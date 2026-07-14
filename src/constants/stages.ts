import { StageCode } from "@/types/domain";

export const STAGES: Array<{ code: StageCode; label: string; shortLabel: string; core: boolean }> = [
  { code: "TAHAP_I", label: "Tahap I", shortLabel: "Tahap 1", core: true },
  { code: "TAHAP_II", label: "Tahap II", shortLabel: "Tahap 2", core: true },
  { code: "TAHAP_III", label: "Tahap III", shortLabel: "Tahap 3", core: true },
  { code: "TAHAP_IV", label: "Tahap IV", shortLabel: "Tahap 4", core: true },
  { code: "RESUME_ALL", label: "Di luar pekerjaan inti", shortLabel: "Luar Inti", core: false },
];

export const STAGE_LABELS = Object.fromEntries(STAGES.map((stage) => [stage.code, stage.label])) as Record<StageCode, string>;

export const STAGE_SHORT_LABELS = Object.fromEntries(STAGES.map((stage) => [stage.code, stage.shortLabel])) as Record<StageCode, string>;

export function getStageLabel(stageCode: StageCode) {
  return STAGE_LABELS[stageCode] ?? stageCode;
}

export function getStageShortLabel(stageCode: StageCode) {
  return STAGE_SHORT_LABELS[stageCode] ?? stageCode;
}
