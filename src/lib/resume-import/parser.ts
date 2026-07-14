import { getStageLabel } from "@/constants/stages";
import { getResumeItemAmount } from "@/lib/resume-calculations";
import { ResumeItem, StageCode, Vendor } from "@/types/domain";

export type ParsedResume = {
  sourceFile: string;
  items: ResumeItem[];
  sourceTotals: {
    grandTotal: number;
    byStage: Record<string, number>;
    byCategory: Record<string, number>;
  };
  warnings: string[];
};

export type ResumeImportDiff = {
  added: ResumeItem[];
  removed: ResumeItem[];
  changed: Array<{ before: ResumeItem; after: ResumeItem; fields: string[] }>;
  unchanged: ResumeItem[];
  oldTotal: number;
  newTotal: number;
};

type LineRef = {
  text: string;
  page: number;
  row: number;
};

type Section = {
  stageCode: StageCode;
  stageName: string;
  lines: LineRef[];
};

type CategoryRef = {
  code: string;
  name: string;
  total?: number;
};

const STAGE_ORDER: StageCode[] = ["TAHAP_I", "TAHAP_II", "TAHAP_III", "TAHAP_IV", "RESUME_ALL"];

const DEFAULT_CATEGORY_NAMES: Record<string, string[]> = {
  TAHAP_I: [
    "Pek. Pemasangan Bowplang",
    "Pek. Pondasi dan footplat Beton",
    "Sewa Peralatan dan Kendaraan",
    "Tenaga Kerja Pembangunan KDKMP",
    "Tenaga Lembur",
  ],
  TAHAP_II: [
    "Pek. Kolom Pendestal, Sloof, Wiremesh dan Plat Lantai Dasar",
    "Pemasangan bata, plesteran, pengacian dan dinding partisi",
    "Pek. Struktur Atas",
    "Pek. Struktur Baja",
    "Pek. Struktur Rangka Atap",
    "Pek. Struktur Rangka Kanopi",
    "Sewa Peralatan dan Kendaraan",
    "Tenaga Kerja Pembangunan KDKMP",
    "Tenaga Lembur",
  ],
  TAHAP_III: [
    "Pasang Keramik Lantai, Dinding dan Plat Lantai Dasar Beton",
    "Pek. Pemasangan Plafond Gypsum dan Plafond Kalsiboard",
    "Finishing Cat Interior & Cat Exterior",
    "Partisi Kaca, Pintu kaca frameles",
    "Pek. Sanitair dan Septictank",
    "Penutup Atap Utama, Atap Kanopi, Facade, Infrastruktur",
    "Sewa Peralatan dan Kendaraan",
    "Tenaga Kerja Pembangunan KDKMP",
    "Tenaga Lembur",
  ],
  TAHAP_IV: [
    "Pek. Mekanikal (Saluran Air Bersih, Air Bekas, Air Hujan)",
    "Pek. Elektrikal (Distribusi listrik, Instalasi Penerangan dan Kontak)",
    "Pekerjaan Instalasi Proteksi Petir",
    "Sewa Peralatan dan Kendaraan",
    "Tenaga Kerja Pembangunan KDKMP",
  ],
  RESUME_ALL: ["Pek. Di luar Konstruksi Inti"],
};

function cleanText(value: string) {
  return value
    .replace(/\t/g, " ")
    .replace(/Ã˜/g, "Diameter")
    .replace(/Ø/g, "Diameter")
    .replace(/â€“/g, "-")
    .replace(/â€œ|â€�/g, '"')
    .replace(/â€™/g, "'")
    .replace(/Â²/g, "2")
    .replace(/Â/g, "")
    .replace(/faÃ§ade/gi, "facade")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeItemName(value: string) {
  if (value.trim().toLowerCase() === "penambahan daya listrik menjadi 16.500 va") {
    return "Penambahan Daya Listrik Menjadi 16.500 VA";
  }
  return value;
}

function parseNumber(value: string | undefined) {
  if (!value) return 0;
  const numeric = Number(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(numeric) ? numeric : 0;
}

function isNumericToken(value: string | undefined) {
  return Boolean(value && /^\d+(?:[.,]\d+)?$/.test(value));
}

function isMoneyToken(value: string | undefined) {
  return Boolean(value && /^\d{1,3}(?:\.\d{3})+(?:,\d+)?$|^\d+(?:,\d+)?$/.test(value));
}

function parseDate(value: string | undefined) {
  const match = value?.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return "";
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function stageFromLine(line: string): StageCode | null {
  const upper = line.toUpperCase();
  if (!upper.includes("PERIHAL")) return null;
  if (upper.includes("DI LUAR KONSTRUKSI INTI")) return "RESUME_ALL";
  if (upper.includes("TAHAP IV")) return "TAHAP_IV";
  if (upper.includes("TAHAP III")) return "TAHAP_III";
  if (upper.includes("TAHAP II")) return "TAHAP_II";
  if (upper.includes("TAHAP I ") || upper.endsWith("TAHAP I")) return "TAHAP_I";
  return null;
}

function pageLines(text: string): LineRef[] {
  let page = 1;
  let row = 0;
  const lines: LineRef[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const marker = rawLine.match(/--\s*(\d+)\s+of\s+\d+\s*--/i);
    if (marker) {
      page = Number(marker[1]);
      row = 0;
      continue;
    }

    row += 1;
    const line = cleanText(rawLine);
    if (line) lines.push({ text: line, page, row });
  }

  return lines;
}

function buildSections(lines: LineRef[]) {
  const sections = new Map<StageCode, Section>();
  let current: Section | null = null;

  for (const line of lines) {
    const nextStage = stageFromLine(line.text);
    if (nextStage) {
      current = sections.get(nextStage) ?? {
        stageCode: nextStage,
        stageName: nextStage === "RESUME_ALL" ? "Pekerjaan Di Luar Konstruksi Inti" : getStageLabel(nextStage),
        lines: [],
      };
      sections.set(nextStage, current);
    }

    if (current) current.lines.push(line);
  }

  return STAGE_ORDER.map((stageCode) => sections.get(stageCode)).filter((section): section is Section => Boolean(section));
}

function categoryCodeByIndex(index: number) {
  return String.fromCharCode("A".charCodeAt(0) + index);
}

function collectCategories(section: Section): CategoryRef[] {
  const byCode = new Map<string, CategoryRef>();

  for (const line of section.lines) {
    const match = line.text.match(/^([A-I])\.\s+(.+)$/);
    if (!match) continue;
    if (/^Terbilang|^JUMLAH/i.test(match[2])) continue;
    byCode.set(match[1], { code: match[1], name: cleanText(match[2]) });
  }

  const defaults = DEFAULT_CATEGORY_NAMES[section.stageCode] ?? ["Kategori"];
  defaults.forEach((name, index) => {
    const code = categoryCodeByIndex(index);
    if (!byCode.has(code)) byCode.set(code, { code, name });
  });

  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}

function vendorIdFromName(rawVendor: string, vendors: Vendor[]) {
  const normalized = rawVendor.trim().toLowerCase();
  if (!normalized || normalized === "-") return "";
  return vendors.find((vendor) => {
    const names = [vendor.name, ...(vendor.aliases ?? [])].map((entry) => entry.toLowerCase());
    return names.includes(normalized);
  })?.id ?? "";
}

function splitAmountAndVendor(line: string) {
  const match = line.match(/\bRp\.?\s*([\d.]+)(?:\s+(.*))?$/i);
  if (!match) return null;
  return {
    beforeAmount: line.slice(0, match.index).trim(),
    amount: parseNumber(match[1]),
    vendorName: cleanText(match[2] ?? ""),
  };
}

function stripLeadingIdentity(value: string) {
  let itemNo = "";
  let date = "";
  let rest = value.trim();

  const numberedWithDate = rest.match(/^(\d+[a-z]?)\s+(\d{2}-\d{2}-\d{4})\s+(.+)$/i);
  if (numberedWithDate) {
    itemNo = numberedWithDate[1];
    date = parseDate(numberedWithDate[2]);
    rest = numberedWithDate[3];
    return { itemNo, date, rest };
  }

  const datedSubitem = rest.match(/^(\d{2}-\d{2}-\d{4})\s+([a-z]\.)\s+(.+)$/i);
  if (datedSubitem) {
    date = parseDate(datedSubitem[1]);
    itemNo = datedSubitem[2];
    rest = rest.replace(datedSubitem[1], "").trim();
    return { itemNo, date, rest };
  }

  const numbered = rest.match(/^(\d+[a-z]?)\s+(.+)$/i);
  if (numbered) {
    itemNo = numbered[1];
    rest = numbered[2];
  }

  return { itemNo, date, rest };
}

function parseQuantityPriceUnit(rest: string, amount: number) {
  const tokens = rest.split(/\s+/).filter(Boolean);
  const candidates: Array<{ itemName: string; volume: number; unitPrice: number; unit: string; exact: boolean }> = [];

  for (let index = 1; index < tokens.length - 2; index += 1) {
    if (!isNumericToken(tokens[index]) || !isMoneyToken(tokens[index + 1])) continue;
    const itemName = tokens.slice(0, index).join(" ");
    const volume = parseNumber(tokens[index]);
    const unitPrice = parseNumber(tokens[index + 1]);
    const unit = tokens.slice(index + 2).join(" ");
    if (!itemName || !unit || volume <= 0 || unitPrice <= 0) continue;
    candidates.push({
      itemName,
      volume,
      unitPrice,
      unit,
      exact: Math.round(volume * unitPrice) === amount,
    });
  }

  const exact = candidates.filter((candidate) => candidate.exact).sort((a, b) => b.itemName.length - a.itemName.length)[0];
  if (exact) return exact;

  const fallback = candidates.sort((a, b) => b.itemName.length - a.itemName.length)[0];
  if (fallback) return fallback;

  return {
    itemName: rest,
    volume: 0,
    unitPrice: 0,
    unit: "",
    exact: false,
  };
}

function isNonItemLine(line: string) {
  return (
    /^NAMA PROJECT/i.test(line) ||
    /^WILAYAH/i.test(line) ||
    /^KDKMP/i.test(line) ||
    /^PERIHAL/i.test(line) ||
    /^NO\b/i.test(line) ||
    /^BELANJA\b/i.test(line) ||
    /^BARANG \/ JASA/i.test(line) ||
    /^VOL\b/i.test(line) ||
    /^SAT\b/i.test(line) ||
    /^VENDOR\b/i.test(line) ||
    /^1 2 3 4/i.test(line) ||
    /^Terbilang/i.test(line) ||
    /^JUMLAH TOTAL/i.test(line) ||
    /^TOTAL PENGGUNAAN/i.test(line)
  );
}

function parseSection(section: Section, vendors: Vendor[], sourceFile: string, warnings: string[]) {
  const categories = collectCategories(section);
  const categoryTotals = new Map<string, number>();
  const items: ResumeItem[] = [];
  let categoryIndex = 0;

  for (const line of section.lines) {
    const text = line.text;
    if (isNonItemLine(text) || /^([A-I])\.\s+/.test(text)) continue;

    const subtotal = text.match(/^Rp\.?\s*([\d.]+)$/i);
    if (subtotal) {
      const category = categories[categoryIndex];
      if (category) {
        const amount = parseNumber(subtotal[1]);
        category.total = amount;
        categoryTotals.set(category.code, amount);
      }
      categoryIndex += 1;
      continue;
    }

    const amountVendor = splitAmountAndVendor(text);
    if (!amountVendor) continue;

    const category = categories[Math.min(categoryIndex, categories.length - 1)] ?? { code: "A", name: "Kategori" };
    const { itemNo, date, rest } = stripLeadingIdentity(amountVendor.beforeAmount);
    const parsed = parseQuantityPriceUnit(rest, amountVendor.amount);
    const amountOverride = parsed.exact ? null : amountVendor.amount;
    const rawVendor = amountVendor.vendorName.trim();
    const vendorId = vendorIdFromName(rawVendor, vendors);
    const categoryName = category.name;
    const itemName = normalizeItemName(cleanText(parsed.itemName));

    if (rawVendor && rawVendor !== "-" && !vendorId) {
      warnings.push(`Vendor "${rawVendor}" belum ada di master vendor untuk ${itemName}.`);
    }

    items.push({
      id: `import-${section.stageCode.toLowerCase()}-${category.code.toLowerCase()}-${items.length + 1}`,
      stageCode: section.stageCode,
      stageName: section.stageName,
      categoryCode: category.code,
      categoryName,
      category: `${category.code}. ${categoryName}`,
      itemNo: itemNo || `${items.length + 1}`,
      expenseDate: date,
      itemName,
      volume: parsed.volume,
      unit: parsed.unit,
      unitPrice: parsed.unitPrice,
      amountOverride,
      vendorId,
      vendorName: rawVendor,
      notes: "",
      sortOrder: 0,
      sourceFile,
      sourcePage: line.page,
      sourceRow: line.row,
      sourceType: "pdf",
      isManualAdded: false,
      isIncludedInResumeTotal: true,
      isGeneratedToNote: false,
      noteId: null,
      categoryTotal: categoryTotals.get(category.code) ?? null,
      validationStatus: amountOverride === null ? "valid" : "warning",
    });
  }

  const computedCategoryTotals = new Map<string, number>();
  for (const item of items) {
    computedCategoryTotals.set(item.categoryCode ?? "A", (computedCategoryTotals.get(item.categoryCode ?? "A") ?? 0) + getResumeItemAmount(item));
  }

  return items.map((item) => ({
    ...item,
    categoryTotal: categoryTotals.get(item.categoryCode ?? "A") ?? computedCategoryTotals.get(item.categoryCode ?? "A") ?? null,
  }));
}

export function parseResumeText(text: string, { sourceFile, vendors }: { sourceFile: string; vendors: Vendor[] }): ParsedResume {
  const warnings: string[] = [];
  const lines = pageLines(text);
  const sections = buildSections(lines);
  const items = sections.flatMap((section) => parseSection(section, vendors, sourceFile, warnings));
  const sortedItems = items.map((item, index) => ({ ...item, sortOrder: index + 1 }));

  const byStage: Record<string, number> = {};
  const byCategory: Record<string, number> = {};

  for (const item of sortedItems) {
    const amount = getResumeItemAmount(item);
    byStage[item.stageCode] = (byStage[item.stageCode] ?? 0) + amount;
    const categoryKey = `${item.stageCode}:${item.categoryCode ?? item.category}`;
    byCategory[categoryKey] = (byCategory[categoryKey] ?? 0) + amount;
  }

  const stageTotals = new Map(Object.entries(byStage));

  return {
    sourceFile,
    items: sortedItems.map((item) => ({
      ...item,
      stageTotal: stageTotals.get(item.stageCode) ?? null,
    })),
    sourceTotals: {
      grandTotal: Object.values(byStage).reduce((sum, total) => sum + total, 0),
      byStage,
      byCategory,
    },
    warnings,
  };
}

export function resumeItemFingerprint(item: ResumeItem) {
  return [
    item.stageCode,
    item.categoryCode ?? normalizeKey(item.category),
    item.itemNo ?? "",
    normalizeKey(item.itemName),
  ].join("|");
}

function normalizeKey(value: string | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function valuesChanged(before: ResumeItem, after: ResumeItem) {
  const fields: string[] = [];
  if (before.expenseDate !== after.expenseDate) fields.push("tanggal");
  if (before.itemName !== after.itemName) fields.push("uraian");
  if (before.volume !== after.volume) fields.push("qty");
  if (before.unit !== after.unit) fields.push("satuan");
  if (before.unitPrice !== after.unitPrice) fields.push("harga");
  if (getResumeItemAmount(before) !== getResumeItemAmount(after)) fields.push("jumlah");
  if ((before.vendorName ?? "") !== (after.vendorName ?? "") || before.vendorId !== after.vendorId) fields.push("vendor");
  return fields;
}

export function compareResumeItems(currentItems: ResumeItem[], importedItems: ResumeItem[]): ResumeImportDiff {
  const currentByKey = new Map(currentItems.map((item) => [resumeItemFingerprint(item), item]));
  const importedByKey = new Map(importedItems.map((item) => [resumeItemFingerprint(item), item]));
  const added: ResumeItem[] = [];
  const removed: ResumeItem[] = [];
  const changed: ResumeImportDiff["changed"] = [];
  const unchanged: ResumeItem[] = [];

  for (const imported of importedItems) {
    const current = currentByKey.get(resumeItemFingerprint(imported));
    if (!current) {
      added.push(imported);
      continue;
    }
    const fields = valuesChanged(current, imported);
    if (fields.length > 0) changed.push({ before: current, after: imported, fields });
    else unchanged.push(current);
  }

  for (const current of currentItems) {
    if (!importedByKey.has(resumeItemFingerprint(current))) removed.push(current);
  }

  return {
    added,
    removed,
    changed,
    unchanged,
    oldTotal: currentItems.reduce((sum, item) => sum + getResumeItemAmount(item), 0),
    newTotal: importedItems.reduce((sum, item) => sum + getResumeItemAmount(item), 0),
  };
}

export function mergeResumeItems(currentItems: ResumeItem[], importedItems: ResumeItem[]) {
  const importedByKey = new Map(importedItems.map((item) => [resumeItemFingerprint(item), item]));
  const merged: ResumeItem[] = [];
  const used = new Set<string>();

  for (const current of currentItems) {
    const key = resumeItemFingerprint(current);
    const imported = importedByKey.get(key);
    if (!imported) {
      merged.push(current);
      continue;
    }
    used.add(key);
    merged.push({
      ...imported,
      id: current.id,
      isGeneratedToNote: false,
      noteId: null,
      sortOrder: current.sortOrder,
    });
  }

  for (const imported of importedItems) {
    const key = resumeItemFingerprint(imported);
    if (used.has(key)) continue;
    merged.push({
      ...imported,
      id: `import-${crypto.randomUUID()}`,
      sortOrder: merged.length + 1,
    });
  }

  return merged.map((item, index) => ({ ...item, sortOrder: index + 1 }));
}
