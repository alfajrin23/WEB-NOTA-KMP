import { Project, ResumeItem, TemplateAssignment, Vendor } from "@/types/domain";

export type ExcelDocumentType = "nota" | "kwitansi";

export type ExcelTemplateRequest = {
  type: ExcelDocumentType;
  project: Project;
  vendor?: Vendor;
  items: ResumeItem[];
  templateAssignment?: TemplateAssignment;
};

export type TemplateMatch = {
  id: string;
  label: string;
  sourcePath: string;
};

export type RenderedExcelPdf = {
  fileName: string;
  pdf: Buffer;
};
