import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const RUNNER_TOKEN_PREFIX = "kmp_runner_";
export const RUNNER_TOKEN_LAST_USED_THROTTLE_MS = 5 * 60_000;

const RUNNER_TOKEN_SELECT = "id,name,active,created_at,expires_at,revoked_at,last_used_at";
const lastUsedUpdateCache = new Map<string, number>();

export type RunnerToken = {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
};

export type RunnerTokenRow = {
  id: string;
  name: string;
  active: boolean;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
};

export type RunnerTokenValidation =
  | { ok: true; runner: RunnerToken; legacy?: boolean }
  | { ok: false; status: 401 | 503; error: string; legacy?: boolean };

function clientOrThrow(client?: SupabaseClient) {
  const resolved = client ?? createSupabaseAdminClient();
  if (!resolved) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY belum dikonfigurasi di server.");
  }
  return resolved;
}

function rowToRunnerToken(row: RunnerTokenRow): RunnerToken {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at,
  };
}

export function generateRunnerToken() {
  return `${RUNNER_TOKEN_PREFIX}${crypto.randomBytes(32).toString("hex")}`;
}

export function hashRunnerToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return "";
  return authorization.slice(7).trim();
}

export function validateRunnerTokenRow(row: RunnerTokenRow | null | undefined, now = new Date()): row is RunnerTokenRow {
  if (!row || row.active !== true || row.revoked_at != null) return false;
  if (!row.expires_at) return true;
  const expiresAt = Date.parse(row.expires_at);
  return Number.isFinite(expiresAt) && expiresAt > now.getTime();
}

function shouldUpdateLastUsed(row: RunnerTokenRow, tokenHash: string, nowMs: number) {
  const cached = lastUsedUpdateCache.get(tokenHash);
  if (cached && nowMs - cached < RUNNER_TOKEN_LAST_USED_THROTTLE_MS) return false;

  const lastUsedAt = row.last_used_at ? Date.parse(row.last_used_at) : 0;
  return !Number.isFinite(lastUsedAt) || lastUsedAt <= 0 || nowMs - lastUsedAt >= RUNNER_TOKEN_LAST_USED_THROTTLE_MS;
}

async function updateLastUsedAt(client: SupabaseClient, row: RunnerTokenRow, tokenHash: string, now: Date) {
  if (!shouldUpdateLastUsed(row, tokenHash, now.getTime())) return;

  const { error } = await client
    .from("runner_tokens")
    .update({ last_used_at: now.toISOString() })
    .eq("id", row.id);

  if (!error) lastUsedUpdateCache.set(tokenHash, now.getTime());
}

function validateLegacyRunnerToken(token: string) {
  const legacyToken = process.env.BELANJA_RUNNER_TOKEN?.trim();
  if (!legacyToken) return false;

  const tokenBuffer = Buffer.from(token);
  const legacyBuffer = Buffer.from(legacyToken);
  return tokenBuffer.length === legacyBuffer.length && crypto.timingSafeEqual(tokenBuffer, legacyBuffer);
}

export async function validateRunnerToken(
  token: string,
  options: {
    client?: SupabaseClient;
    now?: Date;
    updateLastUsed?: boolean;
    allowLegacyFallback?: boolean;
  } = {},
): Promise<RunnerTokenValidation> {
  const trimmed = token.trim();
  if (!trimmed) return { ok: false, status: 401, error: "Unauthorized runner" };

  const now = options.now ?? new Date();
  const tokenHash = hashRunnerToken(trimmed);

  try {
    const client = clientOrThrow(options.client);
    const { data, error } = await client
      .from("runner_tokens")
      .select(RUNNER_TOKEN_SELECT)
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (error) throw error;

    const row = data as RunnerTokenRow | null;
    if (validateRunnerTokenRow(row, now)) {
      if (options.updateLastUsed !== false) {
        await updateLastUsedAt(client, row, tokenHash, now);
      }
      return { ok: true, runner: rowToRunnerToken(row) };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : typeof error === "object" && error ? String((error as { message?: unknown }).message ?? "") : "";
    if (/SUPABASE_SERVICE_ROLE_KEY|runner_tokens|schema cache|does not exist|PGRST205|42P01/i.test(message)) {
      if (options.allowLegacyFallback !== false && validateLegacyRunnerToken(trimmed)) {
        return {
          ok: true,
          runner: {
            id: "legacy",
            name: "Legacy Runner Token",
            active: true,
            createdAt: now.toISOString(),
            expiresAt: null,
            revokedAt: null,
            lastUsedAt: null,
          },
        };
      }

      return { ok: false, status: 503, error: "Runner token database belum siap." };
    }
    throw error;
  }

  // Temporary migration fallback. Remove BELANJA_RUNNER_TOKEN from Vercel after all
  // local runners have switched to tokens created from Settings -> Playwright Runners.
  if (options.allowLegacyFallback !== false && validateLegacyRunnerToken(trimmed)) {
    return {
      ok: true,
      legacy: true,
      runner: {
        id: "legacy",
        name: "Legacy Runner Token",
        active: true,
        createdAt: now.toISOString(),
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
      },
    };
  }

  return { ok: false, status: 401, error: "Unauthorized runner" };
}

export async function listRunnerTokens() {
  const client = clientOrThrow();
  const { data, error } = await client
    .from("runner_tokens")
    .select(RUNNER_TOKEN_SELECT)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return ((data ?? []) as RunnerTokenRow[]).map(rowToRunnerToken);
}

export async function createRunnerToken(input: { name: string; expiresAt?: string | null }) {
  const name = input.name.trim();
  if (!name) throw new Error("Nama runner wajib diisi.");

  const token = generateRunnerToken();
  const tokenHash = hashRunnerToken(token);
  const expiresAt = input.expiresAt?.trim() || null;

  if (expiresAt) {
    const parsed = Date.parse(expiresAt);
    if (!Number.isFinite(parsed) || parsed <= Date.now()) throw new Error("Tanggal expiry harus valid dan berada di masa depan.");
  }

  const client = clientOrThrow();
  const { data, error } = await client
    .from("runner_tokens")
    .insert({
      name,
      token_hash: tokenHash,
      active: true,
      expires_at: expiresAt,
    })
    .select(RUNNER_TOKEN_SELECT)
    .single();

  if (error) throw new Error(error.message);
  return { runner: rowToRunnerToken(data as RunnerTokenRow), token };
}

export async function revokeRunnerToken(id: string) {
  if (!id) throw new Error("ID token wajib diisi.");

  const client = clientOrThrow();
  const revokedAt = new Date().toISOString();
  const { data, error } = await client
    .from("runner_tokens")
    .update({ active: false, revoked_at: revokedAt })
    .eq("id", id)
    .select(RUNNER_TOKEN_SELECT)
    .single();

  if (error) throw new Error(error.message);
  return rowToRunnerToken(data as RunnerTokenRow);
}
