import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import {
  BelanjaAutomationItemError,
  classifyBelanjaAutomationError,
  type BelanjaAutomationPhase,
} from "../../src/lib/belanja-sync/automation-errors";
import { validateBelanjaPayload } from "../../src/lib/belanja-sync/payload";
import type { ClaimedBelanjaSyncItem } from "../../src/lib/belanja-sync/types";
import { BelanjaSyncApiClient } from "./api-client";
import { createBelanjaContext, ensureAuthenticated } from "./auth";
import { ensureRunnerDirs, targetUrl, type RunnerConfig } from "./config";
import { resolveEffectiveDryRun } from "./mode";
import { compareBelanjaForm, fillBelanjaForm, inspectTargetBelanja, readBelanjaForm, saveDryRunScreenshot, submitBelanjaForm } from "./target";

export type TargetReachability = {
  reachable: boolean;
  url: string;
  status?: number;
  reason: "ok" | "http_error" | "timeout" | "network_error";
  detail?: string;
  elapsedMs: number;
};

type TargetMonitor = {
  check: TargetReachability;
  checkedAt: number;
  consecutiveFailures: number;
  stableReachable: boolean;
};

function log(message: string) {
  const time = new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
  console.log(`[${time}] ${message}`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchErrorDetail(error: unknown) {
  if (!(error instanceof Error)) return "Unknown error.";
  const cause = error.cause;
  const causeCode = cause && typeof cause === "object" && "code" in cause
    ? String((cause as { code?: unknown }).code)
    : "";
  const causeMessage = cause && typeof cause === "object" && "message" in cause
    ? String((cause as { message?: unknown }).message)
    : "";
  return [error.message, causeCode, causeMessage].filter(Boolean).join(" | ");
}

export async function checkTargetReachability(config: RunnerConfig): Promise<TargetReachability> {
  const url = targetUrl(config, config.targetHealthPath || "/login");
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.targetCheckTimeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
    });
    const elapsedMs = Date.now() - startedAt;
    const reachable = response.status >= 200 && response.status < 500;
    return {
      reachable,
      url,
      status: response.status,
      reason: reachable ? "ok" : "http_error",
      detail: reachable
        ? `Target merespons HTTP ${response.status}.`
        : `Target merespons HTTP ${response.status}; cek TARGET_HEALTH_PATH atau kondisi aplikasi target.`,
      elapsedMs,
    };
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const reason = elapsedMs >= config.targetCheckTimeoutMs ? "timeout" : "network_error";
    return {
      reachable: false,
      url,
      reason,
      detail: reason === "timeout"
        ? `Timeout setelah ${config.targetCheckTimeoutMs}ms; cek VPN/jaringan/firewall.`
        : fetchErrorDetail(error),
      elapsedMs,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function isTargetReachable(config: RunnerConfig) {
  return (await checkTargetReachability(config)).reachable;
}

function shouldRefreshTargetCheck(monitor: TargetMonitor | null, config: RunnerConfig) {
  if (!monitor) return true;
  const intervalMs = monitor.stableReachable ? config.targetCheckIntervalMs : config.pollIntervalMs;
  return Date.now() - monitor.checkedAt >= intervalMs;
}

async function updateTargetMonitor(config: RunnerConfig, monitor: TargetMonitor | null) {
  const check = await checkTargetReachability(config);
  const consecutiveFailures = check.reachable ? 0 : (monitor?.consecutiveFailures ?? 0) + 1;
  return {
    check,
    checkedAt: Date.now(),
    consecutiveFailures,
    stableReachable: check.reachable || ((monitor?.stableReachable ?? false) && consecutiveFailures < config.targetDisconnectAfterFailures),
  };
}

function monitorMessage(monitor: TargetMonitor) {
  return `Website/VPN target tidak dapat diakses. ${monitor.check.detail ?? monitor.check.reason}`;
}

async function createSession(config: RunnerConfig) {
  const browser = await chromium.launch({ headless: !config.headed });
  const context = await createBelanjaContext(browser, config);
  const page = await context.newPage();
  await ensureAuthenticated(page, context, config);
  return { browser, context, page };
}

async function processClaim(api: BelanjaSyncApiClient, config: RunnerConfig, page: Page, claim: ClaimedBelanjaSyncItem) {
  const { job, item } = claim;
  const payload = item.payload;
  const effectiveDryRun = resolveEffectiveDryRun(config, job);
  let phase: BelanjaAutomationPhase = "unknown";
  log(`Item ${payload.namaItem} | ${payload.desa ?? "-"} | ${effectiveDryRun ? "DRY RUN" : "LIVE"}`);

  const validation = validateBelanjaPayload(payload);
  if (!validation.valid) {
    await api.markFailed(item.id, {
      errorMessage: validation.errors.join(" "),
      retryable: false,
      metadataJson: { validation },
    });
    return;
  }

  if (!effectiveDryRun && !config.fieldMapVerified) {
    await api.markFailed(item.id, {
      errorMessage: "Live mode diblokir karena BELANJA_FIELD_MAP_VERIFIED=false. Verifikasi mapping via dry run terlebih dahulu.",
      retryable: false,
    });
    return;
  }

  let formValues: Awaited<ReturnType<typeof readBelanjaForm>>;
  let comparison: ReturnType<typeof compareBelanjaForm>;
  let screenshotPath: string | null = null;
  try {
    phase = "fill";
    await fillBelanjaForm(page, config, payload);
    phase = "read";
    formValues = await readBelanjaForm(page);
    comparison = compareBelanjaForm(payload, formValues);
    if (effectiveDryRun || !comparison.ok) {
      phase = "screenshot";
      screenshotPath = await saveDryRunScreenshot(page, config, job.id, item.id);
    }
  } catch (error) {
    throw classifyBelanjaAutomationError(error, { phase, dryRun: effectiveDryRun });
  }

  if (!comparison.ok) {
    await api.markFailed(item.id, {
      errorMessage: comparison.mismatches.join(" | "),
      retryable: false,
      metadataJson: { comparison, screenshot_path: screenshotPath },
    });
    log(`FAILED mapping mismatch: ${comparison.mismatches.join(" | ")}`);
    return;
  }

  log("Form filled dan mapping sesuai Resume.");
  if (effectiveDryRun) {
    await api.markSuccess(item.id, {
      dryRun: true,
      metadataJson: { comparison, screenshot_path: screenshotPath },
    });
    log(`DRY_RUN_OK screenshot=${screenshotPath}`);
    return;
  }

  let submitResult: Awaited<ReturnType<typeof submitBelanjaForm>>;
  try {
    phase = "submit";
    submitResult = await submitBelanjaForm(page, config);
  } catch (error) {
    throw classifyBelanjaAutomationError(error, { phase, dryRun: effectiveDryRun });
  }
  await api.markSuccess(item.id, {
    dryRun: false,
    targetReference: submitResult.targetReference,
    metadataJson: { comparison },
  }).catch((error) => {
    throw new BelanjaAutomationItemError(
      `Transaksi target kemungkinan sudah tersimpan, tetapi WEB NOTA gagal mencatat SUCCESS: ${error instanceof Error ? error.message : "unknown"}. Cek manual sebelum kirim ulang agar tidak duplikat.`,
      {
        retryable: false,
        resetSession: false,
        metadataJson: {
          automation_phase: "submit",
          target_reference: submitResult.targetReference,
          duplicate_check_required: true,
          success_mark_failed: true,
        },
      },
    );
  });
  log(`SUCCESS targetRef=${submitResult.targetReference ?? "-"}`);
}

export async function runBelanjaRunner(config: RunnerConfig, options: { once?: boolean } = {}) {
  ensureRunnerDirs(config);
  const api = new BelanjaSyncApiClient(config);
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let authenticated = false;
  let targetMonitor: TargetMonitor | null = null;
  let lastHeartbeatAt = 0;
  let lastHeartbeatTargetStatus: TargetReachability["reachable"] | null = null;
  let lastStatusLogAt = 0;
  let cachedPendingCount = 0;

  console.log("================================");
  console.log("KDKMP BELANJA AUTOMATION RUNNER");
  console.log("================================");

  try {
    while (true) {
      let refreshedTargetCheck = false;
      if (shouldRefreshTargetCheck(targetMonitor, config)) {
        targetMonitor = await updateTargetMonitor(config, targetMonitor);
        refreshedTargetCheck = true;
        if (!targetMonitor.check.reachable) {
          const remaining = Math.max(config.targetDisconnectAfterFailures - targetMonitor.consecutiveFailures, 0);
          if (targetMonitor.stableReachable && remaining > 0) {
            log(`Health-check target timeout sementara (${targetMonitor.check.reason}) url=${targetMonitor.check.url}; lanjut dulu, disconnected setelah ${remaining} gagal lagi.`);
          }
        }
      }

      const reachable = targetMonitor?.stableReachable ?? false;
      const shouldHeartbeat = Date.now() - lastHeartbeatAt >= config.heartbeatIntervalMs || lastHeartbeatTargetStatus !== reachable;
      if (shouldHeartbeat) {
        const message = targetMonitor && !reachable ? monitorMessage(targetMonitor) : null;
        await api.heartbeat({
          status: reachable ? "ready" : "paused",
          targetStatus: reachable ? "connected" : "disconnected",
          dryRun: config.dryRun,
          targetBaseUrl: config.targetBaseUrl,
          message,
        }).then(() => {
          lastHeartbeatAt = Date.now();
          lastHeartbeatTargetStatus = reachable;
        }).catch((error) => log(`Heartbeat gagal: ${error instanceof Error ? error.message : "unknown"}`));
      }

      if (!reachable) {
        const targetCheck = targetMonitor?.check;
        if (refreshedTargetCheck) {
          log(`Website/VPN target unreachable (${targetCheck?.reason ?? "unknown"}) url=${targetCheck?.url ?? config.targetBaseUrl}. Runner pause sebelum claim item.`);
          if (targetCheck?.detail) log(targetCheck.detail);
        }
        if (options.once) break;
        await sleep(config.pollIntervalMs);
        continue;
      }

      if (!browser || !context || !page) {
        ({ browser, context, page } = await createSession(config));
        authenticated = true;
      }

      if (Date.now() - lastStatusLogAt >= config.statusLogIntervalMs) {
        cachedPendingCount = await api.pendingCount().catch(() => cachedPendingCount);
        console.log(`Target        : connected`);
        console.log(`VPN/Website   : reachable`);
        console.log(`Login         : ${authenticated ? "authenticated" : "not authenticated"}`);
        console.log(`Queue         : ${cachedPendingCount} pending`);
        console.log(`Runner        : READY`);
        console.log("=====================");
        lastStatusLogAt = Date.now();
      }

      let claim: ClaimedBelanjaSyncItem | null = null;
      try {
        ({ claim } = await api.claim());
      } catch (error) {
        log(`Koneksi WEB NOTA sementara gagal saat claim: ${error instanceof Error ? error.message : "unknown"}. Runner tetap hidup dan retry.`);
        if (options.once) break;
        await sleep(config.pollIntervalMs);
        continue;
      }
      if (!claim) {
        log("Tidak ada item pending.");
        if (options.once) break;
        await sleep(config.pollIntervalMs);
        continue;
      }

      await api.heartbeat({
        status: "busy",
        targetStatus: "connected",
        dryRun: resolveEffectiveDryRun(config, claim.job),
        targetBaseUrl: config.targetBaseUrl,
      }).then(() => {
        lastHeartbeatAt = Date.now();
        lastHeartbeatTargetStatus = true;
      }).catch((error) => log(`Heartbeat busy gagal: ${error instanceof Error ? error.message : "unknown"}; item tetap diproses.`));

      try {
        await processClaim(api, config, page, claim);
      } catch (error) {
        const classified = error instanceof BelanjaAutomationItemError
          ? error
          : classifyBelanjaAutomationError(error, { dryRun: resolveEffectiveDryRun(config, claim.job) });
        const message = classified.message;
        log(`FAILED ${message}`);
        await api.markFailed(claim.item.id, {
          errorMessage: message,
          retryable: classified.retryable,
          metadataJson: classified.metadataJson,
        }).catch((markError) => log(`Gagal update status failed: ${markError instanceof Error ? markError.message : "unknown"}`));
        if (classified.resetSession) {
          await browser?.close().catch(() => {});
          browser = null;
          context = null;
          page = null;
          authenticated = false;
          targetMonitor = null;
        }
      }

      if (options.once) break;
    }
  } finally {
    await browser?.close().catch(() => {});
  }
}

export async function inspectBelanjaTarget(config: RunnerConfig) {
  ensureRunnerDirs(config);
  const { browser, page } = await createSession(config);
  try {
    const result = await inspectTargetBelanja(page, config);
    log(`Inspect tersimpan: ${result.filePath}`);
    return result;
  } finally {
    await browser.close();
  }
}
