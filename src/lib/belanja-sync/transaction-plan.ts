import type { Project, ResumeItem } from "../../types/domain";
import {
  belanjaTextMatches,
  buildBelanjaPayload,
  normalizeBelanjaIsoDate,
  normalizeBelanjaMatchText,
  normalizeBelanjaText,
  roundBelanjaMoney,
  validateBelanjaPayload,
} from "./payload";
import type {
  BelanjaPayload,
  BelanjaTransactionIdentity,
  BelanjaTransactionKind,
  BelanjaTransactionLine,
  BelanjaTransactionPayload,
  KdkmpIdentity,
} from "./types";

export const DEFAULT_BELANJA_BASE_TRANSACTION_COUNT = 43;
export const BELANJA_COPY_RECONCILE_OPERATION = "copy_reconcile_v1" as const;

export type BelanjaTransactionPlan = {
  projectId: string;
  transactionCount: number;
  lineCount: number;
  totalAmount: number;
  transactions: BelanjaTransactionPayload[];
  summary: {
    material: number;
    honorarium: number;
    equipment: number;
  };
  resumeHash: string;
};

const CATEGORY_TEXT_FALLBACKS: Record<string, string> = {
  "I.01": "Pembersihan Lahan",
  "I.02": "Pekerjaan Bouwplank",
  "II.01": "Struktur Bawah",
  "II.02": "Struktur Atas Bangunan",
  "II.03": "Rangka Atap",
  "III.01": "Pasangan",
  "III.02": "Lantai dan Dinding",
  "III.03": "Penutup Langit-Langit",
  "III.04": "Finishing Cat",
  "III.05": "Kusen",
  "III.06": "Sanitair",
  "III.07": "Penutup Atap",
  "III.08": "Facade",
  "IV.01": "Air Bersih",
  "IV.02": "Air Kotor/Bekas",
  "IV.03": "Pembuangan Air Hujan",
  "V.01": "Distribusi listrik",
  "V.02": "Instalasi Penerangan/Kotak",
  "V.03": "Pekerjaan Proteksi Petir",
  "VI.01": "Sosialisasi",
  "VI.02": "Rapat Koordinasi",
  "VI.03": "Survei/Pengukuran Kelayakan",
  "VI.04": "Penyiapan Lahan",
  "VI.05": "Pematangan Lahan",
  "VI.06": "Cut and Fill",
  "VI.07": "Sumur Bor",
  "VI.10": "Trafo dan Tiang Listrik",
  "VII.01": "Biaya Operasional",
};

const STAGE_TEXT_FALLBACKS: Record<string, string> = {
  I: "I - PEKERJAAN PERSIAPAN",
  II: "II - PEKERJAAN STRUKTUR",
  III: "III - PEKERJAAN ARSITEKTUR",
  IV: "IV - PEKERJAAN MEKANIKAL",
  V: "V - PEKERJAAN ELEKTRIKAL",
  VI: "VI - PEKERJAAN LUAR KONSTRUKSI",
  VII: "VII - PEKERJAAN DUKUNGAN OPERASIONAL",
};

function stageRomanFromPayload(payload: Pick<BelanjaPayload, "categoryCode" | "tahap">) {
  return normalizeBelanjaText(payload.categoryCode).split(".")[0].toUpperCase()
    || /\b(VII|VI|IV|V|III|II|I)\b/i.exec(payload.tahap ?? "")?.[1]?.toUpperCase()
    || "";
}

export function normalizeTransactionName(value: string | null | undefined) {
  return normalizeBelanjaMatchText(value);
}

export function transactionKindFromBelanjaCategory(value: string | null | undefined): BelanjaTransactionKind {
  const normalized = normalizeTransactionName(value);
  if (/upah|honor|tukang|mandor|pekerja|kuli|kenek|borong/.test(normalized)) return "honorarium";
  if (/sewa|alat|fasilitas/.test(normalized)) return "equipment";
  return "material";
}

export function transactionKindFromPayload(payload: BelanjaPayload): BelanjaTransactionKind {
  if (payload.expenseType === "labor") return "honorarium";
  if (payload.expenseType === "equipment") return "equipment";
  return "material";
}

export function belanjaCategoryTextFromKind(kind: BelanjaTransactionKind) {
  if (kind === "honorarium") return "Upah / Honorarium";
  if (kind === "equipment") return "Sewa Alat / Fasilitas";
  return "Bahan / Material";
}

function transactionBaseKey(payload: BelanjaPayload) {
  const kind = transactionKindFromPayload(payload);
  const code = normalizeBelanjaText(payload.categoryCode);
  return [
    normalizeTransactionName(stageRomanFromPayload(payload)),
    normalizeTransactionName(code),
    normalizeTransactionName(belanjaCategoryTextFromKind(kind)),
  ].join("|");
}

export function buildTransactionIdentity(payload: BelanjaPayload, occurrence = 1): BelanjaTransactionIdentity {
  const kind = transactionKindFromPayload(payload);
  const categoryCode = normalizeBelanjaText(payload.categoryCode);
  const stageRoman = stageRomanFromPayload(payload);
  const categoryText = normalizeBelanjaText(payload.kategori) || CATEGORY_TEXT_FALLBACKS[categoryCode] || categoryCode;
  const stageText = normalizeBelanjaText(payload.tahap) || STAGE_TEXT_FALLBACKS[stageRoman] || stageRoman;
  const belanjaCategoryText = belanjaCategoryTextFromKind(kind);
  const transactionDate = normalizeBelanjaIsoDate(payload.tanggal);
  const baseKey = [
    normalizeTransactionName(stageRoman),
    normalizeTransactionName(categoryCode),
    normalizeTransactionName(categoryText),
    normalizeTransactionName(belanjaCategoryText),
    transactionDate,
  ].join("|");
  return {
    key: `${baseKey}|${occurrence}`,
    stageKey: normalizeTransactionName(stageRoman || stageText),
    stageText,
    categoryCode,
    categoryText,
    categoryKey: normalizeTransactionName(`${categoryCode} ${categoryText}`),
    belanjaCategoryText,
    belanjaCategoryKey: normalizeTransactionName(belanjaCategoryText),
    transactionDate,
    kind,
    occurrence,
  };
}

export function inferHonorariumRole(payload: Pick<BelanjaPayload, "namaItem" | "satuan" | "vendor" | "keterangan">): BelanjaTransactionLine["role"] {
  const text = normalizeTransactionName([payload.namaItem, payload.satuan, payload.vendor, payload.keterangan].filter(Boolean).join(" "));
  if (/kepala.*tukang|kepalatukang/.test(text)) return "kepala_tukang";
  if (/kuli|kenek|helper|pekerja/.test(text) && !/pekerjaan/.test(text)) return "kuli_kenek";
  if (/mandor|survei|survey|pengukuran|pemetaan/.test(text)) return "mandor";
  if (/tukang|pekerja|borong|lembur/.test(text)) return "tukang";
  return "other";
}

export function honorariumRoleLabel(role: BelanjaTransactionLine["role"]) {
  if (role === "kepala_tukang") return "Kepala Tukang";
  if (role === "kuli_kenek") return "Kuli/Kenek";
  if (role === "mandor") return "Mandor";
  if (role === "tukang") return "Tukang";
  return "Honorarium";
}

function looksLikeInternalVendor(value: string) {
  return /^(kwitansi|kuitansi|ppm|internal|upah|honorarium|tukang|mandor|kuli|kenek|pekerja)$/i.test(normalizeBelanjaText(value));
}

export function resolveHonorariumRecipient(payload: BelanjaPayload) {
  const vendor = normalizeBelanjaText(payload.vendor);
  if (vendor && !looksLikeInternalVendor(vendor)) return vendor;
  const role = inferHonorariumRole(payload);
  return honorariumRoleLabel(role);
}

function makeLine(payload: BelanjaPayload, sequence: number): BelanjaTransactionLine {
  const role = transactionKindFromPayload(payload) === "honorarium" ? inferHonorariumRole(payload) : undefined;
  return {
    ...payload,
    lineId: payload.sourceItemId,
    sequence,
    role,
    recipient: role ? resolveHonorariumRecipient(payload) : normalizeBelanjaText(payload.vendor),
  };
}

function splitRuleKey(payload: BelanjaPayload) {
  return `${normalizeTransactionName(payload.categoryCode)}|${transactionKindFromPayload(payload)}`;
}

function isLemburLine(payload: BelanjaPayload) {
  return /lembur/.test(normalizeTransactionName([payload.namaItem, payload.keterangan].filter(Boolean).join(" ")));
}

function isFoldingLine(payload: BelanjaPayload) {
  return /folding|polding/.test(normalizeTransactionName(payload.namaItem));
}

type TemplateSplitRule = Array<{
  label: string;
  match: (payload: BelanjaPayload) => boolean;
}>;

const TEMPLATE_SPLIT_RULES: Record<string, TemplateSplitRule> = {
  "iii05|honorarium": [
    { label: "pintu/partisi/kaca", match: (payload) => !isFoldingLine(payload) },
    { label: "folding gate/folding door", match: isFoldingLine },
  ],
  "iii01|honorarium": [
    { label: "pekerja reguler", match: (payload) => !isLemburLine(payload) },
    { label: "lembur", match: isLemburLine },
  ],
  "i02|honorarium": [
    { label: "pekerja reguler", match: (payload) => !isLemburLine(payload) },
    { label: "lembur", match: isLemburLine },
  ],
};

function splitTemplateGroup(group: BelanjaPayload[]) {
  const rule = TEMPLATE_SPLIT_RULES[splitRuleKey(group[0])];
  if (!rule) return [group];

  const buckets = rule.map((bucket) => ({ ...bucket, payloads: [] as BelanjaPayload[] }));
  for (const payload of group) {
    const bucket = buckets.find((entry) => entry.match(payload));
    if (!bucket) {
      throw new Error(`Line "${payload.namaItem}" tidak cocok dengan split template transaksi ${payload.categoryCode}.`);
    }
    bucket.payloads.push(payload);
  }

  const emptyBuckets = buckets.filter((bucket) => bucket.payloads.length === 0);
  if (emptyBuckets.length > 0) {
    const byDate = new Map<string, BelanjaPayload[]>();
    for (const payload of group) {
      const dateKey = normalizeBelanjaIsoDate(payload.tanggal) || "__no_date__";
      const current = byDate.get(dateKey) ?? [];
      current.push(payload);
      byDate.set(dateKey, current);
    }
    if (byDate.size === rule.length) {
      return [...byDate.entries()]
        .sort(([leftDate], [rightDate]) => rightDate.localeCompare(leftDate))
        .map(([, payloads]) => payloads);
    }
    throw new Error(`Template transaksi ${group[0].categoryCode} membutuhkan bucket ${emptyBuckets.map((bucket) => bucket.label).join(", ")}.`);
  }
  return buckets.map((bucket) => bucket.payloads);
}

function transactionDateForGroup(group: BelanjaPayload[]) {
  return group
    .map((payload) => normalizeBelanjaIsoDate(payload.tanggal))
    .filter(Boolean)
    .sort()
    .at(-1) ?? group[0]?.tanggal ?? "";
}

function summarizeRecipientMap(lines: BelanjaTransactionLine[]) {
  const recipients: Record<string, string> = {};
  for (const line of lines) {
    if (!line.role || !line.recipient) continue;
    recipients[line.role] = line.recipient;
  }
  return Object.keys(recipients).length > 0 ? recipients : undefined;
}

export function stableBelanjaHash(value: unknown) {
  const stableStringify = (input: unknown): string => {
    if (Array.isArray(input)) return `[${input.map(stableStringify).join(",")}]`;
    if (input && typeof input === "object") {
      return `{${Object.entries(input as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
        .join(",")}}`;
    }
    return JSON.stringify(input);
  };
  const json = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < json.length; index += 1) {
    hash ^= json.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stablePlanHashInput(transactions: BelanjaTransactionPayload[]) {
  return transactions.map((transaction) => ({
    key: transaction.transactionKey,
    lines: transaction.lines.map((line) => ({
      id: line.sourceItemId,
      name: line.namaItem,
      qty: line.qty,
      unit: line.satuan,
      price: line.hargaSatuan,
      amount: line.jumlah,
      date: line.tanggal,
      vendor: line.vendor,
      recipient: line.recipient,
    })),
  }));
}

export function buildBelanjaIdempotencyKey(input: {
  projectId: string;
  destination: KdkmpIdentity;
  resumeHash: string;
  operationType?: string;
}) {
  const destinationKey = [
    input.destination.province,
    input.destination.regency,
    input.destination.district,
    input.destination.village,
  ].map(normalizeTransactionName).join(".");
  return [
    input.operationType ?? BELANJA_COPY_RECONCILE_OPERATION,
    input.projectId,
    destinationKey,
    input.resumeHash,
  ].join(":");
}

function assertNoAmbiguousTransactionKeys(transactions: BelanjaTransactionPayload[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const transaction of transactions) {
    if (seen.has(transaction.transactionKey)) duplicates.add(transaction.transactionKey);
    seen.add(transaction.transactionKey);
  }
  if (duplicates.size > 0) {
    throw new Error(`Mapping transaksi ambigu: ${[...duplicates].join(", ")}.`);
  }
}

function canCompareCategory(left: BelanjaPayload, right: BelanjaPayload) {
  if (left.categoryCode && right.categoryCode && normalizeTransactionName(left.categoryCode) !== normalizeTransactionName(right.categoryCode)) {
    return false;
  }
  return belanjaTextMatches(left.kategori, right.kategori) || belanjaTextMatches(right.kategori, left.kategori);
}

export function buildBelanjaTransactionPlan(project: Project, items: ResumeItem[] = project.items): BelanjaTransactionPlan {
  const includedItems = items.filter((item) => item.isIncludedInResumeTotal !== false);
  if (includedItems.length === 0) throw new Error("Resume tidak memiliki item yang bisa dikirim ke Web Belanja.");

  const payloads = includedItems.map((item) => buildBelanjaPayload(project, item));
  const invalid = payloads
    .map((payload) => ({ payload, validation: validateBelanjaPayload(payload) }))
    .filter((entry) => !entry.validation.valid);
  if (invalid.length > 0) {
    throw new Error(`Payload transaksi Belanja belum valid: ${invalid.slice(0, 3).map((entry) => `${entry.payload.namaItem}: ${entry.validation.errors.join(" ")}`).join(" | ")}.`);
  }

  const grouped = new Map<string, BelanjaPayload[]>();
  for (const payload of payloads) {
    const baseKey = transactionBaseKey(payload);
    const current = grouped.get(baseKey);
    if (current) {
      const first = current[0];
      if (!canCompareCategory(first, payload)) throw new Error(`Mapping kategori transaksi ambigu untuk "${payload.namaItem}".`);
      current.push(payload);
    } else {
      grouped.set(baseKey, [payload]);
    }
  }

  const byBaseKey = new Map<string, number>();
  const transactionGroups = [...grouped.values()].flatMap(splitTemplateGroup);
  const transactions = transactionGroups
    .map((group) => ({ group, transactionDate: transactionDateForGroup(group) }))
    .sort((left, right) => {
      const leftFirst = left.group[0];
      const rightFirst = right.group[0];
      return right.transactionDate.localeCompare(left.transactionDate)
        || (leftFirst.categoryCode || "").localeCompare(rightFirst.categoryCode || "")
        || (leftFirst.namaItem || "").localeCompare(rightFirst.namaItem || "");
    })
    .map(({ group, transactionDate }, index): BelanjaTransactionPayload => {
      const first = { ...group[0], tanggal: transactionDate };
      const baseIdentity = buildTransactionIdentity(first);
      const baseOccurrenceKey = baseIdentity.key.replace(/\|\d+$/, "");
      const occurrence = (byBaseKey.get(baseOccurrenceKey) ?? 0) + 1;
      byBaseKey.set(baseOccurrenceKey, occurrence);
      const identity = buildTransactionIdentity(first, occurrence);
      const lines = group
        .map((payload, lineIndex) => makeLine(payload, lineIndex + 1));
      const totalAmount = roundBelanjaMoney(lines.reduce((sum, line) => sum + line.jumlah, 0));
      return {
        ...first,
        operationType: BELANJA_COPY_RECONCILE_OPERATION,
        sourceItemId: lines[0]?.sourceItemId ?? first.sourceItemId,
        namaItem: `${identity.categoryCode} ${identity.categoryText}`.trim(),
        qty: lines.length,
        satuan: "transaksi",
        hargaSatuan: totalAmount,
        jumlah: totalAmount,
        vendor: "",
        transactionId: `${project.id}:${identity.key}`,
        transactionKey: identity.key,
        sequence: index + 1,
        kind: identity.kind,
        lineCount: lines.length,
        sourceResumeItemIds: lines.map((line) => line.sourceItemId),
        transactionIdentity: identity,
        lines,
        totalAmount,
        recipientMap: identity.kind === "honorarium" ? summarizeRecipientMap(lines) : undefined,
      };
    });

  assertNoAmbiguousTransactionKeys(transactions);
  const summary = {
    material: transactions.filter((transaction) => transaction.kind === "material").length,
    honorarium: transactions.filter((transaction) => transaction.kind === "honorarium").length,
    equipment: transactions.filter((transaction) => transaction.kind === "equipment").length,
  };
  const totalAmount = roundBelanjaMoney(transactions.reduce((sum, transaction) => sum + transaction.totalAmount, 0));
  const resumeHash = stableBelanjaHash(stablePlanHashInput(transactions));
  return {
    projectId: project.id,
    transactionCount: transactions.length,
    lineCount: payloads.length,
    totalAmount,
    transactions,
    summary,
    resumeHash,
  };
}

export function summarizeBelanjaTransactionPlan(plan: BelanjaTransactionPlan) {
  return {
    transactionCount: plan.transactionCount,
    lineCount: plan.lineCount,
    totalAmount: plan.totalAmount,
    materialTransactions: plan.summary.material,
    honorariumTransactions: plan.summary.honorarium,
    equipmentTransactions: plan.summary.equipment,
    resumeHash: plan.resumeHash,
  };
}
