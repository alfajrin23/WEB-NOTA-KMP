"use client";

import { SupabaseClient } from "@supabase/supabase-js";
import { ALL_TEMPLATE_ASSIGNMENTS, findTemplateDefinition, resolveTemplateAssignment } from "@/constants/template-mapping";
import { getStageLabel } from "@/constants/stages";
import { initialProjects, masterTemplateItems, vendors } from "@/constants/seed-data";
import { generateKwitansiDocuments, generateNotaDocuments } from "@/lib/nota-generator";
import { shiftResumeItemsFromDefault } from "@/lib/project-date-shift";
import { buildResumeItemsForNewProject } from "@/lib/resume-history";
import { buildProjectSummary, getResumeItemAmount } from "@/lib/resume-calculations";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  CustomNote,
  GeneratedNota,
  KwitansiEdit,
  NoteHistoryEntry,
  Project,
  ProjectMeta,
  ResumeItem,
  ResumeSummaryTotals,
  StageCode,
  TemplateAssignment,
} from "@/types/domain";
import { terbilangRupiah } from "@/utils/format";

const CACHE_KEY = "kdkmp.supabase.bundle.v1";
const TEMPLATE_ID = "master-template-kdkmp-v1";

type JsonRecord = Record<string, unknown>;

type ProjectRow = {
  id: string;
  nama_desa: string;
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

export type ProjectBundle = {
  projects: Project[];
  generatedNotas: GeneratedNota[];
  kwitansiEdits: KwitansiEdit[];
  customNotes: CustomNote[];
  history: NoteHistoryEntry[];
  source: "supabase" | "cache" | "seed";
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

function asStageCode(value: string | undefined | null): StageCode {
  if (value === "TAHAP_I" || value === "TAHAP_II" || value === "TAHAP_III" || value === "TAHAP_IV" || value === "RESUME_ALL") {
    return value;
  }
  return "TAHAP_I";
}

function vendorById(vendorId: string | undefined | null) {
  return vendors.find((vendor) => vendor.id === vendorId);
}

function vendorIdByName(name: string | undefined | null) {
  const normalized = (name ?? "").trim().toLowerCase();
  return vendors.find((vendor) => {
    const names = [vendor.name, ...(vendor.aliases ?? [])].map((entry) => entry.toLowerCase());
    return names.includes(normalized);
  })?.id;
}

function projectMeta(project: Project): ProjectMeta {
  return {
    projectName: project.projectName,
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
  const stageCode = asStageCode(row.tahap);
  const vendorId = row.vendor_id ?? vendorIdByName(row.vendor) ?? "";

  return {
    id: row.id,
    stageCode,
    stageName: row.stage_name ?? getStageLabel(stageCode),
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
    vendorName: row.vendor ?? "",
    notes: row.notes ?? "",
    sortOrder: row.urutan,
    sourceFile: row.source_file,
    sourcePage: row.source_page,
    sourceRow: row.source_row,
    sourceType: row.source_type ?? "seed",
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
  const projectItemRows = itemRows.filter((item) => item.project_id === row.id);
  const items = projectItemRows
    .map(rowToResumeItem)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const updatedAt = latestTimestamp([row.updated_at, ...projectItemRows.map((item) => item.updated_at)]);

  return {
    id: row.id,
    templateId: asString(meta.template_id, TEMPLATE_ID),
    projectName: row.nama_project,
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
    invoiceRecipientName: asString(meta.invoice_recipient_name, `KDKMP Desa ${row.nama_desa}`),
    invoiceRecipientAddress: asString(meta.invoice_recipient_address, `Desa ${row.nama_desa}, Kec. ${row.kecamatan}, Kab. ${row.kabupaten}`),
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
  return {
    nama_desa: project.villageName,
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
    totalDiluarKonstruksi: byStage.get("RESUME_ALL") ?? 0,
    totalKeseluruhan: summary.grandTotal,
    terbilang: terbilangRupiah(summary.grandTotal),
  };
}

function stageSortOrder(stageCode: StageCode) {
  const order: StageCode[] = ["TAHAP_I", "TAHAP_II", "TAHAP_III", "TAHAP_IV", "RESUME_ALL"];
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

function legacyGeneratedNoteAutoKey(doc: Pick<GeneratedNota, "stageCode" | "vendorId" | "templateId">) {
  return `${doc.stageCode}:${doc.vendorId}:${doc.templateId}`;
}

function parseGeneratedNota(value: unknown): GeneratedNota | null {
  const record = asRecord(value);
  if (!record.projectId || !Array.isArray(record.items)) return null;
  return record as GeneratedNota;
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
  if (!edit) return doc;
  const custom = asRecord(edit.customDataJson);
  return {
    ...doc,
    kwitansiReceiverName: edit.namaPenerima,
    kwitansiNumber: customString(custom, "no_kwitansi", doc.kwitansiNumber),
    kwitansiPayerName: customString(custom, "nama_pemberi", doc.kwitansiPayerName),
    kwitansiPaymentDescription: customString(custom, "keterangan", doc.kwitansiPaymentDescription),
    kwitansiRoleName: customString(custom, "jabatan", doc.kwitansiRoleName),
    kwitansiNote: customString(custom, "catatan", doc.kwitansiNote),
    kwitansiAmount: Object.prototype.hasOwnProperty.call(custom, "nominal") ? asOptionalNumber(custom.nominal) : doc.kwitansiAmount,
    kwitansiAmountWords: customString(custom, "uang_sejumlah", doc.kwitansiAmountWords),
    kwitansiDate: customString(custom, "tanggal_kwitansi", doc.kwitansiDate),
    kwitansiCity: customString(custom, "kota", doc.kwitansiCity),
    warnaTemplate: edit.warnaTemplate,
  };
}

function rowsToGeneratedNotas(rows: GeneratedNoteRow[], editRows: KwitansiEditRow[]): GeneratedNota[] {
  const editsByNoteId = new Map(editRows.map((row) => [row.note_id, rowToKwitansiEdit(row)]));

  return rows
    .map((row) => {
      const parsed = parseGeneratedNota(row.data_json);
      if (!parsed) return null;
      const doc: GeneratedNota = {
        ...parsed,
        id: row.id,
        projectId: row.project_id,
        stageCode: asStageCode(row.tahap),
        stageId: asStageCode(row.tahap),
        vendorId: row.vendor_id ?? parsed.vendorId,
        vendorName: row.vendor,
        templateId: row.template_id,
        documentType: row.document_type,
        totalAmount: toNumber(row.total),
        subtotal: toNumber(row.total),
        status: row.status,
        source: "auto",
      };
      return applyKwitansiEdit(doc, editsByNoteId.get(row.id));
    })
    .filter((doc): doc is GeneratedNota => Boolean(doc));
}

function rowToCustomNote(row: CustomNoteRow): CustomNote | null {
  const parsed = parseGeneratedNota(row.data_json);
  if (!parsed) return null;
  const vendor = vendorById(row.vendor_id) ?? vendors.find((entry) => entry.name === row.vendor) ?? vendors[0];
  const doc: GeneratedNota = {
    ...parsed,
    id: row.id,
    projectId: row.project_id,
    stageCode: asStageCode(row.tahap),
    stageId: asStageCode(row.tahap),
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

function readCache(): ProjectBundle | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(CACHE_KEY);
    return value ? (JSON.parse(value) as ProjectBundle) : null;
  } catch {
    return null;
  }
}

function writeCache(bundle: ProjectBundle) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CACHE_KEY, JSON.stringify(bundle));
}

export function readCachedProjectBundle(): ProjectBundle {
  return readCache() ?? {
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

export async function fetchProjectBundle(): Promise<ProjectBundle> {
  const client = supabase();
  if (!client) {
    const cached = readCachedProjectBundle();
    return { ...cached, source: cached.source === "seed" ? "seed" : "cache" };
  }

  const { data: projectRows, error: projectError } = await client
    .from("projects")
    .select("*")
    .order("updated_at", { ascending: false });

  if (projectError) throwDatabaseError(projectError, "Gagal menyimpan project.");

  const projectsData = (projectRows ?? []) as ProjectRow[];
  if (projectsData.length === 0) {
    const bundle = emptySupabaseBundle();
    writeCache(bundle);
    return bundle;
  }

  const projectIds = projectsData.map((project) => project.id);
  const [itemsResult, notesResult, editsResult, customResult, historyResult] = await Promise.all([
    client.from("resume_items").select("*").in("project_id", projectIds).order("urutan", { ascending: true }),
    client.from("generated_notes").select("*").in("project_id", projectIds).order("created_at", { ascending: false }),
    client.from("kwitansi_edits").select("*").in("project_id", projectIds),
    client.from("custom_notes").select("*").in("project_id", projectIds).order("created_at", { ascending: false }),
    client.from("note_history").select("*").in("project_id", projectIds).order("created_at", { ascending: false }).limit(500),
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

  writeCache(bundle);
  return bundle;
}

export async function createSupabaseProject(
  input: Pick<Project, "projectName" | "villageName" | "districtName" | "regencyName" | "regionName" | "responsibleName" | "projectDate">,
  options: { templateItems?: ResumeItem[]; historyItems?: ResumeItem[] | null } = {},
) {
  const client = ensureClient(supabase());
  const invoiceRecipientName = `KDKMP Desa ${input.villageName}`;
  const invoiceRecipientAddress = `Desa ${input.villageName}, Kec. ${input.districtName}, Kab. ${input.regencyName}`;

  const { data: projectRow, error: projectError } = await client
    .from("projects")
    .insert({
      nama_desa: input.villageName,
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
  await logHistory(client, project.id, "project_created", `Project Desa ${project.villageName} dibuat.`);
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
  await logHistory(client, project.id, "project_duplicated", `Project disalin dari Desa ${source.villageName}.`);
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
    shiftResumeItemsFromDefault(masterTemplateItems, project.projectDate),
    "Resume project diimport ulang dari master resume terbaru.",
  );
}

async function generateAndPersistAutoDocuments(
  project: Project,
  templateAssignments: TemplateAssignment[] = ALL_TEMPLATE_ASSIGNMENTS,
  documentKind: "nota" | "kwitansi",
) {
  const client = ensureClient(supabase());
  const generatedDocs = documentKind === "kwitansi"
    ? generateKwitansiDocuments(project, vendors, templateAssignments)
    : generateNotaDocuments(project, vendors, templateAssignments);

  const { data: oldRows, error: oldError } = await client
    .from("generated_notes")
    .select("*")
    .eq("project_id", project.id)
    .eq("document_type", documentKind)
    .not("auto_key", "is", null);
  if (oldError) throw oldError;

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
      .eq("template_id", "template-pln")
      .not("auto_key", "is", null);
    if (legacyError) throw legacyError;
    legacyPlnRows = (legacyRows ?? []) as GeneratedNoteRow[];
  }

  const oldGeneratedRows = [...((oldRows ?? []) as GeneratedNoteRow[]), ...legacyPlnRows];
  const oldIds = oldGeneratedRows.map((row) => row.id);
  let oldEditRows: KwitansiEditRow[] = [];
  if (oldIds.length > 0) {
    const { data: editData, error: editError } = await client.from("kwitansi_edits").select("*").in("note_id", oldIds);
    if (editError) throw editError;
    oldEditRows = (editData ?? []) as KwitansiEditRow[];
  }

  const oldRowByAutoKey = new Map(oldGeneratedRows.map((row) => [row.auto_key, row]));
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

  if (oldGeneratedRows.length > 0) {
    const { error: deleteError } = await client
      .from("generated_notes")
      .delete()
      .eq("project_id", project.id)
      .eq("document_type", documentKind)
      .not("auto_key", "is", null);
    if (deleteError) throw deleteError;
  }

  if (documentKind === "nota" && legacyPlnRows.length > 0) {
    const { error: legacyDeleteError } = await client
      .from("generated_notes")
      .delete()
      .eq("project_id", project.id)
      .eq("document_type", "kwitansi")
      .eq("vendor_id", "vendor-pln")
      .eq("template_id", "template-pln")
      .not("auto_key", "is", null);
    if (legacyDeleteError) throw legacyDeleteError;
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
    const oldRow = oldRowByAutoKey.get(autoKey)
      ?? (documentKind === "nota" ? oldRowByAutoKey.get(legacyAutoKey) : undefined)
      ?? migratedPlnRow;
    const oldEdit = oldEditByAutoKey.get(autoKey)
      ?? (documentKind === "nota" ? oldEditByAutoKey.get(legacyAutoKey) : undefined)
      ?? (migratedPlnRow ? oldEditByNoteId.get(migratedPlnRow.id) : undefined);
    if (oldEdit) carriedEditByNewAutoKey.set(autoKey, oldEdit);
    const data: GeneratedNota = {
      ...doc,
      id: oldRow?.id ?? doc.id,
      status: "generated",
      source: "auto",
      kwitansiReceiverName: oldEdit?.nama_penerima,
      warnaTemplate: oldEdit?.warna_template,
    };

    return {
      project_id: project.id,
      tahap: doc.stageCode,
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
      await saveResumeSummary({ ...project, status: "review" });
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
      return {
        project_id: project.id,
        note_id: row.id,
        nama_penerima: oldEdit.nama_penerima,
        warna_template: oldEdit.warna_template,
        custom_data_json: oldEdit.custom_data_json ?? {},
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  if (carriedEdits.length > 0) {
    const { error: editsError } = await client.from("kwitansi_edits").upsert(carriedEdits, { onConflict: "note_id" });
    if (editsError) throw editsError;
  }

  await client.from("projects").update({ status: "generated" }).eq("id", project.id);
  await saveResumeSummary({ ...project, status: "generated" });
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

export async function generateAndPersistNotes(project: Project, templateAssignments: TemplateAssignment[] = ALL_TEMPLATE_ASSIGNMENTS) {
  return generateAndPersistAutoDocuments(project, templateAssignments, "nota");
}

export async function generateAndPersistKwitansi(project: Project, templateAssignments: TemplateAssignment[] = ALL_TEMPLATE_ASSIGNMENTS) {
  return generateAndPersistAutoDocuments(project, templateAssignments, "kwitansi");
}

export async function upsertKwitansiEdit(projectId: string, noteId: string, input: KwitansiEditInput) {
  const client = ensureClient(supabase());
  const customData = {
    prepared_for_template_variants: true,
    no_kwitansi: input.noKwitansi ?? "",
    nama_pemberi: input.namaPemberi ?? "",
    keterangan: input.keterangan ?? "",
    jabatan: input.jabatan ?? "",
    catatan: input.catatan ?? "",
    nominal: input.nominal ?? null,
    uang_sejumlah: input.uangSejumlah ?? "",
    tanggal_kwitansi: input.tanggalKwitansi ?? "",
    kota: input.kota ?? "",
  };
  const { data, error } = await client
    .from("kwitansi_edits")
    .upsert(
      {
        project_id: projectId,
        note_id: noteId,
        nama_penerima: input.namaPenerima ?? "",
        warna_template: input.warnaTemplate ?? "default",
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
