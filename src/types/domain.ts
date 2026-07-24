export type StageCode = "TAHAP_I" | "TAHAP_II" | "TAHAP_III" | "TAHAP_IV" | "RESUME_ALL";

export type KwitansiGroupCode = "TAHAP_1" | "TAHAP_2" | "TAHAP_3" | "TAHAP_4" | "LUAR_INTI";

export type VendorType = "material" | "equipment" | "labor" | "utility" | "internal";

export type ProjectStatus = "draft" | "review" | "generated" | "archived";

export type DocumentType = "nota" | "kwitansi" | "resume" | "full_report";

export type NotaDocumentType = "nota" | "kwitansi";

export type WilayahType = "desa" | "kelurahan";

export type KwitansiWorkerSlot = 1 | 2 | 3 | 4;

export type Vendor = {
  id: string;
  name: string;
  type: VendorType;
  address?: string;
  phone?: string;
  aliases?: string[];
};

export type ResumeItem = {
  id: string;
  stageCode: StageCode;
  stageName: string;
  category: string;
  categoryCode?: string;
  categoryName?: string;
  itemNo?: string;
  expenseDate: string;
  itemName: string;
  volume: number;
  unit: string;
  unitPrice: number;
  amountOverride?: number | null;
  vendorId: string;
  vendorName?: string;
  notes?: string;
  sortOrder: number;
  sourceFile?: string | null;
  sourcePage?: number | null;
  sourceRow?: number | null;
  sourceType?: "pdf" | "excel" | "manual" | "seed";
  isManualAdded?: boolean;
  isIncludedInResumeTotal?: boolean;
  isGeneratedToNote?: boolean;
  noteId?: string | null;
  categoryTotal?: number | null;
  stageTotal?: number | null;
  validationStatus?: "valid" | "warning" | "error";
};

export type Project = {
  id: string;
  templateId: string;
  projectName: string;
  wilayahType: WilayahType;
  villageName: string;
  districtName: string;
  regencyName: string;
  regionName: string;
  projectDate: string;
  reportDate?: string;
  /** Nama Babinsa / penanggung jawab desa; sumber default "Telah terima dari" kwitansi. */
  responsibleName: string;
  coordinates?: string;
  invoiceRecipientName?: string;
  invoiceRecipientAddress?: string;
  targetGrandTotal?: number | null;
  /** Metadata Supabase yang tidak memiliki kolom khusus; dipertahankan saat project disimpan ulang. */
  metadataJson?: Record<string, unknown>;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  items: ResumeItem[];
};

export type TemplateDefinition = {
  id: string;
  label: string;
  documentType: NotaDocumentType;
  stageCodes: StageCode[];
  vendorIds?: string[];
  canonicalFileName?: string;
  aliases: string[];
  fallback?: boolean;
};

export type TemplateAssignment = {
  id: string;
  stageCode: StageCode;
  vendorId: string;
  templateId: string;
  documentType: NotaDocumentType;
  preferredFileName?: string;
  aliases: string[];
  fallback?: boolean;
};

export type ProjectMeta = Pick<
  Project,
  | "projectName"
  | "wilayahType"
  | "villageName"
  | "districtName"
  | "regencyName"
  | "regionName"
  | "projectDate"
  | "reportDate"
  | "responsibleName"
  | "coordinates"
  | "invoiceRecipientName"
  | "invoiceRecipientAddress"
>;

export type GeneratedNota = {
  id: string;
  projectId: string;
  stageId: StageCode;
  stageName: string;
  vendorId: string;
  vendorName: string;
  vendor: Vendor;
  stageCode: StageCode;
  documentType: NotaDocumentType;
  templateId: string;
  templateName: string;
  categoryNames: string[];
  tanggal: string;
  notaDate: string;
  subtotal: number;
  totalAmount: number;
  terbilang: string;
  items: ResumeItem[];
  itemIds: string[];
  projectMeta: ProjectMeta;
  source?: "auto" | "custom";
  status?: "draft" | "generated" | "reviewed" | "exported" | "archived";
  kwitansiReceiverName?: string;
  kwitansiWorkerSlot?: KwitansiWorkerSlot;
  kwitansiNumber?: string;
  kwitansiPayerName?: string;
  kwitansiPaymentDescription?: string;
  kwitansiRoleName?: string;
  kwitansiNote?: string;
  kwitansiAmount?: number;
  kwitansiAmountWords?: string;
  kwitansiDate?: string;
  kwitansiCity?: string;
  printGroupKey?: string;
  printOrder?: number;
  isSpecialKwitansi?: boolean;
  kwitansiGroupCode?: KwitansiGroupCode;
  warnaTemplate?: string;
  customReason?: string;
};

export type ResumeSummaryTotals = {
  totalTahap1: number;
  totalTahap2: number;
  totalTahap3: number;
  totalTahap4: number;
  totalDiluarKonstruksi: number;
  totalKeseluruhan: number;
  terbilang: string;
};

export type KwitansiEdit = {
  id: string;
  projectId: string;
  noteId: string;
  namaPenerima: string;
  warnaTemplate: string;
  customDataJson?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type CustomNote = {
  id: string;
  projectId: string;
  stageCode: StageCode;
  vendorId: string;
  vendorName: string;
  templateId: string;
  dataJson: GeneratedNota;
  total: number;
  alasan?: string;
  createdAt: string;
  updatedAt: string;
};

export type NoteHistoryEntry = {
  id: string;
  projectId: string;
  action: string;
  description: string;
  createdAt: string;
};

export type DashboardStats = {
  totalProjects: number;
  totalNominal: number;
  totalNotas: number;
  totalVendors: number;
};
