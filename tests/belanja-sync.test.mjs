import assert from "node:assert/strict";
import test from "node:test";

import {
  belanjaTextMatches,
  buildBelanjaPayload,
  normalizeBelanjaIsoDate,
  normalizeBelanjaNumber,
  validateBelanjaPayload,
} from "../src/lib/belanja-sync/payload.ts";
import {
  nextFailedBelanjaStatus,
  shouldQueueBelanjaItem,
} from "../src/lib/belanja-sync/status.ts";
import {
  classifyBelanjaAutomationError,
  isPlaywrightTargetClosedError,
} from "../src/lib/belanja-sync/automation-errors.ts";
import { getRunnerConfig } from "../automation/belanja-runner/config.ts";
import { resolveEffectiveDryRun } from "../automation/belanja-runner/mode.ts";

function makeProject() {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    templateId: "template",
    projectName: "Pembangunan KDKMP Desa Babakan Caringin",
    wilayahType: "desa",
    villageName: "Babakan Caringin",
    districtName: "Karangtengah",
    regencyName: "Cianjur",
    regionName: "Kodim 0608",
    projectDate: "2025-11-03",
    responsibleName: "",
    status: "draft",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    items: [],
  };
}

function makeItem(patch = {}) {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    stageCode: "TAHAP_I",
    stageName: "Tahap I",
    category: "I.01 Penyiapan Lahan",
    categoryCode: "I.01",
    categoryName: "Penyiapan Lahan",
    expenseDate: "03/11/2025",
    itemName: "Semen Portland",
    volume: 10,
    unit: "Sak",
    unitPrice: 75000,
    amountOverride: null,
    vendorId: "vendor-cbb",
    vendorName: "CBB",
    sortOrder: 1,
    isIncludedInResumeTotal: true,
    ...patch,
  };
}

test("normalisasi angka dan tanggal untuk payload Belanja", () => {
  assert.equal(normalizeBelanjaNumber("1.250.000,50"), 1250000.5);
  assert.equal(normalizeBelanjaIsoDate("03/11/2025"), "2025-11-03");

  const payload = buildBelanjaPayload(makeProject(), makeItem());
  assert.equal(payload.tanggal, "2025-11-03");
  assert.equal(payload.namaItem, "Semen Portland");
  assert.equal(payload.qty, 10);
  assert.equal(payload.satuan, "Sak");
  assert.equal(payload.hargaSatuan, 75000);
  assert.equal(payload.jumlah, 750000);
  assert.equal(payload.desa, "Babakan Caringin");
  assert.equal(payload.kecamatan, "Karangtengah");
});

test("validasi menolak jumlah yang tidak sama dengan qty x harga satuan", () => {
  const payload = buildBelanjaPayload(makeProject(), makeItem({ amountOverride: 700000 }));
  const validation = validateBelanjaPayload(payload);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(" "), /tidak sama/);
});

test("matching teks belanja menerima urutan kata berbeda pada item target", () => {
  assert.equal(belanjaTextMatches("Mandor Lembur", "lembur Mandor"), true);
  assert.equal(belanjaTextMatches("I.02 Pekerjaan Bouwplank", "I.02"), true);
  assert.equal(belanjaTextMatches("lembur", "lembur Mandor"), false);
  assert.equal(belanjaTextMatches("Kepala Tukang Lembur", "lembur Mandor"), false);
});

test("anti-duplikasi default tidak queue item success atau active", () => {
  assert.deepEqual(shouldQueueBelanjaItem(null), { queue: true, reason: null });
  assert.equal(shouldQueueBelanjaItem("success").queue, false);
  assert.equal(shouldQueueBelanjaItem("pending").queue, false);
  assert.equal(shouldQueueBelanjaItem("processing").queue, false);
  assert.equal(shouldQueueBelanjaItem("needs_review").queue, true);
});

test("kirim ulang eksplisit mengizinkan success untuk queue baru", () => {
  assert.deepEqual(shouldQueueBelanjaItem("success", true), { queue: true, reason: null });
  assert.equal(shouldQueueBelanjaItem("processing", true).queue, false);
});

test("retry gagal hanya kembali pending sebelum max attempt", () => {
  assert.equal(nextFailedBelanjaStatus(1, 3, true), "pending");
  assert.equal(nextFailedBelanjaStatus(3, 3, true), "failed");
  assert.equal(nextFailedBelanjaStatus(1, 3, false), "failed");
});

test("runner retry otomatis saat Playwright menutup page sebelum submit", () => {
  const message = "locator.count: Target page, context or browser has been closed";
  const classified = classifyBelanjaAutomationError(new Error(message), {
    phase: "fill",
    dryRun: false,
  });

  assert.equal(isPlaywrightTargetClosedError(message), true);
  assert.equal(classified.retryable, true);
  assert.equal(classified.resetSession, true);
  assert.equal(classified.metadataJson.automation_phase, "fill");
});

test("runner tidak auto-retry target tertutup saat submit live", () => {
  const classified = classifyBelanjaAutomationError(
    new Error("Target page, context or browser has been closed"),
    { phase: "submit", dryRun: false },
  );

  assert.equal(classified.retryable, false);
  assert.equal(classified.resetSession, true);
  assert.equal(classified.metadataJson.duplicate_check_required, true);
});

test("runner menghormati mode LIVE dari job UI walaupun default env dry-run", () => {
  assert.equal(resolveEffectiveDryRun({ dryRun: true }, { dryRun: false }), false);
  assert.equal(resolveEffectiveDryRun({ dryRun: true }, { dryRun: true }), true);
});

test("runner memakai default polling cepat dan health-check periodik", () => {
  const keys = [
    "TARGET_CHECK_TIMEOUT_MS",
    "BELANJA_RUNNER_POLL_MS",
    "BELANJA_TARGET_CHECK_INTERVAL_MS",
    "BELANJA_TARGET_DISCONNECT_AFTER_FAILURES",
    "BELANJA_RUNNER_HEARTBEAT_MS",
    "BELANJA_RUNNER_STATUS_LOG_MS",
    "BELANJA_API_REQUEST_TIMEOUT_MS",
    "BELANJA_API_REQUEST_RETRIES",
    "BELANJA_SUBMIT_SUCCESS_WAIT_MS",
    "BELANJA_FAST_UI_TIMEOUT_MS",
    "BELANJA_CHOICE_SEARCH_TIMEOUT_MS",
    "BELANJA_CHOICE_SETTLE_MS",
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));

  try {
    for (const key of keys) process.env[key] = "";
    const config = getRunnerConfig();

    assert.equal(config.targetCheckTimeoutMs, 3000);
    assert.equal(config.pollIntervalMs, 1000);
    assert.equal(config.targetCheckIntervalMs, 45000);
    assert.equal(config.targetDisconnectAfterFailures, 8);
    assert.equal(config.heartbeatIntervalMs, 15000);
    assert.equal(config.statusLogIntervalMs, 15000);
    assert.equal(config.apiRequestTimeoutMs, 15000);
    assert.equal(config.apiRequestRetries, 4);
    assert.equal(config.submitSuccessWaitMs, 2000);
    assert.equal(config.fastUiTimeoutMs, 1200);
    assert.equal(config.choiceSearchTimeoutMs, 2000);
    assert.equal(config.choiceSettleMs, 50);
  } finally {
    for (const [key, value] of previous) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
