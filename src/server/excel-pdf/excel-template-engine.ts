import { existsSync } from "node:fs";
import XlsxPopulate from "xlsx-populate";
import { CBS_DOCUMENT_LAYOUT, NOTA_LEFT_MARGIN_INCHES, usesNotaLeftMargin } from "@/constants/document-layout";
import { getResumeItemAmount } from "@/lib/resume-calculations";
import { terbilangRupiah } from "@/utils/format";
import { ExcelTemplateRequest, RenderedExcelPdf } from "./types";
import { resolveExcelTemplate } from "./template-registry";
import { exportWorkbookBufferToPdf } from "./office-pdf-exporter";
import { imposeCbsPdf } from "./cbs-pdf-imposer";
import { imposeCahayaTimurPdf } from "./ctk-pdf-imposer";

type Sheet = ReturnType<Awaited<ReturnType<typeof XlsxPopulate.fromFileAsync>>["sheet"]>;
type SheetWithPageMargins = Sheet & {
  pageMargins(attributeName: "left", value: number): Sheet;
};
type SheetWithPrintLayout = Sheet & {
  definedName(name: string, refersTo: unknown): Sheet;
  range(address: string): unknown;
  row(rowNumber: number): { addPageBreak(): unknown };
  horizontalPageBreaks(): {
    count: number;
    remove(index: number): unknown;
  };
};
type WritableCellValue = string | number | boolean | Date | undefined | null | object;

type CellAddress = {
  row: number;
  column: number;
};

type ItemTable = {
  kind: "header" | "invoice";
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
  numberColumn?: number;
  volumeColumn: number;
  nameColumn: number;
  unitColumn?: number;
  priceColumn: number;
  amountColumn: number;
};

type TableAllocation = {
  table: ItemTable;
  total: number;
  itemCount: number;
};

type CbsItemGroup = {
  key: string;
  date: string;
  items: ExcelTemplateRequest["items"];
};

type WorkbookXmlNode = {
  name: string;
  attributes: Record<string, string | number>;
  children?: WorkbookXmlNode[];
};

const CBS_ROWS_PER_NOTE = 14;

function normalize(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isBlank(value: unknown) {
  return value === undefined || value === null || String(value).trim() === "";
}

function formatSafeFileName(value: string) {
  return value.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function excelDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? new Date() : date;
}

function usedBounds(sheet: Sheet) {
  const used = sheet.usedRange();
  if (!used) {
    return { startRow: 1, endRow: 1, startColumn: 1, endColumn: 1 };
  }

  return {
    startRow: used.startCell().rowNumber(),
    endRow: used.endCell().rowNumber(),
    startColumn: used.startCell().columnNumber(),
    endColumn: used.endCell().columnNumber(),
  };
}

function findCells(sheet: Sheet, predicate: (text: string) => boolean) {
  const bounds = usedBounds(sheet);
  const matches: CellAddress[] = [];

  for (let row = bounds.startRow; row <= bounds.endRow; row += 1) {
    for (let column = bounds.startColumn; column <= bounds.endColumn; column += 1) {
      const text = normalize(sheet.cell(row, column).value());
      if (predicate(text)) matches.push({ row, column });
    }
  }

  return matches;
}

function setCellIfTextIncludes(sheet: Sheet, needle: string, value: WritableCellValue) {
  const cell = findCells(sheet, (text) => text.includes(needle))[0];
  if (cell) sheet.cell(cell.row, cell.column).value(value);
}

function replaceMatchingText(sheet: Sheet, replacers: Array<[RegExp, string]>) {
  const bounds = usedBounds(sheet);

  for (let row = bounds.startRow; row <= bounds.endRow; row += 1) {
    for (let column = bounds.startColumn; column <= bounds.endColumn; column += 1) {
      const cell = sheet.cell(row, column);
      const value = cell.value();
      if (typeof value !== "string") continue;

      let nextValue = value;
      for (const [pattern, replacement] of replacers) {
        nextValue = nextValue.replace(pattern, replacement);
      }

      if (nextValue !== value) cell.value(nextValue);
    }
  }
}

function findColumnsInRow(sheet: Sheet, row: number, aliases: string[]) {
  const bounds = usedBounds(sheet);
  const columns: number[] = [];
  for (let column = bounds.startColumn; column <= bounds.endColumn; column += 1) {
    const text = normalize(sheet.cell(row, column).value());
    if (aliases.some((alias) => text.includes(alias))) columns.push(column);
  }
  return columns;
}

function findNearestHeaderColumn(
  sheet: Sheet,
  row: number,
  aliases: string[],
  minColumn: number,
  maxColumn: number,
) {
  for (let column = minColumn; column <= maxColumn; column += 1) {
    const text = normalize(sheet.cell(row, column).value());
    if (aliases.some((alias) => text.includes(alias))) return column;
  }
  return undefined;
}

function findHeaderColumnInRange(sheet: Sheet, row: number, aliases: string[], minColumn: number, maxColumn: number) {
  for (let column = minColumn; column <= maxColumn; column += 1) {
    const text = normalize(sheet.cell(row, column).value());
    if (aliases.some((alias) => text === alias || text.includes(alias))) return column;
  }
  return undefined;
}

function columnNumberFromLetters(letters: string) {
  return letters.split("").reduce((result, letter) => result * 26 + letter.charCodeAt(0) - 64, 0);
}

function mergedHeaderEndColumn(sheet: Sheet, row: number, column: number) {
  const mergeCells = (sheet as unknown as { _mergeCells?: Record<string, unknown> })._mergeCells;
  if (!mergeCells) return column;

  for (const reference of Object.keys(mergeCells)) {
    const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(reference.toUpperCase());
    if (!match) continue;

    const startColumn = columnNumberFromLetters(match[1]);
    const startRow = Number(match[2]);
    const endColumn = columnNumberFromLetters(match[3]);
    const endRow = Number(match[4]);
    if (row >= startRow && row <= endRow && column >= startColumn && column <= endColumn) {
      return endColumn;
    }
  }

  return column;
}

function findHeaderTables(sheet: Sheet): ItemTable[] {
  const bounds = usedBounds(sheet);
  const tables: ItemTable[] = [];

  for (let row = bounds.startRow; row <= bounds.endRow; row += 1) {
    const nameColumns = findColumnsInRow(sheet, row, ["nama barang", "uraian", "description"]);

    for (const nameColumn of nameColumns) {
      const nextNameColumn = nameColumns.find((column) => column > nameColumn);
      const groupEndColumn = (nextNameColumn ?? bounds.endColumn + 1) - 1;
      const groupStartColumn = Math.max(bounds.startColumn, nameColumn - 3);
      const priceColumn = findNearestHeaderColumn(sheet, row, ["harga satuan", "harga"], nameColumn + 1, groupEndColumn);
      const amountHeaderColumn = findNearestHeaderColumn(sheet, row, ["jumlah", "total"], (priceColumn ?? nameColumn) + 1, groupEndColumn);
      const amountColumn = amountHeaderColumn
        ? mergedHeaderEndColumn(sheet, row, amountHeaderColumn)
        : undefined;
      const volumeColumn =
        findHeaderColumnInRange(sheet, row, ["banyaknya", "qty", "volume"], groupStartColumn, nameColumn) ??
        findHeaderColumnInRange(sheet, row, ["banyaknya", "qty", "volume"], nameColumn + 1, (priceColumn ?? groupEndColumn) - 1);
      const unitColumn =
        findHeaderColumnInRange(sheet, row, ["satuan", "unit"], groupStartColumn, groupEndColumn) ??
        (volumeColumn && volumeColumn < nameColumn && nameColumn - volumeColumn > 1 ? nameColumn - 1 : undefined);

      if (!volumeColumn || !priceColumn || !amountColumn) continue;

      const startRow = row + 1;
      let endRow = startRow - 1;
      for (let candidate = startRow; candidate <= bounds.endRow; candidate += 1) {
        const groupText = Array.from({ length: groupEndColumn - volumeColumn + 1 }, (_, index) =>
          normalize(sheet.cell(candidate, volumeColumn + index).value()),
        ).join(" ");
        const hasItemShape = !isBlank(sheet.cell(candidate, nameColumn).value()) || !isBlank(sheet.cell(candidate, volumeColumn).value());

        if (/jumlah|total|terbilang|tanda terima|hormat kami/.test(groupText)) break;
        if (!hasItemShape && candidate > startRow + 1) break;
        endRow = candidate;
      }

      if (endRow >= startRow) {
        tables.push({
          kind: "header",
          startRow,
          endRow,
          startColumn: volumeColumn,
          endColumn: groupEndColumn,
          volumeColumn,
          nameColumn,
          priceColumn,
          amountColumn,
          unitColumn,
        });
      }
    }
  }

  return tables;
}

function isSequentialInvoiceRow(sheet: Sheet, row: number, expectedNumber: number) {
  return (
    sheet.cell(row, 1).value() === expectedNumber &&
    typeof sheet.cell(row, 2).value() === "string" &&
    typeof sheet.cell(row, 3).value() === "number" &&
    typeof sheet.cell(row, 4).value() === "number" &&
    typeof sheet.cell(row, 5).value() === "number"
  );
}

function findExistingItemTables(sheet: Sheet): ItemTable[] {
  const bounds = usedBounds(sheet);
  const tables: ItemTable[] = [];
  let row = bounds.startRow;

  while (row <= bounds.endRow) {
    if (!isSequentialInvoiceRow(sheet, row, 1)) {
      row += 1;
      continue;
    }

    const startRow = row;
    let expectedNumber = 1;
    while (row <= bounds.endRow) {
      if (!isSequentialInvoiceRow(sheet, row, expectedNumber)) break;
      expectedNumber += 1;
      row += 1;
    }

    tables.push({
      kind: "invoice",
      startRow,
      endRow: row - 1,
      startColumn: 1,
      endColumn: 5,
      numberColumn: 1,
      volumeColumn: 3,
      nameColumn: 2,
      priceColumn: 4,
      amountColumn: 5,
    });
  }

  return tables;
}

function findCbsItemTables(sheet: Sheet): ItemTable[] {
  const bounds = usedBounds(sheet);

  return findCells(sheet, (text) => text === "item description")
    .map((header): ItemTable | null => {
      const volumeColumn = findHeaderColumnInRange(sheet, header.row, ["qty"], bounds.startColumn, bounds.endColumn);
      const priceColumn = findHeaderColumnInRange(sheet, header.row, ["unit price"], bounds.startColumn, bounds.endColumn);
      const amountColumn = findHeaderColumnInRange(sheet, header.row, ["amount"], bounds.startColumn, bounds.endColumn);
      const sayAnchor = findCellsInRange(sheet, (text) => /^say\s*:?$/.test(text), {
        startRow: header.row + 1,
        endRow: Math.min(bounds.endRow, header.row + CBS_ROWS_PER_NOTE + 2),
        startColumn: bounds.startColumn,
        endColumn: bounds.endColumn,
      })[0];

      if (!volumeColumn || !priceColumn || !amountColumn || !sayAnchor) return null;

      return {
        kind: "header",
        startRow: header.row + 1,
        endRow: sayAnchor.row - 1,
        startColumn: Math.max(bounds.startColumn, header.column - 1),
        endColumn: bounds.endColumn,
        volumeColumn,
        nameColumn: header.column,
        priceColumn,
        amountColumn,
      };
    })
    .filter((table): table is ItemTable => table !== null)
    .sort((a, b) => a.startRow - b.startRow);
}

function groupCbsItems(items: ExcelTemplateRequest["items"], maxRows: number): CbsItemGroup[] {
  const grouped = new Map<string, CbsItemGroup>();

  for (const item of [...items].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const key = `${item.expenseDate}-${item.category}`;
    const existing = grouped.get(key);
    if (existing) existing.items.push(item);
    else grouped.set(key, { key, date: item.expenseDate, items: [item] });
  }

  const splitGroups: CbsItemGroup[] = [];
  for (const group of grouped.values()) {
    for (let index = 0; index < group.items.length; index += maxRows) {
      splitGroups.push({
        key: `${group.key}-${Math.floor(index / maxRows) + 1}`,
        date: group.date,
        items: group.items.slice(index, index + maxRows),
      });
    }
  }

  return splitGroups.sort((a, b) => (a.items[0]?.sortOrder ?? 0) - (b.items[0]?.sortOrder ?? 0));
}

function writeCbsFormDate(sheet: Sheet, table: ItemTable, value: string) {
  const date = excelDate(value);
  const bounds = usedBounds(sheet);
  const anchors = findCellsInRange(sheet, (text) => text === "invoice date" || text === "ship date", {
    startRow: Math.max(bounds.startRow, table.startRow - 15),
    endRow: table.startRow - 1,
    startColumn: table.startColumn,
    endColumn: table.endColumn,
  });

  for (const anchor of anchors) sheet.cell(anchor.row + 1, anchor.column).value(date);
}

function writeCbsTotals(sheet: Sheet, allocation: TableAllocation) {
  const value = allocation.itemCount > 0 ? allocation.total : undefined;
  const anchors = findCellsInRange(sheet, (text) => text === "sub total" || text === "subtotal" || text === "total invoice", {
    startRow: allocation.table.endRow + 1,
    endRow: allocation.table.endRow + 8,
    startColumn: allocation.table.startColumn,
    endColumn: allocation.table.endColumn,
  });

  for (const anchor of anchors) {
    sheet.cell(anchor.row, Math.min(anchor.column + 1, allocation.table.endColumn)).value(value);
  }
}

function writeCbsItems(sheet: Sheet, request: ExcelTemplateRequest): TableAllocation[] {
  const tables = findCbsItemTables(sheet);
  if (tables.length === 0) return [];

  const capacity = Math.min(...tables.map((table) => table.endRow - table.startRow + 1));
  const groups = groupCbsItems(request.items, capacity);
  if (groups.length > tables.length) {
    throw new Error(`Template CBS hanya menyediakan ${tables.length} nota, tetapi data membutuhkan ${groups.length} nota.`);
  }

  return tables.map((table, tableIndex) => {
    const group = groups[tableIndex];
    let total = 0;

    for (let row = table.startRow; row <= table.endRow; row += 1) {
      const item = group?.items[row - table.startRow];
      const volumeCell = sheet.cell(row, table.volumeColumn);
      const nameCell = sheet.cell(row, table.nameColumn);
      const priceCell = sheet.cell(row, table.priceColumn);
      const amountCell = sheet.cell(row, table.amountColumn);

      if (!item) {
        volumeCell.value(undefined);
        nameCell.value(undefined);
        priceCell.value(undefined);
        amountCell.value(undefined);
        continue;
      }

      volumeCell.value(item.volume);
      nameCell.value(item.itemName);
      priceCell.value(item.unitPrice);
      const amount = getResumeItemAmount(item);
      amountCell.value(amount);
      total += amount;
    }

    const allocation = { table, total, itemCount: group?.items.length ?? 0 };
    if (group) writeCbsFormDate(sheet, table, group.date);
    writeCbsTotals(sheet, allocation);
    return allocation;
  });
}

function writeItems(sheet: Sheet, request: ExcelTemplateRequest): TableAllocation[] {
  const headerTables = findHeaderTables(sheet);
  const tables = headerTables.length > 0 ? headerTables : findExistingItemTables(sheet);
  if (tables.length === 0) return [];

  let itemIndex = 0;
  const sortedItems = [...request.items].sort((a, b) => a.sortOrder - b.sortOrder);
  const allocations: TableAllocation[] = [];

  for (const table of tables) {
    let tableTotal = 0;
    let itemCount = 0;

    for (let row = table.startRow; row <= table.endRow; row += 1) {
      const item = sortedItems[itemIndex];
      const numberCell = table.numberColumn ? sheet.cell(row, table.numberColumn) : null;
      const volumeCell = sheet.cell(row, table.volumeColumn);
      const nameCell = sheet.cell(row, table.nameColumn);
      const unitCell = table.unitColumn ? sheet.cell(row, table.unitColumn) : null;
      const priceCell = sheet.cell(row, table.priceColumn);
      const amountCell = sheet.cell(row, table.amountColumn);

      if (!item) {
        numberCell?.value(undefined);
        volumeCell.value(undefined);
        nameCell.value(undefined);
        unitCell?.value(undefined);
        priceCell.value(undefined);
        amountCell.value(undefined);
        continue;
      }

      numberCell?.value(itemIndex + 1);
      volumeCell.value(item.volume);
      nameCell.value(item.itemName);
      unitCell?.value(item.unit);
      priceCell.value(item.unitPrice);
      const amount = getResumeItemAmount(item);
      amountCell.value(amount);
      tableTotal += amount;
      itemCount += 1;
      itemIndex += 1;
    }

    allocations.push({ table, total: tableTotal, itemCount });
  }

  return allocations;
}

function findCellsInRange(
  sheet: Sheet,
  predicate: (text: string) => boolean,
  range: { startRow: number; endRow: number; startColumn: number; endColumn: number },
) {
  const matches: CellAddress[] = [];
  for (let row = range.startRow; row <= range.endRow; row += 1) {
    for (let column = range.startColumn; column <= range.endColumn; column += 1) {
      const text = normalize(sheet.cell(row, column).value());
      if (predicate(text)) matches.push({ row, column });
    }
  }
  return matches;
}

function writeTableTotals(sheet: Sheet, allocations: TableAllocation[]) {
  for (const allocation of allocations) {
    const value = allocation.itemCount > 0 ? allocation.total : undefined;
    const range = {
      startRow: allocation.table.endRow + 1,
      endRow: allocation.table.endRow + 16,
      startColumn: allocation.table.startColumn,
      endColumn: allocation.table.endColumn,
    };

    const totalAnchors = findCellsInRange(sheet, (text) => /^(jumlah|jumlah rp\.?|total|grand total|subtotal)$/.test(text), range);
    for (const anchor of totalAnchors) {
      sheet.cell(anchor.row, allocation.table.amountColumn).value(value);
    }

    const terbilangAnchors = findCellsInRange(sheet, (text) => text === "terbilang", range);
    for (const anchor of terbilangAnchors) {
      sheet.cell(anchor.row + 1, anchor.column).value(value ? ` ${terbilangRupiah(allocation.total).toUpperCase()}` : undefined);
    }
  }
}

function writeDates(sheet: Sheet, request: ExcelTemplateRequest) {
  const date = excelDate(request.items[0]?.expenseDate ?? request.project.projectDate);
  for (const anchor of findCells(sheet, (text) => text === "tanggal" || text === "bekasi," || text === "cibadak," || text === "cianjur," || text === "cianjur")) {
    const target = sheet.cell(anchor.row, anchor.column + 1);
    const current = target.value();
    if (current instanceof Date || typeof current === "number" || current === undefined || current === null || current === "") {
      target.value(date);
    }
  }
}

function writeProjectIdentity(sheet: Sheet, request: ExcelTemplateRequest) {
  const village = request.project.villageName;
  const district = request.project.districtName;
  const regency = request.project.regencyName;

  setCellIfTextIncludes(sheet, "kdkmp desa", `KDKMP Desa ${village}`);
  setCellIfTextIncludes(sheet, "kecamatan", `Kecamatan ${district}`);

  replaceMatchingText(sheet, [
    [/Desa\s+Mekarsari/gi, `Desa ${village}`],
    [/Kec\.\s*Cianjur/gi, `Kec. ${district}`],
    [/Kecamatan\s+Cianjur/gi, `Kecamatan ${district}`],
    [/KDKMP\s+CIANJUR/gi, `KDKMP ${regency.toUpperCase()}`],
  ]);
}

function applyTemplatePrintLayout(sheet: Sheet, templateId: string, allocations: TableAllocation[]) {
  if (templateId === "template-cahaya-timur-keramik") {
    const activeNotes = allocations.filter((allocation) => allocation.itemCount > 0).length;
    const endRow = activeNotes <= 1 ? 29 : activeNotes === 2 ? 58 : 86;

    // Template CTK berisi tiga nota pada blok row 1-29, 30-58, 59-86.
    // Cetak dua nota pada lembar pertama dan, bila ada, satu nota pada lembar
    // kedua. Print area sumber sebelumnya hanya menunjuk blok ketiga.
    const printableSheet = sheet as SheetWithPrintLayout;
    printableSheet.definedName("_xlnm.Print_Area", printableSheet.range(`A1:D${endRow}`));
    if (activeNotes > 2) printableSheet.row(59).addPageBreak();

    const sheetNode = (sheet as unknown as { _node?: WorkbookXmlNode })._node;
    const pageSetup = sheetNode?.children?.find((node) => node.name === "pageSetup");
    if (pageSetup) {
      pageSetup.attributes.paperSize = 9;
      pageSetup.attributes.orientation = "portrait";
      pageSetup.attributes.scale = 70;
      delete pageSetup.attributes.fitToWidth;
      delete pageSetup.attributes.fitToHeight;
    }
    return;
  }

  if (templateId !== "template-cbs") return;

  const activeNotes = allocations.filter((allocation) => allocation.itemCount > 0).length;
  if (activeNotes === 0) return;

  const printableSheet = sheet as SheetWithPrintLayout;
  const nextUnusedTable = allocations[activeNotes]?.table;
  const endRow = nextUnusedTable
    ? Math.max(1, nextUnusedTable.startRow - 13)
    : usedBounds(sheet).endRow;
  printableSheet.definedName("_xlnm.Print_Area", printableSheet.range(`A1:H${endRow}`));

  const pageBreaks = printableSheet.horizontalPageBreaks();
  while (pageBreaks.count > 0) pageBreaks.remove(0);
  for (
    let noteIndex = CBS_DOCUMENT_LAYOUT.notesPerPage;
    noteIndex < activeNotes;
    noteIndex += CBS_DOCUMENT_LAYOUT.notesPerPage
  ) {
    const nextPageStart = Math.max(1, allocations[noteIndex].table.startRow - 11);
    // OOXML menyimpan horizontal break sebagai baris terakhir halaman.
    // Sisakan satu row kosong agar gambar/logo blok berikutnya tidak bleed.
    printableSheet.row(Math.max(1, nextPageStart - 2)).addPageBreak();
  }

  // XlsxPopulate mempertahankan pageSetup bawaan, tetapi belum menyediakan
  // public setter untuk atribut scale. Ubah node workbook hasil generate saja;
  // file template sumber pengguna tidak disentuh.
  const sheetNode = (sheet as unknown as { _node?: WorkbookXmlNode })._node;
  const pageSetup = sheetNode?.children?.find((node) => node.name === "pageSetup");
  if (!pageSetup) return;

  // Template sumber mengaktifkan FitToPage tanpa fitToHeight eksplisit.
  // Excel menafsirkannya sebagai 1 x 1 halaman dan mengabaikan manual break.
  const sheetProperties = sheetNode?.children?.find((node) => node.name === "sheetPr");
  const pageSetupProperties = sheetProperties?.children?.find((node) => node.name === "pageSetUpPr");
  if (pageSetupProperties) pageSetupProperties.attributes.fitToPage = 0;

  const currentScale = Number(pageSetup.attributes.scale);
  pageSetup.attributes.paperSize = 9;
  pageSetup.attributes.orientation = "portrait";
  pageSetup.attributes.scale = Number.isFinite(currentScale) && currentScale > 0
    ? Math.max(10, Math.round(currentScale * CBS_DOCUMENT_LAYOUT.exportScaleFactor))
    : CBS_DOCUMENT_LAYOUT.exportScaleFallback;
  delete pageSetup.attributes.fitToWidth;
  delete pageSetup.attributes.fitToHeight;
}

export async function renderExcelTemplateToPdf(request: ExcelTemplateRequest): Promise<RenderedExcelPdf> {
  const template = resolveExcelTemplate(request);
  if (!existsSync(template.sourcePath)) {
    throw new Error(`Template tidak ditemukan: ${template.sourcePath}`);
  }

  const workbook = await XlsxPopulate.fromFileAsync(template.sourcePath);
  const sheet = workbook.sheet(0);
  if (usesNotaLeftMargin(template.id)) {
    (sheet as SheetWithPageMargins).pageMargins("left", NOTA_LEFT_MARGIN_INCHES);
  }
  writeProjectIdentity(sheet, request);
  writeDates(sheet, request);
  const allocations = template.id === "template-cbs"
    ? writeCbsItems(sheet, request)
    : writeItems(sheet, request);
  writeTableTotals(sheet, allocations);
  applyTemplatePrintLayout(sheet, template.id, allocations);

  const buffer = await workbook.outputAsync("nodebuffer");
  const officePdf = await exportWorkbookBufferToPdf(buffer);
  const activeNotes = allocations.filter((allocation) => allocation.itemCount > 0).length;
  let pdf: Buffer = officePdf;
  if (template.id === "template-cahaya-timur-keramik") {
    pdf = await imposeCahayaTimurPdf(officePdf, activeNotes);
  } else if (template.id === "template-cbs") {
    pdf = await imposeCbsPdf(officePdf, activeNotes);
  }

  return {
    fileName: `${formatSafeFileName(template.label)}.pdf`,
    pdf,
  };
}
