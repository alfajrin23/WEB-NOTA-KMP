import assert from "node:assert/strict";
import test from "node:test";

import {
  SIRNAGALIH_PATTERN_START_DATE,
  shiftReferencePatternDateToProject,
  shiftResumeItemsFromDefault,
  shiftSourceTemplateDateToReferencePattern,
} from "../src/lib/project-date-shift.ts";

function makeItem(expenseDate, itemName = "Pembayaran tanggal 27/11/2025") {
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
  const patternDate = shiftSourceTemplateDateToReferencePattern("2025-11-27");
  assert.equal(SIRNAGALIH_PATTERN_START_DATE, "2026-03-01");
  assert.equal(patternDate, "2026-03-25");

  const targetDate = shiftReferencePatternDateToProject(patternDate, "2026-01-14");
  assert.equal(targetDate, "2026-02-07");

  const [shifted] = shiftResumeItemsFromDefault([makeItem("2025-11-27")], "2026-01-14");
  assert.equal(shifted.expenseDate, targetDate);
});
