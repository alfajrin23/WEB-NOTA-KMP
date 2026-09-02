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
import { ensureRunnerDirs, type RunnerConfig } from "./config";
import { compareBelanjaForm, fillBelanjaForm, inspectTargetBelanja, readBelanjaForm, saveDryRunScreenshot, submitBelanjaForm } from "./target";

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

export async function isTargetReachable(config: RunnerConfig) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(new URL("/login", config.targetBaseUrl), { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
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
  const effectiveDryRun = config.dryRun || job.dryRun;
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
  let screenshotPath: string;
  try {
    phase = "fill";
    await fillBelanjaForm(page, config, payload);
    phase = "read";
    formValues = await readBelanjaForm(page);
    comparison = compareBelanjaForm(payload, formValues);
    phase = "screenshot";
    screenshotPath = await saveDryRunScreenshot(page, config, job.id, item.id);
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
    submitResult = await submitBelanjaForm(page);
  } catch (error) {
    throw classifyBelanjaAutomationError(error, { phase, dryRun: effectiveDryRun });
  }
  await api.markSuccess(item.id, {
    dryRun: false,
    targetReference: submitResult.targetReference,
    metadataJson: { comparison },
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

  console.log("================================");
  console.log("KDKMP BELANJA AUTOMATION RUNNER");
  console.log("================================");

  try {
    while (true) {
      const reachable = await isTargetReachable(config);
      await api.heartbeat({
        status: reachable ? "ready" : "paused",
        targetStatus: reachable ? "connected" : "disconnected",
        dryRun: config.dryRun,
        targetBaseUrl: config.targetBaseUrl,
        message: reachable ? null : "Website/VPN target tidak dapat diakses.",
      }).catch((error) => log(`Heartbeat gagal: ${error instanceof Error ? error.message : "unknown"}`));

      if (!reachable) {
        log("Website/VPN target unreachable. Runner pause sebelum claim item.");
        if (options.once) break;
        await sleep(config.pollIntervalMs);
        continue;
      }

      if (!browser || !context || !page) {
        ({ browser, context, page } = await createSession(config));
        authenticated = true;
      }

      const pendingCount = await api.pendingCount().catch(() => 0);
      console.log(`Target        : connected`);
      console.log(`VPN/Website   : reachable`);
      console.log(`Login         : ${authenticated ? "authenticated" : "not authenticated"}`);
      console.log(`Queue         : ${pendingCount} pending`);
      console.log(`Runner        : READY`);
      console.log("=====================");

      const { claim } = await api.claim();
      if (!claim) {
        log("Tidak ada item pending.");
        if (options.once) break;
        await sleep(config.pollIntervalMs);
        continue;
      }

      await api.heartbeat({
        status: "busy",
        targetStatus: "connected",
        dryRun: config.dryRun || claim.job.dryRun,
        targetBaseUrl: config.targetBaseUrl,
      });

      try {
        await processClaim(api, config, page, claim);
      } catch (error) {
        const classified = error instanceof BelanjaAutomationItemError
          ? error
          : classifyBelanjaAutomationError(error, { dryRun: config.dryRun || claim.job.dryRun });
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
