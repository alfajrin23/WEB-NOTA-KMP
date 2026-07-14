declare module "xlsx-populate" {
  type CellValue = string | number | boolean | Date | undefined | null | object;

  export type Cell = {
    address(): string;
    rowNumber(): number;
    columnNumber(): number;
    value(): CellValue;
    value(value: CellValue): Cell;
  };

  export type Range = {
    address(): string;
    startCell(): Cell;
    endCell(): Cell;
  };

  export type Sheet = {
    name(): string;
    usedRange(): Range | undefined;
    cell(row: number, column: number): Cell;
  };

  export type Workbook = {
    sheet(index: number): Sheet;
    sheets(): Sheet[];
    outputAsync(type: "nodebuffer"): Promise<Buffer>;
  };

  const XlsxPopulate: {
    fromFileAsync(path: string): Promise<Workbook>;
  };

  export default XlsxPopulate;
}
