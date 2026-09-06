import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import type { BelanjaSyncItem, BelanjaSyncJob, BelanjaTransactionPayload, ClaimedBelanjaSyncJob, KdkmpIdentity } from "../../src/lib/belanja-sync/types";
import { createBelanjaContext, ensureAuthenticated } from "./auth";
import { ensureRunnerDirs, getRunnerConfig } from "./config";
import { compareDestinationTransactions } from "./copy-reconcile";

async function main() {
  const jobId = process.argv.find((value) => value.startsWith("--job="))?.slice(6);
  if (!jobId || !/^[a-f0-9-]{36}$/i.test(jobId)) throw new Error("Gunakan --job=<job UUID existing>.");
  const config = getRunnerConfig();
  ensureRunnerDirs(config);
  const response = await fetch(new URL(`/api/belanja-sync/jobs/${jobId}`, config.notaKmpBaseUrl), { signal: AbortSignal.timeout(config.apiRequestTimeoutMs) });
  if (!response.ok) throw new Error(`Gagal membaca job: HTTP ${response.status}`);
  const { job, items } = await response.json() as { job: BelanjaSyncJob; items: BelanjaSyncItem[] };
  const claim: ClaimedBelanjaSyncJob = {
    job, items, transactions: items.map((item) => item.payload as unknown as BelanjaTransactionPayload).sort((a, b) => a.sequence - b.sequence),
    destinationKdkmp: job.metadataJson?.destination_kdkmp as KdkmpIdentity,
    sourceKdkmp: job.metadataJson?.source_kdkmp as KdkmpIdentity,
    expectedTransactionCount: Number(job.metadataJson?.expected_transactions),
    stage: "DESTINATION_COPIED", completedTransactionIds: [],
  };
  if (job.operationType !== "copy_reconcile_v1" || !claim.destinationKdkmp?.village) throw new Error("Job bukan copy/reconcile dengan destination valid.");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await createBelanjaContext(browser, config);
    const page = await context.newPage();
    await ensureAuthenticated(page, context, config);
    const result = await compareDestinationTransactions(page, config, claim);
    const report = { mode: "COMPARE_ONLY", destination: claim.destinationKdkmp, transactionCount: result.rows.length,
      expectedTotal: result.diagnostic.expectedTotal, actualTotal: result.diagnostic.actualTotal, difference: result.diagnostic.totalDifference,
      stages: result.stages, scanMs: result.scanMs,
      changes: result.entries.filter((entry) => entry.differences.length).map((entry) => ({ transactionId: entry.transaction.transactionId, name: entry.transaction.namaItem, differences: entry.differences })),
    };
    const reportPath = path.join(config.artifactsDir, `compare-${jobId}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, stages: undefined, changes: report.changes.length, reportPath }, null, 2));
  } finally { await browser.close(); }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
