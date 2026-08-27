import { StageCode, TemplateAssignment, TemplateDefinition } from "@/types/domain";

export const TEMPLATE_ROOT_DEFAULT =
  "G:\\My Drive\\1. DRAFT KDKMP CIANJUR\\VERSI BARU\\NOTA\\CIANJUR\\DESA MEKARSARI KEC CIANJUR";

export const STAGE_TEMPLATE_FOLDERS: Partial<Record<StageCode, string>> = {
  TAHAP_I: "TAHAP 1",
  TAHAP_II: "TAHAP 2",
  TAHAP_III: "TAHAP 3",
  TAHAP_IV: "TAHAP 4",
  TAHAP_V: "TAHAP 5",
  TAHAP_VI: "TAHAP 6",
  TAHAP_VII: "TAHAP 7",
  RESUME_ALL: "TAHAP 6",
};

export const TEMPLATE_DEFINITIONS: TemplateDefinition[] = [
  {
    id: "kwitansi-tahap-1",
    label: "KWITANSI TAHAP 1",
    documentType: "kwitansi",
    stageCodes: ["TAHAP_I"],
    vendorIds: ["vendor-kwitansi", "vendor-ppm"],
    aliases: ["KWITANSI TAHAP 1"],
  },
  {
    id: "kwitansi-tahap-2",
    label: "KWITANSI TAHAP 2",
    documentType: "kwitansi",
    stageCodes: ["TAHAP_II"],
    vendorIds: ["vendor-kwitansi", "vendor-ppm"],
    aliases: ["KWITANSI TAHAP 2"],
  },
  {
    id: "kwitansi-tahap-3",
    label: "KWITANSI TAHAP 3",
    documentType: "kwitansi",
    stageCodes: ["TAHAP_III"],
    vendorIds: ["vendor-kwitansi", "vendor-ppm"],
    aliases: ["KWITANSI TAHAP 3"],
  },
  {
    id: "kwitansi-tahap-4",
    label: "KWITANSI TAHAP 4",
    documentType: "kwitansi",
    stageCodes: ["TAHAP_IV"],
    vendorIds: ["vendor-kwitansi", "vendor-ppm"],
    aliases: ["KWITANSI TAHAP 4"],
  },
  {
    id: "kwitansi-tahap-5",
    label: "KWITANSI TAHAP 5",
    documentType: "kwitansi",
    stageCodes: ["TAHAP_V"],
    vendorIds: ["vendor-kwitansi", "vendor-ppm"],
    aliases: ["KWITANSI TAHAP 5"],
  },
  {
    id: "kwitansi-tahap-6",
    label: "KWITANSI TAHAP 6",
    documentType: "kwitansi",
    stageCodes: ["TAHAP_VI"],
    vendorIds: ["vendor-kwitansi", "vendor-ppm"],
    aliases: ["KWITANSI TAHAP 6"],
  },
  {
    id: "kwitansi-tahap-7",
    label: "KWITANSI TAHAP 7",
    documentType: "kwitansi",
    stageCodes: ["TAHAP_VII"],
    vendorIds: ["vendor-kwitansi", "vendor-ppm"],
    aliases: ["KWITANSI TAHAP 7"],
  },
  {
    id: "kwitansi-luar-inti",
    label: "KWITANSI DI LUAR PEKERJAAN INTI",
    documentType: "kwitansi",
    stageCodes: ["RESUME_ALL"],
    vendorIds: ["vendor-kwitansi"],
    aliases: ["KWITANSI DILUAR PEKERJAAN INTI", "KWITANSI DI LUAR PEKERJAAN INTI"],
  },
  {
    id: "template-amanah",
    label: "Template Amanah",
    documentType: "nota",
    stageCodes: ["TAHAP_I", "TAHAP_II", "TAHAP_III"],
    vendorIds: ["vendor-amanah"],
    canonicalFileName: "Template Amanah.xlsx",
    aliases: ["Template Amanah.xlsx", "Template Amanah 2.xlsx", "Template Amanah 3.xlsx"],
  },
  {
    id: "template-invoice-cbb",
    label: "Template Invoice CBB",
    documentType: "nota",
    stageCodes: ["TAHAP_I", "TAHAP_II", "TAHAP_III"],
    vendorIds: ["vendor-cbb"],
    canonicalFileName: "Template Invoice CBB.xlsx",
    aliases: ["Template Invoice CBB.xlsx", "Template Invoice CBB 2.xlsx", "Template Invoice CBB 3.xlsx"],
  },
  {
    id: "template-murah-maju",
    label: "Template Murah Maju",
    documentType: "nota",
    stageCodes: ["TAHAP_I", "TAHAP_II", "TAHAP_III", "TAHAP_IV", "TAHAP_V", "TAHAP_VI", "TAHAP_VII"],
    vendorIds: ["vendor-murah-maju"],
    canonicalFileName: "Template Murah Maju.xlsx",
    aliases: ["Template Murah Maju.xlsx"],
  },
  {
    id: "template-nota-kosong",
    label: "Template Nota Kosong",
    documentType: "nota",
    stageCodes: ["TAHAP_I", "TAHAP_II", "TAHAP_III", "TAHAP_IV", "TAHAP_V", "TAHAP_VI", "TAHAP_VII"],
    canonicalFileName: "Template Nota Kosong.xlsx",
    aliases: ["Template Nota Kosong.xlsx"],
    fallback: true,
  },
  {
    id: "template-nota-internal-non-vendor",
    label: "Nota Kosong Internal / Non Vendor",
    documentType: "nota",
    stageCodes: ["TAHAP_I", "TAHAP_II", "TAHAP_III", "TAHAP_IV", "TAHAP_V", "TAHAP_VI", "TAHAP_VII", "RESUME_ALL"],
    vendorIds: ["vendor-internal"],
    canonicalFileName: "Template Nota Kosong.xlsx",
    aliases: ["Template Nota Kosong.xlsx", "Nota Kosong Internal / Non Vendor"],
  },
  {
    id: "template-tb-mandau",
    label: "Template TB Mandau",
    documentType: "nota",
    stageCodes: ["TAHAP_I", "TAHAP_II", "TAHAP_III"],
    vendorIds: ["vendor-mandau"],
    canonicalFileName: "Template TB Mandau.xlsx",
    aliases: ["Template TB Mandau.xlsx", "Template TB Mandau 3.xlsx"],
  },
  {
    id: "template-cbs",
    label: "Template CBS",
    documentType: "nota",
    stageCodes: ["TAHAP_II", "TAHAP_III"],
    vendorIds: ["vendor-cbs"],
    canonicalFileName: "Template CBS.xlsx",
    aliases: ["Tamplet CBS.xlsx", "Template CBS.xlsx"],
  },
  {
    id: "template-hpm",
    label: "Template HPM",
    documentType: "nota",
    stageCodes: ["TAHAP_II", "TAHAP_III"],
    vendorIds: ["vendor-hpm"],
    canonicalFileName: "Template HPM.xlsx",
    aliases: ["Tamplet HPM.xlsx", "Template HPM.xlsx"],
  },
  {
    id: "template-cahaya-timur-keramik",
    label: "CAHAYA TIMUR KERAMIK",
    documentType: "nota",
    stageCodes: ["TAHAP_III", "TAHAP_IV"],
    vendorIds: ["vendor-cahaya-timur"],
    canonicalFileName: "CAHAYA TIMUR KERAMIK.xlsx",
    aliases: ["CAHAYA TIMUR KERAMIK.xlsx"],
  },
  {
    id: "template-pln",
    label: "Nota PLN",
    // PLN tetap dicetak sebagai kwitansi pembayaran khusus, tetapi secara alur
    // dokumen ini merupakan keluaran Generate Nota Tahap IV.
    documentType: "nota",
    stageCodes: ["TAHAP_V", "TAHAP_VI", "TAHAP_VII", "RESUME_ALL"],
    vendorIds: ["vendor-pln"],
    canonicalFileName: "Template PLN.xlsx",
    aliases: ["Tamplate PLN.xlsx", "Template PLN.xlsx"],
  },
  {
    id: "template-jasa-electric",
    label: "Template Jasa Electric",
    documentType: "nota",
    stageCodes: ["TAHAP_V"],
    vendorIds: ["vendor-jasa-elektrik"],
    canonicalFileName: "Template Jasa Electric.xlsx",
    aliases: ["Template Jasa Electric.xlsx"],
  },
];

const assignment = (
  stageCode: StageCode,
  vendorId: string,
  templateId: string,
  preferredFileName: string | undefined,
  aliases: string[],
  fallback = false,
): TemplateAssignment => {
  const definition = TEMPLATE_DEFINITIONS.find((entry) => entry.id === templateId);
  return {
    id: `${stageCode}-${vendorId}-${templateId}`,
    stageCode,
    vendorId,
    templateId,
    documentType: definition?.documentType ?? "nota",
    preferredFileName,
    aliases,
    fallback,
  };
};

export const DEFAULT_TEMPLATE_ASSIGNMENTS: TemplateAssignment[] = [
  assignment("TAHAP_I", "vendor-kwitansi", "kwitansi-tahap-1", undefined, ["KWITANSI TAHAP 1"]),
  assignment("TAHAP_II", "vendor-kwitansi", "kwitansi-tahap-2", undefined, ["KWITANSI TAHAP 2"]),
  assignment("TAHAP_III", "vendor-kwitansi", "kwitansi-tahap-3", undefined, ["KWITANSI TAHAP 3"]),
  assignment("TAHAP_IV", "vendor-kwitansi", "kwitansi-tahap-4", undefined, ["KWITANSI TAHAP 4"]),
  assignment("TAHAP_V", "vendor-kwitansi", "kwitansi-tahap-5", undefined, ["KWITANSI TAHAP 5"]),
  assignment("TAHAP_VI", "vendor-kwitansi", "kwitansi-tahap-6", undefined, ["KWITANSI TAHAP 6"]),
  assignment("TAHAP_VII", "vendor-kwitansi", "kwitansi-tahap-7", undefined, ["KWITANSI TAHAP 7"]),
  assignment("RESUME_ALL", "vendor-kwitansi", "kwitansi-luar-inti", undefined, ["KWITANSI DI LUAR PEKERJAAN INTI", "KWITANSI DILUAR PEKERJAAN INTI"]),

  assignment("TAHAP_I", "vendor-internal", "template-nota-internal-non-vendor", "Template Nota Kosong.xlsx", ["Template Nota Kosong.xlsx", "Nota Kosong Internal / Non Vendor"]),
  assignment("TAHAP_II", "vendor-internal", "template-nota-internal-non-vendor", "Template Nota Kosong.xlsx", ["Template Nota Kosong.xlsx", "Nota Kosong Internal / Non Vendor"]),
  assignment("TAHAP_III", "vendor-internal", "template-nota-internal-non-vendor", "Template Nota Kosong.xlsx", ["Template Nota Kosong.xlsx", "Nota Kosong Internal / Non Vendor"]),
  assignment("TAHAP_IV", "vendor-internal", "template-nota-internal-non-vendor", "Template Nota Kosong.xlsx", ["Template Nota Kosong.xlsx", "Nota Kosong Internal / Non Vendor"]),
  assignment("TAHAP_V", "vendor-internal", "template-nota-internal-non-vendor", "Template Nota Kosong.xlsx", ["Template Nota Kosong.xlsx", "Nota Kosong Internal / Non Vendor"]),
  assignment("TAHAP_VI", "vendor-internal", "template-nota-internal-non-vendor", "Template Nota Kosong.xlsx", ["Template Nota Kosong.xlsx", "Nota Kosong Internal / Non Vendor"]),
  assignment("TAHAP_VII", "vendor-internal", "template-nota-internal-non-vendor", "Template Nota Kosong.xlsx", ["Template Nota Kosong.xlsx", "Nota Kosong Internal / Non Vendor"]),
  assignment("RESUME_ALL", "vendor-internal", "template-nota-internal-non-vendor", "Template Nota Kosong.xlsx", ["Template Nota Kosong.xlsx", "Nota Kosong Internal / Non Vendor"]),

  assignment("TAHAP_I", "vendor-ppm", "kwitansi-tahap-1", undefined, ["KWITANSI TAHAP 1"]),
  assignment("TAHAP_II", "vendor-ppm", "kwitansi-tahap-2", undefined, ["KWITANSI TAHAP 2"]),
  assignment("TAHAP_III", "vendor-ppm", "kwitansi-tahap-3", undefined, ["KWITANSI TAHAP 3"]),
  assignment("TAHAP_IV", "vendor-ppm", "kwitansi-tahap-4", undefined, ["KWITANSI TAHAP 4"]),
  assignment("TAHAP_V", "vendor-ppm", "kwitansi-tahap-5", undefined, ["KWITANSI TAHAP 5"]),
  assignment("TAHAP_VI", "vendor-ppm", "kwitansi-tahap-6", undefined, ["KWITANSI TAHAP 6"]),
  assignment("TAHAP_VII", "vendor-ppm", "kwitansi-tahap-7", undefined, ["KWITANSI TAHAP 7"]),

  assignment("TAHAP_I", "vendor-amanah", "template-amanah", "Template Amanah.xlsx", ["Template Amanah.xlsx"]),
  assignment("TAHAP_II", "vendor-amanah", "template-amanah", "Template Amanah 2.xlsx", ["Template Amanah 2.xlsx", "Template Amanah.xlsx"]),
  assignment("TAHAP_III", "vendor-amanah", "template-amanah", "Template Amanah 3.xlsx", ["Template Amanah 3.xlsx", "Template Amanah.xlsx"]),

  assignment("TAHAP_I", "vendor-cbb", "template-invoice-cbb", "Template Invoice CBB.xlsx", ["Template Invoice CBB.xlsx"]),
  assignment("TAHAP_II", "vendor-cbb", "template-invoice-cbb", "Template Invoice CBB 2.xlsx", ["Template Invoice CBB 2.xlsx", "Template Invoice CBB.xlsx"]),
  assignment("TAHAP_III", "vendor-cbb", "template-invoice-cbb", "Template Invoice CBB 3.xlsx", ["Template Invoice CBB 3.xlsx", "Template Invoice CBB.xlsx"]),

  assignment("TAHAP_I", "vendor-murah-maju", "template-murah-maju", "Template Murah Maju.xlsx", ["Template Murah Maju.xlsx"]),
  assignment("TAHAP_II", "vendor-murah-maju", "template-murah-maju", "Template Murah Maju.xlsx", ["Template Murah Maju.xlsx"]),
  assignment("TAHAP_III", "vendor-murah-maju", "template-murah-maju", "Template Murah Maju.xlsx", ["Template Murah Maju.xlsx"]),
  assignment("TAHAP_IV", "vendor-murah-maju", "template-murah-maju", "Template Murah Maju.xlsx", ["Template Murah Maju.xlsx"]),
  assignment("TAHAP_V", "vendor-murah-maju", "template-murah-maju", "Template Murah Maju.xlsx", ["Template Murah Maju.xlsx"]),

  assignment("TAHAP_I", "vendor-mandau", "template-tb-mandau", "Template TB Mandau.xlsx", ["Template TB Mandau.xlsx"]),
  assignment("TAHAP_II", "vendor-mandau", "template-tb-mandau", "Template TB Mandau.xlsx", ["Template TB Mandau.xlsx"]),
  assignment("TAHAP_III", "vendor-mandau", "template-tb-mandau", "Template TB Mandau 3.xlsx", ["Template TB Mandau 3.xlsx", "Template TB Mandau.xlsx"]),

  assignment("TAHAP_II", "vendor-cbs", "template-cbs", "Tamplet CBS.xlsx", ["Tamplet CBS.xlsx", "Template CBS.xlsx"]),
  assignment("TAHAP_III", "vendor-cbs", "template-cbs", "Tamplet CBS.xlsx", ["Tamplet CBS.xlsx", "Template CBS.xlsx"]),

  assignment("TAHAP_II", "vendor-hpm", "template-hpm", "Tamplet HPM.xlsx", ["Tamplet HPM.xlsx", "Template HPM.xlsx"]),
  assignment("TAHAP_III", "vendor-hpm", "template-hpm", "Tamplet HPM.xlsx", ["Tamplet HPM.xlsx", "Template HPM.xlsx"]),

  assignment("TAHAP_III", "vendor-cahaya-timur", "template-cahaya-timur-keramik", "CAHAYA TIMUR KERAMIK.xlsx", ["CAHAYA TIMUR KERAMIK.xlsx"]),
  assignment("TAHAP_IV", "vendor-cahaya-timur", "template-cahaya-timur-keramik", "CAHAYA TIMUR KERAMIK.xlsx", ["CAHAYA TIMUR KERAMIK.xlsx"]),

  assignment("TAHAP_V", "vendor-pln", "template-pln", "Tamplate PLN.xlsx", ["Tamplate PLN.xlsx", "Template PLN.xlsx"]),
  assignment("TAHAP_VI", "vendor-pln", "template-pln", "Tamplate PLN.xlsx", ["Tamplate PLN.xlsx", "Template PLN.xlsx"]),
  assignment("TAHAP_VII", "vendor-pln", "template-pln", "Tamplate PLN.xlsx", ["Tamplate PLN.xlsx", "Template PLN.xlsx"]),
  assignment("RESUME_ALL", "vendor-pln", "template-pln", "Tamplate PLN.xlsx", ["Tamplate PLN.xlsx", "Template PLN.xlsx"]),
  assignment("TAHAP_V", "vendor-jasa-elektrik", "template-jasa-electric", "Template Jasa Electric.xlsx", ["Template Jasa Electric.xlsx"]),
];

export const DEFAULT_FALLBACK_TEMPLATE_ASSIGNMENTS: TemplateAssignment[] = [
  assignment("TAHAP_I", "__fallback__", "template-nota-kosong", "Template Nota Kosong.xlsx", ["Template Nota Kosong.xlsx"], true),
  assignment("TAHAP_II", "__fallback__", "template-nota-kosong", "Template Nota Kosong.xlsx", ["Template Nota Kosong.xlsx"], true),
  assignment("TAHAP_III", "__fallback__", "template-nota-kosong", "Template Nota Kosong.xlsx", ["Template Nota Kosong.xlsx"], true),
  assignment("TAHAP_IV", "__fallback__", "template-nota-kosong", "Template Nota Kosong.xlsx", ["Template Nota Kosong.xlsx"], true),
  assignment("TAHAP_V", "__fallback__", "template-nota-kosong", "Template Nota Kosong.xlsx", ["Template Nota Kosong.xlsx"], true),
  assignment("TAHAP_VI", "__fallback__", "template-nota-kosong", "Template Nota Kosong.xlsx", ["Template Nota Kosong.xlsx"], true),
  assignment("TAHAP_VII", "__fallback__", "template-nota-kosong", "Template Nota Kosong.xlsx", ["Template Nota Kosong.xlsx"], true),
  assignment("RESUME_ALL", "__fallback__", "template-nota-kosong", "Template Nota Kosong.xlsx", ["Template Nota Kosong.xlsx"], true),
];

export const ALL_TEMPLATE_ASSIGNMENTS = [
  ...DEFAULT_TEMPLATE_ASSIGNMENTS,
  ...DEFAULT_FALLBACK_TEMPLATE_ASSIGNMENTS,
];

export function findTemplateDefinition(templateId: string) {
  return TEMPLATE_DEFINITIONS.find((template) => template.id === templateId);
}

export function resolveTemplateAssignment(
  stageCode: StageCode,
  vendorId: string | undefined,
  assignments: TemplateAssignment[] = ALL_TEMPLATE_ASSIGNMENTS,
) {
  if (!vendorId) return assignments.find((entry) => entry.stageCode === stageCode && entry.fallback);
  return (
    assignments.find((entry) => entry.stageCode === stageCode && entry.vendorId === vendorId) ??
    assignments.find((entry) => entry.stageCode === stageCode && entry.fallback)
  );
}

export function resolveExplicitTemplateAssignment(
  stageCode: StageCode,
  vendorId: string | undefined,
  assignments: TemplateAssignment[] = ALL_TEMPLATE_ASSIGNMENTS,
) {
  if (!vendorId) return undefined;
  return assignments.find((entry) => entry.stageCode === stageCode && entry.vendorId === vendorId && !entry.fallback);
}
