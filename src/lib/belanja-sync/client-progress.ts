"use client";

import type { BelanjaSyncProgressSnapshot } from "./progress-server";
export type { BelanjaSyncProgressSnapshot } from "./progress-server";

const CACHE_KEY = "kdkmp.belanja-sync.progress.v1";

function readCache(): BelanjaSyncProgressSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) as BelanjaSyncProgressSnapshot : null;
  } catch {
    window.localStorage.removeItem(CACHE_KEY);
    return null;
  }
}

function writeCache(snapshot: BelanjaSyncProgressSnapshot) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // Cache failure must never block progress UI.
  }
}

export function readCachedBelanjaSyncProgress() {
  return readCache();
}

export async function fetchBelanjaSyncProgress(timeoutMs = 5_000) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("/api/belanja-sync/progress", {
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as (BelanjaSyncProgressSnapshot & { error?: string }) | null;
    if (!response.ok || !payload) {
      throw new Error(payload?.error ?? "Gagal memuat progress Belanja Sync.");
    }
    writeCache(payload);
    return payload;
  } finally {
    window.clearTimeout(timeout);
  }
}
