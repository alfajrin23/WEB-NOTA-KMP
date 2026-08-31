import assert from "node:assert/strict";
import test from "node:test";

import {
  buildKwitansiSyncKeyMap,
  getAutofillKwitansiReceiver,
  getKwitansiReceiverSyncPlan,
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

test("Pekerja Terampil dan Tukang hanya tersinkron ke slot yang sama", () => {
  const docs = STAGES.flatMap((stageCode) => (
    [1, 2, 3, 4].map((slot) => makeDoc({ stageCode, role: stageCode === "TAHAP_I" ? "Tukang" : "Pekerja Terampil", slot, personIndex: slot }))
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

test("Pekerja Buruh, Laden, dan Kenek berbagi kelompok tetapi tetap terpisah per slot", () => {
  const docs = STAGES.flatMap((stageCode, stageIndex) => (
    [1, 2, 3, 4].map((slot) => makeDoc({
      stageCode,
      role: stageIndex === 0 ? "Kenek/Kuli" : stageIndex < 2 ? "Pekerja Buruh" : "Laden",
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
      role: "Tukang",
      slot: undefined,
      personIndex: slot,
    }))
  ));
  const keys = buildKwitansiSyncKeyMap(docs, (doc) => doc.kwitansiRoleName);

  for (const doc of docs) {
    const slot = /worker_(\d)$/.exec(doc.items[0].id)?.[1];
    assert.equal(keys.get(doc.id), `tukang_${slot}`);
  }
});

test("Data lama tanpa metadata atau suffix mendapat slot berdasarkan urutan per tahap", () => {
  const docs = STAGES.flatMap((stageCode) => (
    [1, 2, 3, 4].map((position) => makeDoc({
      stageCode,
      role: "Kenek/Kuli",
      slot: undefined,
      personIndex: position,
      itemId: `legacy-${stageCode}-${position}`,
      printOrder: 10 + position,
    }))
  ));
  const keys = buildKwitansiSyncKeyMap(docs, (doc) => doc.kwitansiRoleName);

  for (const stageCode of STAGES) {
    const stageDocs = docs.filter((doc) => doc.stageCode === stageCode);
    assert.deepEqual(stageDocs.map((doc) => keys.get(doc.id)), ["kenek_1", "kenek_2", "kenek_3", "kenek_4"]);
  }
});

test("Tukang pokok dan lembur memakai slot yang sama saat disinkronkan ke tahap lain", () => {
  const docs = STAGES.flatMap((stageCode) => ([
    ...[1, 2, 3, 4].map((slot) => makeDoc({
      stageCode,
      role: "lembur Tukang",
      slot: undefined,
      personIndex: slot,
      itemId: `legacy-${stageCode}-lembur-tukang-${slot}`,
      printOrder: slot,
    })),
    ...[1, 2, 3, 4].map((slot) => makeDoc({
      stageCode,
      role: "Tukang",
      slot: undefined,
      personIndex: slot,
      itemId: `legacy-${stageCode}-pokok-tukang-${slot}`,
      printOrder: 10 + slot,
    })),
  ]));
  const keys = buildKwitansiSyncKeyMap(docs, (doc) => doc.kwitansiRoleName);
  const source = docs.find((doc) => doc.stageCode === "TAHAP_I" && doc.kwitansiRoleName === "lembur Tukang" && doc.printOrder === 2);
  assert.ok(source);
  const targets = docs.filter((doc) => doc.stageCode !== source.stageCode && keys.get(doc.id) === keys.get(source.id));

  assert.equal(keys.get(source.id), "tukang_2");
  assert.equal(targets.length, 6);
  assert.deepEqual(
    targets.map((doc) => `${doc.stageCode}:${doc.kwitansiRoleName}`).sort(),
    [
      "TAHAP_II:Tukang",
      "TAHAP_II:lembur Tukang",
      "TAHAP_III:Tukang",
      "TAHAP_III:lembur Tukang",
      "TAHAP_IV:Tukang",
      "TAHAP_IV:lembur Tukang",
    ],
  );
});

test("Sinkron penerima pekerja menyertakan pokok dan lembur pada tahap yang sama", () => {
  const docs = STAGES.flatMap((stageCode) => ([
    ...[1, 2, 3, 4].map((slot) => makeDoc({
      stageCode,
      role: "lembur Tukang",
      slot: undefined,
      personIndex: slot,
      itemId: `legacy-${stageCode}-lembur-tukang-${slot}`,
      printOrder: slot,
    })),
    ...[1, 2, 3, 4].map((slot) => makeDoc({
      stageCode,
      role: "Tukang",
      slot: undefined,
      personIndex: slot,
      itemId: `legacy-${stageCode}-pokok-tukang-${slot}`,
      printOrder: 10 + slot,
    })),
  ]));
  const keys = buildKwitansiSyncKeyMap(docs, (doc) => doc.kwitansiRoleName);
  const source = docs.find((doc) => doc.stageCode === "TAHAP_I" && doc.kwitansiRoleName === "lembur Tukang" && doc.printOrder === 2);
  assert.ok(source);

  const { syncKey, targets } = getKwitansiReceiverSyncPlan(docs, source, keys, {
    roleText: source.kwitansiRoleName,
    targetStages: new Set(STAGES),
  });

  assert.equal(syncKey, "tukang_2");
  assert.equal(targets.length, 7);
  assert.ok(targets.some((doc) => doc.stageCode === "TAHAP_I" && doc.kwitansiRoleName === "Tukang"));
  assert.deepEqual(
    targets.map((doc) => `${doc.stageCode}:${doc.kwitansiRoleName}`).sort(),
    [
      "TAHAP_I:Tukang",
      "TAHAP_II:Tukang",
      "TAHAP_II:lembur Tukang",
      "TAHAP_III:Tukang",
      "TAHAP_III:lembur Tukang",
      "TAHAP_IV:Tukang",
      "TAHAP_IV:lembur Tukang",
    ],
  );
});

test("Nama pekerja awal kosong dan dukungan operasional memakai nama Babinsa", () => {
  const kenekDoc = makeDoc({ stageCode: "TAHAP_I", role: "Kenek/Kuli", slot: 1 });
  assert.equal(getAutofillKwitansiReceiver(kenekDoc), "");

  const operasionalDoc = makeDoc({
    stageCode: "TAHAP_VII",
    role: "Dukungan Operasional Babinsa",
    itemId: "operasional-babinsa",
  });
  operasionalDoc.projectMeta.responsibleName = "Nama Babinsa Desa";

  assert.equal(getAutofillKwitansiReceiver(operasionalDoc), "Nama Babinsa Desa");
});
