import type { SupabaseClient } from "@supabase/supabase-js";
import { getStageLabel } from "../../constants/stages";
import type { Project, ProjectStatus, ResumeItem, StageCode, WilayahType } from "../../types/domain";
import { formatProjectRecipientAddress, formatProjectRecipientName, normalizeWilayahType } from "../../utils/format";
import { createSupabaseAdminClient } from "../supabase/admin";
import { buildDestinationKdkmp, formatKdkmpIdentity, isMaleberSource, SOURCE_KDKMP } from "./kdkmp";
import { buildBelanjaPayload, validateBelanjaPayload } from "./payload";
import {
  MIN_COPY_RECONCILE_RUNNER_VERSION,
  isBelanjaRunnerVersionSupported,
  unsupportedBelanjaRunnerVersionMessage,
} from "./runner-version";
import { isBelanjaItemActive, nextFailedBelanjaStatus, shouldQueueBelanjaItem } from "./status";
import {
  BELANJA_COPY_RECONCILE_OPERATION,
  buildBelanjaIdempotencyKey,
  buildBelanjaTransactionPlan,
  DEFAULT_BELANJA_BASE_TRANSACTION_COUNT,
  summarizeBelanjaTransactionPlan,
} from "./transaction-plan";
import type {
  BelanjaCopyReconcileStage,
  BelanjaProjectSyncState,
  BelanjaRunnerHeartbeat,
  BelanjaSyncJobProgress,
  BelanjaSyncItem,
  BelanjaSyncItemStatus,
  BelanjaSyncJob,
  BelanjaSyncJobStatus,
  BelanjaSyncOperationType,
  BelanjaSyncOverviewProject,
  BelanjaSyncReport,
  BelanjaTransactionPayload,
  ClaimedBelanjaSyncItem,
  ClaimedBelanjaSyncJob,
  CreateBelanjaSyncJobInput,
} from "./types";

const PROJECT_SELECT = "id,nama_desa,jenis_wilayah,kecamatan,kabupaten,nama_project,wilayah,kodim,tanggal_laporan,project_date,metadata_json,status,created_at,updated_at";
const RESUME_ITEM_SELECT = "id,project_id,tahap,stage_id,stage_name,category_code,category_name,item_no,kategori,tanggal,uraian,qty,satuan,harga_satuan,jumlah,jumlah_override,is_jumlah_manual,vendor,vendor_id,source_file,source_page,source_row,is_manual_added,is_included_in_resume_total,is_generated_to_note,note_id,category_total,stage_total,source_type,validation_status,notes,urutan,created_at,updated_at";
const JOB_SELECT = "id,project_id,status,dry_run,total_items,success_items,failed_items,skipped_items,created_at,updated_at,started_at,finished_at,error_message,metadata_json";
const ITEM_SELECT = "id,job_id,project_id,source_resume_item_id,status,attempt_count,max_attempts,target_reference,payload_json,error_message,started_at,finished_at,created_at,updated_at,metadata_json";
const HEARTBEAT_SELECT = "runner_id,status,target_status,dry_run,last_seen_at,target_base_url,message,metadata_json";
const PROJECT_OVERVIEW_SELECT = "project_id,latest_job_created_at,latest_job_json,failed_details";
const RUNNER_ONLINE_WINDOW_MS = 120_000;
const STALE_PROCESSING_WINDOW_MS = 30 * 60_000;
const ACTIVE_QUEUE_REASON = "Item sudah ada di antrean aktif, tidak dibuat duplikat.";

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
  tanggal_laporan: string | null;
  project_date: string;
  metadata_json: JsonRecord | null;
  status: ProjectStatus;
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

type BelanjaJobRow = {
  id: string;
  project_id: string;
  status: BelanjaSyncJobStatus;
  dry_run: boolean | null;
  total_items: number | null;
  success_items: number | null;
  failed_items: number | null;
  skipped_items: number | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  metadata_json: JsonRecord | null;
};

type BelanjaItemRow = {
  id: string;
  job_id: string;
  project_id: string;
  source_resume_item_id: string;
  status: BelanjaSyncItemStatus;
  attempt_count: number | null;
  max_attempts: number | null;
  target_reference: string | null;
  payload_json: JsonRecord;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
  metadata_json: JsonRecord | null;
};

type BelanjaHeartbeatRow = {
  runner_id: string;
  status: BelanjaRunnerHeartbeat["status"];
  target_status: BelanjaRunnerHeartbeat["targetStatus"];
  dry_run: boolean | null;
  last_seen_at: string;
  target_base_url: string | null;
  message: string | null;
  metadata_json: JsonRecord | null;
};

type BelanjaOverviewFailedStatus = Extract<BelanjaSyncItemStatus, "failed" | "needs_review">;

type BelanjaOverviewFailedDetailRow = {
  sourceResumeItemId?: unknown;
  itemName?: unknown;
  tanggal?: unknown;
  jumlah?: unknown;
  status?: unknown;
  errorMessage?: unknown;
  updatedAt?: unknown;
};

type BelanjaProjectOverviewRow = {
  project_id: string;
  latest_job_created_at: string;
  latest_job_json: BelanjaJobRow | null;
  failed_details: BelanjaOverviewFailedDetailRow[] | null;
};

function clientOrThrow(): SupabaseClient {
  const client = createSupabaseAdminClient();
  if (!client) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY belum dikonfigurasi di server. Belanja Sync memakai service role hanya di API server, bukan di browser.");
  }
  return client;
}

function nowIso() {
  return new Date().toISOString();
}

function toNumber(value: number | string | null | undefined) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asOptionalString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asCopyStage(value: unknown): BelanjaCopyReconcileStage | null {
  if (
    value === "PRE_FLIGHT" ||
    value === "SOURCE_OPENED" ||
    value === "SOURCE_SELECTED" ||
    value === "COPY_STARTED" ||
    value === "COPY_CONFIRMED" ||
    value === "DESTINATION_COPIED" ||
    value === "RECONCILING" ||
    value === "VERIFYING" ||
    value === "COMPLETED" ||
    value === "FAILED"
  ) {
    return value;
  }
  return null;
}

function operationTypeFromMetadata(metadata: JsonRecord): BelanjaSyncOperationType | string {
  return asString(metadata.operation_type || metadata.operationType, "legacy_item_submit");
}

function isCopyReconcileMetadata(metadata: JsonRecord) {
  return operationTypeFromMetadata(metadata) === BELANJA_COPY_RECONCILE_OPERATION;
}

function isCopyReconcileJobRow(row: BelanjaJobRow | null | undefined) {
  return Boolean(row && isCopyReconcileMetadata(asRecord(row.metadata_json)));
}

function buildProgress(stage: BelanjaCopyReconcileStage, patch: Partial<BelanjaSyncJobProgress> = {}): BelanjaSyncJobProgress {
  return {
    stage,
    ...patch,
    updatedAt: patch.updatedAt ?? nowIso(),
  };
}

function asStageCode(value: string | null | undefined): StageCode {
  if (
    value === "TAHAP_I" ||
    value === "TAHAP_II" ||
    value === "TAHAP_III" ||
    value === "TAHAP_IV" ||
    value === "TAHAP_V" ||
    value === "TAHAP_VI" ||
    value === "TAHAP_VII" ||
    value === "RESUME_ALL"
  ) {
    return value;
  }
  return "TAHAP_I";
}

function isSchemaMissingError(error: { code?: string; message?: string } | null | undefined) {
  const message = error?.message ?? "";
  return Boolean(
    error?.code === "PGRST205" ||
    error?.code === "42P01" ||
    /schema cache|relation .*(belanja_sync_|belanja_runner_).*does not exist|could not find .*belanja_sync_|could not find .*belanja_runner_/i.test(message),
  );
}

function throwDatabaseError(error: { code?: string; message?: string } | null | undefined, fallback: string): never {
  if (isSchemaMissingError(error)) {
    throw new Error(`${error?.message ?? fallback}. Jalankan migration supabase/migrations/20260901_belanja_sync.sql terlebih dahulu.`);
  }
  throw new Error(error?.message ?? fallback);
}

function isActiveItemUniqueViolation(error: { code?: string; message?: string } | null | undefined) {
  return error?.code === "23505" && /belanja_sync_items_active_once_idx/i.test(error.message ?? "");
}

function rowToResumeItem(row: ResumeItemRow): ResumeItem {
  const stageCode = asStageCode(row.tahap);
  return {
    id: row.id,
    stageCode,
    stageName: row.stage_name || getStageLabel(stageCode),
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
    vendorId: row.vendor_id ?? "",
    vendorName: row.vendor,
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

function rowToProject(row: ProjectRow, items: ResumeItem[]): Project {
  const metadata = asRecord(row.metadata_json);
  const wilayahType = normalizeWilayahType(row.jenis_wilayah ?? asString(metadata.wilayah_type)) as WilayahType;
  const identity = {
    wilayahType,
    villageName: row.nama_desa,
    districtName: row.kecamatan,
    regencyName: row.kabupaten,
    invoiceRecipientName: asString(metadata.invoice_recipient_name),
    invoiceRecipientAddress: asString(metadata.invoice_recipient_address),
  };

  return {
    id: row.id,
    templateId: asString(metadata.template_id, "master-template-kdkmp-v1"),
    projectName: row.nama_project,
    wilayahType,
    villageName: row.nama_desa,
    districtName: row.kecamatan,
    regencyName: row.kabupaten,
    regionName: row.wilayah,
    projectDate: row.project_date,
    reportDate: row.tanggal_laporan ?? row.project_date,
    responsibleName: asString(metadata.babinsa_responsible_name, asString(metadata.responsible_name)),
    coordinates: asString(metadata.coordinates),
    invoiceRecipientName: formatProjectRecipientName(identity, "long"),
    invoiceRecipientAddress: formatProjectRecipientAddress(identity),
    targetGrandTotal: typeof metadata.target_grand_total_resume === "number" ? metadata.target_grand_total_resume : null,
    metadataJson: metadata,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items,
  };
}

function rowToJob(row: BelanjaJobRow): BelanjaSyncJob {
  const metadata = asRecord(row.metadata_json);
  const stage = asCopyStage(metadata.stage);
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    dryRun: row.dry_run ?? true,
    totalItems: row.total_items ?? 0,
    successItems: row.success_items ?? 0,
    failedItems: row.failed_items ?? 0,
    skippedItems: row.skipped_items ?? 0,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorMessage: row.error_message,
    metadataJson: metadata,
    operationType: operationTypeFromMetadata(metadata),
    stage,
    stageMessage: asOptionalString(metadata.stage_message || metadata.stageMessage),
    progress: metadata.progress && typeof metadata.progress === "object" && !Array.isArray(metadata.progress)
      ? metadata.progress as BelanjaSyncJobProgress
      : null,
    report: metadata.report && typeof metadata.report === "object" && !Array.isArray(metadata.report)
      ? metadata.report as BelanjaSyncReport
      : null,
  };
}

function rowToItem(row: BelanjaItemRow): BelanjaSyncItem {
  return {
    id: row.id,
    jobId: row.job_id,
    projectId: row.project_id,
    sourceResumeItemId: row.source_resume_item_id,
    status: row.status,
    attemptCount: row.attempt_count ?? 0,
    maxAttempts: row.max_attempts ?? 3,
    targetReference: row.target_reference,
    payload: row.payload_json as BelanjaSyncItem["payload"],
    errorMessage: row.error_message,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadataJson: row.metadata_json ?? {},
  };
}

function overviewFailedStatus(value: unknown): BelanjaOverviewFailedStatus {
  return value === "needs_review" ? "needs_review" : "failed";
}

function rowToOverviewFailedDetail(row: BelanjaOverviewFailedDetailRow) {
  return {
    sourceResumeItemId: asString(row.sourceResumeItemId),
    itemName: asString(row.itemName),
    tanggal: asString(row.tanggal),
    jumlah: toNumber(row.jumlah as number | string | null | undefined),
    status: overviewFailedStatus(row.status),
    errorMessage: asString(row.errorMessage, "Item gagal tanpa pesan error dari runner."),
    updatedAt: asString(row.updatedAt, nowIso()),
  };
}

function rowToHeartbeat(row: BelanjaHeartbeatRow | null | undefined): BelanjaRunnerHeartbeat | null {
  if (!row) return null;
  const lastSeen = Date.parse(row.last_seen_at);
  return {
    runnerId: row.runner_id,
    status: row.status,
    targetStatus: row.target_status,
    dryRun: row.dry_run ?? true,
    lastSeenAt: row.last_seen_at,
    online: Number.isFinite(lastSeen) && Date.now() - lastSeen <= RUNNER_ONLINE_WINDOW_MS,
    targetBaseUrl: row.target_base_url,
    message: row.message,
    metadataJson: row.metadata_json ?? {},
  };
}

function latestBySourceItemId(items: BelanjaSyncItem[]) {
  const score: Record<BelanjaSyncItemStatus, number> = {
    processing: 60,
    pending: 55,
    needs_review: 54,
    success: 50,
    failed: 20,
    skipped: 10,
  };
  const latest: Record<string, BelanjaSyncItem> = {};

  for (const item of items) {
    const metadata = asRecord(item.metadataJson);
    const payload = item.payload as unknown as JsonRecord;
    const sourceIds = [
      item.sourceResumeItemId,
      ...asStringArray(metadata.source_resume_item_ids),
      ...asStringArray(payload.sourceResumeItemIds),
    ].filter(Boolean);
    const itemScore = score[item.status] ?? 0;
    for (const sourceId of [...new Set(sourceIds)]) {
      const current = latest[sourceId];
      const currentScore = current ? score[current.status] ?? 0 : -1;
      const itemTime = Date.parse(item.updatedAt || item.createdAt);
      const currentTime = current ? Date.parse(current.updatedAt || current.createdAt) : -1;
      if (!current || itemScore > currentScore || (itemScore === currentScore && itemTime > currentTime)) {
        latest[sourceId] = item;
      }
    }
  }

  return latest;
}

function activeBySourceItemId(items: BelanjaSyncItem[]) {
  const active: Record<string, BelanjaSyncItem> = {};

  for (const item of items) {
    if (!isBelanjaItemActive(item.status)) continue;
    const current = active[item.sourceResumeItemId];
    const itemTime = Date.parse(item.updatedAt || item.createdAt);
    const currentTime = current ? Date.parse(current.updatedAt || current.createdAt) : -1;
    if (!current || itemTime > currentTime) {
      active[item.sourceResumeItemId] = item;
    }
  }

  return active;
}

function hasVerifiedFieldMapProof(status: BelanjaSyncItemStatus, errorMessage: string | null, metadataJson: JsonRecord | null) {
  if (status === "success") return true;
  if (status !== "skipped") return false;
  const metadata = asRecord(metadataJson);
  const fromDryRun = typeof errorMessage === "string" && errorMessage.includes("DRY_RUN_OK");
  const fromMetadata = metadata.comparison != null && metadata.dry_run === true;
  return fromDryRun || fromMetadata;
}

async function hasVerifiedFieldMapInHistory(client: SupabaseClient) {
  const { data, error } = await client
    .from("belanja_sync_items")
    .select("status,error_message,metadata_json")
    .in("status", ["success", "skipped"])
    .order("updated_at", { ascending: false })
    .limit(1000);
  if (error) throwDatabaseError(error, "Gagal memeriksa status verifikasi mapping Belanja.");

  return ((data ?? []) as Array<{
    status: BelanjaSyncItemStatus;
    error_message: string | null;
    metadata_json: JsonRecord | null;
  }>).some((row) => hasVerifiedFieldMapProof(row.status, row.error_message, row.metadata_json));
}

async function getLatestRunnerHeartbeat(client: SupabaseClient) {
  const { data, error } = await client
    .from("belanja_runner_heartbeats")
    .select(HEARTBEAT_SELECT)
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throwDatabaseError(error, "Gagal memuat heartbeat runner.");
  return rowToHeartbeat(data as BelanjaHeartbeatRow | null);
}

async function getLatestCompatibleCopyRunnerHeartbeat(client: SupabaseClient) {
  const onlineSince = new Date(Date.now() - RUNNER_ONLINE_WINDOW_MS).toISOString();
  const { data, error } = await client
    .from("belanja_runner_heartbeats")
    .select(HEARTBEAT_SELECT)
    .gte("last_seen_at", onlineSince)
    .order("last_seen_at", { ascending: false })
    .limit(20);
  if (error) throwDatabaseError(error, "Gagal memuat heartbeat runner.");

  return ((data ?? []) as BelanjaHeartbeatRow[])
    .map(rowToHeartbeat)
    .find((runner): runner is BelanjaRunnerHeartbeat => Boolean(
      runner?.online
      && runner.targetStatus === "connected"
      && isBelanjaRunnerVersionSupported(runnerVersionFromMetadata(asRecord(runner.metadataJson))),
    )) ?? null;
}

async function loadProjectWithItems(client: SupabaseClient, projectId: string, itemIds?: string[]) {
  const { data: projectRow, error: projectError } = await client
    .from("projects")
    .select(PROJECT_SELECT)
    .eq("id", projectId)
    .maybeSingle();
  if (projectError) throwDatabaseError(projectError, "Gagal memuat project.");
  if (!projectRow) throw new Error("Project tidak ditemukan.");

  let query = client
    .from("resume_items")
    .select(RESUME_ITEM_SELECT)
    .eq("project_id", projectId);
  if (itemIds && itemIds.length > 0) query = query.in("id", itemIds);
  const { data: itemRows, error: itemsError } = await query
    .order("urutan", { ascending: true })
    .order("id", { ascending: true });
  if (itemsError) throwDatabaseError(itemsError, "Gagal memuat item resume.");

  const items = ((itemRows ?? []) as ResumeItemRow[]).map(rowToResumeItem);
  return rowToProject(projectRow as ProjectRow, items);
}

async function getJobRow(client: SupabaseClient, jobId: string) {
  const { data, error } = await client
    .from("belanja_sync_jobs")
    .select(JOB_SELECT)
    .eq("id", jobId)
    .maybeSingle();
  if (error) throwDatabaseError(error, "Gagal memuat sync job.");
  return data as BelanjaJobRow | null;
}

async function updateJobRollup(client: SupabaseClient, jobId: string) {
  const job = await getJobRow(client, jobId);
  if (!job) throw new Error("Sync job tidak ditemukan.");

  const { data, error } = await client
    .from("belanja_sync_items")
    .select("status")
    .eq("job_id", jobId);
  if (error) throwDatabaseError(error, "Gagal menghitung status item sync.");

  const statuses = ((data ?? []) as Array<{ status: BelanjaSyncItemStatus }>).map((row) => row.status);
  const successItems = statuses.filter((status) => status === "success").length;
  const skippedItems = statuses.filter((status) => status === "skipped").length;
  const failedItems = statuses.filter((status) => status === "failed" || status === "needs_review").length;
  const pendingItems = statuses.filter((status) => status === "pending").length;
  const processingItems = statuses.filter((status) => status === "processing").length;
  const activeItems = pendingItems + processingItems;
  const timestamp = nowIso();

  let status: BelanjaSyncJobStatus = job.status;
  let finishedAt = job.finished_at;
  if (job.status !== "cancelled") {
    const metadata = asRecord(job.metadata_json);
    const copyStage = asCopyStage(metadata.stage);
    if (isCopyReconcileMetadata(metadata)) {
      if (copyStage === "FAILED") {
        status = "failed";
        finishedAt = job.finished_at ?? timestamp;
      } else if (copyStage !== "COMPLETED") {
        status = job.started_at ? "processing" : "pending";
        finishedAt = null;
      } else {
        status = failedItems > 0 ? "completed_with_errors" : "completed";
        finishedAt = job.finished_at ?? timestamp;
      }
    } else {
      if (activeItems > 0) status = job.started_at || processingItems > 0 ? "processing" : "pending";
      else status = failedItems > 0 ? "completed_with_errors" : "completed";
      finishedAt = activeItems > 0 ? null : (job.finished_at ?? timestamp);
    }
  }

  const { data: updated, error: updateError } = await client
    .from("belanja_sync_jobs")
    .update({
      status,
      total_items: statuses.length,
      success_items: successItems,
      failed_items: failedItems,
      skipped_items: skippedItems,
      finished_at: finishedAt,
    })
    .eq("id", jobId)
    .select(JOB_SELECT)
    .single();
  if (updateError) throwDatabaseError(updateError, "Gagal memperbarui rollup sync job.");
  return rowToJob(updated as BelanjaJobRow);
}

export async function getBelanjaProjectState(projectId: string): Promise<BelanjaProjectSyncState> {
  try {
    const client = clientOrThrow();
    await markStaleProcessingItems(client);
    await markStaleCopyReconcileJobs(client);
    const [itemsResult, jobsResult, runner] = await Promise.all([
      client
        .from("belanja_sync_items")
        .select(ITEM_SELECT)
        .eq("project_id", projectId)
        .order("created_at", { ascending: false }),
      client
        .from("belanja_sync_jobs")
        .select(JOB_SELECT)
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(20),
      getLatestRunnerHeartbeat(client),
    ]);

    if (itemsResult.error) throwDatabaseError(itemsResult.error, "Gagal memuat item Belanja Sync.");
    if (jobsResult.error) throwDatabaseError(jobsResult.error, "Gagal memuat job Belanja Sync.");

    const items = ((itemsResult.data ?? []) as BelanjaItemRow[]).map(rowToItem);
    const jobs = ((jobsResult.data ?? []) as BelanjaJobRow[]).map(rowToJob);
    return {
      projectId,
      schemaReady: true,
      jobs,
      items,
      latestBySourceItemId: latestBySourceItemId(items),
      runner,
      activeJob: jobs.find((job) => job.status === "pending" || job.status === "processing") ?? null,
    };
  } catch (error) {
    if (error instanceof Error && /SUPABASE_SERVICE_ROLE_KEY|migration|schema|belanja_sync_|belanja_runner_/i.test(error.message)) {
      return {
        projectId,
        schemaReady: false,
        jobs: [],
        items: [],
        latestBySourceItemId: {},
        runner: null,
        activeJob: null,
        errorMessage: error.message,
      };
    }
    throw error;
  }
}

type BelanjaOverviewJobCounts = Pick<BelanjaSyncJob, "status" | "totalItems" | "successItems" | "failedItems" | "skippedItems">;

export function overviewStatusFromJob(job: BelanjaOverviewJobCounts): BelanjaSyncOverviewProject["status"] {
  if (job.status === "failed" || job.status === "completed_with_errors" || job.failedItems > 0) {
    return "ada_error";
  }
  if (job.status === "pending" || job.status === "processing") {
    return "sebagian";
  }
  if (job.status === "cancelled") {
    return job.successItems > 0 ? "sebagian" : "belum_dikirim";
  }
  const completedItems = job.successItems + job.skippedItems;
  if (job.totalItems > 0 && completedItems >= job.totalItems) {
    return "selesai";
  }
  if (completedItems > 0) {
    return "sebagian";
  }
  return "belum_dikirim";
}

export function overviewPendingItemsFromJob(job: BelanjaOverviewJobCounts) {
  if (job.status === "cancelled") {
    return Math.max(job.totalItems - job.successItems - job.failedItems, 0);
  }
  return Math.max(job.totalItems - job.successItems - job.failedItems - job.skippedItems, 0);
}

export async function getBelanjaSyncOverview() {
  try {
    const client = clientOrThrow();
    await markStaleProcessingItems(client);
    await markStaleCopyReconcileJobs(client);
    const [overviewResult, runner] = await Promise.all([
      client
        .from("belanja_sync_project_overview_v1")
        .select(PROJECT_OVERVIEW_SELECT)
        .order("latest_job_created_at", { ascending: false })
        .limit(300),
      getLatestRunnerHeartbeat(client),
    ]);
    if (overviewResult.error) throwDatabaseError(overviewResult.error, "Gagal memuat overview job Belanja Sync.");

    const projects = ((overviewResult.data ?? []) as BelanjaProjectOverviewRow[])
      .map((row): BelanjaSyncOverviewProject | null => {
        if (!row.latest_job_json) return null;
        const job = rowToJob(row.latest_job_json);
        const failedDetails = (row.failed_details ?? []).map(rowToOverviewFailedDetail);
        const pendingItems = overviewPendingItemsFromJob(job);
        return {
          projectId: job.projectId,
          status: overviewStatusFromJob(job),
          totalItems: job.totalItems,
          successItems: job.successItems,
          failedItems: job.failedItems,
          pendingItems,
          latestJob: job,
          failedDetails,
        };
      })
      .filter((project): project is BelanjaSyncOverviewProject => Boolean(project));

    return { schemaReady: true, runner, projects };
  } catch (error) {
    if (error instanceof Error && /SUPABASE_SERVICE_ROLE_KEY|migration|schema|belanja_sync_|belanja_runner_/i.test(error.message)) {
      return { schemaReady: false, runner: null, projects: [], errorMessage: error.message };
    }
    throw error;
  }
}

export async function getBelanjaRunnerQueueCount() {
  const client = clientOrThrow();
  await markStaleProcessingItems(client);
  await markStaleCopyReconcileJobs(client);

  const { data: jobRows, error: jobsError } = await client
    .from("belanja_sync_jobs")
    .select("id,metadata_json")
    .eq("status", "pending")
    .limit(1000);
  if (jobsError) throwDatabaseError(jobsError, "Gagal menghitung antrean job Belanja Sync.");

  const pendingCopyJobs = ((jobRows ?? []) as Array<{ id: string; metadata_json: JsonRecord | null }>)
    .filter((row) => isCopyReconcileMetadata(asRecord(row.metadata_json)))
    .length;

  const { data: itemRows, error: itemsError } = await client
    .from("belanja_sync_items")
    .select("id,job_id")
    .eq("status", "pending")
    .limit(1000);
  if (itemsError) throwDatabaseError(itemsError, "Gagal menghitung antrean item Belanja Sync.");

  const pendingItems = (itemRows ?? []) as Array<{ id: string; job_id: string }>;
  const jobIds = [...new Set(pendingItems.map((item) => item.job_id).filter(Boolean))];
  let pendingLegacyItems = 0;

  for (let index = 0; index < jobIds.length; index += 1000) {
    const chunk = jobIds.slice(index, index + 1000);
    const { data: relatedJobs, error: relatedError } = await client
      .from("belanja_sync_jobs")
      .select("id,status,metadata_json")
      .in("id", chunk);
    if (relatedError) throwDatabaseError(relatedError, "Gagal memuat job aktif Belanja Sync.");

    const activeLegacyJobIds = new Set(((relatedJobs ?? []) as Array<{
      id: string;
      status: BelanjaSyncJobStatus;
      metadata_json: JsonRecord | null;
    }>)
      .filter((job) => isActiveJobStatus(job.status) && !isCopyReconcileMetadata(asRecord(job.metadata_json)))
      .map((job) => job.id));
    pendingLegacyItems += pendingItems.filter((item) => activeLegacyJobIds.has(item.job_id)).length;
  }

  return {
    pendingCount: pendingCopyJobs + pendingLegacyItems,
    pendingCopyJobs,
    pendingLegacyItems,
  };
}

async function createLegacyBelanjaSyncJob(input: CreateBelanjaSyncJobInput) {
  const client = clientOrThrow();
  await markStaleProcessingItems(client);
  const uniqueItemIds = [...new Set(input.itemIds.filter(Boolean))];
  if (!input.projectId) throw new Error("projectId wajib diisi.");
  if (uniqueItemIds.length === 0) throw new Error("Pilih minimal satu item resume.");

  const project = await loadProjectWithItems(client, input.projectId, uniqueItemIds);
  const foundItemIds = new Set(project.items.map((item) => item.id));
  const missingItemIds = uniqueItemIds.filter((itemId) => !foundItemIds.has(itemId));
  if (missingItemIds.length > 0) throw new Error(`${missingItemIds.length} item resume tidak ditemukan pada project ini.`);

  const { data: existingRows, error: existingError } = await client
    .from("belanja_sync_items")
    .select(ITEM_SELECT)
    .eq("project_id", input.projectId)
    .in("source_resume_item_id", uniqueItemIds)
    .order("created_at", { ascending: false });
  if (existingError) throwDatabaseError(existingError, "Gagal mengecek status Belanja Sync lama.");

  const existingItems = ((existingRows ?? []) as BelanjaItemRow[]).map(rowToItem);
  const existingBySource = latestBySourceItemId(existingItems);
  const activeBySource = activeBySourceItemId(existingItems);
  const timestamp = nowIso();
  // Mapping target Belanja bersifat global untuk seluruh project. Setelah satu
  // dry run berhasil, PC runner lain tidak perlu mengulang verifikasi hanya
  // karena mengirim project/desa yang berbeda.
  const fieldMapVerified = input.dryRun === false && await hasVerifiedFieldMapInHistory(client);
  const itemRows = project.items.map((item) => {
    const existing = existingBySource[item.id];
    const activeExisting = activeBySource[item.id];
    const payload = buildBelanjaPayload(project, item);
    const validation = validateBelanjaPayload(payload);
    let status: BelanjaSyncItemStatus = "pending";
    let errorMessage: string | null = null;
    const queueDecision = activeExisting
      ? { queue: false, reason: ACTIVE_QUEUE_REASON }
      : shouldQueueBelanjaItem(existing?.status, input.forceResend);

    if (!queueDecision.queue) {
      status = "skipped";
      errorMessage = queueDecision.reason;
    } else if (!validation.valid) {
      status = "failed";
      errorMessage = validation.errors.join(" ");
    }

    return {
      project_id: input.projectId,
      source_resume_item_id: item.id,
      status,
      attempt_count: 0,
      max_attempts: 3,
      target_reference: status === "skipped" && existing?.status === "success" ? existing?.targetReference ?? null : null,
      payload_json: payload,
      error_message: errorMessage,
      started_at: null,
      finished_at: status === "pending" ? null : timestamp,
      metadata_json: {
        validation,
        force_resend: input.forceResend ?? false,
        source_snapshot_at: timestamp,
        field_map_verified: fieldMapVerified,
      },
    };
  });

  const pendingCount = itemRows.filter((row) => row.status === "pending").length;
  const failedCount = itemRows.filter((row) => row.status === "failed").length;
  const skippedCount = itemRows.filter((row) => row.status === "skipped").length;
  const jobStatus: BelanjaSyncJobStatus = pendingCount > 0 ? "pending" : failedCount > 0 ? "completed_with_errors" : "completed";
  const { data: jobRow, error: jobError } = await client
    .from("belanja_sync_jobs")
    .insert({
      project_id: input.projectId,
      status: jobStatus,
      dry_run: input.dryRun ?? true,
      total_items: itemRows.length,
      success_items: 0,
      failed_items: failedCount,
      skipped_items: skippedCount,
      finished_at: pendingCount > 0 ? null : timestamp,
      metadata_json: {
        force_resend: input.forceResend ?? false,
        created_from: "web",
        field_map_verified: fieldMapVerified,
        field_map_verified_source: fieldMapVerified ? "project_history" : "unverified",
      },
    })
    .select(JOB_SELECT)
    .single();
  if (jobError) throwDatabaseError(jobError, "Gagal membuat Belanja Sync job.");

  const job = jobRow as BelanjaJobRow;
  const rowsWithJob = itemRows.map((row) => ({ ...row, job_id: job.id }));
  let activeDuplicateCount = 0;

  for (const row of rowsWithJob) {
    const { error: itemError } = await client.from("belanja_sync_items").insert(row);
    if (!itemError) continue;

    if (isActiveItemUniqueViolation(itemError)) {
      activeDuplicateCount += 1;
      const { error: skippedError } = await client.from("belanja_sync_items").insert({
        ...row,
        status: "skipped" as const,
        error_message: ACTIVE_QUEUE_REASON,
        finished_at: nowIso(),
      });
      if (!skippedError) continue;

      await client
        .from("belanja_sync_jobs")
        .update({ status: "failed", error_message: skippedError.message, finished_at: nowIso() })
        .eq("id", job.id);
      throwDatabaseError(skippedError, "Gagal membuat item Belanja Sync.");
    }

    await client
      .from("belanja_sync_jobs")
      .update({ status: "failed", error_message: itemError.message, finished_at: nowIso() })
      .eq("id", job.id);
    throwDatabaseError(itemError, "Gagal membuat item Belanja Sync.");
  }

  const refreshedJob = await updateJobRollup(client, job.id);
  const state = await getBelanjaProjectState(input.projectId);
  return {
    job: refreshedJob,
    state,
    message: activeDuplicateCount > 0
      ? `${activeDuplicateCount} item dilewati karena masih punya antrean aktif; item lainnya tetap dibuat.`
      : undefined,
  };
}

function isActiveJobStatus(status: BelanjaSyncJobStatus) {
  return status === "pending" || status === "processing";
}

function runnerFieldMapVerified(runner: BelanjaRunnerHeartbeat | null) {
  const metadata = asRecord(runner?.metadataJson);
  return metadata.field_map_verified === true
    || metadata.fieldMapVerified === true
    || metadata.belanja_field_map_verified === true;
}

function runnerVersionFromMetadata(metadata: JsonRecord) {
  return asOptionalString(metadata.runner_version)
    ?? asOptionalString(metadata.runnerVersion)
    ?? asOptionalString(metadata.belanja_runner_version);
}

function assertCopyReconcileRunnerVersion(version: string | null | undefined, runnerId?: string) {
  if (!isBelanjaRunnerVersionSupported(version)) {
    throw new Error(unsupportedBelanjaRunnerVersionMessage(version, runnerId));
  }
}

function activeCopyJobError(job: BelanjaSyncJob, idempotencyKey: string) {
  const metadata = asRecord(job.metadataJson);
  if (metadata.idempotency_key === idempotencyKey) {
    return `Job copy/reconcile yang sama masih aktif (${job.id}). Runner akan melanjutkan checkpoint job tersebut; tidak membuat copy baru.`;
  }
  return `Project ini masih punya job copy/reconcile aktif (${job.id}). Batalkan atau selesaikan job tersebut sebelum membuat job baru agar 43 transaksi tidak tercopy dua kali.`;
}

function isActiveJobIdempotencyViolation(error: { code?: string; message?: string } | null | undefined) {
  return error?.code === "23505" && /belanja_sync_jobs_active_idempotency_idx/i.test(error.message ?? "");
}

export async function createBelanjaSyncJob(input: CreateBelanjaSyncJobInput) {
  if (input.operationType === "legacy_item_submit") return createLegacyBelanjaSyncJob(input);

  const client = clientOrThrow();
  await markStaleProcessingItems(client);
  await markStaleCopyReconcileJobs(client);
  const uniqueItemIds = [...new Set(input.itemIds.filter(Boolean))];
  if (!input.projectId) throw new Error("projectId wajib diisi.");
  if (uniqueItemIds.length === 0) throw new Error("Pilih minimal satu item resume.");

  const runner = await getLatestRunnerHeartbeat(client);
  if (!runner?.online) throw new Error("Runner lokal belum online. Jalankan `npm run belanja:runner` pada PC yang tersambung VPN.");
  const copyRunner = await getLatestCompatibleCopyRunnerHeartbeat(client);
  const runnerForJob = copyRunner ?? runner;
  if (runnerForJob.targetStatus !== "connected") throw new Error("Runner tidak dapat mengakses Web Belanja. Cek VPN, TARGET_BASE_URL, dan login runner.");
  if (!copyRunner) {
    const runnerVersion = runnerVersionFromMetadata(asRecord(runner.metadataJson));
    assertCopyReconcileRunnerVersion(runnerVersion, runner.runnerId);
  }

  const project = await loadProjectWithItems(client, input.projectId, uniqueItemIds);
  const foundItemIds = new Set(project.items.map((item) => item.id));
  const missingItemIds = uniqueItemIds.filter((itemId) => !foundItemIds.has(itemId));
  if (missingItemIds.length > 0) throw new Error(`${missingItemIds.length} item resume tidak ditemukan pada project ini.`);

  const destination = buildDestinationKdkmp(project);
  const destinationIsSource = isMaleberSource(destination);
  if (destinationIsSource) {
    throw new Error("KDKMP tujuan sama dengan source template Maleber. Copy ke Maleber sendiri diblokir agar template tidak berubah dan transaksi tidak duplikat.");
  }
  const expectedTransactionCount = input.expectedTransactionCount ?? DEFAULT_BELANJA_BASE_TRANSACTION_COUNT;
  const plan = buildBelanjaTransactionPlan(project, project.items);
  if (plan.transactionCount !== expectedTransactionCount) {
    throw new Error(`Payload Resume belum membentuk ${expectedTransactionCount} transaksi target. Terdeteksi ${plan.transactionCount} transaksi; copy Maleber dibatalkan sebelum browser mengubah data.`);
  }

  const fieldMapVerifiedFromHistory = input.dryRun === false ? await hasVerifiedFieldMapInHistory(client) : false;
  const fieldMapVerified = input.dryRun === false
    ? fieldMapVerifiedFromHistory || runnerFieldMapVerified(runnerForJob)
    : false;
  if (input.dryRun === false && !fieldMapVerified) {
    throw new Error("Mapping Web Belanja belum diverifikasi. Jalankan dry run sampai DRY_RUN_OK, atau set BELANJA_FIELD_MAP_VERIFIED=true hanya pada runner yang sudah dicek.");
  }

  const idempotencyKey = buildBelanjaIdempotencyKey({
    projectId: input.projectId,
    destination,
    resumeHash: plan.resumeHash,
    operationType: BELANJA_COPY_RECONCILE_OPERATION,
  });

  const { data: activeJobRows, error: activeJobErrorResult } = await client
    .from("belanja_sync_jobs")
    .select(JOB_SELECT)
    .eq("project_id", input.projectId)
    .in("status", ["pending", "processing"])
    .order("created_at", { ascending: false })
    .limit(20);
  if (activeJobErrorResult) throwDatabaseError(activeJobErrorResult, "Gagal memeriksa job aktif Belanja Sync.");
  const activeCopyJob = ((activeJobRows ?? []) as BelanjaJobRow[])
    .map(rowToJob)
    .find((job) => isCopyReconcileMetadata(asRecord(job.metadataJson)));
  if (activeCopyJob) {
    return {
      job: activeCopyJob,
      state: await getBelanjaProjectState(input.projectId),
      message: activeCopyJobError(activeCopyJob, idempotencyKey),
    };
  }

  const representativeSourceIds = plan.transactions.map((transaction) => transaction.sourceItemId);
  const { data: activeItemRows, error: activeItemError } = await client
    .from("belanja_sync_items")
    .select(ITEM_SELECT)
    .eq("project_id", input.projectId)
    .in("source_resume_item_id", representativeSourceIds)
    .in("status", ["pending", "processing", "needs_review"])
    .order("created_at", { ascending: false });
  if (activeItemError) throwDatabaseError(activeItemError, "Gagal memeriksa antrean aktif Belanja Sync.");
  if ((activeItemRows ?? []).length > 0) {
    throw new Error("Masih ada antrean Belanja Sync aktif pada item Resume project ini. Selesaikan atau batalkan antrean lama sebelum membuat copy/reconcile baru.");
  }

  const timestamp = nowIso();
  const progress = buildProgress("PRE_FLIGHT", {
    message: "Menyiapkan data resume dan validasi runner.",
    current: 0,
    total: expectedTransactionCount,
  });
  const report: BelanjaSyncReport = {
    source: SOURCE_KDKMP,
    destination,
    expectedTransactions: expectedTransactionCount,
    copiedTransactions: 0,
    verifiedTransactions: 0,
    materialsUpdated: 0,
    honorariumUpdated: 0,
    equipmentUpdated: 0,
    errors: [],
    status: "PRE_FLIGHT",
  };

  const { data: jobRow, error: jobError } = await client
    .from("belanja_sync_jobs")
    .insert({
      project_id: input.projectId,
      // Keep the job invisible to runners until all transaction items exist.
      status: "processing",
      dry_run: input.dryRun ?? true,
      total_items: plan.transactionCount,
      success_items: 0,
      failed_items: 0,
      skipped_items: 0,
      finished_at: null,
      metadata_json: {
        operation_type: BELANJA_COPY_RECONCILE_OPERATION,
        force_resend: input.forceResend ?? false,
        created_from: "web",
        source_snapshot_at: timestamp,
        source_kdkmp: SOURCE_KDKMP,
        destination_kdkmp: destination,
        destination_is_source: destinationIsSource,
        expected_transactions: expectedTransactionCount,
        plan_summary: summarizeBelanjaTransactionPlan(plan),
        resume_hash: plan.resumeHash,
        idempotency_key: idempotencyKey,
        stage: "PRE_FLIGHT",
        stage_message: progress.message,
        progress,
        report,
        field_map_verified: fieldMapVerified,
        field_map_verified_source: fieldMapVerified
          ? fieldMapVerifiedFromHistory
            ? "project_history"
            : "runner_heartbeat"
          : "unverified",
      },
    })
    .select(JOB_SELECT)
    .single();
  if (jobError) {
    if (isActiveJobIdempotencyViolation(jobError)) {
      const state = await getBelanjaProjectState(input.projectId);
      const existing = state.jobs.find((job) => isActiveJobStatus(job.status) && asRecord(job.metadataJson).idempotency_key === idempotencyKey);
      if (existing) return { job: existing, state, message: activeCopyJobError(existing, idempotencyKey) };
    }
    throwDatabaseError(jobError, "Gagal membuat Belanja Sync job.");
  }

  const job = jobRow as BelanjaJobRow;
  const rowsWithJob = plan.transactions.map((transaction) => ({
    job_id: job.id,
    project_id: input.projectId,
    source_resume_item_id: transaction.sourceItemId,
    status: "pending" as const,
    attempt_count: 0,
    max_attempts: 1,
    target_reference: null,
    payload_json: transaction as unknown as JsonRecord,
    error_message: null,
    started_at: null,
    finished_at: null,
    metadata_json: {
      operation_type: BELANJA_COPY_RECONCILE_OPERATION,
      transaction_id: transaction.transactionId,
      transaction_key: transaction.transactionKey,
      transaction_kind: transaction.kind,
      transaction_identity: transaction.transactionIdentity,
      line_count: transaction.lineCount,
      source_resume_item_ids: transaction.sourceResumeItemIds,
      source_snapshot_at: timestamp,
      field_map_verified: fieldMapVerified,
    },
  }));

  for (const row of rowsWithJob) {
    const { error: itemError } = await client.from("belanja_sync_items").insert(row);
    if (!itemError) continue;

    await client
      .from("belanja_sync_jobs")
      .update({
        status: "failed",
        error_message: itemError.message,
        finished_at: nowIso(),
        metadata_json: {
          ...asRecord(job.metadata_json),
          stage: "FAILED",
          stage_message: "Gagal membuat daftar transaksi sync.",
          report: {
            ...report,
            status: "FAILED",
            errors: [itemError.message],
          },
        },
      })
      .eq("id", job.id);
    throwDatabaseError(itemError, "Gagal membuat item transaksi Belanja Sync.");
  }

  const refreshedJob = await updateJobRollup(client, job.id);
  const state = await getBelanjaProjectState(input.projectId);
  return {
    job: refreshedJob,
    state,
    message: `Job copy/reconcile dibuat: ${plan.transactionCount} transaksi dari template Maleber akan dikirim ke ${formatKdkmpIdentity(destination)}.`,
  };
}

export async function getBelanjaSyncJob(jobId: string) {
  const client = clientOrThrow();
  const [jobResult, itemsResult] = await Promise.all([
    client.from("belanja_sync_jobs").select(JOB_SELECT).eq("id", jobId).maybeSingle(),
    client.from("belanja_sync_items").select(ITEM_SELECT).eq("job_id", jobId).order("created_at", { ascending: true }),
  ]);
  if (jobResult.error) throwDatabaseError(jobResult.error, "Gagal memuat Belanja Sync job.");
  if (itemsResult.error) throwDatabaseError(itemsResult.error, "Gagal memuat item Belanja Sync job.");
  if (!jobResult.data) throw new Error("Belanja Sync job tidak ditemukan.");
  return {
    job: rowToJob(jobResult.data as BelanjaJobRow),
    items: ((itemsResult.data ?? []) as BelanjaItemRow[]).map(rowToItem),
  };
}

export async function resetBelanjaProjectSyncState(projectId: string) {
  const client = clientOrThrow();
  const { data: project, error: projectError } = await client
    .from("projects")
    .select("id,nama_desa,kecamatan")
    .eq("id", projectId)
    .maybeSingle();
  if (projectError) throwDatabaseError(projectError, "Gagal memuat project.");
  if (!project) throw new Error("Project tidak ditemukan.");

  const { data: itemRows, error: itemError } = await client
    .from("belanja_sync_items")
    .delete()
    .eq("project_id", projectId)
    .select("id");
  if (itemError) throwDatabaseError(itemError, "Gagal menghapus item Belanja Sync.");

  const { data: jobRows, error: jobError } = await client
    .from("belanja_sync_jobs")
    .delete()
    .eq("project_id", projectId)
    .select("id");
  if (jobError) throwDatabaseError(jobError, "Gagal menghapus job Belanja Sync.");

  return {
    project,
    deletedItems: itemRows?.length ?? 0,
    deletedJobs: jobRows?.length ?? 0,
    state: await getBelanjaProjectState(projectId),
  };
}

export async function retryFailedBelanjaSyncJob(jobId: string) {
  const client = clientOrThrow();
  const job = await getJobRow(client, jobId);
  if (!job) throw new Error("Belanja Sync job tidak ditemukan.");
  if (job.status === "cancelled") throw new Error("Job yang sudah dibatalkan tidak bisa diretry.");
  const timestamp = nowIso();

  const { data, error } = await client
    .from("belanja_sync_items")
    .select(ITEM_SELECT)
    .eq("job_id", jobId)
    .in("status", ["failed", "needs_review"]);
  if (error) throwDatabaseError(error, "Gagal memuat item gagal.");

  const rows = (data ?? []) as BelanjaItemRow[];
  if (rows.length === 0) {
    const { data: activeRows, error: activeError } = await client
      .from("belanja_sync_items")
      .select("status")
      .eq("job_id", jobId)
      .in("status", ["pending", "processing"]);
    if (activeError) throwDatabaseError(activeError, "Gagal memuat item aktif.");

    const metadata = asRecord(job.metadata_json);
    if ((activeRows ?? []).length > 0 && isCopyReconcileMetadata(metadata)) {
      const retryStage: BelanjaCopyReconcileStage = "DESTINATION_COPIED";
      const retryMessage = "Retry dipulihkan; melanjutkan rekonsiliasi tanpa copy ulang.";
      const { error: resetError } = await client
        .from("belanja_sync_jobs")
        .update({
          status: "pending",
          started_at: null,
          finished_at: null,
          error_message: null,
          metadata_json: {
            ...metadata,
            checkpoint_at: timestamp,
            stage: retryStage,
            stage_message: retryMessage,
            progress: buildProgress(retryStage, {
              ...asRecord(metadata.progress),
              stage: retryStage,
              message: retryMessage,
            }),
            report: {
              ...asRecord(metadata.report),
              status: retryStage,
              errors: [],
            },
          },
        })
        .eq("id", jobId);
      if (resetError) throwDatabaseError(resetError, "Gagal memulihkan status retry job.");
      await updateJobRollup(client, jobId);
    }
    return getBelanjaSyncJob(jobId);
  }

  const sourceIds = rows.map((row) => row.source_resume_item_id);
  const { data: successRows, error: successError } = await client
    .from("belanja_sync_items")
    .select("source_resume_item_id")
    .eq("project_id", job.project_id)
    .eq("status", "success")
    .in("source_resume_item_id", sourceIds);
  if (successError) throwDatabaseError(successError, "Gagal mengecek item yang sudah berhasil.");
  const successIds = new Set(((successRows ?? []) as Array<{ source_resume_item_id: string }>).map((row) => row.source_resume_item_id));
  const retryIds = rows.filter((row) => !successIds.has(row.source_resume_item_id)).map((row) => row.id);
  const skippedIds = rows.filter((row) => successIds.has(row.source_resume_item_id)).map((row) => row.id);

  if (retryIds.length > 0) {
    const { error: retryError } = await client
      .from("belanja_sync_items")
      .update({ status: "pending", attempt_count: 0, error_message: null, started_at: null, finished_at: null })
      .in("id", retryIds);
    if (retryError) throwDatabaseError(retryError, "Gagal retry item gagal.");
  }
  if (skippedIds.length > 0) {
    const { error: skippedError } = await client
      .from("belanja_sync_items")
      .update({ status: "skipped", error_message: "Item sudah SUCCESS pada job lain.", finished_at: timestamp })
      .in("id", skippedIds);
    if (skippedError) throwDatabaseError(skippedError, "Gagal skip item yang sudah berhasil.");
  }

  const metadata = asRecord(job.metadata_json);
  const copyReconcileRetryStage: BelanjaCopyReconcileStage | null = isCopyReconcileMetadata(metadata)
    ? "DESTINATION_COPIED"
    : null;
  const retryMessage = `Retry ${retryIds.length} item gagal; melanjutkan rekonsiliasi tanpa copy ulang.`;

  const { error: retryJobError } = await client
    .from("belanja_sync_jobs")
    .update({
      status: retryIds.length > 0 ? "pending" : job.status,
      started_at: retryIds.length > 0 ? null : job.started_at,
      finished_at: retryIds.length > 0 ? null : job.finished_at,
      error_message: retryIds.length > 0 ? null : job.error_message,
      metadata_json: retryIds.length > 0 && copyReconcileRetryStage
        ? {
            ...metadata,
            checkpoint_at: timestamp,
            stage: copyReconcileRetryStage,
            stage_message: retryMessage,
            progress: buildProgress(copyReconcileRetryStage, {
              ...asRecord(metadata.progress),
              stage: copyReconcileRetryStage,
              message: retryMessage,
            }),
            report: {
              ...asRecord(metadata.report),
              status: copyReconcileRetryStage,
              errors: [],
            },
          }
        : metadata,
    })
    .eq("id", jobId);
  if (retryJobError) throwDatabaseError(retryJobError, "Gagal menyimpan status retry job.");
  await updateJobRollup(client, jobId);
  return getBelanjaSyncJob(jobId);
}

export async function cancelBelanjaSyncJob(jobId: string) {
  const client = clientOrThrow();
  const timestamp = nowIso();
  const { data: job, error: jobError } = await client
    .from("belanja_sync_jobs")
    .update({ status: "cancelled", finished_at: timestamp })
    .eq("id", jobId)
    .select(JOB_SELECT)
    .single();
  if (jobError) throwDatabaseError(jobError, "Gagal membatalkan Belanja Sync job.");

  await client
    .from("belanja_sync_items")
    .update({ status: "skipped", error_message: "Job dibatalkan.", finished_at: timestamp })
    .eq("job_id", jobId)
    .eq("status", "pending");
  await client
    .from("belanja_sync_items")
    .update({ status: "needs_review", error_message: "Job dibatalkan saat item sedang diproses. Cek manual sebelum retry.", finished_at: timestamp })
    .eq("job_id", jobId)
    .eq("status", "processing");

  return rowToJob(job as BelanjaJobRow);
}

export async function recordBelanjaRunnerHeartbeat(input: {
  runnerId: string;
  status: BelanjaRunnerHeartbeat["status"];
  targetStatus: BelanjaRunnerHeartbeat["targetStatus"];
  dryRun: boolean;
  targetBaseUrl?: string | null;
  message?: string | null;
  metadataJson?: Record<string, unknown>;
}) {
  const client = clientOrThrow();
  const metadata = asRecord(input.metadataJson);
  const runnerVersion = runnerVersionFromMetadata(metadata);
  const { data, error } = await client
    .from("belanja_runner_heartbeats")
    .upsert({
      runner_id: input.runnerId,
      status: input.status,
      target_status: input.targetStatus,
      dry_run: input.dryRun,
      target_base_url: input.targetBaseUrl ?? null,
      message: input.message ?? null,
      last_seen_at: nowIso(),
      metadata_json: {
        ...metadata,
        min_copy_reconcile_runner_version: MIN_COPY_RECONCILE_RUNNER_VERSION,
        runner_version_supported: isBelanjaRunnerVersionSupported(runnerVersion),
      },
    }, { onConflict: "runner_id" })
    .select(HEARTBEAT_SELECT)
    .single();
  if (error) throwDatabaseError(error, "Gagal menyimpan heartbeat runner.");
  return rowToHeartbeat(data as BelanjaHeartbeatRow);
}

async function markStaleProcessingItems(client: SupabaseClient) {
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_WINDOW_MS).toISOString();
  const staleUpdate = {
    status: "needs_review" as const,
    error_message: "Runner berhenti saat item processing. Cek target manual sebelum retry agar tidak duplikat.",
    finished_at: nowIso(),
  };
  const staleByStartedAt = await client
    .from("belanja_sync_items")
    .update(staleUpdate)
    .eq("status", "processing")
    .lt("started_at", staleBefore)
    .select("job_id");
  if (staleByStartedAt.error) {
    throwDatabaseError(staleByStartedAt.error, "Gagal menandai stale processing item.");
  }

  const staleByUpdatedAt = await client
    .from("belanja_sync_items")
    .update(staleUpdate)
    .eq("status", "processing")
    .is("started_at", null)
    .lt("updated_at", staleBefore)
    .select("job_id");
  if (staleByUpdatedAt.error) {
    throwDatabaseError(staleByUpdatedAt.error, "Gagal menandai stale processing item.");
  }

  const jobIds = [...new Set([
    ...((staleByStartedAt.data ?? []) as Array<{ job_id: string }>).map((row) => row.job_id),
    ...((staleByUpdatedAt.data ?? []) as Array<{ job_id: string }>).map((row) => row.job_id),
  ])];
  await Promise.all(jobIds.map((jobId) => updateJobRollup(client, jobId)));
}

async function markStaleCopyReconcileJobs(client: SupabaseClient) {
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_WINDOW_MS).toISOString();
  const { data, error } = await client
    .from("belanja_sync_jobs")
    .select(JOB_SELECT)
    .eq("status", "processing")
    .lt("updated_at", staleBefore)
    .order("updated_at", { ascending: true })
    .limit(25);
  if (error) throwDatabaseError(error, "Gagal memeriksa stale job copy/reconcile.");

  for (const row of (data ?? []) as BelanjaJobRow[]) {
    if (!isCopyReconcileJobRow(row)) continue;
    const metadata = asRecord(row.metadata_json);
    const stage = asCopyStage(metadata.stage) ?? "PRE_FLIGHT";
    await client
      .from("belanja_sync_jobs")
      .update({
        status: "pending",
        finished_at: null,
        error_message: null,
        metadata_json: {
          ...metadata,
          stage,
          stage_message: "Runner berhenti saat job berjalan. Job akan dilanjutkan dari checkpoint terakhir.",
          progress: buildProgress(stage, {
            ...asRecord(metadata.progress),
            message: "Runner berhenti saat job berjalan. Job akan dilanjutkan dari checkpoint terakhir.",
          }),
          stale_requeued_at: nowIso(),
        },
      })
      .eq("id", row.id)
      .eq("status", "processing");
  }
}

function readKdkmpMetadata(value: unknown, fallback: { province?: string; regency: string; district: string; village: string }) {
  const metadata = asRecord(value);
  return {
    province: asString(metadata.province, fallback.province ?? SOURCE_KDKMP.province),
    regency: asString(metadata.regency, fallback.regency),
    district: asString(metadata.district, fallback.district),
    village: asString(metadata.village, fallback.village),
    label: asOptionalString(metadata.label) ?? undefined,
  };
}

async function loadBelanjaSyncItemsForJob(client: SupabaseClient, jobId: string) {
  const { data, error } = await client
    .from("belanja_sync_items")
    .select(ITEM_SELECT)
    .eq("job_id", jobId)
    .order("created_at", { ascending: true });
  if (error) throwDatabaseError(error, "Gagal memuat transaksi job Belanja Sync.");
  return ((data ?? []) as BelanjaItemRow[]).map(rowToItem);
}

export async function claimNextBelanjaSyncJob(
  runnerId: string,
  options: { runnerVersion?: string | null } = {},
): Promise<ClaimedBelanjaSyncJob | null> {
  const client = clientOrThrow();
  await markStaleProcessingItems(client);
  await markStaleCopyReconcileJobs(client);

  const { data, error } = await client
    .from("belanja_sync_jobs")
    .select(JOB_SELECT)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(25);
  if (error) throwDatabaseError(error, "Gagal mengambil antrean job Belanja Sync.");

  for (const candidate of (data ?? []) as BelanjaJobRow[]) {
    const metadata = asRecord(candidate.metadata_json);
    if (!isCopyReconcileMetadata(metadata)) continue;
    assertCopyReconcileRunnerVersion(options.runnerVersion, runnerId);

    const timestamp = nowIso();
    const stage = asCopyStage(metadata.stage) ?? "PRE_FLIGHT";
    const { data: updated, error: updateError } = await client
      .from("belanja_sync_jobs")
      .update({
        status: "processing",
        started_at: candidate.started_at ?? timestamp,
        finished_at: null,
        error_message: null,
        metadata_json: {
          ...metadata,
          runner_id: runnerId,
          runner_version: options.runnerVersion ?? null,
          min_runner_version: MIN_COPY_RECONCILE_RUNNER_VERSION,
          claimed_at: timestamp,
          stage,
          stage_message: asString(metadata.stage_message, "Runner mengambil job copy/reconcile."),
          progress: buildProgress(stage, {
            ...asRecord(metadata.progress),
            stage,
            message: asString(metadata.stage_message, "Runner mengambil job copy/reconcile."),
          }),
        },
      })
      .eq("id", candidate.id)
      .eq("status", "pending")
      .select(JOB_SELECT)
      .maybeSingle();
    if (updateError) throwDatabaseError(updateError, "Gagal claim job Belanja Sync.");
    if (!updated) continue;

    let finalJob = rowToJob(updated as BelanjaJobRow);
    const finalMetadata = asRecord(finalJob.metadataJson);
    if (!finalJob.dryRun) {
      const verified = finalMetadata.field_map_verified === true || await hasVerifiedFieldMapInHistory(client);
      if (verified && finalMetadata.field_map_verified !== true) {
        const { data: updatedJob, error: jobMetadataError } = await client
          .from("belanja_sync_jobs")
          .update({
            metadata_json: {
              ...finalMetadata,
              field_map_verified: true,
              field_map_verified_source: finalMetadata.field_map_verified_source ?? "project_history",
            },
          })
          .eq("id", candidate.id)
          .select(JOB_SELECT)
          .single();
        if (!jobMetadataError && updatedJob) finalJob = rowToJob(updatedJob as BelanjaJobRow);
      }
    }

    const items = await loadBelanjaSyncItemsForJob(client, candidate.id);
    const transactions = items
      .map((item) => item.payload as unknown as BelanjaTransactionPayload)
      .sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0));
    return {
      job: finalJob,
      items,
      transactions,
      sourceKdkmp: readKdkmpMetadata(finalMetadata.source_kdkmp, SOURCE_KDKMP),
      destinationKdkmp: readKdkmpMetadata(finalMetadata.destination_kdkmp, {
        province: SOURCE_KDKMP.province,
        regency: "",
        district: "",
        village: "",
      }),
      expectedTransactionCount: Number(finalMetadata.expected_transactions) || DEFAULT_BELANJA_BASE_TRANSACTION_COUNT,
      stage: asCopyStage(finalMetadata.stage) ?? "PRE_FLIGHT",
      completedTransactionIds: asStringArray(finalMetadata.completed_transaction_ids),
    };
  }

  return null;
}

export async function claimNextBelanjaSyncItem(runnerId: string): Promise<ClaimedBelanjaSyncItem | null> {
  const client = clientOrThrow();
  await markStaleProcessingItems(client);
  await markStaleCopyReconcileJobs(client);

  const { data, error } = await client
    .from("belanja_sync_items")
    .select(ITEM_SELECT)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(25);
  if (error) throwDatabaseError(error, "Gagal mengambil antrean item.");

  for (const candidate of (data ?? []) as BelanjaItemRow[]) {
    if ((candidate.attempt_count ?? 0) >= (candidate.max_attempts ?? 3)) {
      await client
        .from("belanja_sync_items")
        .update({ status: "failed", error_message: "Melebihi batas percobaan otomatis.", finished_at: nowIso() })
        .eq("id", candidate.id);
      await updateJobRollup(client, candidate.job_id);
      continue;
    }

    const job = await getJobRow(client, candidate.job_id);
    if (!job || !["pending", "processing"].includes(job.status)) {
      await client
        .from("belanja_sync_items")
        .update({ status: "skipped", error_message: "Job sudah tidak aktif.", finished_at: nowIso() })
        .eq("id", candidate.id)
        .eq("status", "pending");
      if (job) await updateJobRollup(client, job.id);
      continue;
    }
    if (isCopyReconcileJobRow(job)) continue;

    const timestamp = nowIso();
    const { data: updated, error: updateError } = await client
      .from("belanja_sync_items")
      .update({
        status: "processing",
        attempt_count: (candidate.attempt_count ?? 0) + 1,
        started_at: timestamp,
        finished_at: null,
        error_message: null,
        metadata_json: {
          ...asRecord(candidate.metadata_json),
          runner_id: runnerId,
          claimed_at: timestamp,
        },
      })
      .eq("id", candidate.id)
      .eq("status", "pending")
      .select(ITEM_SELECT)
      .maybeSingle();
    if (updateError) throwDatabaseError(updateError, "Gagal claim item.");
    if (!updated) continue;

    await client
      .from("belanja_sync_jobs")
      .update({
        status: "processing",
        started_at: job.started_at ?? timestamp,
        finished_at: null,
        error_message: null,
      })
      .eq("id", job.id);

    const refreshedJob = await getJobRow(client, job.id);
    let finalJob = rowToJob(refreshedJob ?? job);
    const finalJobMetadata = asRecord(finalJob.metadataJson);
    if (!finalJob.dryRun) {
      const verified = finalJobMetadata.field_map_verified === true || await hasVerifiedFieldMapInHistory(client);
      if (verified && finalJobMetadata.field_map_verified !== true) {
        const { data: updatedJob, error: jobMetadataError } = await client
          .from("belanja_sync_jobs")
          .update({
            metadata_json: {
              ...finalJobMetadata,
              field_map_verified: true,
              field_map_verified_source: finalJobMetadata.field_map_verified_source ?? "project_history",
            },
          })
          .eq("id", job.id)
          .select(JOB_SELECT)
          .single();
        if (!jobMetadataError && updatedJob) finalJob = rowToJob(updatedJob as BelanjaJobRow);
      }
    }
    return {
      job: finalJob,
      item: rowToItem(updated as BelanjaItemRow),
    };
  }

  return null;
}

export async function updateBelanjaSyncJobCheckpoint(jobId: string, input: {
  runnerId: string;
  stage?: BelanjaCopyReconcileStage;
  stageMessage?: string | null;
  progress?: Partial<BelanjaSyncJobProgress>;
  report?: Partial<BelanjaSyncReport>;
  completedTransactionIds?: string[];
  copiedTransactionIds?: string[];
  status?: BelanjaSyncJobStatus;
  errorMessage?: string | null;
}) {
  const client = clientOrThrow();
  const row = await getJobRow(client, jobId);
  if (!row) throw new Error("Belanja Sync job tidak ditemukan.");
  if (!isCopyReconcileJobRow(row)) throw new Error("Checkpoint job hanya berlaku untuk operasi copy/reconcile.");

  const metadata = asRecord(row.metadata_json);
  const stage = input.stage ?? asCopyStage(metadata.stage) ?? "PRE_FLIGHT";
  const timestamp = nowIso();
  const completedTransactionIds = [...new Set([
    ...asStringArray(metadata.completed_transaction_ids),
    ...asStringArray(input.completedTransactionIds),
  ])];
  const copiedTransactionIds = [...new Set([
    ...asStringArray(metadata.copied_transaction_ids),
    ...asStringArray(input.copiedTransactionIds),
  ])];
  const previousProgress = asRecord(metadata.progress);
  const progressMessage = input.stageMessage
    ?? input.progress?.message
    ?? asOptionalString(previousProgress.message)
    ?? undefined;
  const nextReport = {
    ...asRecord(metadata.report),
    ...asRecord(input.report),
    status: input.report?.status ?? stage,
  };
  const nextProgress = buildProgress(stage, {
    ...previousProgress,
    ...asRecord(input.progress),
    stage,
    message: progressMessage,
  });
  const status = input.status
    ?? (stage === "COMPLETED"
      ? "completed"
      : stage === "FAILED"
        ? "failed"
        : row.status);

  const { data, error } = await client
    .from("belanja_sync_jobs")
    .update({
      status,
      error_message: input.errorMessage ?? (stage === "FAILED" ? row.error_message : null),
      finished_at: status === "completed" || status === "completed_with_errors" || status === "failed" || status === "cancelled"
        ? row.finished_at ?? timestamp
        : null,
      metadata_json: {
        ...metadata,
        runner_id: input.runnerId,
        checkpoint_at: timestamp,
        stage,
        stage_message: progressMessage ?? null,
        progress: nextProgress,
        report: nextReport,
        completed_transaction_ids: completedTransactionIds,
        copied_transaction_ids: copiedTransactionIds,
      },
    })
    .eq("id", jobId)
    .select(JOB_SELECT)
    .single();
  if (error) throwDatabaseError(error, "Gagal menyimpan checkpoint job Belanja Sync.");

  if (status === "failed") {
    const failureMessage = input.errorMessage
      ?? progressMessage
      ?? row.error_message
      ?? "Job copy/reconcile gagal.";
    const { error: itemError } = await client
      .from("belanja_sync_items")
      .update({
        status: "failed",
        error_message: failureMessage,
        finished_at: timestamp,
      })
      .eq("job_id", jobId)
      .in("status", ["pending", "processing", "needs_review"]);
    if (itemError) throwDatabaseError(itemError, "Gagal menutup item Belanja Sync pada job gagal.");
    return updateJobRollup(client, jobId);
  }

  return rowToJob(data as BelanjaJobRow);
}

export async function markBelanjaSyncItemSuccess(itemId: string, input: {
  runnerId: string;
  targetReference?: string | null;
  dryRun?: boolean;
  metadataJson?: Record<string, unknown>;
}) {
  const client = clientOrThrow();
  const { data: current, error: currentError } = await client
    .from("belanja_sync_items")
    .select(ITEM_SELECT)
    .eq("id", itemId)
    .maybeSingle();
  if (currentError) throwDatabaseError(currentError, "Gagal memuat item sync.");
  if (!current) throw new Error("Item sync tidak ditemukan.");

  const row = current as BelanjaItemRow;
  if (row.status === "success") {
    return { item: rowToItem(row), job: await updateJobRollup(client, row.job_id) };
  }

  const timestamp = nowIso();
  const dryRun = input.dryRun === true;
  const nextStatus: BelanjaSyncItemStatus = dryRun ? "skipped" : "success";
  const { data: updated, error: updateError } = await client
    .from("belanja_sync_items")
    .update({
      status: nextStatus,
      target_reference: dryRun ? row.target_reference : input.targetReference ?? row.target_reference,
      error_message: dryRun ? "DRY_RUN_OK: form terisi dan tervalidasi, tidak submit transaksi." : null,
      finished_at: timestamp,
      metadata_json: {
        ...asRecord(row.metadata_json),
        ...asRecord(input.metadataJson),
        runner_id: input.runnerId,
        dry_run: dryRun,
        finished_at: timestamp,
      },
    })
    .eq("id", itemId)
    .select(ITEM_SELECT)
    .single();
  if (updateError) throwDatabaseError(updateError, "Gagal menyimpan status sukses item.");

  return {
    item: rowToItem(updated as BelanjaItemRow),
    job: await updateJobRollup(client, row.job_id),
  };
}

export async function markBelanjaSyncItemFailed(itemId: string, input: {
  runnerId: string;
  errorMessage: string;
  retryable?: boolean;
  metadataJson?: Record<string, unknown>;
}) {
  const client = clientOrThrow();
  const { data: current, error: currentError } = await client
    .from("belanja_sync_items")
    .select(ITEM_SELECT)
    .eq("id", itemId)
    .maybeSingle();
  if (currentError) throwDatabaseError(currentError, "Gagal memuat item sync.");
  if (!current) throw new Error("Item sync tidak ditemukan.");

  const row = current as BelanjaItemRow;
  if (row.status === "success") {
    return { item: rowToItem(row), job: await updateJobRollup(client, row.job_id) };
  }

  const nextStatus = nextFailedBelanjaStatus(row.attempt_count ?? 0, row.max_attempts ?? 3, input.retryable === true);
  const canRetry = nextStatus === "pending";
  const timestamp = nowIso();
  const { data: updated, error: updateError } = await client
    .from("belanja_sync_items")
    .update({
      status: nextStatus,
      error_message: input.errorMessage,
      started_at: canRetry ? null : row.started_at,
      finished_at: canRetry ? null : timestamp,
      metadata_json: {
        ...asRecord(row.metadata_json),
        ...asRecord(input.metadataJson),
        runner_id: input.runnerId,
        failed_at: timestamp,
        retryable: canRetry,
      },
    })
    .eq("id", itemId)
    .select(ITEM_SELECT)
    .single();
  if (updateError) throwDatabaseError(updateError, "Gagal menyimpan status gagal item.");

  return {
    item: rowToItem(updated as BelanjaItemRow),
    job: await updateJobRollup(client, row.job_id),
  };
}
