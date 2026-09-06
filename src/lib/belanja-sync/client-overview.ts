import type { BelanjaRunnerHeartbeat, BelanjaSyncOverviewProject } from "./types";

const BELANJA_OVERVIEW_CACHE_KEY = "kdkmp.belanja-sync.overview.v1";

export type BelanjaSyncOverviewPayload = {
  schemaReady: boolean;
  runner: BelanjaRunnerHeartbeat | null;
  projects: BelanjaSyncOverviewProject[];
  errorMessage?: string;
  cachedAt?: string;
};

type FetchOverviewOptions = {
  force?: boolean;
  maxCacheAgeMs?: number;
  retries?: number;
  timeoutMs?: number;
};

function readCache(): BelanjaSyncOverviewPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(BELANJA_OVERVIEW_CACHE_KEY);
    return value ? (JSON.parse(value) as BelanjaSyncOverviewPayload) : null;
  } catch {
    window.localStorage.removeItem(BELANJA_OVERVIEW_CACHE_KEY);
    return null;
  }
}

function writeCache(payload: BelanjaSyncOverviewPayload) {
  if (typeof window === "undefined" || !payload.schemaReady) return;
  try {
    window.localStorage.setItem(BELANJA_OVERVIEW_CACHE_KEY, JSON.stringify({ ...payload, cachedAt: new Date().toISOString() }));
  } catch {
    // Keep the UI responsive even when browser storage is unavailable.
  }
}

function isCacheFresh(payload: BelanjaSyncOverviewPayload | null, maxAgeMs: number) {
  const timestamp = Date.parse(payload?.cachedAt ?? "");
  return Boolean(payload && Number.isFinite(timestamp) && Date.now() - timestamp <= maxAgeMs);
}

function isTransientOverviewError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /timeout|timed out|network|fetch failed|failed to fetch|load failed|abort|502|503|504|rate limit|too many requests/i.test(message);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOverviewOnce(timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch("/api/belanja-sync/overview", {
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as Partial<BelanjaSyncOverviewPayload> & { error?: string } | null;
    if (!response.ok) {
      throw new Error(payload?.error ?? payload?.errorMessage ?? "Gagal memuat overview Belanja Sync.");
    }
    return {
      schemaReady: payload?.schemaReady === true,
      runner: payload?.runner ?? null,
      projects: Array.isArray(payload?.projects) ? payload.projects : [],
      errorMessage: payload?.errorMessage,
    } satisfies BelanjaSyncOverviewPayload;
  } catch (error) {
    if (timedOut) {
      throw new Error(`Overview Belanja Sync melewati batas ${Math.round(timeoutMs / 1000)} detik.`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function readCachedBelanjaSyncOverview() {
  return readCache();
}

export async function fetchBelanjaSyncOverview(options: FetchOverviewOptions = {}) {
  const cached = readCache();
  const maxCacheAgeMs = options.maxCacheAgeMs ?? 30_000;
  if (!options.force && isCacheFresh(cached, maxCacheAgeMs)) return cached as BelanjaSyncOverviewPayload;

  const retries = options.retries ?? 2;
  const timeoutMs = options.timeoutMs ?? 10_000;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const payload = await fetchOverviewOnce(timeoutMs);
      writeCache(payload);
      return payload;
    } catch (error) {
      lastError = error;
      if (!isTransientOverviewError(error) || attempt >= retries) break;
      await sleep(Math.min(600 * 2 ** attempt, 2_500));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Gagal memuat overview Belanja Sync.");
}
