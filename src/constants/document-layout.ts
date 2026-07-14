/** Physical left inset shared by HTML preview/print and Excel-to-PDF export. */
export const NOTA_LEFT_MARGIN_MM = 5;
export const NOTA_LEFT_MARGIN_INCHES = NOTA_LEFT_MARGIN_MM / 25.4;

const NOTA_LEFT_MARGIN_TEMPLATE_IDS = new Set([
  "template-amanah",
  "template-nota-kosong",
  "template-nota-internal-non-vendor",
  "template-tb-mandau",
  "template-murah-maju",
  "template-jasa-electric",
]);

export function notaLeftPosition(originalMillimeters: number) {
  return `${originalMillimeters + NOTA_LEFT_MARGIN_MM}mm`;
}

export function usesNotaLeftMargin(templateId: string) {
  return NOTA_LEFT_MARGIN_TEMPLATE_IDS.has(templateId);
}

/** Penyesuaian khusus layout CBS, dipakai sama oleh renderer HTML dan export Excel. */
export const CBS_DOCUMENT_LAYOUT = {
  pageWidthMm: 210,
  pageHeightMm: 297,
  sourceNoteWidthMm: 297,
  sourceNoteHeightMm: 210,
  notesPerPage: 2,
  htmlContentScale: 0.63,
  verticalInsetMm: 6,
  verticalGapMm: 6,
  exportScaleFactor: 0.9,
  exportScaleFallback: 62,
} as const;
