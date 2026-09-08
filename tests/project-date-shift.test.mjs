import assert from "node:assert/strict";
import test from "node:test";

import { EXCEL_BASE_ROWS } from "../src/constants/excel-base-data.ts";
import {
  SIRNAGALIH_PATTERN_START_DATE,
  daysBetweenIsoDates,
  shiftReferencePatternDateToProject,
  shiftResumeItemsByDays,
  shiftResumeItemsFromDefault,
  shiftSourceTemplateDateToReferencePattern,
} from "../src/lib/project-date-shift.ts";

function makeItem(expenseDate, itemName = "Pembayaran tanggal 03/11/2025") {
  return {
    id: "item-date-pattern",
    stageCode: "TAHAP_I",
    stageName: "Tahap I",
    category: "Test",
    expenseDate,
    itemName,
    volume: 1,
    unit: "Ls",
    unitPrice: 1,
    amountOverride: null,
    vendorId: "vendor-test",
    vendorName: "TEST",
    notes: "",
    sortOrder: 1,
  };
}

test("tanggal desa dihitung dari pola Sirnagalih, bukan memakai tanggal Sirnagalih mentah", () => {
  const patternDate = shiftSourceTemplateDateToReferencePattern("2025-11-03");
  assert.equal(SIRNAGALIH_PATTERN_START_DATE, "2025-11-03");
  assert.equal(patternDate, "2025-11-03");

  const targetDate = shiftReferencePatternDateToProject(patternDate, "2026-01-14");
  assert.equal(targetDate, "2026-01-14");

  const [shifted] = shiftResumeItemsFromDefault([makeItem("2025-11-03")], "2026-01-14");
  assert.equal(shifted.expenseDate, targetDate);
});

test("tanggal dasar resume mengikuti offset Excel Haurwangi/Sirnagalih Cilaku", () => {
  assert.equal(EXCEL_BASE_ROWS.length, 273);

  const bySourceRow = new Map(EXCEL_BASE_ROWS.map((row) => [row.excelRow, row]));
  assert.equal(bySourceRow.get(17)?.date, "2025-11-03");
  assert.equal(bySourceRow.get(70)?.date, "2025-12-01");
  assert.equal(bySourceRow.get(209)?.date, "2026-01-05");
  assert.equal(bySourceRow.get(318)?.date, "2026-02-09");
  assert.equal(bySourceRow.get(426)?.itemName, "Honorarium Tim Survei (Pengukuran & Pemetaan)");
  assert.equal(bySourceRow.get(426)?.durationDays, 1);
  assert.equal(bySourceRow.get(458)?.date, "2026-02-11");
});

test("perubahan anchor tanggal menggeser tanggal item dan tanggal di teks dengan delta yang sama", () => {
  const source = {
    ...makeItem("2026-01-10", "Belanja tanggal 10/01/2026"),
    notes: "Laporan 10-01-2026",
  };
  const delta = daysBetweenIsoDates("2026-01-10", "2026-01-17");
  assert.equal(delta, 7);

  const [shifted] = shiftResumeItemsByDays([source], delta);
  assert.equal(shifted.expenseDate, "2026-01-17");
  assert.equal(shifted.itemName, "Belanja tanggal 17/01/2026");
  assert.equal(shifted.notes, "Laporan 17-01-2026");
});

test("pergeseran tanggal ke belakang tetap konsisten", () => {
  const source = {
    ...makeItem("2026-01-10", "Belanja tanggal 10/01/2026"),
    notes: "Laporan 10-01-2026",
  };
  const delta = daysBetweenIsoDates("2026-01-10", "2026-01-05");
  assert.equal(delta, -5);

  const [shifted] = shiftResumeItemsByDays([source], delta);
  assert.equal(shifted.expenseDate, "2026-01-05");
  assert.equal(shifted.itemName, "Belanja tanggal 05/01/2026");
  assert.equal(shifted.notes, "Laporan 05-01-2026");
});
