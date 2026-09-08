import assert from "node:assert/strict";
import test from "node:test";

import {
  daysBetweenIsoDates,
  shiftResumeItemsByDays,
} from "../src/lib/project-date-shift.ts";

function makeItem() {
  return {
    id: "date-sync-regression",
    stageCode: "TAHAP_I",
    stageName: "Tahap I",
    category: "Test",
    expenseDate: "2026-01-10",
    itemName: "Belanja tanggal 10/01/2026",
    volume: 1,
    unit: "Ls",
    unitPrice: 1,
    amountOverride: null,
    vendorId: "vendor-test",
    vendorName: "TEST",
    notes: "Laporan 10-01-2026",
    sortOrder: 1,
  };
}

test("perubahan anchor tanggal menggeser semua tanggal item dengan delta yang sama", () => {
  const delta = daysBetweenIsoDates("2026-01-10", "2026-01-17");
  assert.equal(delta, 7);

  const [shifted] = shiftResumeItemsByDays([makeItem()], delta);
  assert.equal(shifted.expenseDate, "2026-01-17");
  assert.equal(shifted.itemName, "Belanja tanggal 17/01/2026");
  assert.equal(shifted.notes, "Laporan 17-01-2026");
});

test("pergeseran tanggal ke belakang tetap konsisten", () => {
  const delta = daysBetweenIsoDates("2026-01-10", "2026-01-05");
  assert.equal(delta, -5);

  const [shifted] = shiftResumeItemsByDays([makeItem()], delta);
  assert.equal(shifted.expenseDate, "2026-01-05");
  assert.equal(shifted.itemName, "Belanja tanggal 05/01/2026");
  assert.equal(shifted.notes, "Laporan 05-01-2026");
});
