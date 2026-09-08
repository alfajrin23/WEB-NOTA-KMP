import assert from "node:assert/strict";
import test from "node:test";

import { buildDestinationKdkmp } from "../src/lib/belanja-sync/kdkmp.ts";
import { buildBelanjaTransactionPlan } from "../src/lib/belanja-sync/transaction-plan.ts";
import { assertSnapshotDestination, matchResumeToTargetTransaction } from "../automation/belanja-runner/copy-reconcile.ts";

function makeBabakankaretProject() {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    templateId: "template",
    projectName: "Pembangunan Gedung KDKMP",
    wilayahType: "desa",
    villageName: "Babakan Karet (Babakankaret)",
    districtName: "Cianjur",
    regencyName: "Cianjur",
    regionName: "Kodim 0608",
    projectDate: "2026-05-18",
    responsibleName: "",
    status: "draft",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    metadataJson: {},
    items: [],
  };
}

function makeKusenProject() {
  return {
    ...makeBabakankaretProject(),
    villageName: "Haurwangi",
    districtName: "Haurwangi",
    items: [{
      id: "22222222-2222-2222-2222-222222222222",
      stageCode: "TAHAP_III",
      stageName: "III - PEKERJAAN ARSITEKTUR",
      category: "III.05 Pekerjaan Arsitektur - Kusen",
      categoryCode: "III.05",
      categoryName: "Pekerjaan Arsitektur - Kusen",
      expenseDate: "20/05/2026",
      itemName: "Kusen Aluminium",
      volume: 2,
      unit: "Batang",
      unitPrice: 500000,
      amountOverride: null,
      vendorId: "vendor-cbb",
      vendorName: "CBB",
      sortOrder: 1,
      isIncludedInResumeTotal: true,
      expenseType: "material",
    }],
  };
}

function duplicateKusenFixture() {
  const plan = buildBelanjaTransactionPlan(makeKusenProject());
  const base = plan.transactions.find((entry) => entry.transactionIdentity.categoryCode === "III.05");
  assert.ok(base, "III.05 transaction should exist");

  const first = { ...base, transactionId: "tx-kusen-1", transactionKey: "kusen-1", sequence: 1 };
  const second = { ...base, transactionId: "tx-kusen-2", transactionKey: "kusen-2", sequence: 2 };
  const row = (index) => ({
    rowIndex: index,
    uuid: `target-${index}`,
    editHref: `/belanja/target-${index}/edit`,
    kdkmpText: "Koperasi Desa Haurwangi",
    stageText: base.transactionIdentity.stageText,
    itemText: `${base.transactionIdentity.categoryCode} ${base.transactionIdentity.categoryText}`,
    belanjaCategoryText: base.transactionIdentity.belanjaCategoryText,
    totalText: String(base.totalAmount),
    dateText: base.transactionIdentity.transactionDate,
    identityKey: "",
  });
  const snapshot = (transaction) => ({
    destination: "Koperasi Desa Haurwangi (Jawa Barat, Cianjur, Haurwangi, Haurwangi)",
    stage: transaction.transactionIdentity.stageText,
    category: `${transaction.transactionIdentity.categoryCode} ${transaction.transactionIdentity.categoryText}`,
    kind: transaction.transactionIdentity.belanjaCategoryText,
    date: transaction.transactionIdentity.transactionDate,
    lines: transaction.lines.map((line, index) => ({
      index,
      name: line.namaItem,
      qty: line.qty,
      unit: line.satuan,
      unitPrice: line.hargaSatuan,
      subtotal: line.jumlah,
      paymentDate: line.tanggal,
      recipient: line.vendor,
    })),
  });
  return {
    transactions: [first, second],
    rows: [row(1), row(2)],
    snapshots: new Map([
      ["/belanja/target-1/edit", snapshot(first)],
      ["/belanja/target-2/edit", snapshot(second)],
    ]),
  };
}

test("Babakan Karet display alias becomes canonical Babakankaret destination", () => {
  const destination = buildDestinationKdkmp(makeBabakankaretProject());
  assert.equal(destination.village, "Babakankaret");
  assert.equal(destination.district, "Cianjur");
  assert.equal(destination.regency, "Cianjur");
});

test("snapshot destination accepts Babakan Karet display alias against target canonical village", () => {
  assert.doesNotThrow(() => assertSnapshotDestination({
    destination: "Koperasi Desa Babakan Karet (Babakankaret) (Jawa Barat, Cianjur, Cianjur, Babakankaret)",
    stage: "I - PEKERJAAN STRUKTUR",
    category: "I.01 Pembersihan Lahan",
    kind: "Bahan / Material",
    date: "2026-01-01",
    lines: [{ index: 0, name: "Cangkul", qty: 1, unit: "Buah", unitPrice: 1, subtotal: 1, paymentDate: "2026-01-01", recipient: "MURAH MAJU" }],
  }, {
    village: "Babakan Karet (Babakankaret)",
    district: "Cianjur",
    regency: "Cianjur",
    province: "Jawa Barat",
  }));
});

test("equivalent duplicate target rows are mapped deterministically instead of failing ambiguous", () => {
  const fixture = duplicateKusenFixture();
  const matches = matchResumeToTargetTransaction(fixture.transactions, fixture.rows, fixture.snapshots);
  assert.equal(matches.length, 2);
  assert.equal(matches[0].row.rowIndex, 1);
  assert.equal(matches[1].row.rowIndex, 2);
});

test("full snapshot breaks a coarse-score tie and selects the exact target", () => {
  const fixture = duplicateKusenFixture();
  const bad = structuredClone(fixture.snapshots.get("/belanja/target-1/edit"));
  bad.lines[0].qty = Number(bad.lines[0].qty) + 1;
  fixture.snapshots.set("/belanja/target-1/edit", bad);

  const matches = matchResumeToTargetTransaction([fixture.transactions[0]], fixture.rows, fixture.snapshots);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].row.rowIndex, 2);
});
