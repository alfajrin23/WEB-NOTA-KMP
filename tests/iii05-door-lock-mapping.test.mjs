import assert from "node:assert/strict";
import test from "node:test";

import { EXCEL_BASE_ROWS } from "../src/constants/excel-base-data.ts";
import {
  detailNamesMatch,
  findLookupItemForLine,
} from "../automation/belanja-runner/copy-reconcile.ts";

function line(name, unitPrice) {
  return {
    lineId: `line-${unitPrice}`,
    namaItem: name,
    qty: name.includes("PVC") ? 3 : 2,
    satuan: "Pcs",
    hargaSatuan: unitPrice,
    jumlah: (name.includes("PVC") ? 3 : 2) * unitPrice,
    tanggal: "2026-01-21",
    vendor: "CAHAYA TIMUR KERAMIK",
  };
}

function materialLine(patch = {}) {
  return {
    lineId: "material-line",
    namaItem: "Paku 10 Cm",
    qty: 5,
    satuan: "Kg",
    hargaSatuan: 21000,
    jumlah: 105000,
    tanggal: "2026-01-21",
    vendor: "CBB",
    ...patch,
  };
}

test("base resume III.05 separates PVC 5k from Standard 35k", () => {
  const locks = EXCEL_BASE_ROWS.filter((row) => row.categoryCode === "III.05" && /Kunci Pintu/i.test(row.itemName));
  assert.equal(locks.length, 2);
  assert.deepEqual(
    locks.map((row) => [row.itemName, row.volume, row.unitPrice, row.amount]),
    [
      ["Kunci Pintu (Standar) - Pcs", 2, 35000, 70000],
      ["Kunci Pintu PVC", 3, 5000, 15000],
    ],
  );
});

test("door-lock matcher never treats PVC and Standard as the same item", () => {
  assert.equal(detailNamesMatch("Kunci Pintu PVC - Pcs", "Kunci Pintu PVC"), true);
  assert.equal(detailNamesMatch("Kunci Pintu (Standar) - Pcs", "Kunci Pintu (Standar) - Pcs"), true);
  assert.equal(detailNamesMatch("Kunci Pintu (Standar) - Pcs", "Kunci Pintu PVC"), false);
  assert.equal(detailNamesMatch("Kunci Pintu PVC", "Kunci Pintu (Standar) - Pcs"), false);
});

test("Playwright lookup uses target specification to select correct door lock", () => {
  const targetLookup = [
    { uuid: "lock-pvc", nama: "Kunci Pintu", spesifikasi: "PVC", satuan: "Pcs" },
    { uuid: "lock-standard", nama: "Kunci Pintu", spesifikasi: "Standar", satuan: "Pcs" },
  ];
  assert.equal(findLookupItemForLine(targetLookup, line("Kunci Pintu PVC", 5000), "material").uuid, "lock-pvc");
  assert.equal(findLookupItemForLine(targetLookup, line("Kunci Pintu (Standar) - Pcs", 35000), "material").uuid, "lock-standard");
});

test("Playwright lookup also supports target options with explicit names", () => {
  const targetLookup = [
    { uuid: "lock-standard", nama: "Kunci Pintu (Standar)", spesifikasi: "", satuan: "Pcs" },
    { uuid: "lock-pvc", nama: "Kunci Pintu PVC", spesifikasi: "", satuan: "Pcs" },
  ];
  assert.equal(findLookupItemForLine(targetLookup, line("Kunci Pintu PVC", 5000), "material").uuid, "lock-pvc");
  assert.equal(findLookupItemForLine(targetLookup, line("Kunci Pintu (Standar) - Pcs", 35000), "material").uuid, "lock-standard");
});


test("door-lock lookup normalizes Pcs and Buah and resolves duplicate Standard metadata", () => {
  const targetLookup = [
    { uuid: "std-a", nama: "Kunci Pintu", spesifikasi: "Standar", satuan: "Buah", hargaSatuan: 35000 },
    { uuid: "std-b", nama: "Kunci Pintu", spesifikasi: "Standard", satuan: "Pcs", hargaSatuan: 35000 },
    { uuid: "std-wrong-price", nama: "Kunci Pintu", spesifikasi: "Standar premium", satuan: "Buah", hargaSatuan: 50000 },
    { uuid: "pvc", nama: "Kunci Pintu", spesifikasi: "PVC", satuan: "Buah", hargaSatuan: 5000 },
  ];
  const resolved = findLookupItemForLine(targetLookup, line("Kunci Pintu (Standar) - Pcs", 35000), "material");
  assert.ok(["std-a", "std-b"].includes(resolved.uuid));
  assert.equal(findLookupItemForLine(targetLookup, line("Kunci Pintu PVC", 5000), "material").uuid, "pvc");
});

test("door-lock lookup uses price when target exposes multiple same-variant candidates", () => {
  const targetLookup = [
    { uuid: "std-correct", nama: "Kunci Pintu", spesifikasi: "Standar", satuan: "Buah", hargaSatuan: 35000 },
    { uuid: "std-other", nama: "Kunci Pintu", spesifikasi: "Standar", satuan: "Buah", hargaSatuan: 45000 },
  ];
  assert.equal(findLookupItemForLine(targetLookup, line("Kunci Pintu (Standar) - Pcs", 35000), "material").uuid, "std-correct");
});

test("material lookup resolves Paku 10 Cm when target splits size between name and specification", () => {
  const targetLookup = [
    { uuid: "paku-7", nama: "Paku", spesifikasi: "7 Cm", satuan: "Kg", hargaSatuan: 21000 },
    { uuid: "paku-10-a", nama: "Paku", spesifikasi: "10 Cm", satuan: "Kg", hargaSatuan: 20000 },
    { uuid: "paku-10-b", nama: "Paku 10 Cm", spesifikasi: "", satuan: "Kilogram", hargaSatuan: 22000 },
  ];

  const resolved = findLookupItemForLine(targetLookup, materialLine(), "material");

  assert.ok(["paku-10-a", "paku-10-b"].includes(resolved.uuid));
  assert.notEqual(resolved.uuid, "paku-7");
});

test("material lookup prefers exact resume price but does not fail on duplicate default prices", () => {
  const targetLookup = [
    { uuid: "paku-10-old-price", nama: "Paku", spesifikasi: "10 Cm", satuan: "Kg", hargaSatuan: 18000 },
    { uuid: "paku-10-resume-price", nama: "Paku", spesifikasi: "10 Cm", satuan: "Kg", hargaSatuan: 21000 },
  ];

  assert.equal(findLookupItemForLine(targetLookup, materialLine(), "material").uuid, "paku-10-resume-price");
});
