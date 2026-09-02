import assert from "node:assert/strict";
import test from "node:test";
import {
  generateRunnerToken,
  getBearerToken,
  hashRunnerToken,
  RUNNER_TOKEN_PREFIX,
  validateRunnerToken,
  validateRunnerTokenRow,
  type RunnerTokenRow,
} from "../src/lib/runner-tokens";

function row(overrides: Partial<RunnerTokenRow> = {}): RunnerTokenRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Laptop Utama",
    active: true,
    created_at: "2026-09-02T00:00:00.000Z",
    expires_at: null,
    revoked_at: null,
    last_used_at: null,
    ...overrides,
  };
}

function fakeClient(data: RunnerTokenRow | null) {
  return {
    from(table: string) {
      assert.equal(table, "runner_tokens");
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle() {
          return Promise.resolve({ data, error: null });
        },
      };
    },
  };
}

test("generateRunnerToken memakai prefix dan entropy hex 32 bytes", () => {
  const token = generateRunnerToken();

  assert.match(token, /^kmp_runner_[a-f0-9]{64}$/);
  assert.equal(token.startsWith(RUNNER_TOKEN_PREFIX), true);
});

test("hashRunnerToken menghasilkan SHA-256 dari token penuh", () => {
  assert.equal(
    hashRunnerToken("kmp_runner_test"),
    "bf42c83641fceaa3422e242a0187eb0de0b8886fc955d0e86de72482734f9e81",
  );
});

test("getBearerToken membaca Authorization: Bearer", () => {
  const request = new Request("http://localhost/api", {
    headers: { authorization: "Bearer kmp_runner_abc" },
  });

  assert.equal(getBearerToken(request), "kmp_runner_abc");
});

test("getBearerToken kosong jika Authorization header tidak ada", () => {
  assert.equal(getBearerToken(new Request("http://localhost/api")), "");
});

test("validateRunnerToken menerima token aktif dari database", async () => {
  const result = await validateRunnerToken("kmp_runner_valid", {
    client: fakeClient(row()) as never,
    updateLastUsed: false,
    allowLegacyFallback: false,
  });

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.runner.name, "Laptop Utama");
});

test("validateRunnerToken menolak token random yang tidak ada di database", async () => {
  const result = await validateRunnerToken("random", {
    client: fakeClient(null) as never,
    updateLastUsed: false,
    allowLegacyFallback: false,
  });

  assert.deepEqual(result, { ok: false, status: 401, error: "Unauthorized runner" });
});

test("validateRunnerToken menolak request tanpa token", async () => {
  const result = await validateRunnerToken("", {
    client: fakeClient(row()) as never,
    updateLastUsed: false,
    allowLegacyFallback: false,
  });

  assert.deepEqual(result, { ok: false, status: 401, error: "Unauthorized runner" });
});

test("validateRunnerTokenRow menerima active token tanpa expiry", () => {
  assert.equal(validateRunnerTokenRow(row()), true);
});

test("validateRunnerTokenRow menolak token revoked, inactive, dan expired", () => {
  const now = new Date("2026-09-02T12:00:00.000Z");

  assert.equal(validateRunnerTokenRow(row({ active: false }), now), false);
  assert.equal(validateRunnerTokenRow(row({ revoked_at: "2026-09-02T11:00:00.000Z" }), now), false);
  assert.equal(validateRunnerTokenRow(row({ expires_at: "2026-09-02T11:59:59.000Z" }), now), false);
});

test("validateRunnerTokenRow menerima multiple runner active secara independen", () => {
  const now = new Date("2026-09-02T12:00:00.000Z");
  const tokenA = row({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", name: "Laptop Kos" });
  const tokenB = row({ id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", name: "Laptop Kantor" });

  assert.equal(validateRunnerTokenRow(tokenA, now), true);
  assert.equal(validateRunnerTokenRow(tokenB, now), true);
});

test("satu runner revoked tidak mempengaruhi runner active lain", () => {
  const now = new Date("2026-09-02T12:00:00.000Z");
  const tokenA = row({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", active: false, revoked_at: "2026-09-02T10:00:00.000Z" });
  const tokenB = row({ id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" });

  assert.equal(validateRunnerTokenRow(tokenA, now), false);
  assert.equal(validateRunnerTokenRow(tokenB, now), true);
});
