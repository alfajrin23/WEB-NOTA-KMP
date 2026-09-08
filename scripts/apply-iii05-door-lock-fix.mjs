import fs from "node:fs";

function replaceOnce(file, label, before, after) {
  let source = fs.readFileSync(file, "utf8");
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${file} ${label}: expected 1 match, found ${count}`);
  source = source.replace(before, after);
  fs.writeFileSync(file, source);
}

const excelFile = "src/constants/excel-base-data.ts";
replaceOnce(
  excelFile,
  "rename standard door lock",
  '{ excelRow: 248, stageCode: "TAHAP_III", categoryCode: "III.05", categoryName: "Pekerjaan Arsitektur - Kusen", expenseType: "material", date: "2026-01-21", itemName: "Kunci Pintu PVC", volume: 2, unit: "Bh", unitPrice: 35000, amount: 70000, vendorName: "CAHAYA TIMUR KERAMIK" },',
  '{ excelRow: 248, stageCode: "TAHAP_III", categoryCode: "III.05", categoryName: "Pekerjaan Arsitektur - Kusen", expenseType: "material", date: "2026-01-21", itemName: "Kunci Pintu (Standar) - Pcs", volume: 2, unit: "Bh", unitPrice: 35000, amount: 70000, vendorName: "CAHAYA TIMUR KERAMIK" },',
);
replaceOnce(
  excelFile,
  "correct PVC door lock price",
  '{ excelRow: 252, stageCode: "TAHAP_III", categoryCode: "III.05", categoryName: "Pekerjaan Arsitektur - Kusen", expenseType: "material", date: "2026-01-21", itemName: "Kunci Pintu PVC", volume: 3, unit: "Bh", unitPrice: 8000, amount: 24000, vendorName: "CAHAYA TIMUR KERAMIK" },',
  '{ excelRow: 252, stageCode: "TAHAP_III", categoryCode: "III.05", categoryName: "Pekerjaan Arsitektur - Kusen", expenseType: "material", date: "2026-01-21", itemName: "Kunci Pintu PVC", volume: 3, unit: "Bh", unitPrice: 5000, amount: 15000, vendorName: "CAHAYA TIMUR KERAMIK" },',
);

const runnerFile = "automation/belanja-runner/copy-reconcile.ts";
const detailNamesAnchor = 'export function detailNamesMatch(actual: string, expected: string, honorarium = false) {\n';
const detailNamesReplacement = `function doorLockVariant(value: string | null | undefined): "pvc" | "standard" | null {
  const normalized = normalizeIdentityPart(value);
  if (!normalized.includes("kuncipintu")) return null;
  if (normalized.includes("pvc")) return "pvc";
  if (/(standar|standard|standart|setandar)/.test(normalized) || /^kuncipintu(?:pcs|buah|bh)?$/.test(normalized)) {
    return "standard";
  }
  return null;
}

export function detailNamesMatch(actual: string, expected: string, honorarium = false) {
  // III.05 has two different physical products that used to share the same
  // resume name. Never allow fuzzy/substring matching to merge PVC with the
  // standard lock, including target lookup variants that store the distinction
  // in the specification field rather than the item name.
  const actualDoorLock = doorLockVariant(actual);
  const expectedDoorLock = doorLockVariant(expected);
  if ((actualDoorLock || expectedDoorLock) && actualDoorLock !== expectedDoorLock) return false;
`;
replaceOnce(runnerFile, "add door-lock semantic discriminator", detailNamesAnchor, detailNamesReplacement);

const oldLookup = `  const matches = items.filter((item) => {
    const label = detailLookupLabel(kind, item);
    return detailNamesMatch(label, line.namaItem) || detailNamesMatch(item.nama ?? "", line.namaItem);
  });`;
const newLookup = `  const expectedDoorLock = kind === "material" ? doorLockVariant(line.namaItem) : null;
  const matches = items.filter((item) => {
    const label = detailLookupLabel(kind, item);
    if (expectedDoorLock) {
      // For Kunci Pintu, always map from the complete lookup label so target
      // specifications such as PVC vs Standar are part of the identity.
      return doorLockVariant(label) === expectedDoorLock;
    }
    return detailNamesMatch(label, line.namaItem) || detailNamesMatch(item.nama ?? "", line.namaItem);
  });`;
replaceOnce(runnerFile, "make lookup specification-aware for door locks", oldLookup, newLookup);

console.log("Patched III.05 door-lock base data and Playwright lookup mapping.");
