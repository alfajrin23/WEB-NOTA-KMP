import XlsxPopulate, { Cell, Range, Sheet } from "xlsx-populate";
import { STAGES } from "@/constants/stages";
import { buildProjectSummary, getResumeItemAmount } from "@/lib/resume-calculations";
import {
  formatProjectKdkmpWilayah,
  formatProjectWilayah,
  parseDateInputToIso,
  stripWilayahPrefix,
  wilayahLabel,
} from "@/utils/format";
import { Project, ResumeItem, Vendor } from "@/types/domain";

const XLSX_CURRENCY_FORMAT = '"Rp" #,##0;[Red]-"Rp" #,##0';
const XLSX_NUMBER_FORMAT = "#,##0.##";
const XLSX_INTEGER_FORMAT = "#,##0";
const XLSX_DATE_FORMAT = "dd/mm/yyyy";

const COLORS = {
  navy: "1E3A8A",
  blue: "2563EB",
  blueSoft: "DBEAFE",
  slate: "475569",
  slateSoft: "E2E8F0",
  slateVerySoft: "F8FAFC",
  white: "FFFFFF",
  greenSoft: "DCFCE7",
  amberSoft: "FEF3C7",
};

const GRID_BORDER = {
  top: { style: "thin", color: "CBD5E1" },
  right: { style: "thin", color: "CBD5E1" },
  bottom: { style: "thin", color: "CBD5E1" },
  left: { style: "thin", color: "CBD5E1" },
};

const TITLE_STYLE = {
  bold: true,
  fontSize: 16,
  fontColor: COLORS.white,
  fill: COLORS.navy,
  horizontalAlignment: "center",
  verticalAlignment: "center",
};

const SUBTITLE_STYLE = {
  bold: true,
  fontSize: 11,
  fontColor: COLORS.navy,
  fill: COLORS.blueSoft,
  horizontalAlignment: "center",
  verticalAlignment: "center",
};

const TABLE_HEADER_STYLE = {
  bold: true,
  fontColor: COLORS.white,
  fill: COLORS.blue,
  horizontalAlignment: "center",
  verticalAlignment: "center",
  wrapText: true,
  border: GRID_BORDER,
};

const METADATA_LABEL_STYLE = {
  bold: true,
  fontColor: COLORS.slate,
  fill: COLORS.slateSoft,
  verticalAlignment: "center",
  border: GRID_BORDER,
};

const METADATA_VALUE_STYLE = {
  verticalAlignment: "center",
  wrapText: true,
  border: GRID_BORDER,
};

const MONEY_STYLE = {
  numberFormat: XLSX_CURRENCY_FORMAT,
  horizontalAlignment: "right",
  verticalAlignment: "center",
};

const STAGE_SHEET_COLUMNS = [
  { header: "No.", width: 8 },
  { header: "Tanggal", width: 14 },
  { header: "Tahap Pekerjaan", width: 18 },
  { header: "Kategori Pekerjaan", width: 38 },
  { header: "Vendor", width: 24 },
  { header: "Nama Barang / Uraian Item", width: 46 },
  { header: "Qty / Volume", width: 15 },
  { header: "Satuan", width: 12 },
  { header: "Harga Satuan", width: 20 },
  { header: "Jumlah", width: 20 },
  { header: "Override Jumlah", width: 20 },
  { header: "Keterangan", width: 30 },
  { header: "Masuk Total", width: 14 },
] as const;

const STAGE_TABLE_HEADER_ROW = 8;
const STAGE_TABLE_FIRST_ROW = STAGE_TABLE_HEADER_ROW + 1;
const STAGE_LAST_COLUMN = STAGE_SHEET_COLUMNS.length;

type WorkbookProjectIdentity = Pick<Project, "projectName" | "wilayahType" | "villageName">;

type VendorSubtotal = {
  key: string;
  vendorName: string;
  itemCount: number;
  total: number;
};

function columnName(column: number) {
  let value = column;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function cellAddress(row: number, column: number) {
  return `${columnName(column)}${row}`;
}

function rangeAddress(row: number, startColumn: number, endColumn: number) {
  return `${cellAddress(row, startColumn)}:${cellAddress(row, endColumn)}`;
}

function mergeRow(sheet: Sheet, row: number, startColumn: number, endColumn: number) {
  const range = sheet.range(rangeAddress(row, startColumn, endColumn));
  range.merged(true);
  return range;
}

function styleGrid(target: Cell | Range) {
  target.style({ border: GRID_BORDER, verticalAlignment: "center" });
  return target;
}

function finiteNumber(value: number, label: string) {
  if (!Number.isFinite(value)) throw new Error(`${label} bukan angka yang valid.`);
  return value;
}

function itemAmount(item: ResumeItem) {
  return finiteNumber(getResumeItemAmount(item), `Jumlah item ${item.itemName || item.id}`);
}

function excelDate(value: string | null | undefined): Date | string {
  const iso = parseDateInputToIso(value);
  if (!iso) return value?.trim() ?? "";
  const [year, month, day] = iso.split("-").map(Number);
  // xlsx-populate mengonversi Date menggunakan zona waktu lokal. Membuat
  // tanggal pada tengah malam lokal mencegah pecahan jam masuk ke serial Excel.
  return new Date(year, month - 1, day);
}

function setDateCell(cell: Cell, value: string | null | undefined) {
  const converted = excelDate(value);
  cell.value(converted);
  if (converted instanceof Date) cell.style("numberFormat", XLSX_DATE_FORMAT);
  return cell;
}

function normalizeVendorKey(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("id-ID");
}

export function resolveResumeVendorName(item: Pick<ResumeItem, "vendorId" | "vendorName">, vendors: Vendor[]) {
  const vendor = item.vendorId ? vendors.find((entry) => entry.id === item.vendorId) : undefined;
  return vendor?.name?.trim() || item.vendorName?.trim() || "Belum ada vendor";
}

function buildVendorSubtotals(items: ResumeItem[], vendors: Vendor[]) {
  const subtotals = new Map<string, VendorSubtotal>();

  for (const item of items) {
    if (item.isIncludedInResumeTotal === false) continue;
    const vendorName = resolveResumeVendorName(item, vendors);
    const key = item.vendorId ? `id:${item.vendorId}` : `name:${normalizeVendorKey(vendorName)}`;
    const current = subtotals.get(key) ?? { key, vendorName, itemCount: 0, total: 0 };
    current.itemCount += 1;
    current.total += itemAmount(item);
    subtotals.set(key, current);
  }

  return [...subtotals.values()];
}

function safeFileSegment(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 80);
}

export function safeResumeExcelFileName(project: WorkbookProjectIdentity) {
  const locationWithoutPrefix = stripWilayahPrefix(project.villageName);
  const segment = safeFileSegment(locationWithoutPrefix)
    || safeFileSegment(project.projectName)
    || "Project";
  return `Resume_KDKMP_${wilayahLabel(project.wilayahType, "long")}_${segment}.xlsx`;
}

function validateWorkbookInput(project: Project) {
  if (!project || !Array.isArray(project.items)) throw new Error("Data project atau resume tidak valid.");

  for (const item of project.items) {
    finiteNumber(item.volume, `Qty/volume item ${item.itemName || item.id}`);
    finiteNumber(item.unitPrice, `Harga satuan item ${item.itemName || item.id}`);
    finiteNumber(item.sortOrder, `Urutan item ${item.itemName || item.id}`);
    if (item.amountOverride != null) finiteNumber(item.amountOverride, `Override item ${item.itemName || item.id}`);
    itemAmount(item);
  }
}

function setSheetColumnWidths(sheet: Sheet, widths: number[]) {
  widths.forEach((width, index) => sheet.column(index + 1).width(width));
}

function writeMetadataPair({
  sheet,
  row,
  leftLabel,
  leftValue,
  rightLabel,
  rightValue,
  leftDate = false,
  rightDate = false,
  lastColumn = 8,
}: {
  sheet: Sheet;
  row: number;
  leftLabel: string;
  leftValue: string;
  rightLabel: string;
  rightValue: string;
  leftDate?: boolean;
  rightDate?: boolean;
  lastColumn?: number;
}) {
  const midpoint = Math.floor(lastColumn / 2);
  const rightLabelColumn = midpoint + 1;
  const rightValueColumn = rightLabelColumn + 1;

  sheet.cell(row, 1).value(leftLabel).style(METADATA_LABEL_STYLE);
  mergeRow(sheet, row, 2, midpoint).style(METADATA_VALUE_STYLE);
  if (leftDate) setDateCell(sheet.cell(row, 2), leftValue);
  else sheet.cell(row, 2).value(leftValue);

  sheet.cell(row, rightLabelColumn).value(rightLabel).style(METADATA_LABEL_STYLE);
  mergeRow(sheet, row, rightValueColumn, lastColumn).style(METADATA_VALUE_STYLE);
  if (rightDate) setDateCell(sheet.cell(row, rightValueColumn), rightValue);
  else sheet.cell(row, rightValueColumn).value(rightValue);
}

function writeSummarySheet(sheet: Sheet, project: Project, vendors: Vendor[]) {
  const summary = buildProjectSummary(project, vendors);
  finiteNumber(summary.grandTotal, "Grand total resume");

  sheet.name("Ringkasan");
  setSheetColumnWidths(sheet, [30, 16, 18, 24, 24, 22, 22, 24]);
  sheet.row(1).height(30);
  mergeRow(sheet, 1, 1, 8).style(TITLE_STYLE);
  sheet.cell(1, 1).value(`RESUME ${formatProjectKdkmpWilayah(project, "long").toUpperCase()}`);
  mergeRow(sheet, 2, 1, 8).style(SUBTITLE_STYLE);
  sheet.cell(2, 1).value(project.projectName || "Resume Project");

  writeMetadataPair({
    sheet,
    row: 4,
    leftLabel: "Nama Project",
    leftValue: project.projectName || "-",
    rightLabel: "Desa / Kelurahan",
    rightValue: formatProjectWilayah(project, "long") || "-",
  });
  writeMetadataPair({
    sheet,
    row: 5,
    leftLabel: "Kecamatan",
    leftValue: project.districtName || "-",
    rightLabel: "Kabupaten",
    rightValue: project.regencyName || "-",
  });
  writeMetadataPair({
    sheet,
    row: 6,
    leftLabel: "Wilayah / Kodim",
    leftValue: project.regionName || "-",
    rightLabel: "Penanggung Jawab",
    rightValue: project.responsibleName || "-",
  });
  writeMetadataPair({
    sheet,
    row: 7,
    leftLabel: "Tanggal Awal Project",
    leftValue: project.projectDate,
    rightLabel: "Tanggal Laporan",
    rightValue: project.reportDate ?? project.projectDate,
    leftDate: true,
    rightDate: true,
  });

  const headerRow = 9;
  ["Tahap Pekerjaan", "Jumlah Item", "Jumlah Vendor", "Subtotal Tahap"].forEach((header, index) => {
    sheet.cell(headerRow, index + 1).value(header);
  });
  sheet.range(`A${headerRow}:D${headerRow}`).style(TABLE_HEADER_STYLE);
  sheet.row(headerRow).height(28);

  summary.stages.forEach((stage, index) => {
    const row = headerRow + index + 1;
    finiteNumber(stage.total, `Subtotal ${stage.label}`);
    sheet.cell(row, 1).value(stage.label);
    sheet.cell(row, 2).value(stage.itemCount).style("numberFormat", XLSX_INTEGER_FORMAT);
    sheet.cell(row, 3).value(stage.vendorCount).style("numberFormat", XLSX_INTEGER_FORMAT);
    sheet.cell(row, 4).value(stage.total).style(MONEY_STYLE);
    styleGrid(sheet.range(`A${row}:D${row}`));
  });

  const grandTotalRow = headerRow + summary.stages.length + 1;
  mergeRow(sheet, grandTotalRow, 1, 3);
  sheet.cell(grandTotalRow, 1).value("GRAND TOTAL RESUME");
  sheet.cell(grandTotalRow, 4).value(summary.grandTotal).style(MONEY_STYLE);
  sheet.range(`A${grandTotalRow}:D${grandTotalRow}`).style({
    bold: true,
    fill: COLORS.greenSoft,
    border: GRID_BORDER,
    verticalAlignment: "center",
  });

  const target = project.targetGrandTotal;
  if (typeof target === "number" && Number.isFinite(target)) {
    const difference = target - summary.grandTotal;
    const targetRow = grandTotalRow + 1;
    const differenceRow = targetRow + 1;
    const statusRow = differenceRow + 1;
    const status = difference > 0
      ? "Resume masih kurang dari target (perlu ditambahkan)."
      : difference < 0
        ? "Resume melebihi target (perlu dikurangi)."
        : "Grand total resume sudah sesuai target.";

    mergeRow(sheet, targetRow, 1, 3);
    sheet.cell(targetRow, 1).value("TARGET GRAND TOTAL");
    sheet.cell(targetRow, 4).value(target).style(MONEY_STYLE);
    sheet.range(`A${targetRow}:D${targetRow}`).style({ bold: true, border: GRID_BORDER });

    mergeRow(sheet, differenceRow, 1, 3);
    sheet.cell(differenceRow, 1).value("SELISIH TARGET (TARGET - GRAND TOTAL)");
    sheet.cell(differenceRow, 4).value(difference).style(MONEY_STYLE);
    sheet.range(`A${differenceRow}:D${differenceRow}`).style({
      bold: true,
      fill: COLORS.amberSoft,
      border: GRID_BORDER,
    });

    sheet.cell(statusRow, 1).value("STATUS SELISIH").style(METADATA_LABEL_STYLE);
    mergeRow(sheet, statusRow, 2, 4).style(METADATA_VALUE_STYLE);
    sheet.cell(statusRow, 2).value(status);
  }

  sheet.freezePanes(`A${headerRow + 1}`);
}

function writeStageMetadata(sheet: Sheet, project: Project) {
  writeMetadataPair({
    sheet,
    row: 3,
    leftLabel: "Nama Project",
    leftValue: project.projectName || "-",
    rightLabel: "Desa / Kelurahan",
    rightValue: formatProjectWilayah(project, "long") || "-",
    lastColumn: STAGE_LAST_COLUMN,
  });
  writeMetadataPair({
    sheet,
    row: 4,
    leftLabel: "Kecamatan",
    leftValue: project.districtName || "-",
    rightLabel: "Kabupaten",
    rightValue: project.regencyName || "-",
    lastColumn: STAGE_LAST_COLUMN,
  });
  writeMetadataPair({
    sheet,
    row: 5,
    leftLabel: "Tanggal Awal Project",
    leftValue: project.projectDate,
    rightLabel: "Tanggal Laporan",
    rightValue: project.reportDate ?? project.projectDate,
    leftDate: true,
    rightDate: true,
    lastColumn: STAGE_LAST_COLUMN,
  });
}

function writeStageItemRow(sheet: Sheet, row: number, item: ResumeItem, index: number, vendors: Vendor[]) {
  const included = item.isIncludedInResumeTotal !== false;
  const amount = itemAmount(item);
  const override = item.amountOverride;
  const values: Array<string | number | null> = [
    item.itemNo?.trim() || index + 1,
    null,
    item.stageName || item.stageCode,
    item.category || item.categoryName || item.categoryCode || "Tanpa kategori",
    resolveResumeVendorName(item, vendors),
    item.itemName,
    item.volume,
    item.unit,
    item.unitPrice,
    amount,
    typeof override === "number" && Number.isFinite(override) ? override : null,
    item.notes ?? "",
    included ? "Ya" : "Tidak",
  ];

  values.forEach((value, columnIndex) => {
    sheet.cell(row, columnIndex + 1).value(value);
  });
  setDateCell(sheet.cell(row, 2), item.expenseDate);
  sheet.cell(row, 7).style("numberFormat", XLSX_NUMBER_FORMAT);
  sheet.cell(row, 9).style(MONEY_STYLE);
  sheet.cell(row, 10).style(MONEY_STYLE);
  sheet.cell(row, 11).style(MONEY_STYLE);
  sheet.cell(row, 1).style("horizontalAlignment", "center");
  sheet.cell(row, 2).style("horizontalAlignment", "center");
  sheet.cell(row, 7).style("horizontalAlignment", "right");
  sheet.cell(row, 8).style("horizontalAlignment", "center");
  sheet.cell(row, 13).style("horizontalAlignment", "center");
  sheet.range(`A${row}:M${row}`).style({
    border: GRID_BORDER,
    verticalAlignment: "center",
    wrapText: true,
  });
}

function writeVendorSubtotalBlock(sheet: Sheet, startRow: number, subtotals: VendorSubtotal[], hasExcludedItems: boolean) {
  if (subtotals.length === 0) return;

  mergeRow(sheet, startRow, 1, 3).style(SUBTITLE_STYLE);
  sheet.cell(startRow, 1).value(hasExcludedItems ? "SUBTOTAL PER VENDOR (ITEM YANG MASUK TOTAL)" : "SUBTOTAL PER VENDOR");
  const headerRow = startRow + 1;
  ["Vendor", "Jumlah Item", "Subtotal"].forEach((header, index) => sheet.cell(headerRow, index + 1).value(header));
  sheet.range(`A${headerRow}:C${headerRow}`).style(TABLE_HEADER_STYLE);

  subtotals.forEach((subtotal, index) => {
    const row = headerRow + index + 1;
    finiteNumber(subtotal.total, `Subtotal vendor ${subtotal.vendorName}`);
    sheet.cell(row, 1).value(subtotal.vendorName);
    sheet.cell(row, 2).value(subtotal.itemCount).style("numberFormat", XLSX_INTEGER_FORMAT);
    sheet.cell(row, 3).value(subtotal.total).style(MONEY_STYLE);
    styleGrid(sheet.range(`A${row}:C${row}`));
  });
}

function writeStageSheet({
  sheet,
  project,
  vendors,
  stageCode,
  stageLabel,
  sheetName,
  stageTotal,
}: {
  sheet: Sheet;
  project: Project;
  vendors: Vendor[];
  stageCode: ResumeItem["stageCode"];
  stageLabel: string;
  sheetName: string;
  stageTotal: number;
}) {
  const items = project.items
    .filter((item) => item.stageCode === stageCode)
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder);
  const vendorSubtotals = buildVendorSubtotals(items, vendors);
  const hasExcludedItems = items.some((item) => item.isIncludedInResumeTotal === false);

  sheet.name(sheetName);
  setSheetColumnWidths(sheet, STAGE_SHEET_COLUMNS.map((column) => column.width));
  sheet.row(1).height(30);
  mergeRow(sheet, 1, 1, STAGE_LAST_COLUMN).style(TITLE_STYLE);
  sheet.cell(1, 1).value(`RESUME ${stageLabel.toUpperCase()} - ${formatProjectWilayah(project, "long").toUpperCase()}`);
  mergeRow(sheet, 2, 1, STAGE_LAST_COLUMN).style(SUBTITLE_STYLE);
  sheet.cell(2, 1).value(project.projectName || "Resume Project");
  writeStageMetadata(sheet, project);

  STAGE_SHEET_COLUMNS.forEach((column, index) => {
    sheet.cell(STAGE_TABLE_HEADER_ROW, index + 1).value(column.header);
  });
  sheet.range(`A${STAGE_TABLE_HEADER_ROW}:M${STAGE_TABLE_HEADER_ROW}`).style(TABLE_HEADER_STYLE);
  sheet.row(STAGE_TABLE_HEADER_ROW).height(32);

  if (items.length === 0) {
    mergeRow(sheet, STAGE_TABLE_FIRST_ROW, 1, STAGE_LAST_COLUMN).style({
      italic: true,
      fontColor: COLORS.slate,
      fill: COLORS.slateVerySoft,
      horizontalAlignment: "center",
      verticalAlignment: "center",
      border: GRID_BORDER,
    });
    sheet.cell(STAGE_TABLE_FIRST_ROW, 1).value("Tidak ada item resume pada tahap ini.");
  } else {
    items.forEach((item, index) => writeStageItemRow(sheet, STAGE_TABLE_FIRST_ROW + index, item, index, vendors));
  }

  const lastItemRow = STAGE_TABLE_FIRST_ROW + Math.max(items.length, 1) - 1;
  const subtotalRow = lastItemRow + 2;
  finiteNumber(stageTotal, `Subtotal ${stageLabel}`);
  mergeRow(sheet, subtotalRow, 1, 9);
  sheet.cell(subtotalRow, 1).value(`SUBTOTAL ${stageLabel.toUpperCase()}`);
  sheet.cell(subtotalRow, 10).value(stageTotal).style(MONEY_STYLE);
  mergeRow(sheet, subtotalRow, 11, STAGE_LAST_COLUMN);
  sheet.range(`A${subtotalRow}:M${subtotalRow}`).style({
    bold: true,
    fill: COLORS.greenSoft,
    border: GRID_BORDER,
    verticalAlignment: "center",
  });

  writeVendorSubtotalBlock(sheet, subtotalRow + 3, vendorSubtotals, hasExcludedItems);
  sheet.freezePanes(`A${STAGE_TABLE_FIRST_ROW}`);
}

export async function buildResumeWorkbook(project: Project, vendors: Vendor[]) {
  validateWorkbookInput(project);
  const summary = buildProjectSummary(project, vendors);
  const workbook = await XlsxPopulate.fromBlankAsync();
  const summarySheet = workbook.sheet(0);
  writeSummarySheet(summarySheet, project, vendors);

  for (const stage of STAGES) {
    const stageSummary = summary.stages.find((entry) => entry.stageCode === stage.code);
    const sheet = workbook.addSheet(stage.shortLabel);
    writeStageSheet({
      sheet,
      project,
      vendors,
      stageCode: stage.code,
      stageLabel: stage.label,
      sheetName: stage.shortLabel,
      stageTotal: stageSummary?.total ?? 0,
    });
  }

  return workbook.outputAsync("nodebuffer");
}
