import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  belanjaTextMatches,
  buildBelanjaPayload,
  normalizeBelanjaIsoDate,
  normalizeBelanjaNumber,
  validateBelanjaPayload,
} from "../src/lib/belanja-sync/payload.ts";
import {
  buildDestinationKdkmp,
  findKdkmpOption,
  formatKdkmpIdentity,
  isMaleberSource,
  parseKdkmpOptionText,
  SOURCE_KDKMP,
} from "../src/lib/belanja-sync/kdkmp.ts";
import {
  buildBelanjaIdempotencyKey,
  buildBelanjaTransactionPlan,
  DEFAULT_BELANJA_BASE_TRANSACTION_COUNT,
  inferHonorariumRole,
  resolveHonorariumRecipient,
} from "../src/lib/belanja-sync/transaction-plan.ts";
import {
  nextFailedBelanjaStatus,
  shouldQueueBelanjaItem,
} from "../src/lib/belanja-sync/status.ts";
import {
  classifyBelanjaAutomationError,
  isPlaywrightTargetClosedError,
} from "../src/lib/belanja-sync/automation-errors.ts";
import {
  BELANJA_RUNNER_VERSION,
  MIN_COPY_RECONCILE_RUNNER_VERSION,
  isBelanjaRunnerVersionSupported,
} from "../src/lib/belanja-sync/runner-version.ts";
import { getRunnerConfig, loadLocalEnv } from "../automation/belanja-runner/config.ts";
import { resolveEffectiveDryRun, resolveEffectiveFieldMapVerified } from "../automation/belanja-runner/mode.ts";
import {
  diagnoseDestinationBudget,
  assertSnapshotDestination,
  compareTransactionSnapshot,
  detailNamesMatch,
  findLookupItemForLine,
  matchLine,
  matchResumeToTargetTransaction,
  formatBudgetDiagnostics,
  genericHonorariumNameMatches,
  shouldPreserveTemplateHonorariumDetails,
  planDestinationBudgetRepairs,
  planStageBudgetReconcile,
  shouldReconcileTransactionForStageBudgetPlan,
} from "../automation/belanja-runner/copy-reconcile.ts";

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

const templateRows = [
  ["V", "V.03", "Pekerjaan Proteksi Petir", "material", "2026-03-11"],
  ["VI", "VI.10", "Trafo dan Tiang Listrik", "labor", "2026-03-11"],
  ["VI", "VI.07", "Sumur Bor", "labor", "2026-03-11"],
  ["V", "V.02", "Instalasi Penerangan/Kotak", "material", "2026-03-10"],
  ["IV", "IV.01", "Air Bersih", "labor", "2026-03-09"],
  ["V", "V.01", "Distribusi listrik", "labor", "2026-03-09"],
  ["IV", "IV.01", "Air Bersih", "material", "2026-03-09"],
  ["IV", "IV.02", "Air Kotor/Bekas", "material", "2026-03-09"],
  ["IV", "IV.01", "Air Bersih", "equipment", "2026-03-09"],
  ["IV", "IV.03", "Pembuangan Air Hujan", "material", "2026-03-09"],
  ["V", "V.01", "Distribusi listrik", "material", "2026-03-09"],
  ["III", "III.05", "Kusen", "labor", "2026-02-20"],
  ["III", "III.05", "Kusen", "material", "2026-02-18"],
  ["III", "III.07", "Penutup Atap", "material", "2026-02-18"],
  ["III", "III.08", "Facade", "labor", "2026-02-18"],
  ["III", "III.06", "Sanitair", "material", "2026-02-18"],
  ["III", "III.05", "Kusen", "labor", "2026-02-12"],
  ["III", "III.04", "Finishing Cat", "material", "2026-02-11"],
  ["III", "III.07", "Penutup Atap", "labor", "2026-02-09"],
  ["III", "III.03", "Penutup Langit-Langit", "material", "2026-02-04"],
  ["VII", "VII.01", "Biaya Operasional", "labor", "2026-02-03"],
  ["III", "III.01", "Pasangan", "labor", "2026-02-03"],
  ["III", "III.01", "Pasangan", "labor", "2026-02-02"],
  ["III", "III.02", "Lantai dan Dinding", "material", "2026-02-02"],
  ["III", "III.01", "Pasangan", "equipment", "2026-02-02"],
  ["II", "II.02", "Struktur Atas Bangunan", "material", "2026-01-14"],
  ["III", "III.01", "Pasangan", "material", "2026-01-07"],
  ["II", "II.03", "Rangka Atap", "labor", "2026-01-03"],
  ["II", "II.03", "Rangka Atap", "material", "2026-01-02"],
  ["II", "II.02", "Struktur Atas Bangunan", "equipment", "2025-12-29"],
  ["II", "II.01", "Struktur Bawah", "labor", "2025-12-29"],
  ["I", "I.02", "Bouwplank", "labor", "2025-12-04"],
  ["VI", "VI.06", "Cut and Fill", "equipment", "2025-12-02"],
  ["VI", "VI.01", "Sosialisasi", "labor", "2025-12-01"],
  ["I", "I.02", "Bouwplank", "equipment", "2025-12-01"],
  ["I", "I.02", "Bouwplank", "labor", "2025-12-01"],
  ["VI", "VI.04", "Penyiapan Lahan", "labor", "2025-12-01"],
  ["VI", "VI.05", "Pematangan Lahan", "labor", "2025-12-01"],
  ["VI", "VI.03", "Survei/Pengukuran Kelayakan", "labor", "2025-12-01"],
  ["I", "I.01", "Pembersihan Lahan", "material", "2025-12-01"],
  ["VI", "VI.02", "Rapat Koordinasi", "material", "2025-12-01"],
  ["II", "II.01", "Struktur Bawah", "material", "2025-12-01"],
  ["I", "I.02", "Bouwplank", "material", "2025-12-01"],
];

function makeTemplatePlanProject() {
  const project = makeProject();
  return {
    ...project,
    villageName: "Mekarsari",
    districtName: "Cianjur",
    regencyName: "Cianjur",
    items: templateRows.map(([roman, code, name, type, date], index) => makeItem({
      id: `33333333-3333-3333-3333-${String(index + 1).padStart(12, "0")}`,
      stageCode: `TAHAP_${roman}`,
      stageName: `${roman} - PEKERJAAN`,
      category: `${code} ${name}`,
      categoryCode: code,
      categoryName: name,
      expenseDate: date,
      itemName: type === "labor" ? `${name} Mandor` : `${name} Item`,
      volume: index + 1,
      unit: type === "labor" ? "Orang-Hari" : type === "equipment" ? "Hari" : "Unit",
      unitPrice: 1000 + index,
      vendorName: type === "labor" ? "" : `Vendor ${index + 1}`,
      sortOrder: index + 1,
      expenseType: type,
    })),
  };
}

function makeTargetRowsFromPlan(plan) {
  return plan.transactions.map((transaction, index) => ({
    rowIndex: index + 1,
    uuid: `target-${index + 1}`,
    editHref: `/belanja/${index + 1}/edit`,
    kdkmpText: "Koperasi Desa Mekarsari",
    stageText: transaction.transactionIdentity.stageText,
    itemText: `${transaction.transactionIdentity.categoryCode} ${transaction.transactionIdentity.categoryText}`,
    belanjaCategoryText: transaction.transactionIdentity.belanjaCategoryText,
    totalText: String(transaction.totalAmount),
    dateText: transaction.transactionIdentity.transactionDate,
    identityKey: "",
  }));
}

function snapshotFor(transaction) {
  return { destination: "Koperasi Desa Muka (Jawa Barat, Cianjur, Cianjur, Muka)",
    stage: transaction.transactionIdentity.stageText,
    category: `${transaction.transactionIdentity.categoryCode} ${transaction.transactionIdentity.categoryText}`,
    kind: transaction.transactionIdentity.belanjaCategoryText, date: transaction.transactionIdentity.transactionDate,
    lines: transaction.lines.map((line, index) => ({ index, name: line.namaItem, qty: line.qty,
      unitPrice: line.hargaSatuan, subtotal: line.jumlah, paymentDate: line.tanggal, recipient: line.vendor })),
  };
}

test("signature mendeteksi qty/harga tertukar meskipun subtotal tetap sama", () => {
  const plan = buildBelanjaTransactionPlan(makeTemplatePlanProject());
  const transaction = plan.transactions.find((t) => t.kind === "material");
  const snapshot = snapshotFor(transaction);
  const correct = compareTransactionSnapshot(transaction, snapshot);
  assert.deepEqual(correct.differences, []);
  assert.equal(correct.expectedSignature, correct.actualSignature);
  snapshot.lines[0].qty *= 2;
  snapshot.lines[0].unitPrice /= 2;
  const diff = compareTransactionSnapshot(transaction, snapshot);
  assert.equal(diff.differences.length, 2);
  assert.notEqual(diff.expectedSignature, diff.actualSignature);
});

test("signature menerima skala qty ribuan target hanya jika subtotal tetap sama", () => {
  const transaction = buildBelanjaTransactionPlan(makeTemplatePlanProject()).transactions.find((t) => t.kind === "material");
  transaction.lines = [{
    ...transaction.lines[0],
    lineId: "batu-bata-line",
    namaItem: "Batu Bata Merah",
    qty: 1500,
    satuan: "Buah",
    hargaSatuan: 1200,
    jumlah: 1800000,
    tanggal: "2026-04-15",
    vendor: "NOTA KOSONG",
  }];
  transaction.lineCount = 1;
  transaction.totalAmount = 1800000;
  const snapshot = snapshotFor(transaction);
  snapshot.lines[0] = {
    ...snapshot.lines[0],
    name: "Batu Bata Merah",
    qty: 1.5,
    unit: "Buah",
    unitPrice: 1200,
    subtotal: 1800000,
    paymentDate: "2026-04-15",
    recipient: "NOTA KOSONG",
  };
  const accepted = compareTransactionSnapshot(transaction, snapshot);
  assert.deepEqual(accepted.differences, []);
  assert.equal(accepted.expectedSignature, accepted.actualSignature);

  snapshot.lines[0].subtotal = 1799900;
  const rejected = compareTransactionSnapshot(transaction, snapshot);
  assert.match(rejected.differences.join(" "), /Batu Bata Merah qty|Batu Bata Merah subtotal/);
  assert.notEqual(rejected.expectedSignature, rejected.actualSignature);
});

test("signature menolak penerima kosong dan memakai jabatan dari nama transaksi", () => {
  const transaction = buildBelanjaTransactionPlan(makeTemplatePlanProject()).transactions.find((t) => t.kind === "honorarium");
  transaction.lines[0].namaItem = "Lembur Mandor";
  transaction.lines[0].recipient = "Nama Maleber";
  const snapshot = snapshotFor(transaction);
  snapshot.lines[0].recipient = "";
  assert.match(compareTransactionSnapshot(transaction, snapshot).differences.join(" "), /penerima.*Mandor/);
  snapshot.lines[0].recipient = "Mandor";
  assert.deepEqual(compareTransactionSnapshot(transaction, snapshot).differences, []);
});

test("signature honorarium role other boleh mempertahankan penerima target existing", () => {
  const transaction = buildBelanjaTransactionPlan(makeTemplatePlanProject()).transactions.find((t) => t.kind === "honorarium");
  transaction.lines[0].namaItem = "Uang Jalan / Pengawalan Lapangan";
  transaction.lines[0].role = "other";
  transaction.lines[0].recipient = "Honorarium";
  transaction.lines[0].vendor = "KWITANSI";
  const snapshot = snapshotFor(transaction);
  snapshot.lines[0].recipient = "Serma Andri Rolen";
  assert.deepEqual(compareTransactionSnapshot(transaction, snapshot).differences, []);
});

test("honorarium operasional VII.01 mempertahankan rincian Maleber dan hanya wajib tanggal sesuai resume", () => {
  const plan = buildBelanjaTransactionPlan(makeTemplatePlanProject());
  const base = plan.transactions.find((transaction) => transaction.transactionIdentity.categoryCode === "VII.01");
  assert.ok(base);
  const transaction = {
    ...base,
    totalAmount: 18400000,
    hargaSatuan: 18400000,
    jumlah: 18400000,
    transactionIdentity: {
      ...base.transactionIdentity,
      categoryText: "Biaya Operasional Lapangan",
      transactionDate: "2026-02-10",
    },
    lines: [{
      ...base.lines[0],
      namaItem: "Upah Honorium",
      qty: 1,
      hargaSatuan: 18400000,
      jumlah: 18400000,
      tanggal: "2026-02-10",
      recipient: "Honorarium",
      vendor: "",
    }],
    lineCount: 1,
  };
  const snapshot = {
    ...snapshotFor(transaction),
    date: "2026-02-10",
    lines: [
      { index: 0, name: "Mandor Lapangan", qty: 10, unitPrice: 500000, subtotal: 5000000, paymentDate: "2026-02-03", recipient: "Mandor" },
      { index: 1, name: "Pengawas Operasional", qty: 8, unitPrice: 800000, subtotal: 6400000, paymentDate: "2026-02-03", recipient: "Pengawas" },
      { index: 2, name: "Administrasi Gerai", qty: 7, unitPrice: 1000000, subtotal: 7000000, paymentDate: "2026-02-03", recipient: "Admin" },
    ],
  };

  assert.equal(shouldPreserveTemplateHonorariumDetails(transaction), true);
  const needsDateEdit = compareTransactionSnapshot(transaction, snapshot);
  assert.match(needsDateEdit.differences.join(" "), /Tanggal bayar honorarium template/);
  assert.notEqual(needsDateEdit.expectedSignature, needsDateEdit.actualSignature);

  const saved = {
    ...snapshot,
    lines: snapshot.lines.map((line) => ({ ...line, paymentDate: "2026-02-10" })),
  };
  const accepted = compareTransactionSnapshot(transaction, saved);
  assert.deepEqual(accepted.differences, []);
  assert.equal(accepted.expectedSignature, accepted.actualSignature);
});

test("budget mendeteksi selisih satu rupiah dan tahap di luar tujuh tahap", () => {
  const plan = buildBelanjaTransactionPlan(makeTemplatePlanProject());
  const transaction = plan.transactions[0];
  transaction.transactionIdentity.stageText = "VIII - TAMBAHAN";
  const rows = makeTargetRowsFromPlan(plan);
  rows[0].totalText = String(transaction.totalAmount - 1);
  const diagnostic = diagnoseDestinationBudget(rows, plan.transactions);
  assert.equal(diagnostic.totalDifference, -1);
  assert.equal(diagnostic.stages.find((stage) => stage.stageKey === "VIII").issues.length, 1);
});

test("guard destination menolak desa atau kecamatan yang berbeda", () => {
  const transaction = buildBelanjaTransactionPlan(makeTemplatePlanProject()).transactions[0];
  const snapshot = snapshotFor(transaction);
  const expected = { village: "Muka", district: "Cianjur", regency: "Cianjur", province: "Jawa Barat" };
  assert.doesNotThrow(() => assertSnapshotDestination(snapshot, expected));
  assert.throws(() => assertSnapshotDestination(snapshot, { ...expected, district: "Karangtengah" }), /Destination salah/);
  assert.throws(() => assertSnapshotDestination({ ...snapshot, destination: "" }, expected), /Destination salah/);
});

test("matching menolak ukuran berbeda dan kandidat ambigu", () => {
  assert.equal(detailNamesMatch("Besi 18 mm", "Besi 8 mm"), false);
  assert.equal(detailNamesMatch("Besi 10 mm", "Besi 8 mm"), false);
  assert.equal(detailNamesMatch("Hebeul 10 (standard) - BH", "Hebel 10"), true);
  const line = { namaItem: "Semen", qty: 10, hargaSatuan: 100, jumlah: 1000 };
  assert.throws(() => matchLine(line, [{ index: 0, name: "Semen" }, { index: 1, name: "Semen" }], new Set()), /ambigu/);
});

test("matching memilih material duplicate berdasarkan tanggal bayar dan vendor", () => {
  const line = {
    namaItem: "Besi Polos 8 mm",
    qty: 118,
    hargaSatuan: 37000,
    jumlah: 4366000,
    tanggal: "2026-03-30",
    vendor: "CBB",
  };
  const selected = matchLine(line, [
    { index: 2, name: "Besi Polos 8 (-) - Btg", qty: 118, unitPrice: 37000, subtotal: 4366000, paymentDate: "2026-03-02", recipient: "CBB" },
    { index: 24, name: "Besi Polos 8 (-) - Btg", qty: 118, unitPrice: 37000, subtotal: 4366000, paymentDate: "2026-03-30", recipient: "CBB" },
  ], new Set());
  assert.equal(selected.index, 24);
});

test("matching memilih duplicate identik berdasarkan urutan saat hanya tanggal bayar target berbeda", () => {
  const used = new Set();
  const lines = [
    { index: 2, name: "Besi Polos 8 (-) - Btg", qty: 118, unitPrice: 37000, subtotal: 4366000, paymentDate: "2026-01-21", recipient: "CBB" },
    { index: 24, name: "Besi Polos 8 (-) - Btg", qty: 118, unitPrice: 37000, subtotal: 4366000, paymentDate: "2026-02-11", recipient: "CBB" },
  ];
  const first = matchLine({
    namaItem: "Besi Polos 8 mm",
    qty: 118,
    hargaSatuan: 37000,
    jumlah: 4366000,
    tanggal: "2026-01-14",
    vendor: "CBB",
  }, lines, used);
  const second = matchLine({
    namaItem: "Besi Polos 8 mm",
    qty: 118,
    hargaSatuan: 37000,
    jumlah: 4366000,
    tanggal: "2026-02-11",
    vendor: "CBB",
  }, lines, used);
  assert.equal(first.index, 2);
  assert.equal(second.index, 24);
});

test("lookup honorarium memilih opsi pekerjaan spesifik dibanding tukang borongan generik", () => {
  const selected = findLookupItemForLine([
    { uuid: "generic", nama: "Tukang Borongan", spesifikasi: "Upah Tukang Borongan", satuan: "", hargaSatuan: 390000 },
    { uuid: "gate", nama: "PEK POLDING GATE", spesifikasi: "STANDAR", satuan: "", hargaSatuan: 390000 },
    { uuid: "door", nama: "PEK FOLDINGDOR", spesifikasi: "STANDAR", satuan: "", hargaSatuan: 200000 },
  ], {
    namaItem: "Tukang Borongan Pek. Folding Gate",
    qty: 45,
    satuan: "Orang-Hari",
    hargaSatuan: 390000,
    jumlah: 17550000,
    tanggal: "2026-02-18",
  }, "honorarium");
  assert.equal(selected.uuid, "gate");
});

test("normalisasi angka dan tanggal untuk payload Belanja", () => {
  assert.equal(normalizeBelanjaNumber("1.250.000,50"), 1250000.5);
  assert.equal(normalizeBelanjaNumber("Rp. 18.000.000,00"), 18000000);
  assert.equal(normalizeBelanjaNumber("Rp. 600.000,00"), 600000);
  assert.equal(normalizeBelanjaNumber("Rp. 1.387.618.000,00"), 1387618000);
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
  assert.equal(belanjaTextMatches("PEK POLDING GATE (STANDAR)", "Tukang Borongan Pek. Folding Gate"), true);
  assert.equal(belanjaTextMatches("PEK FOLDINGDOR (STANDAR)", "JASA BORONG Pek. Folding Door"), true);
  assert.equal(belanjaTextMatches("Besi Polos 8 (-) - Btg", "Besi Polos 8 mm"), true);
  assert.equal(belanjaTextMatches("Batu Belah (8 Kubik) - Truck", "batu belah 15/20"), true);
  assert.equal(belanjaTextMatches("PEK SIGNAGE KDKMP (STANDAR)", "JASA BORONG SIGNAGE KDKMP"), true);
  assert.equal(belanjaTextMatches("PEK PINTU BESI (SETANDAR)", "Tukang Borongan Pek. Pintu Besi"), true);
  assert.equal(belanjaTextMatches("PEK DINDING PARTISI KACA (SETANDAR)", "Tukang Borongan Pek. Dinding Partisi Kaca"), true);
  assert.equal(belanjaTextMatches("PEK PINTU KACA FRAMELESS (SETANDAR)", "Tukang Borongan Pek. Pintu Kaca Frameless"), true);
  assert.equal(
    belanjaTextMatches(
      "Koperasi Desa Batulawang (Jawa Barat, Cianjur, Cibinong, Batulawang)",
      "Batulawang Cubinong",
    ),
    true,
  );
  assert.equal(belanjaTextMatches("lembur", "lembur Mandor"), false);
  assert.equal(belanjaTextMatches("Kepala Tukang Lembur", "lembur Mandor"), false);
});

test("matcher honorarium menerima label lembur target yang generik secara terbatas", () => {
  assert.equal(genericHonorariumNameMatches("lembur (pekerjaan)", "lembur Mandor"), true);
  assert.equal(genericHonorariumNameMatches("lembur (pekerjaan)", "lembur Kepala Tukang"), true);
  assert.equal(genericHonorariumNameMatches("lembur (pekerjaan)", "JASA BORONG SIGNAGE KDKMP"), false);
});

test("KDKMP option wajib cocok exact normalized hierarchy", () => {
  const parsed = parseKdkmpOptionText("Koperasi Desa Maleber (Jawa Barat, Kab. Cianjur, Kec. Karangtengah, Desa Maleber)");
  assert.ok(parsed);
  assert.equal(isMaleberSource(parsed), true);
  assert.equal(formatKdkmpIdentity(buildDestinationKdkmp(makeTemplatePlanProject())), "Mekarsari / Cianjur / Cianjur / Jawa Barat");

  const option = findKdkmpOption([
    { value: "wrong", text: "Koperasi Desa Mekarsari (Jawa Barat, Cianjur, Karangtengah, Mekarsari)" },
    { value: "right", text: "Koperasi Desa Mekarsari (Jawa Barat, Cianjur, Cianjur, Mekarsari)" },
  ], {
    province: SOURCE_KDKMP.province,
    regency: "Kab. Cianjur",
    district: "Kec. Cianjur",
    village: "Desa Mekarsari",
  });
  assert.equal(option.value, "right");

  assert.throws(() => findKdkmpOption([
    { value: "a", text: "Koperasi Desa Mekarsari (Jawa Barat, Cianjur, Cianjur, Mekarsari)" },
    { value: "b", text: "Koperasi Desa Mekarsari (Jawa Barat, Kab. Cianjur, Kec. Cianjur, Desa Mekarsari)" },
  ], {
    province: "Jawa Barat",
    regency: "Cianjur",
    district: "Cianjur",
    village: "Mekarsari",
  }), /ambigu/);
});

test("transaction plan membentuk 43 transaksi target dari grup resume", () => {
  const project = makeTemplatePlanProject();
  const plan = buildBelanjaTransactionPlan(project, project.items);
  assert.equal(plan.transactionCount, DEFAULT_BELANJA_BASE_TRANSACTION_COUNT);
  assert.equal(plan.lineCount, DEFAULT_BELANJA_BASE_TRANSACTION_COUNT);
  assert.equal(plan.summary.material > 0, true);
  assert.equal(plan.summary.honorarium > 0, true);
  assert.equal(plan.summary.equipment > 0, true);
  assert.equal(plan.transactions.every((transaction) => transaction.operationType === "copy_reconcile_v1"), true);
});

test("diagnostic final budget menunjuk tahap dan transaksi material yang selisih", () => {
  const project = makeTemplatePlanProject();
  const plan = buildBelanjaTransactionPlan(project, project.items);
  const rows = makeTargetRowsFromPlan(plan);
  const mismatchIndex = plan.transactions.findIndex((transaction) => (
    transaction.kind === "material" && transaction.transactionIdentity.categoryCode.startsWith("I.")
  ));
  assert.notEqual(mismatchIndex, -1);
  rows[mismatchIndex] = {
    ...rows[mismatchIndex],
    totalText: String(plan.transactions[mismatchIndex].totalAmount - 25000),
  };

  const diagnostic = diagnoseDestinationBudget(rows, plan.transactions);
  const stageI = diagnostic.stages.find((stage) => stage.stageKey === "I");
  assert.ok(stageI);
  assert.equal(diagnostic.totalDifference, -25000);
  assert.equal(stageI.difference, -25000);
  assert.equal(stageI.issues[0].kind, "material");
  assert.equal(stageI.issues[0].issue, "total_mismatch");

  const message = formatBudgetDiagnostics(diagnostic);
  assert.match(message, /Tahap I/);
  assert.match(message, /material/);
  assert.match(message, /selisih/);
});

test("repair planner final budget memilih transaksi target yang perlu diedit", () => {
  const project = makeTemplatePlanProject();
  const plan = buildBelanjaTransactionPlan(project, project.items);
  const rows = makeTargetRowsFromPlan(plan);
  const mismatchIndex = plan.transactions.findIndex((transaction) => (
    transaction.kind === "material" && transaction.transactionIdentity.categoryCode.startsWith("I.")
  ));
  assert.notEqual(mismatchIndex, -1);
  rows[mismatchIndex] = {
    ...rows[mismatchIndex],
    totalText: String(plan.transactions[mismatchIndex].totalAmount + 12500),
  };

  const diagnostic = diagnoseDestinationBudget(rows, plan.transactions);
  const repairs = planDestinationBudgetRepairs(rows, plan.transactions, diagnostic);

  assert.equal(repairs.length, 1);
  assert.equal(repairs[0].transactionId, plan.transactions[mismatchIndex].transactionId);
  assert.equal(repairs[0].rowIndex, rows[mismatchIndex].rowIndex);
  assert.equal(repairs[0].kind, "material");
  assert.equal(repairs[0].difference, 12500);
});

test("matcher meremap row template saat resume mengubah VI.10 honorarium menjadi material", () => {
  const project = makeTemplatePlanProject();
  const plan = buildBelanjaTransactionPlan(project, project.items);
  const vi10Index = plan.transactions.findIndex((transaction) => transaction.transactionIdentity.categoryCode === "VI.10");
  assert.notEqual(vi10Index, -1);

  const transactions = plan.transactions.map((transaction, index) => {
    if (index !== vi10Index) return transaction;
    return {
      ...transaction,
      kind: "material",
      transactionKey: transaction.transactionKey.replace(/upahhonorarium/g, "bahanmaterial"),
      transactionIdentity: {
        ...transaction.transactionIdentity,
        kind: "material",
        belanjaCategoryText: "Bahan / Material",
        belanjaCategoryKey: "bahanmaterial",
      },
      lines: transaction.lines.map((line) => ({
        ...line,
        namaItem: "Jasa Pemasangan & Tambah Daya PLN",
        satuan: "Ls",
        vendor: "PLN",
        recipient: "PLN",
      })),
    };
  });
  const rows = makeTargetRowsFromPlan(plan);
  const snapshots = new Map(rows.map((row, index) => [row.editHref, snapshotFor(plan.transactions[index])]));

  const matches = matchResumeToTargetTransaction(transactions, rows, snapshots);
  const vi10Match = matches.find((entry) => entry.transaction.transactionIdentity.categoryCode === "VI.10");

  assert.ok(vi10Match);
  assert.equal(vi10Match.remapRequired, true);
  assert.equal(vi10Match.row.rowIndex, rows[vi10Index].rowIndex);
  assert.equal(vi10Match.row.belanjaCategoryText, "Upah / Honorarium");
  assert.match(vi10Match.remapReason, /kode kategori sama/);
  assert.equal(new Set(matches.map((entry) => entry.row.editHref)).size, matches.length);
});

test("compare menerima fallback jenis target jika kategori sama dan detail cocok", () => {
  const project = makeTemplatePlanProject();
  const plan = buildBelanjaTransactionPlan(project, project.items);
  const honorariumTransaction = plan.transactions.find((transaction) => transaction.transactionIdentity.categoryCode === "VI.10");
  assert.ok(honorariumTransaction);
  const materialTransaction = {
    ...honorariumTransaction,
    kind: "material",
    transactionIdentity: {
      ...honorariumTransaction.transactionIdentity,
      kind: "material",
      belanjaCategoryText: "Bahan / Material",
      belanjaCategoryKey: "bahanmaterial",
    },
  };

  const comparison = compareTransactionSnapshot(materialTransaction, snapshotFor(honorariumTransaction), {
    targetKindFallback: "honorarium",
  });

  assert.deepEqual(comparison.differences, []);
  assert.equal(comparison.expectedSignature, comparison.actualSignature);
});

test("stage budget planner hanya mengedit transaksi pada tahap yang selisih", () => {
  const project = makeTemplatePlanProject();
  const plan = buildBelanjaTransactionPlan(project, project.items);
  const rows = makeTargetRowsFromPlan(plan);
  const mismatchIndex = plan.transactions.findIndex((transaction) => (
    transaction.kind === "material" && transaction.transactionIdentity.categoryCode.startsWith("I.")
  ));
  assert.notEqual(mismatchIndex, -1);
  rows[mismatchIndex] = {
    ...rows[mismatchIndex],
    totalText: String(plan.transactions[mismatchIndex].totalAmount + 12500),
  };

  const diagnostic = diagnoseDestinationBudget(rows, plan.transactions);
  const stagePlan = planStageBudgetReconcile(rows, plan.transactions, diagnostic);
  const edited = plan.transactions.filter((transaction) => (
    shouldReconcileTransactionForStageBudgetPlan(transaction, stagePlan)
  ));

  assert.equal(stagePlan.mode, "targeted");
  assert.deepEqual(stagePlan.mismatchedStageKeys, ["I"]);
  assert.equal(stagePlan.balancedStageKeys.includes("II"), true);
  assert.equal(edited.length, 1);
  assert.equal(edited[0].transactionId, plan.transactions[mismatchIndex].transactionId);
});

test("diagnostic final budget mendeteksi transaksi target duplicate exact", () => {
  const project = makeTemplatePlanProject();
  const plan = buildBelanjaTransactionPlan(project, project.items);
  const rows = makeTargetRowsFromPlan(plan);
  rows.push({ ...rows[0], rowIndex: rows.length + 1, uuid: "duplicate-row" });

  const diagnostic = diagnoseDestinationBudget(rows, plan.transactions);
  assert.equal(diagnostic.duplicateGroups.length, 1);
  assert.equal(diagnostic.duplicateGroups[0].length, 2);
  assert.match(formatBudgetDiagnostics(diagnostic), /Duplicate exact 1 grup/);
});

test("idempotency key stabil dan berubah saat resume berubah", () => {
  const project = makeTemplatePlanProject();
  const plan = buildBelanjaTransactionPlan(project, project.items);
  const destination = buildDestinationKdkmp(project);
  const first = buildBelanjaIdempotencyKey({ projectId: project.id, destination, resumeHash: plan.resumeHash });
  const second = buildBelanjaIdempotencyKey({ projectId: project.id, destination, resumeHash: plan.resumeHash });
  assert.equal(first, second);

  const changedProject = {
    ...project,
    items: project.items.map((item, index) => index === 0 ? { ...item, unitPrice: item.unitPrice + 1 } : item),
  };
  const changedPlan = buildBelanjaTransactionPlan(changedProject, changedProject.items);
  const changed = buildBelanjaIdempotencyKey({ projectId: changedProject.id, destination, resumeHash: changedPlan.resumeHash });
  assert.notEqual(first, changed);
});

test("honorarium role dan recipient memakai data existing tanpa mengarang nama", () => {
  const mandorPayload = buildBelanjaPayload(makeProject(), makeItem({
    itemName: "Honorarium Tim Survei Pengukuran Pemetaan",
    unit: "Orang-Hari",
    vendorName: "",
    expenseType: "labor",
  }));
  assert.equal(inferHonorariumRole(mandorPayload), "mandor");
  assert.equal(resolveHonorariumRecipient(mandorPayload), "Mandor");

  const namedPayload = buildBelanjaPayload(makeProject(), makeItem({
    itemName: "Kepala Tukang Lembur",
    unit: "Orang-Hari",
    vendorName: "Dian",
    expenseType: "labor",
  }));
  assert.equal(inferHonorariumRole(namedPayload), "kepala_tukang");
  assert.equal(resolveHonorariumRecipient(namedPayload), "Dian");
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

test("runner menerima verifikasi mapping dari metadata job walaupun env lokal false", () => {
  assert.equal(
    resolveEffectiveFieldMapVerified(
      { fieldMapVerified: false },
      { metadataJson: { field_map_verified: true } },
    ),
    true,
  );
  assert.equal(
    resolveEffectiveFieldMapVerified(
      { fieldMapVerified: false },
      { metadataJson: { fieldMapVerified: "true" } },
    ),
    true,
  );
  assert.equal(
    resolveEffectiveFieldMapVerified(
      { fieldMapVerified: false },
      { metadataJson: {} },
    ),
    false,
  );
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
    "BELANJA_COPY_SUCCESS_WAIT_MS",
    "BELANJA_BASE_TRANSACTION_COUNT",
    "BELANJA_FAST_UI_TIMEOUT_MS",
    "BELANJA_CHOICE_SEARCH_TIMEOUT_MS",
    "BELANJA_CHOICE_SETTLE_MS",
    "BELANJA_DESTINATION_ROWS_WAIT_MS",
    "BELANJA_DESTINATION_READ_ATTEMPTS",
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
    assert.equal(config.copySuccessWaitMs, 5000);
    assert.equal(config.baseTransactionCount, 43);
    assert.equal(config.fastUiTimeoutMs, 1200);
    assert.equal(config.choiceSearchTimeoutMs, 2000);
    assert.equal(config.choiceSettleMs, 50);
    assert.equal(config.destinationRowsWaitMs, 30000);
    assert.equal(config.destinationReadAttempts, 5);
  } finally {
    for (const [key, value] of previous) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("gate versi runner copy/reconcile menolak runner lama atau tanpa versi", () => {
  assert.equal(isBelanjaRunnerVersionSupported(BELANJA_RUNNER_VERSION), true);
  assert.equal(isBelanjaRunnerVersionSupported(MIN_COPY_RECONCILE_RUNNER_VERSION), true);
  assert.equal(isBelanjaRunnerVersionSupported("playwright-v2.3.9"), false);
  assert.equal(isBelanjaRunnerVersionSupported(null), false);
});

test("runner memuat env lokal dari folder induk walau cwd ada di subfolder", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "belanja-env-"));
  const nestedDir = path.join(tempRoot, "automation", "belanja-runner");
  fs.mkdirSync(nestedDir, { recursive: true });
  fs.writeFileSync(path.join(tempRoot, ".env.belanja.local"), [
    "BELANJA_FIELD_MAP_VERIFIED=true",
    "BELANJA_DRY_RUN=false",
  ].join("\n"));

  const previous = {
    fieldMap: process.env.BELANJA_FIELD_MAP_VERIFIED,
    dryRun: process.env.BELANJA_DRY_RUN,
  };

  try {
    delete process.env.BELANJA_FIELD_MAP_VERIFIED;
    delete process.env.BELANJA_DRY_RUN;

    loadLocalEnv(nestedDir);

    assert.equal(process.env.BELANJA_FIELD_MAP_VERIFIED, "true");
    assert.equal(process.env.BELANJA_DRY_RUN, "false");
  } finally {
    if (previous.fieldMap == null) delete process.env.BELANJA_FIELD_MAP_VERIFIED;
    else process.env.BELANJA_FIELD_MAP_VERIFIED = previous.fieldMap;

    if (previous.dryRun == null) delete process.env.BELANJA_DRY_RUN;
    else process.env.BELANJA_DRY_RUN = previous.dryRun;

    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
