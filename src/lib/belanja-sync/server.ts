import type { SupabaseClient } from "@supabase/supabase-js";
import { getStageLabel } from "../../constants/stages";
import type { Project, ProjectStatus, ResumeItem, StageCode, WilayahType } from "../../types/domain";
import { formatProjectRecipientAddress, formatProjectRecipientName, normalizeWilayahType } from "../../utils/format";
import { createSupabaseAdminClient } from "../supabase/admin";
import { buildBelanjaPayload, validateBelanjaPayload } from "./payload";
import { isBelanjaItemActive, nextFailedBelanjaStatus, shouldQueueBelanjaItem } from "./status";
import type {
  BelanjaProjectSyncState,
  BelanjaRunnerHeartbeat,
  BelanjaSyncItem,
  BelanjaSyncItemStatus,
  BelanjaSyncJob,
  BelanjaSyncJobStatus,
  ClaimedBelanjaSyncItem,
  CreateBelanjaSyncJobInput,
} from "./types";

const PROJECT_SELECT = "id,nama_desa,jenis_wilayah,kecamatan,kabupaten,nama_project,wilayah,kodim,tanggal_laporan,project_date,metadata_json,status,created_at,updated_at";
const RESUME_ITEM_SELECT = "id,project_id,tahap,stage_id,stage_name,category_code,category_name,item_no,kategori,tanggal,uraian,qty,satuan,harga_satuan,jumlah,jumlah_override,is_jumlah_manual,vendor,vendor_id,source_file,source_page,source_row,is_manual_added,is_included_in_resume_total,is_generated_to_note,note_id,category_total,stage_total,source_type,validation_status,notes,urutan,created_at,updated_at";
const JOB_SELECT = "id,project_id,status,dry_run,total_items,success_items,failed_items,skipped_items,created_at,started_at,finished_at,error_message,metadata_json";
const ITEM_SELECT = "id,job_id,project_id,source_resume_item_id,status,attempt_count,max_attempts,target_reference,payload_json,error_message,started_at,finished_at,created_at,updated_at,metadata_json";
const HEARTBEAT_SELECT = "runner_id,status,target_status,dry_run,last_seen_at,target_base_url,message,metadata_json";
const RUNNER_ONLINE_WINDOW_MS = 90_000;
const STALE_PROCESSING_WINDOW_MS = 30 * 60_000;

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

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
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
    metadataJson: row.metadata_json ?? {},
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
    const current = latest[item.sourceResumeItemId];
    const itemScore = score[item.status] ?? 0;
    const currentScore = current ? score[current.status] ?? 0 : -1;
    const itemTime = Date.parse(item.updatedAt || item.createdAt);
    const currentTime = current ? Date.parse(current.updatedAt || current.createdAt) : -1;
    if (!current || itemScore > currentScore || (itemScore === currentScore && itemTime > currentTime)) {
      latest[item.sourceResumeItemId] = item;
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
    if (activeItems > 0) status = job.started_at || processingItems > 0 ? "processing" : "pending";
    else status = failedItems > 0 ? "completed_with_errors" : "completed";
    finishedAt = activeItems > 0 ? null : (job.finished_at ?? timestamp);
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
    return {
      projectId,
      schemaReady: true,
      jobs: ((jobsResult.data ?? []) as BelanjaJobRow[]).map(rowToJob),
      items,
      latestBySourceItemId: latestBySourceItemId(items),
      runner,
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
        errorMessage: error.message,
      };
    }
    throw error;
  }
}

export async function getBelanjaSyncOverview() {
  try {
    const client = clientOrThrow();
    const [itemsResult, runner] = await Promise.all([
      client
        .from("belanja_sync_items")
        .select("project_id,status,source_resume_item_id,payload_json,error_message,updated_at,created_at")
        .order("updated_at", { ascending: false }),
      getLatestRunnerHeartbeat(client),
    ]);
    if (itemsResult.error) throwDatabaseError(itemsResult.error, "Gagal memuat overview Belanja Sync.");

    const grouped = new Map<string, BelanjaSyncItem[]>();
    for (const row of (itemsResult.data ?? []) as Array<{
      project_id: string;
      status: BelanjaSyncItemStatus;
      source_resume_item_id: string;
      payload_json: JsonRecord | null;
      error_message: string | null;
      updated_at: string;
      created_at: string;
    }>) {
      const list = grouped.get(row.project_id) ?? [];
      list.push({
        id: `${row.project_id}:${row.source_resume_item_id}:${row.updated_at}`,
        jobId: "",
        projectId: row.project_id,
        sourceResumeItemId: row.source_resume_item_id,
        status: row.status,
        attemptCount: 0,
        maxAttempts: 0,
        payload: row.payload_json as BelanjaSyncItem["payload"] ?? {
          sourceItemId: row.source_resume_item_id,
          projectId: row.project_id,
          tanggal: "",
          namaItem: "",
          qty: 0,
          satuan: "",
          hargaSatuan: 0,
          jumlah: 0,
        },
        errorMessage: row.error_message,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
      grouped.set(row.project_id, list);
    }

    const projects = [...grouped.entries()].map(([projectId, rows]) => {
      const latest = Object.values(latestBySourceItemId(rows));
      const successItems = latest.filter((item) => item.status === "success").length;
      const failedItems = latest.filter((item) => item.status === "failed" || item.status === "needs_review").length;
      const pendingItems = latest.filter((item) => item.status === "pending" || item.status === "processing").length;
      const failedDetails = latest
        .filter((item): item is BelanjaSyncItem & { status: "failed" | "needs_review" } => item.status === "failed" || item.status === "needs_review")
        .map((item) => ({
          sourceResumeItemId: item.sourceResumeItemId,
          itemName: item.payload?.namaItem ?? "",
          tanggal: item.payload?.tanggal ?? "",
          jumlah: item.payload?.jumlah ?? 0,
          status: item.status,
          errorMessage: item.errorMessage ?? "Item gagal tanpa pesan error dari runner.",
          updatedAt: item.updatedAt,
        }))
        .slice(0, 5);
      return {
        projectId,
        status: successItems === 0 && failedItems === 0 && pendingItems === 0
          ? "belum_dikirim" as const
          : failedItems > 0
            ? "ada_error" as const
            : pendingItems > 0 || successItems < latest.length
              ? "sebagian" as const
              : "selesai" as const,
        totalItems: latest.length,
        successItems,
        failedItems,
        pendingItems,
        failedDetails,
      };
    });

    return { schemaReady: true, runner, projects };
  } catch (error) {
    if (error instanceof Error && /SUPABASE_SERVICE_ROLE_KEY|migration|schema|belanja_sync_|belanja_runner_/i.test(error.message)) {
      return { schemaReady: false, runner: null, projects: [], errorMessage: error.message };
    }
    throw error;
  }
}

export async function createBelanjaSyncJob(input: CreateBelanjaSyncJobInput) {
  const client = clientOrThrow();
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
  const itemRows = project.items.map((item) => {
    const existing = existingBySource[item.id];
    const activeExisting = activeBySource[item.id];
    const payload = buildBelanjaPayload(project, item);
    const validation = validateBelanjaPayload(payload);
    let status: BelanjaSyncItemStatus = "pending";
    let errorMessage: string | null = null;
    const queueDecision = activeExisting
      ? { queue: false, reason: "Item sudah ada di antrean aktif, tidak dibuat duplikat." }
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
      },
    })
    .select(JOB_SELECT)
    .single();
  if (jobError) throwDatabaseError(jobError, "Gagal membuat Belanja Sync job.");

  const job = jobRow as BelanjaJobRow;
  const rowsWithJob = itemRows.map((row) => ({ ...row, job_id: job.id }));
  const { error: itemError } = await client.from("belanja_sync_items").insert(rowsWithJob);
  if (itemError) {
    if (isActiveItemUniqueViolation(itemError)) {
      await client.from("belanja_sync_jobs").delete().eq("id", job.id);
      return {
        job: null,
        state: await getBelanjaProjectState(input.projectId),
        message: "Sebagian item sudah punya antrean aktif. Status sudah direfresh; item tersebut tidak dibuat duplikat.",
      };
    }

    await client
      .from("belanja_sync_jobs")
      .update({ status: "failed", error_message: itemError.message, finished_at: nowIso() })
      .eq("id", job.id);
    throwDatabaseError(itemError, "Gagal membuat item Belanja Sync.");
  }

  const refreshedJob = await updateJobRollup(client, job.id);
  const state = await getBelanjaProjectState(input.projectId);
  return { job: refreshedJob, state };
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

  const { data, error } = await client
    .from("belanja_sync_items")
    .select(ITEM_SELECT)
    .eq("job_id", jobId)
    .in("status", ["failed", "needs_review"]);
  if (error) throwDatabaseError(error, "Gagal memuat item gagal.");

  const rows = (data ?? []) as BelanjaItemRow[];
  if (rows.length === 0) return getBelanjaSyncJob(jobId);

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
      .update({ status: "skipped", error_message: "Item sudah SUCCESS pada job lain.", finished_at: nowIso() })
      .in("id", skippedIds);
    if (skippedError) throwDatabaseError(skippedError, "Gagal skip item yang sudah berhasil.");
  }

  await client
    .from("belanja_sync_jobs")
    .update({ status: retryIds.length > 0 ? "pending" : job.status, finished_at: retryIds.length > 0 ? null : job.finished_at })
    .eq("id", jobId);
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
      metadata_json: input.metadataJson ?? {},
    }, { onConflict: "runner_id" })
    .select(HEARTBEAT_SELECT)
    .single();
  if (error) throwDatabaseError(error, "Gagal menyimpan heartbeat runner.");
  return rowToHeartbeat(data as BelanjaHeartbeatRow);
}

async function markStaleProcessingItems(client: SupabaseClient) {
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_WINDOW_MS).toISOString();
  const { data, error } = await client
    .from("belanja_sync_items")
    .update({
      status: "needs_review",
      error_message: "Runner berhenti saat item processing. Cek target manual sebelum retry agar tidak duplikat.",
      finished_at: nowIso(),
    })
    .eq("status", "processing")
    .lt("started_at", staleBefore)
    .select("job_id");
  if (error) throwDatabaseError(error, "Gagal menandai stale processing item.");
  const jobIds = [...new Set(((data ?? []) as Array<{ job_id: string }>).map((row) => row.job_id))];
  await Promise.all(jobIds.map((jobId) => updateJobRollup(client, jobId)));
}

export async function claimNextBelanjaSyncItem(runnerId: string): Promise<ClaimedBelanjaSyncItem | null> {
  const client = clientOrThrow();
  await markStaleProcessingItems(client);

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
    return {
      job: rowToJob(refreshedJob ?? job),
      item: rowToItem(updated as BelanjaItemRow),
    };
  }

  return null;
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
