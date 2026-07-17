import type { GeneratedNota, StageCode, Vendor } from "@/types/domain";

const CORE_NOTA_STAGES = new Set<StageCode>([
  "TAHAP_I",
  "TAHAP_II",
  "TAHAP_III",
  "TAHAP_IV",
]);

const SPECIAL_VENDOR_IDS = new Set([
  "vendor-cbb",
  "vendor-cbs",
  "vendor-hpm",
]);

const SPECIAL_TEMPLATE_IDS = new Set([
  "template-invoice-cbb",
  "template-cbb",
  "template-cbs",
  "template-hpm",
]);

const SPECIAL_VENDOR_PHRASES = [
  "cahaya baja bangunan",
  "citra baja sejahtera",
];

// Match acronym variants such as CBB, CBS, HPM, C.B.B, or H-P-M without
// accidentally matching a longer word such as "ACBBX".
const SPECIAL_VENDOR_TOKEN = /(?:^|[^a-z0-9])(?:c[^a-z0-9]*b[^a-z0-9]*[bs]|h[^a-z0-9]*p[^a-z0-9]*m)(?=$|[^a-z0-9])/i;

export type NotaOutputOrderCandidate = Pick<
  GeneratedNota,
  "stageCode" | "documentType" | "vendorId" | "vendorName" | "templateId" | "templateName"
> & {
  vendor?: Pick<Vendor, "id" | "name" | "aliases"> | null;
};

function normalized(value: string | undefined | null) {
  return (value ?? "").trim().toLowerCase();
}

function hasSpecialVendorName(value: string | undefined | null) {
  const candidate = normalized(value);
  if (!candidate) return false;
  return SPECIAL_VENDOR_TOKEN.test(candidate)
    || SPECIAL_VENDOR_PHRASES.some((phrase) => candidate.includes(phrase));
}

/**
 * CBB/CBS/HPM nota use a different paper path and must be printed after the
 * regular nota in the same core stage. Matching uses canonical identifiers as
 * well as display names so legacy/custom records remain covered.
 */
export function isSpecialPaperNota(doc: NotaOutputOrderCandidate) {
  if (doc.documentType !== "nota" || !CORE_NOTA_STAGES.has(doc.stageCode)) return false;

  const vendorIds = [doc.vendorId, doc.vendor?.id].map(normalized);
  if (vendorIds.some((id) => SPECIAL_VENDOR_IDS.has(id))) return true;

  const templateId = normalized(doc.templateId);
  if (SPECIAL_TEMPLATE_IDS.has(templateId)) return true;

  return [
    doc.vendorName,
    doc.vendor?.name,
    ...(doc.vendor?.aliases ?? []),
    doc.vendorId,
    doc.templateName,
    doc.templateId,
  ].some(hasSpecialVendorName);
}

/**
 * Stable-partition only nota positions inside each Tahap I-IV bucket.
 * Kwitansi and non-core-stage entries keep their exact array positions, while
 * both regular and special nota preserve their original relative order.
 */
export function moveSpecialNotasToStageEnd<T extends NotaOutputOrderCandidate>(source: readonly T[]): T[] {
  const orderedNotasByStage = new Map<StageCode, T[]>();

  for (const stageCode of CORE_NOTA_STAGES) {
    const stageNotas = source.filter((doc) => doc.documentType === "nota" && doc.stageCode === stageCode);
    if (stageNotas.length === 0) continue;

    orderedNotasByStage.set(stageCode, [
      ...stageNotas.filter((doc) => !isSpecialPaperNota(doc)),
      ...stageNotas.filter(isSpecialPaperNota),
    ]);
  }

  const stageCursors = new Map<StageCode, number>();
  return source.map((doc) => {
    if (doc.documentType !== "nota" || !CORE_NOTA_STAGES.has(doc.stageCode)) return doc;

    const stageNotas = orderedNotasByStage.get(doc.stageCode);
    if (!stageNotas) return doc;

    const cursor = stageCursors.get(doc.stageCode) ?? 0;
    stageCursors.set(doc.stageCode, cursor + 1);
    return stageNotas[cursor] ?? doc;
  });
}
