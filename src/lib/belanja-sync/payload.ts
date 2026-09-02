import type { Project, ResumeItem } from "../../types/domain";
import type { BelanjaPayload, BelanjaPayloadValidation } from "./types";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeBelanjaText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeBelanjaMatchText(value: string | null | undefined) {
  return normalizeBelanjaText(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function belanjaTextTokens(value: string | null | undefined) {
  return normalizeBelanjaText(value)
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9]+/g, ""))
    .filter(Boolean);
}

export function belanjaTextMatches(actual: string | null | undefined, expected: string | null | undefined) {
  const actualNorm = normalizeBelanjaMatchText(actual);
  const expectedNorm = normalizeBelanjaMatchText(expected);
  if (!actualNorm || !expectedNorm) return false;
  if (actualNorm === expectedNorm || actualNorm.includes(expectedNorm)) return true;

  const expectedTokens = belanjaTextTokens(expected);
  return expectedTokens.length > 1 && expectedTokens.every((token) => actualNorm.includes(token));
}

export function normalizeBelanjaNumber(value: number | string | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const normalized = raw
    .replace(/\s+/g, "")
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function roundBelanjaMoney(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function resumeItemAmount(item: Pick<ResumeItem, "volume" | "unitPrice" | "amountOverride">) {
  if (typeof item.amountOverride === "number" && Number.isFinite(item.amountOverride)) {
    return Math.round(item.amountOverride);
  }
  return Math.round(normalizeBelanjaNumber(item.volume) * normalizeBelanjaNumber(item.unitPrice));
}

function inferBelanjaExpenseType(item: ResumeItem): BelanjaPayload["expenseType"] {
  if (item.expenseType) return item.expenseType;
  const text = normalizeBelanjaText([
    item.category,
    item.categoryName,
    item.itemName,
    item.unit,
    item.vendorName,
  ].filter(Boolean).join(" ")).toLowerCase();

  if (
    /\borang\b|\borang-hari\b|\bmandor\b|\btukang\b|\bkenek\b|\bkuli\b|\bpekerja\b|\bupah\b|\bhonorarium\b|\blembur\b|\buang jalan\b|\bborong\b/.test(text)
  ) {
    return "labor";
  }
  if (
    /\bsewa\b|\balat\b|\bfasilitas\b|\bdump truck\b|\bexcavator\b|\btandem\b|\broller\b|\bgenset\b|\bconcrete mixer\b|\bmolen\b|\bjam\b/.test(text)
  ) {
    return "equipment";
  }
  return "material";
}

export function normalizeBelanjaIsoDate(value: string | null | undefined) {
  const trimmed = normalizeBelanjaText(value);
  if (!trimmed) return "";
  if (ISO_DATE_PATTERN.test(trimmed)) return trimmed;

  const local = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(trimmed);
  if (!local) return trimmed;

  const day = Number(local[1]);
  const month = Number(local[2]);
  const year = Number(local[3].length === 2 ? `20${local[3]}` : local[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return trimmed;
  }
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

export function buildBelanjaPayload(project: Project, item: ResumeItem): BelanjaPayload {
  return {
    sourceItemId: item.id,
    projectId: project.id,
    tanggal: normalizeBelanjaIsoDate(item.expenseDate),
    namaItem: normalizeBelanjaText(item.itemName),
    qty: normalizeBelanjaNumber(item.volume),
    satuan: normalizeBelanjaText(item.unit),
    hargaSatuan: roundBelanjaMoney(normalizeBelanjaNumber(item.unitPrice)),
    jumlah: roundBelanjaMoney(resumeItemAmount(item)),
    desa: normalizeBelanjaText(project.villageName),
    kecamatan: normalizeBelanjaText(project.districtName),
    kabupaten: normalizeBelanjaText(project.regencyName),
    tahap: normalizeBelanjaText(item.stageName || item.stageCode),
    categoryCode: normalizeBelanjaText(item.categoryCode),
    kategori: normalizeBelanjaText(item.categoryName || item.category),
    expenseType: inferBelanjaExpenseType(item),
    vendor: normalizeBelanjaText(item.vendorName),
    durationDays: typeof item.durationDays === "number" && Number.isFinite(item.durationDays) ? item.durationDays : null,
    keterangan: normalizeBelanjaText(item.notes),
  };
}

export function validateBelanjaPayload(payload: BelanjaPayload, tolerance = 0): BelanjaPayloadValidation {
  const errors: string[] = [];
  const computedJumlah = roundBelanjaMoney(payload.qty * payload.hargaSatuan);
  const difference = roundBelanjaMoney(payload.jumlah - computedJumlah);

  if (!payload.sourceItemId) errors.push("sourceItemId kosong.");
  if (!payload.projectId) errors.push("projectId kosong.");
  if (!payload.tanggal || !ISO_DATE_PATTERN.test(payload.tanggal)) errors.push("Tanggal harus format ISO yyyy-mm-dd dari Resume.");
  if (!payload.namaItem) errors.push("Nama item kosong.");
  if (!Number.isFinite(payload.qty) || payload.qty <= 0) errors.push("Qty harus angka lebih dari 0.");
  if (!payload.satuan) errors.push("Satuan kosong.");
  if (!Number.isFinite(payload.hargaSatuan) || payload.hargaSatuan < 0) errors.push("Harga satuan harus angka valid.");
  if (!Number.isFinite(payload.jumlah) || payload.jumlah < 0) errors.push("Jumlah harus angka valid.");
  if (Math.abs(difference) > tolerance) {
    errors.push(`Jumlah Resume ${payload.jumlah} tidak sama dengan qty x harga satuan ${computedJumlah}.`);
  }

  return {
    valid: errors.length === 0,
    errors,
    computedJumlah,
    difference,
  };
}

export function summarizeBelanjaPayloads(payloads: BelanjaPayload[]) {
  return {
    itemCount: payloads.length,
    totalAmount: payloads.reduce((sum, payload) => sum + payload.jumlah, 0),
  };
}
