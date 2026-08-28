"use client";

import { SupabaseClient } from "@supabase/supabase-js";
import { ALL_TEMPLATE_ASSIGNMENTS, findTemplateDefinition, resolveTemplateAssignment } from "@/constants/template-mapping";
import { getStageLabel, normalizeLegacyStageCode } from "@/constants/stages";
import { initialProjects, masterTemplateItems, vendors } from "@/constants/seed-data";
import { EXCEL_BASE_ROWS } from "@/constants/excel-base-data";
import { generateKwitansiDocuments, generateNotaDocuments } from "@/lib/nota-generator";
import { getAutofillKwitansiReceiver } from "@/lib/kwitansi-rules";
import type { KwitansiSyncKey } from "@/lib/kwitansi-rules";
import { isSpecialPLNKwitansi } from "@/lib/pln-document-groups";
import { buildResumeItemsForNewProject } from "@/lib/resume-history";
import { buildProjectSummary, getResumeItemAmount } from "@/lib/resume-calculations";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  CustomNote,
  GeneratedNota,
  KwitansiEdit,
  KwitansiWorkerSlot,
  NoteHistoryEntry,
  Project,
  ProjectMeta,
  ResumeItem,
  ResumeSummaryTotals,
  StageCode,
  TemplateAssignment,
} from "@/types/domain";
import {
  formatProjectRecipientAddress,
  formatProjectRecipientName,
  normalizeWilayahType,
  terbilangRupiah,
} from "@/utils/format";

const LEGACY_CACHE_KEY = "kdkmp.supabase.bundle.v2-excel";
const CACHE_KEY = "kdkmp.supabase.bundle.v3";
const TEMPLATE_ID = "master-template-kdkmp-v1";
// Supabase returns at most 1,000 rows by default. Matching that page size and
// fetching pages concurrently avoids dozens of sequential round trips for the
// 84-project resume bundle.
const RESUME_ITEMS_PAGE_SIZE = 1000;
const RESUME_ITEMS_PAGE_CONCURRENCY = 6;
const MAX_LOCAL_CACHE_CHARS = 4_000_000;

const PROJECT_SELECT = "id,nama_desa,jenis_wilayah,kecamatan,kabupaten,nama_project,wilayah,kodim,tanggal_laporan,project_date,metadata_json,status,created_at,updated_at";
const RESUME_ITEM_SELECT = "id,project_id,tahap,stage_id,stage_name,category_code,category_name,item_no,kategori,tanggal,uraian,qty,satuan,harga_satuan,jumlah,jumlah_override,is_jumlah_manual,vendor,vendor_id,source_file,source_page,source_row,is_manual_added,is_included_in_resume_total,is_generated_to_note,note_id,category_total,stage_total,source_type,validation_status,notes,urutan,created_at,updated_at";
const GENERATED_NOTE_SELECT = "id,project_id,tahap,vendor,vendor_id,template_id,document_type,source_resume_item_ids,data_json,total,status,auto_key,created_at,updated_at";
const KWITANSI_EDIT_SELECT = "id,project_id,note_id,nama_penerima,warna_template,custom_data_json,created_at,updated_at";
const CUSTOM_NOTE_SELECT = "id,project_id,tahap,vendor,vendor_id,template_id,document_type,data_json,total,alasan,created_at,updated_at";
const HISTORY_SELECT = "id,project_id,action,description,created_at";
const DASHBOARD_SUMMARY_SELECT = "project_id,total_tahap_1,total_tahap_2,total_tahap_3,total_tahap_4,total_diluar_konstruksi,total_keseluruhan";
const DASHBOARD_OUTSIDE_ITEM_SELECT = "project_id,tahap,category_code,kategori,uraian,qty,harga_satuan,jumlah,jumlah_override,is_jumlah_manual,is_included_in_resume_total";
const DASHBOARD_NOTE_SELECT = "id,project_id,tahap,vendor,vendor_id,document_type,total";
const DASHBOARD_CUSTOM_NOTE_SELECT = "id,project_id,tahap,vendor,vendor_id,document_type,total";

type JsonRecord = Record<string, unknown>;

type ProjectRow = {
  id: string;
  nama_desa: string;
  jenis_wilayah: string | null;
  kecamatan: string;
  kabupaten: string;
  nama_project: string;
  wilayah: string;
  kodim: string | null;
  tanggal_laporan: string;
  project_date: string;
  metadata_json: JsonRecord | null;
  status: Project["status"];
  created_at: string;
  updated_at: string;
};

type ResumeItemRow = {
  id: string;
  project_id: string;
  tahap: string;
  stage_id: string | null;
  stage_name: string | null;
  category_code: string | null;
  category_name: string | null;
  item_no: string | null;
  kategori: string;
  tanggal: string | null;
  uraian: string;
  qty: number | string;
  satuan: string;
  harga_satuan: number | string;
  jumlah: number | string;
  jumlah_override: number | string | null;
  is_jumlah_manual: boolean;
  vendor: string;
  vendor_id: string | null;
  source_file: string | null;
  source_page: number | null;
  source_row: number | null;
  is_manual_added: boolean | null;
  is_included_in_resume_total: boolean | null;
  is_generated_to_note: boolean | null;
  note_id: string | null;
  category_total: number | string | null;
  stage_total: number | string | null;
  source_type: ResumeItem["sourceType"] | null;
  validation_status: ResumeItem["validationStatus"] | null;
  notes: string | null;
  urutan: number;
  created_at: string;
  updated_at: string;
};

type GeneratedNoteRow = {
  id: string;
  project_id: string;
  tahap: string;
  vendor: string;
  vendor_id: string | null;
  template_id: string;
  document_type: GeneratedNota["documentType"];
  source_resume_item_ids: string[] | null;
  data_json: unknown;
  total: number | string;
  status: NonNullable<GeneratedNota["status"]>;
  auto_key: string | null;
  created_at: string;
  updated_at: string;
};

type KwitansiEditRow = {
  id: string;
  project_id: string;
  note_id: string;
  nama_penerima: string;
  warna_template: string;
  custom_data_json: JsonRecord | null;
  created_at: string;
  updated_at: string;
};

type CustomNoteRow = {
  id: string;
  project_id: string;
  tahap: string;
  vendor: string;
  vendor_id: string | null;
  template_id: string;
  document_type: GeneratedNota["documentType"];
  data_json: unknown;
  total: number | string;
  alasan: string | null;
  created_at: string;
  updated_at: string;
};

type NoteHistoryRow = {
  id: string;
  project_id: string;
  action: string;
  description: string;
  created_at: string;
};

type DashboardSummaryRow = {
  project_id: string;
  total_tahap_1: number | string;
  total_tahap_2: number | string;
  total_tahap_3: number | string;
  total_tahap_4: number | string;
  total_diluar_konstruksi: number | string;
  total_keseluruhan: number | string;
};

type DashboardAmountRow = {
  project_id: string;
  tahap: string;
  category_code: string | null;
  kategori: string;
  uraian: string;
  qty: number | string;
  harga_satuan: number | string;
  jumlah: number | string;
  jumlah_override: number | string | null;
  is_jumlah_manual: boolean;
  is_included_in_resume_total: boolean | null;
};

type DashboardNoteRow = {
  id: string;
  project_id: string;
  tahap: string;
  vendor: string;
  vendor_id: string | null;
  document_type: GeneratedNota["documentType"];
  total: number | string;
};

export type DashboardProjectStats = {
  projectId: string;
  stageTotals: Partial<Record<StageCode, number>>;
  grandTotal: number;
  notaCount: number;
};

export type DashboardNotaStats = {
  projectId: string;
  stageCode: StageCode;
  stageName: string;
  vendorId: string;
  vendorName: string;
  count: number;
  total: number;
};

export type ProjectBundle = {
  projects: Project[];
  generatedNotas: GeneratedNota[];
  kwitansiEdits: KwitansiEdit[];
  customNotes: CustomNote[];
  history: NoteHistoryEntry[];
  source: "supabase" | "cache" | "seed";
  dashboardProjectStats?: DashboardProjectStats[];
  dashboardNotaStats?: DashboardNotaStats[];
  dashboardSummaryOnly?: boolean;
};

export type CustomNoteInput = {
  stageCode: StageCode;
  vendorId: string;
  templateId: string;
  tanggal: string;
  uraian: string;
  qty: number;
  satuan: string;
  hargaSatuan: number;
  jumlahOverride?: number | null;
  alasan?: string;
};

export type KwitansiEditInput = {
  namaPenerima?: string;
  receiverSource?: "manual" | "sync" | "auto";
  receiverSyncKey?: KwitansiSyncKey;
  warnaTemplate?: string;
  noKwitansi?: string;
  namaPemberi?: string;
  keterangan?: string;
  jabatan?: string;
  catatan?: string;
  nominal?: number | null;
  uangSejumlah?: string;
  tanggalKwitansi?: string;
  kota?: string;
};

function supabase() {
  return createSupabaseBrowserClient();
}

export function isSupabaseConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

function toNumber(value: number | string | null | undefined) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asOptionalNumber(value: unknown) {
  if (value == null || value === "") return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function asKwitansiWorkerSlot(value: unknown): KwitansiWorkerSlot | undefined {
  const slot = asOptionalNumber(value);
  return slot === 1 || slot === 2 || slot === 3 || slot === 4 ? slot : undefined;
}

function latestTimestamp(values: Array<string | null | undefined>): string {
  const fallback = new Date().toISOString();
  return values.reduce((latest, value) => {
    const current = Date.parse(value ?? "");
    const previous = Date.parse(latest ?? "");
    if (!Number.isFinite(current)) return latest;
    if (!Number.isFinite(previous) || current > previous) return value ?? latest;
    return latest;
  }, values[0] ?? fallback) ?? fallback;
}

function customString(custom: JsonRecord, key: string, fallback: string | undefined) {
  return Object.prototype.hasOwnProperty.call(custom, key) ? asString(custom[key]) : fallback;
}

function hasOwnInput(input: KwitansiEditInput, key: keyof KwitansiEditInput) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function kwitansiReceiverSource(custom: JsonRecord) {
  const source = custom.receiver_source;
  return source === "manual" || source === "sync" || source === "auto" ? source : null;
}

function isPreservedReceiverEdit(edit: KwitansiEditRow | undefined | null) {
  if (!edit?.nama_penerima?.trim()) return false;
  return kwitansiReceiverSource(asRecord(edit.custom_data_json)) !== "auto";
}

function withAutomaticKwitansiReceiver(doc: GeneratedNota) {
  if (isSpecialPLNKwitansi(doc)) return { ...doc, kwitansiReceiverName: "" };
  if (doc.documentType !== "kwitansi" || doc.kwitansiReceiverName?.trim()) return doc;
  const receiver = getAutofillKwitansiReceiver(doc);
  return receiver ? { ...doc, kwitansiReceiverName: receiver } : doc;
}

function withoutSpecialPlnAmountEdit(doc: GeneratedNota, custom: JsonRecord) {
  if (!isSpecialPLNKwitansi(doc)) return custom;
  const rest = { ...custom };
  delete rest.nominal;
  delete rest.uang_sejumlah;
  return rest;
}

function identityOnlyKwitansiEdit(edit: KwitansiEditRow): KwitansiEditRow {
  const custom = asRecord(edit.custom_data_json);
  const identityData: JsonRecord = {};
  for (const key of ["nama_pemberi", "receiver_source", "receiver_sync_key", "worker_slot", "prepared_for_template_variants"]) {
    if (Object.prototype.hasOwnProperty.call(custom, key)) identityData[key] = custom[key];
  }
  return { ...edit, custom_data_json: identityData };
}

function asStageCode(value: string | undefined | null, itemName = "", category = ""): StageCode {
  if (value === "TAHAP_I" || value === "TAHAP_II" || value === "TAHAP_III" || value === "TAHAP_IV" || value === "TAHAP_V" || value === "TAHAP_VI" || value === "TAHAP_VII") {
    return value;
  }
  if (value === "RESUME_ALL" || value === "LUAR_INTI" || value === "DI_LUAR_PEKERJAAN_INTI") {
    return normalizeLegacyStageCode("RESUME_ALL", itemName, category);
  }
  return "TAHAP_I";
}

function generatedNoteStageForStorage(doc: GeneratedNota) {
  return doc.documentType === "kwitansi" && (doc.stageCode === "RESUME_ALL" || doc.kwitansiGroupCode === "LUAR_INTI")
    ? "LUAR_INTI"
    : doc.stageCode;
}

function kwitansiGroupForStage(stageCode: StageCode): NonNullable<GeneratedNota["kwitansiGroupCode"]> {
  if (stageCode === "TAHAP_I") return "TAHAP_1";
  if (stageCode === "TAHAP_II") return "TAHAP_2";
  if (stageCode === "TAHAP_III") return "TAHAP_3";
  if (stageCode === "TAHAP_IV") return "TAHAP_4";
  if (stageCode === "TAHAP_V") return "TAHAP_5";
  if (stageCode === "TAHAP_VI") return "TAHAP_6";
  if (stageCode === "TAHAP_VII") return "TAHAP_7";
  return "LUAR_INTI";
}

function vendorById(vendorId: string | undefined | null) {
  return vendors.find((vendor) => vendor.id === vendorId);
}

function vendorIdByName(name: string | undefined | null) {
  const normalized = (name ?? "").trim().toLowerCase();
  if (normalized === "-" || normalized === "nota kosong" || normalized === "internal / non vendor") return "vendor-internal";
  return vendors.find((vendor) => {
    const names = [vendor.name, ...(vendor.aliases ?? [])].map((entry) => entry.toLowerCase());
    return names.includes(normalized);
  })?.id;
}

function normalizeStoredStageCode(stageCode: StageCode, categoryCode: string | null | undefined, itemName: string) {
  const name = itemName.trim().toLowerCase();
  if (stageCode === "TAHAP_IV" && (categoryCode === "B" || categoryCode === "C" || name.includes("sumuran grounding") || name.includes("tukang listrik"))) {
    return "TAHAP_V" as const;
  }
  return stageCode;
}

function isPartisiKwitansiItem(stageCode: StageCode, categoryCode: string | null | undefined, itemName: string) {
  const name = itemName.trim().toLowerCase();
  return stageCode === "TAHAP_III" && (
    categoryCode === "D" ||
    name.includes("pintu besi") ||
    name.includes("dinding partisi kaca") ||
    name.includes("pintu kaca frameless")
  );
}

function inferredStoredVendorName(stageCode: StageCode, categoryCode: string | null | undefined, itemName: string, vendorName: string) {
  const raw = vendorName.trim();
  if (raw === "-" || raw.toLowerCase() === "nota kosong") return "NOTA KOSONG";
  if (raw) return raw;
  if (isPartisiKwitansiItem(stageCode, categoryCode, itemName)) return "KWITANSI";
  if (stageCode === "TAHAP_I" && categoryCode === "A") return itemName.toLowerCase().includes("sirtu") ? "AMANAH" : "MURAH MAJU";
  return raw;
}

function projectMeta(project: Project): ProjectMeta {
  return {
    projectName: project.projectName,
    wilayahType: normalizeWilayahType(project.wilayahType),
    villageName: project.villageName,
    districtName: project.districtName,
    regencyName: project.regencyName,
    regionName: project.regionName,
    projectDate: project.projectDate,
    reportDate: project.reportDate,
    responsibleName: project.responsibleName,
    coordinates: project.coordinates,
    invoiceRecipientName: project.invoiceRecipientName,
    invoiceRecipientAddress: project.invoiceRecipientAddress,
  };
}

function rowToResumeItem(row: ResumeItemRow): ResumeItem {
  const excelSource = row.source_file === "G.xlsx" && row.source_row
    ? EXCEL_BASE_ROWS.find((entry) => entry.excelRow === row.source_row)
    : undefined;
  const rawStageCode = asStageCode(row.tahap, row.uraian, row.kategori);
  const stageCode = normalizeStoredStageCode(rawStageCode, row.category_code, row.uraian);
  const vendorName = inferredStoredVendorName(stageCode, row.category_code, row.uraian, row.vendor || excelSource?.vendorName || "");
  const vendorId = row.vendor_id || vendorIdByName(vendorName) || "";

  return {
    id: row.id,
    stageCode,
    stageName: getStageLabel(stageCode),
    category: row.kategori || row.category_name || "",
    categoryCode: row.category_code ?? undefined,
    categoryName: row.category_name ?? row.kategori,
    itemNo: row.item_no ?? undefined,
    expenseDate: row.tanggal ?? "",
    itemName: row.uraian,
    volume: toNumber(row.qty),
    unit: row.satuan,
    unitPrice: toNumber(row.harga_satuan),
    amountOverride: row.is_jumlah_manual ? toNumber(row.jumlah_override ?? row.jumlah) : null,
    vendorId,
    vendorName,
    notes: row.notes ?? "",
    sortOrder: row.urutan,
    sourceFile: row.source_file,
    sourcePage: row.source_page,
    sourceRow: row.source_row,
    sourceType: row.source_type ?? "seed",
    kwitansiCount: excelSource?.kwitansiCount ?? (isPartisiKwitansiItem(stageCode, row.category_code, row.uraian) ? 5 : undefined),
    isManualAdded: row.is_manual_added ?? false,
    isIncludedInResumeTotal: row.is_included_in_resume_total ?? true,
    isGeneratedToNote: row.is_generated_to_note ?? false,
    noteId: row.note_id,
    categoryTotal: row.category_total == null ? null : toNumber(row.category_total),
    stageTotal: row.stage_total == null ? null : toNumber(row.stage_total),
    validationStatus: row.validation_status ?? "valid",
  };
}

function rowToProject(row: ProjectRow, itemRows: ResumeItemRow[]): Project {
  const meta = asRecord(row.metadata_json);
  const wilayahType = normalizeWilayahType(
    row.jenis_wilayah ?? asString(meta.jenis_wilayah, asString(meta.wilayah_type)),
  );
  const projectItemRows = itemRows.filter((item) => item.project_id === row.id);
  const items = projectItemRows
    .map(rowToResumeItem)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const updatedAt = latestTimestamp([row.updated_at, ...projectItemRows.map((item) => item.updated_at)]);
  const invoiceRecipientName = asString(meta.invoice_recipient_name);
  const invoiceRecipientAddress = asString(meta.invoice_recipient_address);
  const identity = {
    wilayahType,
    villageName: row.nama_desa,
    districtName: row.kecamatan,
    regencyName: row.kabupaten,
    invoiceRecipientName,
    invoiceRecipientAddress,
  };

  return {
    id: row.id,
    templateId: asString(meta.template_id, TEMPLATE_ID),
    projectName: row.nama_project,
    wilayahType,
    villageName: row.nama_desa,
    districtName: row.kecamatan,
    regencyName: row.kabupaten,
    regionName: row.wilayah,
    projectDate: row.project_date,
    reportDate: row.tanggal_laporan,
    responsibleName: asString(
      meta.babinsa_responsible_name,
      asString(meta.responsible_name, asString(meta.nama_babinsa, asString(meta.penanggung_jawab))),
    ),
    coordinates: asString(meta.coordinates),
    invoiceRecipientName: formatProjectRecipientName(identity, "long"),
    invoiceRecipientAddress: formatProjectRecipientAddress(identity),
    targetGrandTotal: asOptionalNumber(meta.target_grand_total_resume) ?? null,
    metadataJson: meta,
    status: row.status,
    createdAt: row.created_at,
    updatedAt,
    items,
  };
}

function resumeItemToRow(projectId: string, item: ResumeItem) {
  const vendor = vendorById(item.vendorId);
  const amount = getResumeItemAmount(item);
  const vendorName = item.vendorName ?? vendor?.name ?? "";

  return {
    project_id: projectId,
    tahap: item.stageCode,
    stage_id: item.stageCode,
    stage_name: item.stageName,
    category_code: item.categoryCode ?? null,
    category_name: item.categoryName ?? item.category,
    item_no: item.itemNo ?? null,
    kategori: item.category,
    tanggal: item.expenseDate || null,
    uraian: item.itemName,
    qty: item.volume,
    satuan: item.unit,
    harga_satuan: item.unitPrice,
    jumlah: amount,
    jumlah_override: item.amountOverride ?? null,
    is_jumlah_manual: typeof item.amountOverride === "number" && Number.isFinite(item.amountOverride),
    vendor: vendorName,
    vendor_id: item.vendorId || null,
    source_file: item.sourceFile ?? null,
    source_page: item.sourcePage ?? null,
    source_row: item.sourceRow ?? null,
    is_manual_added: item.isManualAdded ?? false,
    is_included_in_resume_total: item.isIncludedInResumeTotal ?? true,
    is_generated_to_note: item.isGeneratedToNote ?? false,
    note_id: item.noteId ?? null,
    category_total: item.categoryTotal ?? null,
    stage_total: item.stageTotal ?? null,
    source_type: item.sourceType ?? "seed",
    validation_status: item.validationStatus ?? "valid",
    notes: item.notes ?? "",
    urutan: item.sortOrder,
  };
}

function projectToRow(project: Project) {
  const wilayahType = normalizeWilayahType(project.wilayahType);
  return {
    nama_desa: project.villageName,
    jenis_wilayah: wilayahType,
    kecamatan: project.districtName,
    kabupaten: project.regencyName,
    nama_project: project.projectName,
    wilayah: project.regionName,
    kodim: project.regionName,
    tanggal_laporan: project.reportDate ?? project.projectDate,
    project_date: project.projectDate,
    status: project.status,
    metadata_json: {
      ...(project.metadataJson ?? {}),
      template_id: project.templateId,
      jenis_wilayah: wilayahType,
      wilayah_type: wilayahType,
      babinsa_responsible_name: project.responsibleName,
      responsible_name: project.responsibleName,
      coordinates: project.coordinates ?? "",
      invoice_recipient_name: project.invoiceRecipientName ?? "",
      invoice_recipient_address: project.invoiceRecipientAddress ?? "",
      target_grand_total_resume: project.targetGrandTotal ?? null,
    },
  };
}

function summarizeProject(project: Project): ResumeSummaryTotals {
  const summary = buildProjectSummary(project, vendors);
  const byStage = new Map(summary.stages.map((stage) => [stage.stageCode, stage.total]));

  return {
    totalTahap1: byStage.get("TAHAP_I") ?? 0,
    totalTahap2: byStage.get("TAHAP_II") ?? 0,
    totalTahap3: byStage.get("TAHAP_III") ?? 0,
    totalTahap4: byStage.get("TAHAP_IV") ?? 0,
    totalDiluarKonstruksi: (byStage.get("TAHAP_VI") ?? 0) + (byStage.get("TAHAP_VII") ?? 0) + (byStage.get("RESUME_ALL") ?? 0),
    totalKeseluruhan: summary.grandTotal,
    terbilang: terbilangRupiah(summary.grandTotal),
  };
}

function stageSortOrder(stageCode: StageCode) {
  const order: StageCode[] = ["TAHAP_I", "TAHAP_II", "TAHAP_III", "TAHAP_IV", "TAHAP_V", "TAHAP_VI", "TAHAP_VII", "RESUME_ALL"];
  const index = order.indexOf(stageCode);
  return index === -1 ? 99 : index + 1;
}

async function saveResumeStructure(project: Project) {
  const client = supabase();
  if (!client) return;

  const includedItems = project.items.filter((item) => item.isIncludedInResumeTotal !== false);
  const stageRows = new Map<string, { stage_id: string; stage_name: string; sort_order: number; source_total: number }>();
  const categoryRows = new Map<string, { stage_id: string; category_code: string; category_name: string; sort_order: number; source_total: number }>();

  for (const item of includedItems) {
    const amount = getResumeItemAmount(item);
    const stage = stageRows.get(item.stageCode) ?? {
      stage_id: item.stageCode,
      stage_name: item.stageName,
      sort_order: stageSortOrder(item.stageCode),
      source_total: 0,
    };
    stage.source_total += amount;
    stageRows.set(item.stageCode, stage);

    const categoryCode = item.categoryCode ?? item.category.match(/^([A-Z])\./)?.[1] ?? "A";
    const categoryName = item.categoryName ?? item.category.replace(/^([A-Z])\.\s*/, "");
    const categoryKey = `${item.stageCode}:${categoryCode}`;
    const category = categoryRows.get(categoryKey) ?? {
      stage_id: item.stageCode,
      category_code: categoryCode,
      category_name: categoryName,
      sort_order: item.sortOrder,
      source_total: 0,
    };
    category.source_total += amount;
    categoryRows.set(categoryKey, category);
  }

  if (stageRows.size > 0) {
    const { error } = await client.from("resume_stages").upsert(
      [...stageRows.values()].map((row) => ({ ...row, project_id: project.id })),
      { onConflict: "project_id,stage_id" },
    );
    if (error) throw error;
  }

  if (categoryRows.size > 0) {
    const { error } = await client.from("resume_categories").upsert(
      [...categoryRows.values()].map((row) => ({ ...row, project_id: project.id })),
      { onConflict: "project_id,stage_id,category_code" },
    );
    if (error) throw error;
  }
}

function generatedNoteAutoKey(doc: Pick<GeneratedNota, "stageCode" | "vendorId" | "templateId" | "documentType"> & Partial<Pick<GeneratedNota, "id">>) {
  const docId = doc.id ?? "";
  return `${doc.documentType}:${doc.stageCode}:${doc.vendorId}:${doc.templateId}:${docId}`;
}

function sourceItemIdsKey(ids: string[] | null | undefined) {
  const values = (ids ?? []).filter(Boolean).sort();
  return values.length > 0 ? values.join("|") : "";
}

function legacyGeneratedNoteAutoKey(doc: Pick<GeneratedNota, "stageCode" | "vendorId" | "templateId">) {
  return `${doc.stageCode}:${doc.vendorId}:${doc.templateId}`;
}

function parseGeneratedNota(value: unknown): GeneratedNota | null {
  const record = asRecord(value);
  if (!record.projectId || !Array.isArray(record.items)) return null;
  return record as GeneratedNota;
}

function isGeneratedKwitansiRow(row: GeneratedNoteRow) {
  const parsed = parseGeneratedNota(row.data_json);
  return (
    row.document_type === "kwitansi" ||
    row.template_id.startsWith("kwitansi-") ||
    row.auto_key?.startsWith("kwitansi:") === true ||
    parsed?.documentType === "kwitansi"
  );
}

function rowToKwitansiEdit(row: KwitansiEditRow): KwitansiEdit {
  return {
    id: row.id,
    projectId: row.project_id,
    noteId: row.note_id,
    namaPenerima: row.nama_penerima,
    warnaTemplate: row.warna_template,
    customDataJson: row.custom_data_json ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function applyKwitansiEdit(doc: GeneratedNota, edit: KwitansiEdit | undefined): GeneratedNota {
  if (!edit) return withAutomaticKwitansiReceiver(doc);
  const custom = withoutSpecialPlnAmountEdit(doc, asRecord(edit.customDataJson));
  const withCustomFields: GeneratedNota = {
    ...doc,
    kwitansiNumber: customString(custom, "no_kwitansi", doc.kwitansiNumber),
    kwitansiPayerName: customString(custom, "nama_pemberi", doc.kwitansiPayerName),
    kwitansiPaymentDescription: customString(custom, "keterangan", doc.kwitansiPaymentDescription),
    kwitansiRoleName: customString(custom, "jabatan", doc.kwitansiRoleName),
    kwitansiNote: customString(custom, "catatan", doc.kwitansiNote),
    kwitansiAmount: Object.prototype.hasOwnProperty.call(custom, "nominal") ? asOptionalNumber(custom.nominal) : doc.kwitansiAmount,
    kwitansiAmountWords: customString(custom, "uang_sejumlah", doc.kwitansiAmountWords),
    kwitansiDate: customString(custom, "tanggal_kwitansi", doc.kwitansiDate),
    kwitansiCity: customString(custom, "kota", doc.kwitansiCity),
    kwitansiWorkerSlot: doc.kwitansiWorkerSlot ?? asKwitansiWorkerSlot(custom.worker_slot),
    warnaTemplate: edit.warnaTemplate,
  };
  if (isSpecialPLNKwitansi(withCustomFields)) return { ...withCustomFields, kwitansiReceiverName: "" };
  return {
    ...withCustomFields,
    kwitansiReceiverName: edit.namaPenerima?.trim()
      || withCustomFields.kwitansiReceiverName?.trim()
      || getAutofillKwitansiReceiver(withCustomFields)
      || "",
  };
}

function rowsToGeneratedNotas(rows: GeneratedNoteRow[], editRows: KwitansiEditRow[]): GeneratedNota[] {
  const editsByNoteId = new Map(editRows.map((row) => [row.note_id, rowToKwitansiEdit(row)]));

  return rows
    .map((row) => {
      const parsed = parseGeneratedNota(row.data_json);
      if (!parsed) return null;
      const stageCode = asStageCode(row.tahap, parsed.items.map((item) => item.itemName).join(" "), parsed.stageName);
      const doc: GeneratedNota = {
        ...parsed,
        id: row.id,
        projectId: row.project_id,
        stageCode,
        stageId: stageCode,
        vendorId: row.vendor_id ?? parsed.vendorId,
        vendorName: row.vendor,
        templateId: row.template_id,
        documentType: row.document_type,
        totalAmount: toNumber(row.total),
        subtotal: toNumber(row.total),
        status: row.status,
        source: "auto",
        kwitansiGroupCode: row.document_type === "kwitansi" ? kwitansiGroupForStage(stageCode) : parsed.kwitansiGroupCode,
      };
      return applyKwitansiEdit(doc, editsByNoteId.get(row.id));
    })
    .filter((doc): doc is GeneratedNota => Boolean(doc));
}

function rowToCustomNote(row: CustomNoteRow): CustomNote | null {
  const parsed = parseGeneratedNota(row.data_json);
  if (!parsed) return null;
  const vendor = vendorById(row.vendor_id) ?? vendors.find((entry) => entry.name === row.vendor) ?? vendors[0];
  const stageCode = asStageCode(row.tahap, parsed.items.map((item) => item.itemName).join(" "), parsed.stageName);
  const doc: GeneratedNota = {
    ...parsed,
    id: row.id,
    projectId: row.project_id,
    stageCode,
    stageId: stageCode,
    vendorId: vendor.id,
    vendorName: vendor.name,
    vendor,
    templateId: row.template_id,
    documentType: row.document_type,
    totalAmount: toNumber(row.total),
    subtotal: toNumber(row.total),
    source: "custom",
    status: "generated",
    customReason: row.alasan ?? undefined,
    kwitansiGroupCode: row.document_type === "kwitansi" ? kwitansiGroupForStage(stageCode) : parsed.kwitansiGroupCode,
  };

  return {
    id: row.id,
    projectId: row.project_id,
    stageCode: asStageCode(row.tahap),
    vendorId: vendor.id,
    vendorName: vendor.name,
    templateId: row.template_id,
    dataJson: doc,
    total: toNumber(row.total),
    alasan: row.alasan ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowsToHistory(rows: NoteHistoryRow[]): NoteHistoryEntry[] {
  return rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    action: row.action,
    description: row.description,
    createdAt: row.created_at,
  }));
}

type CacheScope = "all" | "dashboard" | `project:${string}`;

function cacheStorageKey(scope: CacheScope) {
  return `${CACHE_KEY}.${scope}`;
}

function readCache(scope: CacheScope = "all"): ProjectBundle | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(cacheStorageKey(scope))
      ?? (scope === "all" ? window.localStorage.getItem(LEGACY_CACHE_KEY) : null);
    return value ? (JSON.parse(value) as ProjectBundle) : null;
  } catch {
    clearCache(scope);
    return null;
  }
}

function clearCache(scope: CacheScope = "all") {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(cacheStorageKey(scope));
    if (scope === "all") window.localStorage.removeItem(LEGACY_CACHE_KEY);
  } catch {
    // Ignore unavailable browser storage.
  }
}

function compactCacheBundle(bundle: ProjectBundle): ProjectBundle {
  return {
    projects: bundle.projects,
    generatedNotas: [],
    kwitansiEdits: [],
    customNotes: [],
    history: bundle.history.slice(0, 100),
    source: "cache",
    dashboardProjectStats: bundle.dashboardProjectStats,
    dashboardNotaStats: bundle.dashboardNotaStats,
    dashboardSummaryOnly: bundle.dashboardSummaryOnly,
  };
}

function serializeCacheBundle(bundle: ProjectBundle): string | null {
  const serialized = JSON.stringify(bundle);
  if (serialized.length <= MAX_LOCAL_CACHE_CHARS) return serialized;

  const compactSerialized = JSON.stringify(compactCacheBundle(bundle));
  return compactSerialized.length <= MAX_LOCAL_CACHE_CHARS ? compactSerialized : null;
}

function writeCache(bundle: ProjectBundle, scope: CacheScope = "all") {
  if (typeof window === "undefined") return;

  try {
    const serialized = serializeCacheBundle({ ...bundle, source: "cache" });
    if (!serialized) {
      // Keep an older valid cache when a complete multi-project bundle is too
      // large for localStorage. Dashboard and single-project caches are scoped
      // separately and remain available.
      return;
    }
    window.localStorage.setItem(cacheStorageKey(scope), serialized);
  } catch (error) {
    console.warn("Cache lokal project terlalu besar atau tidak tersedia, data tetap disimpan di Supabase.", error);
  }
}

export function readCachedProjectBundleOrNull(projectId?: string, dashboardOnly = false): ProjectBundle | null {
  const scope: CacheScope = dashboardOnly ? "dashboard" : projectId ? `project:${projectId}` : "all";
  const cached = readCache(scope);
  return cached ? { ...cached, source: "cache" } : null;
}

export function readCachedProjectBundle(projectId?: string, dashboardOnly = false): ProjectBundle {
  return readCachedProjectBundleOrNull(projectId, dashboardOnly) ?? {
    projects: initialProjects,
    generatedNotas: [],
    kwitansiEdits: [],
    customNotes: [],
    history: [],
    source: "seed",
  };
}

function emptySupabaseBundle(): ProjectBundle {
  return {
    projects: [],
    generatedNotas: [],
    kwitansiEdits: [],
    customNotes: [],
    history: [],
    source: "supabase",
  };
}

function ensureClient(client: SupabaseClient | null): SupabaseClient {
  if (!client) {
    throw new Error("Supabase belum dikonfigurasi. Isi NEXT_PUBLIC_SUPABASE_URL dan NEXT_PUBLIC_SUPABASE_ANON_KEY di .env.local.");
  }
  return client;
}

function databaseErrorMessage(error: { code?: string; message?: string } | null | undefined, fallback: string) {
  if (
    error?.code === "PGRST204" ||
    error?.code === "42703" ||
    /Could not find the .* column/i.test(error?.message ?? "")
  ) {
    return `${error?.message ?? fallback}. Skema Supabase belum terbaru. Jalankan ulang supabase/schema.sql di Supabase SQL Editor, lalu reload aplikasi.`;
  }
  return error?.message ?? fallback;
}

function throwDatabaseError(error: { code?: string; message?: string } | null | undefined, fallback: string): never {
  throw new Error(databaseErrorMessage(error, fallback));
}

async function logHistory(client: SupabaseClient, projectId: string, action: string, description: string) {
  await client.from("note_history").insert({ project_id: projectId, action, description });
}

async function fetchAllResumeItemRows(client: SupabaseClient, projectIds: string[]) {
  const allRows: ResumeItemRow[] = [];
  let page = 0;

  const fetchPage = async (pageIndex: number) => {
    const from = pageIndex * RESUME_ITEMS_PAGE_SIZE;
    const { data, error } = await client
      .from("resume_items")
      .select(RESUME_ITEM_SELECT)
      .in("project_id", projectIds)
      .order("project_id", { ascending: true })
      .order("urutan", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + RESUME_ITEMS_PAGE_SIZE - 1);
    return { rows: (data ?? []) as ResumeItemRow[], error };
  };

  const firstPage = await fetchPage(0);
  if (firstPage.error) return { data: allRows, error: firstPage.error };
  allRows.push(...firstPage.rows);
  if (firstPage.rows.length < RESUME_ITEMS_PAGE_SIZE) return { data: allRows, error: null };

  page = 1;
  while (true) {
    // The pages are independent ranges, so a small batch of parallel requests
    // is substantially faster than waiting for every page one after another.
    const pageIndexes = Array.from({ length: RESUME_ITEMS_PAGE_CONCURRENCY }, (_, index) => page + index);
    const results = await Promise.all(pageIndexes.map(fetchPage));
    const failed = results.find((result) => result.error);
    if (failed?.error) return { data: allRows, error: failed.error };

    for (const result of results) allRows.push(...result.rows);
    const lastPageIsShort = results.some((result) => result.rows.length < RESUME_ITEMS_PAGE_SIZE);
    page += RESUME_ITEMS_PAGE_CONCURRENCY;
    if (lastPageIsShort) break;
  }

  return { data: allRows, error: null };
}

async function fetchDashboardAmountRows(client: SupabaseClient, projectIds: string[], outsideOnly: boolean) {
  if (projectIds.length === 0) return { data: [] as DashboardAmountRow[], error: null };

  const allRows: DashboardAmountRow[] = [];
  let page = 0;
  while (true) {
    const from = page * RESUME_ITEMS_PAGE_SIZE;
    let query = client
      .from("resume_items")
      .select(DASHBOARD_OUTSIDE_ITEM_SELECT)
      .in("project_id", projectIds);
    if (outsideOnly) {
      query = query.in("tahap", ["TAHAP_VI", "TAHAP_VII", "RESUME_ALL", "LUAR_INTI", "DI_LUAR_PEKERJAAN_INTI"]);
    }
    const { data, error } = await query
      .order("project_id", { ascending: true })
      .range(from, from + RESUME_ITEMS_PAGE_SIZE - 1);
    if (error) return { data: allRows, error };
    const rows = (data ?? []) as DashboardAmountRow[];
    allRows.push(...rows);
    if (rows.length < RESUME_ITEMS_PAGE_SIZE) break;
    page += 1;
  }
  return { data: allRows, error: null };
}

function dashboardRowAmount(row: DashboardAmountRow) {
  if (row.is_jumlah_manual) return toNumber(row.jumlah_override ?? row.jumlah);
  return Math.round(toNumber(row.qty) * toNumber(row.harga_satuan));
}

function dashboardRowStage(row: DashboardAmountRow) {
  const rawStage = asStageCode(row.tahap, row.uraian, row.kategori);
  return normalizeStoredStageCode(rawStage, row.category_code, row.uraian);
}

function buildDashboardNotaStats(rows: DashboardNoteRow[]): DashboardNotaStats[] {
  const grouped = new Map<string, {
    projectId: string;
    stageCode: StageCode;
    stageName: string;
    vendorId: string;
    vendorName: string;
    notaCount: number;
    kwitansiCount: number;
    notaTotal: number;
    kwitansiTotal: number;
  }>();

  for (const row of rows) {
    const stageCode = asStageCode(row.tahap);
    const vendorId = row.vendor_id ?? vendorIdByName(row.vendor) ?? (row.vendor || "vendor-tanpa-id");
    const key = `${row.project_id}:${stageCode}:${vendorId}`;
    const current = grouped.get(key) ?? {
      projectId: row.project_id,
      stageCode,
      stageName: getStageLabel(stageCode),
      vendorId,
      vendorName: row.vendor || vendorById(vendorId)?.name || "Tanpa vendor",
      notaCount: 0,
      kwitansiCount: 0,
      notaTotal: 0,
      kwitansiTotal: 0,
    };
    if (row.document_type === "nota") {
      current.notaCount += 1;
      current.notaTotal += toNumber(row.total);
    } else {
      current.kwitansiCount += 1;
      current.kwitansiTotal += toNumber(row.total);
    }
    grouped.set(key, current);
  }

  return [...grouped.values()].map((row) => ({
    projectId: row.projectId,
    stageCode: row.stageCode,
    stageName: row.stageName,
    vendorId: row.vendorId,
    vendorName: row.vendorName,
    count: Math.max(row.notaCount, row.kwitansiCount),
    total: row.notaCount > 0 ? row.notaTotal : row.kwitansiTotal,
  }));
}

function withReadTimeout<T>(request: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutRequest = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} melewati batas ${Math.round(timeoutMs / 1000)} detik. Periksa koneksi atau konfigurasi Supabase Vercel.`)), timeoutMs);
  });
  return Promise.race([request, timeoutRequest]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

async function fetchDashboardBundleUncached(): Promise<ProjectBundle> {
  const client = supabase();
  if (!client) {
    const cached = readCachedProjectBundle(undefined, true);
    return { ...cached, source: cached.source === "seed" ? "seed" : "cache" };
  }

  const { data: projectRows, error: projectError } = await client
    .from("projects")
    .select(PROJECT_SELECT)
    .order("updated_at", { ascending: false });
  if (projectError) throwDatabaseError(projectError, "Gagal memuat daftar project.");

  const projectsData = (projectRows ?? []) as ProjectRow[];
  if (projectsData.length === 0) {
    const bundle = { ...emptySupabaseBundle(), dashboardProjectStats: [], dashboardNotaStats: [], dashboardSummaryOnly: true };
    writeCache(bundle, "dashboard");
    return bundle;
  }

  const projectIds = projectsData.map((project) => project.id);
  const [summariesResult, outsideResult, notesResult, customNotesResult] = await Promise.all([
    client.from("resume_summaries").select(DASHBOARD_SUMMARY_SELECT).in("project_id", projectIds),
    fetchDashboardAmountRows(client, projectIds, true),
    client.from("generated_notes").select(DASHBOARD_NOTE_SELECT).in("project_id", projectIds),
    client.from("custom_notes").select(DASHBOARD_CUSTOM_NOTE_SELECT).in("project_id", projectIds),
  ]);
  if (summariesResult.error) throw summariesResult.error;
  if (outsideResult.error) throw outsideResult.error;
  if (notesResult.error) throw notesResult.error;
  if (customNotesResult.error) throw customNotesResult.error;

  const summaryRows = (summariesResult.data ?? []) as DashboardSummaryRow[];
  const summaryByProject = new Map(summaryRows.map((row) => [row.project_id, row]));
  const missingSummaryIds = projectIds.filter((id) => !summaryByProject.has(id));
  const missingResult = await fetchDashboardAmountRows(client, missingSummaryIds, false);
  if (missingResult.error) throw missingResult.error;

  const outsideByProject = new Map<string, Partial<Record<StageCode, number>>>();
  for (const row of outsideResult.data) {
    if (row.is_included_in_resume_total === false) continue;
    const stageCode = dashboardRowStage(row);
    const totals = outsideByProject.get(row.project_id) ?? {};
    totals[stageCode] = (totals[stageCode] ?? 0) + dashboardRowAmount(row);
    outsideByProject.set(row.project_id, totals);
  }

  const missingByProject = new Map<string, Partial<Record<StageCode, number>>>();
  for (const row of missingResult.data) {
    if (row.is_included_in_resume_total === false) continue;
    const stageCode = dashboardRowStage(row);
    const totals = missingByProject.get(row.project_id) ?? {};
    totals[stageCode] = (totals[stageCode] ?? 0) + dashboardRowAmount(row);
    missingByProject.set(row.project_id, totals);
  }

  const dashboardNotaStats = buildDashboardNotaStats([
    ...((notesResult.data ?? []) as DashboardNoteRow[]),
    ...((customNotesResult.data ?? []) as DashboardNoteRow[]),
  ]);
  const notaCountByProject = new Map<string, number>();
  for (const row of dashboardNotaStats) {
    notaCountByProject.set(row.projectId, (notaCountByProject.get(row.projectId) ?? 0) + row.count);
  }

  const dashboardProjectStats = projectIds.map((projectId): DashboardProjectStats => {
    const summary = summaryByProject.get(projectId);
    if (!summary) {
      const stageTotals = missingByProject.get(projectId) ?? {};
      return {
        projectId,
        stageTotals,
        grandTotal: Object.values(stageTotals).reduce((sum, value) => sum + (value ?? 0), 0),
        notaCount: notaCountByProject.get(projectId) ?? 0,
      };
    }

    const outsideTotal = toNumber(summary.total_diluar_konstruksi);
    const outsideStages = outsideByProject.get(projectId) ?? {};
    const tahap6 = outsideStages.TAHAP_VI ?? 0;
    const tahap7 = outsideStages.TAHAP_VII ?? 0;
    const outsideResidual = outsideTotal - tahap6 - tahap7;
    const stageTotals: Partial<Record<StageCode, number>> = {
      TAHAP_I: toNumber(summary.total_tahap_1),
      TAHAP_II: toNumber(summary.total_tahap_2),
      TAHAP_III: toNumber(summary.total_tahap_3),
      TAHAP_IV: toNumber(summary.total_tahap_4),
      TAHAP_VI: tahap6 + outsideResidual,
      TAHAP_VII: tahap7,
    };
    const grandTotal = toNumber(summary.total_keseluruhan);
    stageTotals.TAHAP_V = grandTotal
      - (stageTotals.TAHAP_I ?? 0)
      - (stageTotals.TAHAP_II ?? 0)
      - (stageTotals.TAHAP_III ?? 0)
      - (stageTotals.TAHAP_IV ?? 0)
      - outsideTotal;
    return { projectId, stageTotals, grandTotal, notaCount: notaCountByProject.get(projectId) ?? 0 };
  });

  const bundle: ProjectBundle = {
    projects: projectsData.map((row) => rowToProject(row, [])),
    generatedNotas: [],
    kwitansiEdits: [],
    customNotes: [],
    history: [],
    source: "supabase",
    dashboardProjectStats,
    dashboardNotaStats,
    dashboardSummaryOnly: true,
  };
  writeCache(bundle, "dashboard");
  return bundle;
}

const inFlightProjectBundles = new Map<string, Promise<ProjectBundle>>();
let inFlightDashboardBundle: Promise<ProjectBundle> | null = null;

async function fetchProjectBundleUncached(projectId?: string): Promise<ProjectBundle> {
  const client = supabase();
  if (!client) {
    const cached = readCachedProjectBundle(projectId);
    return { ...cached, source: cached.source === "seed" ? "seed" : "cache" };
  }

  const projectQuery = client.from("projects").select(PROJECT_SELECT);
  const { data: projectRows, error: projectError } = await (projectId
    ? projectQuery.eq("id", projectId).order("updated_at", { ascending: false })
    : projectQuery.order("updated_at", { ascending: false }));

  if (projectError) throwDatabaseError(projectError, "Gagal menyimpan project.");

  const projectsData = (projectRows ?? []) as ProjectRow[];
  if (projectsData.length === 0) {
    const bundle = emptySupabaseBundle();
    writeCache(bundle, projectId ? `project:${projectId}` : "all");
    return bundle;
  }

  const projectIds = projectsData.map((project) => project.id);
  const [itemsResult, notesResult, editsResult, customResult, historyResult] = await Promise.all([
    fetchAllResumeItemRows(client, projectIds),
    client.from("generated_notes").select(GENERATED_NOTE_SELECT).in("project_id", projectIds).order("created_at", { ascending: false }),
    client.from("kwitansi_edits").select(KWITANSI_EDIT_SELECT).in("project_id", projectIds),
    client.from("custom_notes").select(CUSTOM_NOTE_SELECT).in("project_id", projectIds).order("created_at", { ascending: false }),
    client.from("note_history").select(HISTORY_SELECT).in("project_id", projectIds).order("created_at", { ascending: false }).limit(500),
  ]);

  if (itemsResult.error) throw itemsResult.error;
  if (notesResult.error) throw notesResult.error;
  if (editsResult.error) throw editsResult.error;
  if (customResult.error) throw customResult.error;
  if (historyResult.error) throw historyResult.error;

  const itemRows = (itemsResult.data ?? []) as ResumeItemRow[];
  const editRows = (editsResult.data ?? []) as KwitansiEditRow[];
  const customNotes = ((customResult.data ?? []) as CustomNoteRow[]).map(rowToCustomNote).filter((row): row is CustomNote => Boolean(row));
  const customDocs = customNotes.map((note) => note.dataJson);

  const bundle: ProjectBundle = {
    projects: projectsData.map((row) => rowToProject(row, itemRows)),
    generatedNotas: [...rowsToGeneratedNotas((notesResult.data ?? []) as GeneratedNoteRow[], editRows), ...customDocs],
    kwitansiEdits: editRows.map(rowToKwitansiEdit),
    customNotes,
    history: rowsToHistory((historyResult.data ?? []) as NoteHistoryRow[]),
    source: "supabase",
  };

  writeCache(bundle, projectId ? `project:${projectId}` : "all");
  return bundle;
}

/** Deduplicate simultaneous page/component refreshes into one Supabase load. */
export function fetchProjectBundle(projectId?: string): Promise<ProjectBundle> {
  const requestKey = projectId ?? "__all__";
  const existingRequest = inFlightProjectBundles.get(requestKey);
  if (existingRequest) return existingRequest;

  const request = withReadTimeout(
    fetchProjectBundleUncached(projectId),
    projectId ? 20_000 : 35_000,
    projectId ? "Pemuatan project" : "Pemuatan seluruh data",
  ).finally(() => {
    inFlightProjectBundles.delete(requestKey);
  });
  inFlightProjectBundles.set(requestKey, request);
  return request;
}

/** Lightweight dashboard load: project metadata, exact totals, and note counters. */
export function fetchDashboardBundle(): Promise<ProjectBundle> {
  if (inFlightDashboardBundle) return inFlightDashboardBundle;
  inFlightDashboardBundle = withReadTimeout(fetchDashboardBundleUncached(), 15_000, "Pemuatan dashboard")
    .finally(() => {
      inFlightDashboardBundle = null;
    });
  return inFlightDashboardBundle;
}

export async function createSupabaseProject(
  input: Pick<Project, "projectName" | "wilayahType" | "villageName" | "districtName" | "regencyName" | "regionName" | "responsibleName" | "projectDate">,
  options: { templateItems?: ResumeItem[]; historyItems?: ResumeItem[] | null } = {},
) {
  const client = ensureClient(supabase());
  const wilayahType = normalizeWilayahType(input.wilayahType);
  const identity = { ...input, wilayahType };
  const invoiceRecipientName = formatProjectRecipientName(identity, "long");
  const invoiceRecipientAddress = formatProjectRecipientAddress(identity);

  const { data: projectRow, error: projectError } = await client
    .from("projects")
    .insert({
      nama_desa: input.villageName,
      jenis_wilayah: wilayahType,
      kecamatan: input.districtName,
      kabupaten: input.regencyName,
      nama_project: input.projectName,
      wilayah: input.regionName,
      kodim: input.regionName,
      tanggal_laporan: input.projectDate,
      project_date: input.projectDate,
      status: "draft",
      metadata_json: {
        template_id: TEMPLATE_ID,
        jenis_wilayah: wilayahType,
        wilayah_type: wilayahType,
        babinsa_responsible_name: input.responsibleName,
        responsible_name: input.responsibleName,
        coordinates: "",
        invoice_recipient_name: invoiceRecipientName,
        invoice_recipient_address: invoiceRecipientAddress,
        target_grand_total_resume: null,
      },
    })
    .select("*")
    .single();

  if (projectError) throw projectError;

  const projectId = (projectRow as ProjectRow).id;
  const rows = buildResumeItemsForNewProject(
    options.templateItems ?? masterTemplateItems,
    input.projectDate,
    options.historyItems,
  ).map((item) => resumeItemToRow(projectId, item));
  const { data: itemRows, error: itemError } = await client.from("resume_items").insert(rows).select("*");

  if (itemError) {
    await client.from("projects").delete().eq("id", projectId);
    throwDatabaseError(itemError, "Gagal membuat resume awal.");
  }

  const project = rowToProject(projectRow as ProjectRow, (itemRows ?? []) as ResumeItemRow[]);
  await saveResumeSummary(project);
  await logHistory(client, project.id, "project_created", `Project ${formatProjectRecipientName(project, "long")} dibuat.`);
  return project;
}

export async function saveProjectMetadata(project: Project) {
  const client = ensureClient(supabase());
  const { error } = await client.from("projects").update(projectToRow(project)).eq("id", project.id);
  if (error) throw error;
  await saveResumeStructure(project);
}

export async function saveResumeItem(projectId: string, item: ResumeItem) {
  const client = ensureClient(supabase());
  const { error } = await client.from("resume_items").update(resumeItemToRow(projectId, item)).eq("id", item.id);
  if (error) throw error;
}

export async function createResumeItem(projectId: string, item: ResumeItem) {
  const client = ensureClient(supabase());
  const { data, error } = await client.from("resume_items").insert(resumeItemToRow(projectId, item)).select("*").single();
  if (error) throw error;
  return rowToResumeItem(data as ResumeItemRow);
}

export async function deleteResumeItem(itemId: string) {
  const client = ensureClient(supabase());
  const { error } = await client.from("resume_items").delete().eq("id", itemId);
  if (error) throw error;
}

export async function saveResumeSummary(project: Project) {
  const client = supabase();
  if (!client) return;
  const totals = summarizeProject(project);
  const { error } = await client
    .from("resume_summaries")
    .upsert(
      {
        project_id: project.id,
        total_tahap_1: totals.totalTahap1,
        total_tahap_2: totals.totalTahap2,
        total_tahap_3: totals.totalTahap3,
        total_tahap_4: totals.totalTahap4,
        total_diluar_konstruksi: totals.totalDiluarKonstruksi,
        total_keseluruhan: totals.totalKeseluruhan,
        terbilang: totals.terbilang,
      },
      { onConflict: "project_id" },
    );
  if (error) throw error;
}

export async function deleteSupabaseProject(projectId: string) {
  const client = ensureClient(supabase());
  const { error } = await client.from("projects").delete().eq("id", projectId);
  if (error) throw error;
}

export async function duplicateSupabaseProject(source: Project) {
  const client = ensureClient(supabase());
  const copy = await createSupabaseProject({
    projectName: source.projectName,
    wilayahType: source.wilayahType,
    villageName: `${source.villageName} Copy`,
    districtName: source.districtName,
    regencyName: source.regencyName,
    regionName: source.regionName,
    responsibleName: source.responsibleName,
    projectDate: source.projectDate,
  });

  const copiedItems = source.items.map((item, index) => ({
    ...item,
    id: crypto.randomUUID(),
    sortOrder: index + 1,
  }));

  await client.from("resume_items").delete().eq("project_id", copy.id);
  const { data, error } = await client.from("resume_items").insert(copiedItems.map((item) => resumeItemToRow(copy.id, item))).select("*");
  if (error) throw error;

  const project = {
    ...copy,
    items: ((data ?? []) as ResumeItemRow[]).map(rowToResumeItem),
  };
  await saveResumeSummary(project);
  await logHistory(client, project.id, "project_duplicated", `Project disalin dari ${formatProjectRecipientName(source, "long")}.`);
  return project;
}

export async function replaceSupabaseProjectResume(
  project: Project,
  items: ResumeItem[],
  description = "Resume project diperbarui dari import resume.",
) {
  const client = ensureClient(supabase());

  const { error: deleteNotesError } = await client
    .from("generated_notes")
    .delete()
    .eq("project_id", project.id)
    .not("auto_key", "is", null);
  if (deleteNotesError) throw deleteNotesError;

  await client.from("resume_categories").delete().eq("project_id", project.id);
  await client.from("resume_stages").delete().eq("project_id", project.id);

  const { error: deleteItemsError } = await client.from("resume_items").delete().eq("project_id", project.id);
  if (deleteItemsError) throw deleteItemsError;

  const rows = items.map((item, index) => resumeItemToRow(project.id, { ...item, sortOrder: index + 1, isGeneratedToNote: false, noteId: null }));
  const { data, error } = await client.from("resume_items").insert(rows).select("*");
  if (error) throw error;

  const nextProject: Project = {
    ...project,
    status: "draft",
    updatedAt: new Date().toISOString(),
    items: ((data ?? []) as ResumeItemRow[]).map(rowToResumeItem).sort((a, b) => a.sortOrder - b.sortOrder),
  };

  await saveProjectMetadata(nextProject);
  await saveResumeSummary(nextProject);
  await logHistory(client, project.id, "resume_reimported", description);
  return nextProject;
}

export async function reimportSupabaseProjectResume(project: Project) {
  return replaceSupabaseProjectResume(
    project,
    buildResumeItemsForNewProject(masterTemplateItems, project.projectDate, project.items),
    "Resume project diimport ulang dari master resume terbaru.",
  );
}

async function generateAndPersistAutoDocuments(
  project: Project,
  templateAssignments: TemplateAssignment[] = ALL_TEMPLATE_ASSIGNMENTS,
  documentKind: "nota" | "kwitansi",
  sourceProject: Project = project,
) {
  const client = ensureClient(supabase());
  const generatedDocs = documentKind === "kwitansi"
    ? generateKwitansiDocuments(project, vendors, templateAssignments)
    : generateNotaDocuments(project, vendors, templateAssignments);

  const { data: projectGeneratedData, error: oldError } = await client
    .from("generated_notes")
    .select("*")
    .eq("project_id", project.id);
  if (oldError) throw oldError;

  const projectGeneratedRows = (projectGeneratedData ?? []) as GeneratedNoteRow[];
  const oldRows = documentKind === "kwitansi"
    ? projectGeneratedRows.filter(isGeneratedKwitansiRow)
    : projectGeneratedRows.filter((row) => row.document_type === "nota" && !isGeneratedKwitansiRow(row));

  // Rule lama menyimpan PLN sebagai kwitansi tahapan. Saat nota diregenerate,
  // ambil baris lama itu juga agar edit manual dapat dibawa ke dokumen nota PLN
  // pengganti sebelum baris lama dibersihkan.
  let legacyPlnRows: GeneratedNoteRow[] = [];
  if (documentKind === "nota") {
    const { data: legacyRows, error: legacyError } = await client
      .from("generated_notes")
      .select("*")
      .eq("project_id", project.id)
      .eq("document_type", "kwitansi")
      .eq("vendor_id", "vendor-pln")
      .eq("template_id", "template-pln");
    if (legacyError) throw legacyError;
    legacyPlnRows = (legacyRows ?? []) as GeneratedNoteRow[];
  }

  const oldGeneratedRows = [...oldRows, ...legacyPlnRows];
  const oldIds = oldGeneratedRows.map((row) => row.id);
  let oldEditRows: KwitansiEditRow[] = [];
  if (oldIds.length > 0) {
    const { data: editData, error: editError } = await client.from("kwitansi_edits").select("*").in("note_id", oldIds);
    if (editError) throw editError;
    oldEditRows = (editData ?? []) as KwitansiEditRow[];
  }

  const oldRowByAutoKey = new Map(
    oldGeneratedRows
      .filter((row) => Boolean(row.auto_key))
      .map((row) => [row.auto_key as string, row] as const),
  );
  const oldRowsBySourceItemIds = new Map<string, GeneratedNoteRow[]>();
  for (const row of oldGeneratedRows) {
    const key = sourceItemIdsKey(row.source_resume_item_ids);
    if (!key) continue;
    oldRowsBySourceItemIds.set(key, [...(oldRowsBySourceItemIds.get(key) ?? []), row]);
  }
  const oldEditByAutoKey = new Map(
    oldEditRows
      .map((edit) => {
        const row = oldGeneratedRows.find((entry) => entry.id === edit.note_id);
        return row?.auto_key ? ([row.auto_key, edit] as const) : null;
      })
      .filter((entry): entry is readonly [string, KwitansiEditRow] => Boolean(entry)),
  );
  const oldEditByNoteId = new Map(oldEditRows.map((edit) => [edit.note_id, edit]));
  const legacyPlnRowByPrintOrder = new Map(
    legacyPlnRows
      .map((row) => {
        const parsed = parseGeneratedNota(row.data_json);
        return parsed?.printOrder ? ([parsed.printOrder, row] as const) : null;
      })
      .filter((entry): entry is readonly [number, GeneratedNoteRow] => Boolean(entry)),
  );

  if (documentKind === "kwitansi") {
    const debugDoc = (doc: GeneratedNota) => ({
      id: doc.id,
      group: doc.kwitansiGroupCode,
      stage: doc.stageCode,
      item: doc.items.map((item) => item.itemName).join(" + "),
      amount: doc.totalAmount,
      sourceItemIds: doc.itemIds,
    });
    console.info("[kwitansi:regenerate] classification", {
      resumeItemCount: project.items.length,
      staleReceiptCount: oldGeneratedRows.length,
      tahap4Items: generatedDocs.filter((doc) => doc.stageCode === "TAHAP_IV").map(debugDoc),
      luarIntiItems: generatedDocs.filter((doc) => doc.stageCode === "RESUME_ALL").map(debugDoc),
      receiptsToInsert: generatedDocs.map(debugDoc),
    });
  }

  if (oldGeneratedRows.length > 0) {
    const { error: deleteError } = await client
      .from("generated_notes")
      .delete()
      .in("id", oldIds);
    if (deleteError) throw deleteError;
  }

  if (documentKind === "nota") {
    const { error: resetGeneratedFlagError } = await client
      .from("resume_items")
      .update({ is_generated_to_note: false, note_id: null })
      .eq("project_id", project.id);
    if (resetGeneratedFlagError) throw resetGeneratedFlagError;
  }

  const carriedEditByNewAutoKey = new Map<string, KwitansiEditRow>();
  const rows = generatedDocs.map((doc) => {
    const autoKey = generatedNoteAutoKey(doc);
    const legacyAutoKey = legacyGeneratedNoteAutoKey(doc);
    const migratedPlnRow = documentKind === "nota" && doc.isSpecialKwitansi
      ? legacyPlnRowByPrintOrder.get(doc.printOrder ?? 0)
      : undefined;
    const sourceRows = documentKind === "kwitansi"
      ? oldRowsBySourceItemIds.get(sourceItemIdsKey(doc.itemIds)) ?? []
      : [];
    const migratedSourceRow = sourceRows.length === 1
      ? sourceRows[0]
      : undefined;
    const oldRow = oldRowByAutoKey.get(autoKey)
      ?? (documentKind === "nota" ? oldRowByAutoKey.get(legacyAutoKey) : undefined)
      ?? migratedPlnRow
      ?? migratedSourceRow;
    const matchedOldEdit = oldEditByAutoKey.get(autoKey)
      ?? (documentKind === "nota" ? oldEditByAutoKey.get(legacyAutoKey) : undefined)
      ?? (migratedPlnRow ? oldEditByNoteId.get(migratedPlnRow.id) : undefined)
      ?? (migratedSourceRow ? oldEditByNoteId.get(migratedSourceRow.id) : undefined);
    const oldEdit = matchedOldEdit && doc.id.includes("-worker-") && migratedSourceRow
      ? identityOnlyKwitansiEdit(matchedOldEdit)
      : matchedOldEdit;
    if (oldEdit) carriedEditByNewAutoKey.set(autoKey, oldEdit);
    const preserveOldReceiver = isPreservedReceiverEdit(oldEdit);
    const data: GeneratedNota = {
      ...doc,
      id: oldRow?.id ?? doc.id,
      status: "generated",
      source: "auto",
      kwitansiReceiverName: preserveOldReceiver ? oldEdit?.nama_penerima : doc.kwitansiReceiverName,
      warnaTemplate: oldEdit ? oldEdit.warna_template : doc.warnaTemplate,
    };

    return {
      project_id: project.id,
      tahap: generatedNoteStageForStorage(doc),
      vendor: doc.vendorName,
      vendor_id: doc.vendorId,
      template_id: doc.templateId,
      document_type: doc.documentType,
      source_resume_item_ids: doc.itemIds,
      data_json: data,
      total: doc.totalAmount,
      status: "generated",
      auto_key: autoKey,
    };
  });

  if (rows.length === 0) {
    if (documentKind === "nota") {
      await client.from("projects").update({ status: "review" }).eq("id", project.id);
      await saveResumeSummary({ ...sourceProject, status: "review" });
    }
    await logHistory(
      client,
      project.id,
      documentKind === "nota" ? "notes_generated" : "kwitansi_generated",
      documentKind === "nota"
        ? "Tidak ada nota otomatis dibuat karena belum ada item resume yang punya vendor/template."
        : "Tidak ada kwitansi otomatis dibuat karena belum ada item KWITANSI pada resume.",
    );
    return [];
  }

  const { data: insertedRows, error: insertError } = await client.from("generated_notes").insert(rows).select("*");
  if (insertError) throw insertError;

  const inserted = (insertedRows ?? []) as GeneratedNoteRow[];
  if (documentKind === "kwitansi") {
    const { data: persistedData, error: verificationError } = await client
      .from("generated_notes")
      .select("id,tahap")
      .eq("project_id", project.id)
      .eq("document_type", "kwitansi");
    const persistedRows = (persistedData ?? []) as Array<Pick<GeneratedNoteRow, "id" | "tahap">>;
    if (verificationError) console.warn("[kwitansi:regenerate] verification query failed", verificationError);
    console.info("[kwitansi:regenerate] persisted", {
      insertedCount: inserted.length,
      tahap4Count: inserted.filter((row) => asStageCode(row.tahap) === "TAHAP_IV").length,
      luarIntiCount: inserted.filter((row) => asStageCode(row.tahap) === "RESUME_ALL").length,
      databaseReceiptCount: verificationError ? null : persistedRows.length,
      databaseLuarIntiCount: verificationError ? null : persistedRows.filter((row) => asStageCode(row.tahap) === "RESUME_ALL").length,
      persistedGroups: inserted.map((row) => ({ id: row.id, group: row.tahap, autoKey: row.auto_key })),
    });
  }
  const docsByAutoKey = new Map(generatedDocs.map((doc) => [generatedNoteAutoKey(doc), doc]));

  if (documentKind === "nota") {
    for (const row of inserted) {
      const doc = row.auto_key ? docsByAutoKey.get(row.auto_key) : undefined;
      if (!doc || doc.itemIds.length === 0) continue;
      const { error: flagError } = await client
        .from("resume_items")
        .update({ is_generated_to_note: true, note_id: row.id })
        .in("id", doc.itemIds);
      if (flagError) throw flagError;
    }
  }

  const carriedEdits = inserted
    .map((row) => {
      const oldEdit = row.auto_key ? oldEditByAutoKey.get(row.auto_key) ?? carriedEditByNewAutoKey.get(row.auto_key) : undefined;
      if (!oldEdit) return null;
      const doc = row.auto_key ? docsByAutoKey.get(row.auto_key) : undefined;
      const preserveOldReceiver = isPreservedReceiverEdit(oldEdit);
      const receiverName = preserveOldReceiver ? oldEdit.nama_penerima : doc?.kwitansiReceiverName ?? oldEdit.nama_penerima ?? "";
      const customData = doc ? withoutSpecialPlnAmountEdit(doc, asRecord(oldEdit.custom_data_json)) : oldEdit.custom_data_json ?? {};
      const nextCustomData = receiverName && !preserveOldReceiver
        ? { ...customData, receiver_source: "auto" }
        : customData;
      return {
        project_id: project.id,
        note_id: row.id,
        nama_penerima: receiverName,
        warna_template: oldEdit.warna_template,
        custom_data_json: nextCustomData,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  if (carriedEdits.length > 0) {
    const { error: editsError } = await client.from("kwitansi_edits").upsert(carriedEdits, { onConflict: "note_id" });
    if (editsError) throw editsError;
  }

  await client.from("projects").update({ status: "generated" }).eq("id", project.id);
  await saveResumeSummary({ ...sourceProject, status: "generated" });
  await logHistory(
    client,
    project.id,
    documentKind === "nota" ? "notes_generated" : "kwitansi_generated",
    documentKind === "nota"
      ? `${inserted.length} nota otomatis dibuat dari resume.`
      : `${inserted.length} kwitansi tahapan otomatis dibuat dari resume.`,
  );

  const refreshedEdits = carriedEdits.map((edit) => ({
    id: "",
    project_id: edit.project_id,
    note_id: edit.note_id,
    nama_penerima: edit.nama_penerima,
    warna_template: edit.warna_template,
    custom_data_json: edit.custom_data_json,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })) as KwitansiEditRow[];

  return rowsToGeneratedNotas(inserted, refreshedEdits);
}

export async function generateAndPersistNotes(
  project: Project,
  templateAssignments: TemplateAssignment[] = ALL_TEMPLATE_ASSIGNMENTS,
  sourceProject: Project = project,
) {
  return generateAndPersistAutoDocuments(project, templateAssignments, "nota", sourceProject);
}

export async function generateAndPersistKwitansi(project: Project, templateAssignments: TemplateAssignment[] = ALL_TEMPLATE_ASSIGNMENTS) {
  return generateAndPersistAutoDocuments(project, templateAssignments, "kwitansi");
}

export async function backfillProjectKwitansiReceivers(projectId: string) {
  const client = ensureClient(supabase());
  const { data: noteData, error: notesError } = await client
    .from("generated_notes")
    .select("*")
    .eq("project_id", projectId)
    .eq("document_type", "kwitansi");
  if (notesError) throw notesError;

  const rows = (noteData ?? []) as GeneratedNoteRow[];
  const noteIds = rows.map((row) => row.id);
  let editRows: KwitansiEditRow[] = [];
  if (noteIds.length > 0) {
    const { data: editData, error: editError } = await client.from("kwitansi_edits").select("*").in("note_id", noteIds);
    if (editError) throw editError;
    editRows = (editData ?? []) as KwitansiEditRow[];
  }

  const editsByNoteId = new Map(editRows.map((row) => [row.note_id, row]));
  let updated = 0;

  for (const row of rows) {
    const parsed = parseGeneratedNota(row.data_json);
    if (!parsed) continue;

    const stageCode = asStageCode(row.tahap);
    const baseDoc: GeneratedNota = {
      ...parsed,
      id: row.id,
      projectId: row.project_id,
      stageCode,
      stageId: stageCode,
      vendorId: row.vendor_id ?? parsed.vendorId,
      vendorName: row.vendor,
      templateId: row.template_id,
      documentType: row.document_type,
      totalAmount: toNumber(row.total),
      subtotal: toNumber(row.total),
      status: row.status,
      source: "auto",
      kwitansiGroupCode: kwitansiGroupForStage(stageCode),
    };
    const edit = editsByNoteId.get(row.id);
    if (isPreservedReceiverEdit(edit)) continue;

    const docForMapping = edit ? applyKwitansiEdit(baseDoc, rowToKwitansiEdit(edit)) : baseDoc;
    const receiver = getAutofillKwitansiReceiver(docForMapping);
    if (!receiver) continue;

    const currentDataJson = asRecord(row.data_json);
    const dataNeedsUpdate = baseDoc.kwitansiReceiverName?.trim() !== receiver;
    let editNeedsUpdate = false;

    if (dataNeedsUpdate) {
      const { error } = await client
        .from("generated_notes")
        .update({ data_json: { ...currentDataJson, kwitansiReceiverName: receiver } })
        .eq("id", row.id);
      if (error) throw error;
    }

    if (edit) {
      const previousCustomData = asRecord(edit.custom_data_json);
      const customData = { ...previousCustomData, receiver_source: "auto" };
      editNeedsUpdate = edit.nama_penerima?.trim() !== receiver || kwitansiReceiverSource(previousCustomData) !== "auto";
      if (editNeedsUpdate) {
        const { error } = await client
          .from("kwitansi_edits")
          .upsert(
            {
              project_id: projectId,
              note_id: row.id,
              nama_penerima: receiver,
              warna_template: edit.warna_template ?? baseDoc.warnaTemplate ?? "default",
              custom_data_json: customData,
            },
            { onConflict: "note_id" },
          );
        if (error) throw error;
      }
    }

    if (dataNeedsUpdate || editNeedsUpdate) updated += 1;
  }

  if (updated > 0) {
    await logHistory(client, projectId, "kwitansi_receivers_backfilled", `${updated} nama penerima kwitansi otomatis diperbarui.`);
  }

  return { checked: rows.length, updated };
}

export async function upsertKwitansiEdit(projectId: string, noteId: string, input: KwitansiEditInput) {
  const client = ensureClient(supabase());
  const { data: existingData, error: existingError } = await client
    .from("kwitansi_edits")
    .select("*")
    .eq("note_id", noteId)
    .maybeSingle();
  if (existingError) throw existingError;

  const existing = existingData as KwitansiEditRow | null;
  const customData: JsonRecord = {
    ...asRecord(existing?.custom_data_json),
    prepared_for_template_variants: true,
  };
  if (hasOwnInput(input, "noKwitansi")) customData.no_kwitansi = input.noKwitansi ?? "";
  if (hasOwnInput(input, "namaPemberi")) customData.nama_pemberi = input.namaPemberi ?? "";
  if (hasOwnInput(input, "keterangan")) customData.keterangan = input.keterangan ?? "";
  if (hasOwnInput(input, "jabatan")) customData.jabatan = input.jabatan ?? "";
  if (hasOwnInput(input, "catatan")) customData.catatan = input.catatan ?? "";
  if (hasOwnInput(input, "nominal")) customData.nominal = input.nominal ?? null;
  if (hasOwnInput(input, "uangSejumlah")) customData.uang_sejumlah = input.uangSejumlah ?? "";
  if (hasOwnInput(input, "tanggalKwitansi")) customData.tanggal_kwitansi = input.tanggalKwitansi ?? "";
  if (hasOwnInput(input, "kota")) customData.kota = input.kota ?? "";
  if (hasOwnInput(input, "namaPenerima")) customData.receiver_source = input.receiverSource ?? "manual";
  if (hasOwnInput(input, "receiverSyncKey")) {
    customData.receiver_sync_key = input.receiverSyncKey ?? "";
    const slot = /_(1|2|3|4)$/.exec(input.receiverSyncKey ?? "")?.[1];
    if (slot) customData.worker_slot = Number(slot);
    else delete customData.worker_slot;
  }

  const { data, error } = await client
    .from("kwitansi_edits")
    .upsert(
      {
        project_id: projectId,
        note_id: noteId,
        nama_penerima: hasOwnInput(input, "namaPenerima") ? input.namaPenerima ?? "" : existing?.nama_penerima ?? "",
        warna_template: hasOwnInput(input, "warnaTemplate") ? input.warnaTemplate ?? "default" : existing?.warna_template ?? "default",
        custom_data_json: customData,
      },
      { onConflict: "note_id" },
    )
    .select("*")
    .single();
  if (error) throw error;
  await logHistory(client, projectId, "kwitansi_edited", "Data edit kwitansi diperbarui.");
  return rowToKwitansiEdit(data as KwitansiEditRow);
}

export async function createCustomNote(project: Project, input: CustomNoteInput) {
  const client = ensureClient(supabase());
  const vendor = vendorById(input.vendorId) ?? vendors[0];
  const template = findTemplateDefinition(input.templateId);
  const assignment = resolveTemplateAssignment(input.stageCode, input.vendorId, ALL_TEMPLATE_ASSIGNMENTS);
  const amountOverride = typeof input.jumlahOverride === "number" && Number.isFinite(input.jumlahOverride) ? input.jumlahOverride : null;
  const item: ResumeItem = {
    id: `custom-item-${crypto.randomUUID()}`,
    stageCode: input.stageCode,
    stageName: getStageLabel(input.stageCode),
    category: "Nota tambahan",
    expenseDate: input.tanggal,
    itemName: input.uraian,
    volume: input.qty,
    unit: input.satuan,
    unitPrice: input.hargaSatuan,
    amountOverride,
    vendorId: vendor.id,
    vendorName: vendor.name,
    notes: input.alasan ?? "",
    sortOrder: 1,
    sourceFile: null,
    sourceType: "manual",
    isManualAdded: true,
    isIncludedInResumeTotal: false,
    isGeneratedToNote: true,
  };
  const total = getResumeItemAmount(item);
  const documentType = template?.documentType ?? assignment?.documentType ?? (vendor.type === "labor" ? "kwitansi" : "nota");
  const doc: GeneratedNota = {
    id: `custom-note-${crypto.randomUUID()}`,
    projectId: project.id,
    stageId: input.stageCode,
    stageCode: input.stageCode,
    stageName: getStageLabel(input.stageCode),
    vendorId: vendor.id,
    vendorName: vendor.name,
    vendor,
    documentType,
    templateId: input.templateId,
    templateName: template?.label ?? assignment?.templateId ?? "Template Nota Kosong",
    categoryNames: ["Nota tambahan"],
    tanggal: input.tanggal,
    notaDate: input.tanggal,
    subtotal: total,
    totalAmount: total,
    terbilang: terbilangRupiah(total),
    items: [item],
    itemIds: [item.id],
    projectMeta: projectMeta(project),
    source: "custom",
    status: "generated",
    customReason: input.alasan,
  };

  const { data, error } = await client
    .from("custom_notes")
    .insert({
      project_id: project.id,
      tahap: input.stageCode,
      vendor: vendor.name,
      vendor_id: vendor.id,
      template_id: input.templateId,
      document_type: documentType,
      data_json: doc,
      total,
      alasan: input.alasan ?? "",
    })
    .select("*")
    .single();
  if (error) throw error;

  await logHistory(client, project.id, "custom_note_created", `Nota tambahan ${vendor.name} dibuat.`);
  const customNote = rowToCustomNote(data as CustomNoteRow);
  if (!customNote) throw new Error("Gagal membaca data nota tambahan.");
  return customNote;
}

export function mergeBundleWithGenerated(
  bundle: ProjectBundle,
  projectId: string,
  generatedDocs: GeneratedNota[],
  documentKind: "nota" | "kwitansi" = "nota",
) {
  const generatedItemToNote = new Map(generatedDocs.flatMap((doc) => doc.itemIds.map((itemId) => [itemId, doc.id] as const)));
  const movesPlnToNota = documentKind === "nota"
    && generatedDocs.some((doc) => doc.isSpecialKwitansi && doc.vendorId === "vendor-pln");

  return {
    ...bundle,
    projects: bundle.projects.map((project) => (
      project.id === projectId
        ? {
          ...project,
          status: documentKind === "nota" ? (generatedDocs.length > 0 ? "generated" as const : "review" as const) : project.status,
          items: documentKind === "nota"
            ? project.items.map((item) => ({
              ...item,
              isGeneratedToNote: generatedItemToNote.has(item.id),
              noteId: generatedItemToNote.get(item.id) ?? null,
            }))
            : project.items,
        }
        : project
    )),
    generatedNotas: [
      ...bundle.generatedNotas.filter((doc) => {
        if (doc.projectId !== projectId || doc.source === "custom") return true;
        if (movesPlnToNota && doc.documentType === "kwitansi" && doc.vendorId === "vendor-pln") return false;
        return doc.documentType !== documentKind;
      }),
      ...generatedDocs,
    ],
  };
}

export function cacheProjectBundle(bundle: ProjectBundle) {
  writeCache(bundle);
}
