import assert from "node:assert/strict";
import test from "node:test";

import {
  isSpecialPaperNota,
  moveSpecialNotasToStageEnd,
} from "../src/lib/nota-output-order.ts";

const CORE_STAGES = ["TAHAP_I", "TAHAP_II", "TAHAP_III", "TAHAP_IV"];

function makeDoc({
  id,
  stageCode = "TAHAP_I",
  documentType = "nota",
  vendorId = `vendor-${id}`,
  vendorName = id,
  templateId = `template-${id}`,
  templateName = `Template ${id}`,
  aliases = [],
}) {
  return {
    id,
    stageCode,
    documentType,
    vendorId,
    vendorName,
    templateId,
    templateName,
    vendor: { id: vendorId, name: vendorName, aliases },
    untouched: { total: 123_456 },
  };
}

function ids(docs) {
  return docs.map((doc) => doc.id);
}

test("memindahkan CBB/CBS/HPM ke akhir setiap Tahap I-IV secara stabil", () => {
  const source = CORE_STAGES.flatMap((stageCode, stageIndex) => [
    makeDoc({ id: `normal-a-${stageIndex}`, stageCode }),
    makeDoc({ id: `hpm-${stageIndex}`, stageCode, vendorId: "vendor-hpm", vendorName: "HPM" }),
    makeDoc({ id: `normal-b-${stageIndex}`, stageCode }),
    makeDoc({ id: `cbb-${stageIndex}`, stageCode, vendorId: "vendor-cbb", vendorName: "CBB" }),
    makeDoc({ id: `cbs-${stageIndex}`, stageCode, vendorId: "vendor-cbs", vendorName: "CBS" }),
  ]);

  const originalIds = ids(source);
  const ordered = moveSpecialNotasToStageEnd(source);

  assert.notStrictEqual(ordered, source);
  assert.deepEqual(ids(source), originalIds, "array sumber tidak boleh dimutasi");

  for (const [stageIndex, stageCode] of CORE_STAGES.entries()) {
    assert.deepEqual(
      ids(ordered.filter((doc) => doc.stageCode === stageCode)),
      [
        `normal-a-${stageIndex}`,
        `normal-b-${stageIndex}`,
        `hpm-${stageIndex}`,
        `cbb-${stageIndex}`,
        `cbs-${stageIndex}`,
      ],
    );
  }

  assert.ok(ordered.every((doc) => source.includes(doc)), "objek dokumen harus tetap referensi asli");
  assert.ok(ordered.every((doc) => doc.untouched.total === 123_456));
});

test("mempertahankan urutan nota biasa dan urutan relatif nota khusus", () => {
  const source = [
    makeDoc({ id: "murah-maju" }),
    makeDoc({ id: "hpm", vendorName: "HPM" }),
    makeDoc({ id: "mandau" }),
    makeDoc({ id: "cbb", templateName: "Template Invoice CBB" }),
    makeDoc({ id: "amanah" }),
    makeDoc({ id: "cbs", templateId: "template-cbs" }),
    makeDoc({ id: "pln", vendorName: "PLN" }),
  ];

  assert.deepEqual(
    ids(moveSpecialNotasToStageEnd(source)),
    ["murah-maju", "mandau", "amanah", "pln", "hpm", "cbb", "cbs"],
  );
});

test("mencocokkan ID, nama, template, alias, kapitalisasi, dan nama vendor lama", () => {
  const candidates = [
    makeDoc({ id: "vendor-id", vendorId: "VENDOR-CBB", vendorName: "Legacy" }),
    makeDoc({ id: "template-id", templateId: "TEMPLATE-HPM", vendorName: "Legacy" }),
    makeDoc({ id: "vendor-name", vendorName: "cv. cBs Cianjur" }),
    makeDoc({ id: "template-name", templateName: "Tamplet hPm Tahap 2" }),
    makeDoc({ id: "alias", vendorName: "Legacy", aliases: ["Cabang H.P.M"] }),
    makeDoc({ id: "full-cbb", vendorName: "PT Cahaya Baja Bangunan" }),
    makeDoc({ id: "full-cbs", vendorName: "Citra Baja Sejahtera" }),
  ];

  assert.ok(candidates.every(isSpecialPaperNota));
  assert.equal(isSpecialPaperNota(makeDoc({ id: "false-positive", vendorName: "ACBBX" })), false);
  assert.equal(isSpecialPaperNota(makeDoc({ id: "ordinary", vendorName: "Amanah" })), false);
});

test("hanya menukar slot nota; posisi kwitansi dan RESUME_ALL tidak berubah", () => {
  const special = makeDoc({ id: "special", vendorName: "HPM" });
  const receiptOne = makeDoc({ id: "receipt-1", documentType: "kwitansi", vendorName: "HPM" });
  const regular = makeDoc({ id: "regular", vendorName: "Mandau" });
  const receiptTwo = makeDoc({ id: "receipt-2", documentType: "kwitansi", vendorName: "CBB" });
  const outside = makeDoc({ id: "outside", stageCode: "RESUME_ALL", vendorName: "CBB" });
  const source = [special, receiptOne, regular, receiptTwo, outside];

  const ordered = moveSpecialNotasToStageEnd(source);

  assert.deepEqual(ids(ordered), ["regular", "receipt-1", "special", "receipt-2", "outside"]);
  assert.strictEqual(ordered[1], receiptOne);
  assert.strictEqual(ordered[3], receiptTwo);
  assert.strictEqual(ordered[4], outside);
  assert.equal(isSpecialPaperNota(outside), false);
  assert.equal(isSpecialPaperNota(receiptOne), false);
});

test("tetap benar saat tahap saling berselang-seling", () => {
  const source = [
    makeDoc({ id: "t1-cbb", stageCode: "TAHAP_I", vendorName: "CBB" }),
    makeDoc({ id: "t2-hpm", stageCode: "TAHAP_II", vendorName: "HPM" }),
    makeDoc({ id: "t1-normal", stageCode: "TAHAP_I", vendorName: "Mandau" }),
    makeDoc({ id: "t2-normal", stageCode: "TAHAP_II", vendorName: "Amanah" }),
  ];

  assert.deepEqual(
    ids(moveSpecialNotasToStageEnd(source)),
    ["t1-normal", "t2-normal", "t1-cbb", "t2-hpm"],
  );
});
