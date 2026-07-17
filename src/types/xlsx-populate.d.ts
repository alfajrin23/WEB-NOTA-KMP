declare module "xlsx-populate" {
  type CellValue = string | number | boolean | Date | undefined | null | object;
  type StyleValue = string | number | boolean | object | undefined | null;
  type StyleMap = Record<string, StyleValue>;

  export type Cell = {
    address(): string;
    rowNumber(): number;
    columnNumber(): number;
    value(): CellValue;
    value(value: CellValue): Cell;
    formula(): string | undefined;
    formula(value: string): Cell;
    style(): StyleMap;
    style(styles: StyleMap): Cell;
    style(name: string): StyleValue;
    style(name: string, value: StyleValue): Cell;
  };

  export type Range = {
    address(): string;
    startCell(): Cell;
    endCell(): Cell;
    value(): CellValue | CellValue[][];
    value(value: CellValue | CellValue[][]): Range;
    formula(): string | string[][] | undefined;
    formula(value: string | string[][]): Range;
    merged(): boolean;
    merged(value: boolean): Range;
    style(): StyleMap;
    style(styles: StyleMap): Range;
    style(name: string): StyleValue;
    style(name: string, value: StyleValue): Range;
  };

  export type Row = {
    height(): number | undefined;
    height(value: number): Row;
    hidden(): boolean;
    hidden(value: boolean): Row;
    style(): StyleMap;
    style(styles: StyleMap): Row;
    addPageBreak(): Row;
  };

  export type Column = {
    width(): number | undefined;
    width(value: number): Column;
    hidden(): boolean;
    hidden(value: boolean): Column;
    style(): StyleMap;
    style(styles: StyleMap): Column;
  };

  export type Sheet = {
    name(): string;
    name(value: string): Sheet;
    usedRange(): Range | undefined;
    cell(address: string): Cell;
    cell(row: number, column: number): Cell;
    range(address: string): Range;
    row(rowNumber: number): Row;
    column(column: number | string): Column;
    freezePanes(topLeftCell: string): Sheet;
    freezePanes(xSplit: number, ySplit: number): Sheet;
  };

  export type Workbook = {
    sheet(index: number): Sheet;
    sheet(name: string): Sheet;
    sheets(): Sheet[];
    addSheet(name: string, indexOrBeforeSheet?: number | string | Sheet): Sheet;
    deleteSheet(sheet: number | string | Sheet): Workbook;
    outputAsync(type: "nodebuffer"): Promise<Buffer>;
  };

  const XlsxPopulate: {
    MIME_TYPE: string;
    fromBlankAsync(): Promise<Workbook>;
    fromDataAsync(data: Buffer | Uint8Array | ArrayBuffer): Promise<Workbook>;
    fromFileAsync(path: string): Promise<Workbook>;
  };

  export default XlsxPopulate;
}
