import assert from "node:assert/strict";
import test from "node:test";

import {
  buildKwitansiSyncKeyMap,
  kwitansiSyncKeyForDoc,
} from "../src/lib/kwitansi-rules.ts";

const STAGES = ["TAHAP_I", "TAHAP_II", "TAHAP_III", "TAHAP_IV"];

function makeDoc({ stageCode, role, slot, personIndex = 1, itemId, printOrder = personIndex }) {
  const resolvedItemId = itemId ?? `${stageCode.toLowerCase()}-${role.toLowerCase().replaceAll(" ", "-")}__kwitansi_worker_${personIndex}`;
  return {
    id: `doc-${stageCode}-${role}-${personIndex}`,
    projectId: "project-test",
    stageId: stageCode,
    stageCode,
    stageName: stageCode,
    vendorId: "vendor-kwitansi",
    vendorName: "KWITANSI",
    vendor: { id: "vendor-kwitansi", name: "KWITANSI", type: "labor" },
    documentType: "kwitansi",
    templateId: "kwitansi-test",
    templateName: "KWITANSI",
    categoryNames: ["Tenaga Kerja"],
    tanggal: "2026-01-01",
    notaDate: "2026-01-01",
    subtotal: 100,
    totalAmount: 100,
    terbilang: "Seratus Rupiah",
    items: [{
      id: resolvedItemId,
      stageCode,
      stageName: stageCode,
      category: "Tenaga Kerja",
      expenseDate: "2026-01-01",
      itemName: role,
      volume: 1,
      unit: "Orang",
      unitPrice: 100,
      vendorId: "vendor-kwitansi",
      sortOrder: 1,
    }],
    itemIds: [resolvedItemId],
    projectMeta: {
      projectName: "Project Test",
      villageName: "Desa Test",
      districtName: "Kecamatan Test",
      regencyName: "Kabupaten Test",
      regionName: "Wilayah Test",
      projectDate: "2026-01-01",
      responsibleName: "",
    },
    kwitansiRoleName: role,
    kwitansiWorkerSlot: slot,
    printOrder,
  };
}

function targetsFor(docs, sourceId) {
  const keys = buildKwitansiSyncKeyMap(docs, (doc) => doc.kwitansiRoleName);
  const source = docs.find((doc) => doc.id === sourceId);
  const sourceKey = keys.get(sourceId);
  assert.ok(source);
  assert.ok(sourceKey);
  return docs.filter((doc) => (
    doc.stageCode !== source.stageCode && keys.get(doc.id) === sourceKey
  ));
}

test("Kepala Tukang tersinkron ke satu kwitansi pada tiga tahap lain", () => {
  const docs = STAGES.map((stageCode) => makeDoc({ stageCode, role: "Kepala Tukang" }));
  const targets = targetsFor(docs, docs[0].id);

  assert.deepEqual(targets.map((doc) => doc.stageCode), ["TAHAP_II", "TAHAP_III", "TAHAP_IV"]);
  assert.ok(docs.every((doc) => kwitansiSyncKeyForDoc(doc, doc.kwitansiRoleName) === "kepala_tukang"));
});

test("Pekerja Terampil hanya tersinkron ke slot yang sama", () => {
  const docs = STAGES.flatMap((stageCode) => (
    [1, 2, 3, 4].map((slot) => makeDoc({ stageCode, role: "Pekerja Terampil", slot, personIndex: slot }))
  ));

  for (const slot of [1, 2]) {
    const source = docs.find((doc) => doc.stageCode === "TAHAP_I" && doc.kwitansiWorkerSlot === slot);
    assert.ok(source);
    const targets = targetsFor(docs, source.id);
    assert.equal(targets.length, 3);
    assert.ok(targets.every((doc) => doc.kwitansiWorkerSlot === slot));
    assert.ok(targets.every((doc) => doc.kwitansiWorkerSlot !== (slot === 1 ? 2 : 1)));
  }
});

test("Pekerja Buruh dan Laden berbagi kelompok tetapi tetap terpisah per slot", () => {
  const docs = STAGES.flatMap((stageCode, stageIndex) => (
    [1, 2, 3, 4].map((slot) => makeDoc({
      stageCode,
      role: stageIndex < 2 ? "Pekerja Buruh" : "Laden",
      slot,
      personIndex: slot,
    }))
  ));

  for (const slot of [1, 3]) {
    const source = docs.find((doc) => doc.stageCode === "TAHAP_I" && doc.kwitansiWorkerSlot === slot);
    assert.ok(source);
    const targets = targetsFor(docs, source.id);
    assert.equal(targets.length, 3);
    assert.ok(targets.every((doc) => doc.kwitansiWorkerSlot === slot));
  }
});

test("Data lama mengambil slot dari suffix item worker_N", () => {
  const docs = STAGES.flatMap((stageCode) => (
    [1, 2, 3, 4].map((slot) => makeDoc({
      stageCode,
      role: "Pekerja Terampil",
      slot: undefined,
      personIndex: slot,
    }))
  ));
  const keys = buildKwitansiSyncKeyMap(docs, (doc) => doc.kwitansiRoleName);

  for (const doc of docs) {
    const slot = /worker_(\d)$/.exec(doc.items[0].id)?.[1];
    assert.equal(keys.get(doc.id), `terampil_${slot}`);
  }
});

test("Data lama tanpa metadata atau suffix mendapat slot berdasarkan urutan per tahap", () => {
  const docs = STAGES.flatMap((stageCode) => (
    [1, 2, 3, 4].map((position) => makeDoc({
      stageCode,
      role: "Pekerja Buruh",
      slot: undefined,
      personIndex: position,
      itemId: `legacy-${stageCode}-${position}`,
      printOrder: 10 + position,
    }))
  ));
  const keys = buildKwitansiSyncKeyMap(docs, (doc) => doc.kwitansiRoleName);

  for (const stageCode of STAGES) {
    const stageDocs = docs.filter((doc) => doc.stageCode === stageCode);
    assert.deepEqual(stageDocs.map((doc) => keys.get(doc.id)), ["buruh_1", "buruh_2", "buruh_3", "buruh_4"]);
  }
});
