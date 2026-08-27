import { StageCode } from "@/types/domain";

export const STAGES: Array<{ code: StageCode; label: string; shortLabel: string; core: boolean }> = [
  { code: "TAHAP_I", label: "I - PEKERJAAN PERSIAPAN", shortLabel: "Tahap 1", core: true },
  { code: "TAHAP_II", label: "II - PEKERJAAN STRUKTUR", shortLabel: "Tahap 2", core: true },
  { code: "TAHAP_III", label: "III - PEKERJAAN ARSITEKTUR", shortLabel: "Tahap 3", core: true },
  { code: "TAHAP_IV", label: "IV - PEKERJAAN MEKANIKAL", shortLabel: "Tahap 4", core: true },
  { code: "TAHAP_V", label: "V - PEKERJAAN ELEKTRIKAL", shortLabel: "Tahap 5", core: true },
  { code: "TAHAP_VI", label: "VI - PEKERJAAN DI LUAR KONSTRUKSI INTI", shortLabel: "Tahap 6", core: false },
  { code: "TAHAP_VII", label: "VII. DUKUNGAN OPERASIONAL GERAI", shortLabel: "Tahap 7", core: false },
];

export const STAGE_CODES = STAGES.map((stage) => stage.code);

export function isOutsideCoreStage(stageCode: StageCode) {
  return stageCode === "TAHAP_VI" || stageCode === "TAHAP_VII" || stageCode === "RESUME_ALL";
}

/** Map data lama yang menyimpan semua pekerjaan non-inti sebagai RESUME_ALL. */
export function normalizeLegacyStageCode(stageCode: StageCode, itemName = "", category = ""): StageCode {
  if (stageCode !== "RESUME_ALL") return stageCode;
  const text = `${itemName} ${category}`.toLowerCase();
  return text.includes("operasional gerai") || text.includes("operasional babinsa") ? "TAHAP_VII" : "TAHAP_VI";
}

export const STAGE_LABELS = Object.fromEntries(STAGES.map((stage) => [stage.code, stage.label])) as Record<StageCode, string>;

export const STAGE_SHORT_LABELS = Object.fromEntries(STAGES.map((stage) => [stage.code, stage.shortLabel])) as Record<StageCode, string>;

export function getStageLabel(stageCode: StageCode) {
  return STAGE_LABELS[stageCode] ?? stageCode;
}

export function getStageShortLabel(stageCode: StageCode) {
  return STAGE_SHORT_LABELS[stageCode] ?? stageCode;
}
