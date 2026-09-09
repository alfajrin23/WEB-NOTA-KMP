import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createBelanjaSyncJob } from "./server";
import { DEFAULT_BELANJA_BASE_TRANSACTION_COUNT } from "./transaction-plan";
import type { BelanjaSyncJobStatus } from "./types";

const DEFAULT_VILLAGE_ESTIMATE_SECONDS = 741;
const MAX_BATCH_PROJECTS = 50;

type JsonRecord = Record<string, unknown>;

type BatchProgressRow = {
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
  stage: string | null;
  stage_message: string | null;
  progress_json: JsonRecord | null;
  error_details: unknown[] | null;
};

export type CreateBelanjaBatchInput = {
  projectIds: string[];
  dryRun?: boolean;
};

function adminClient() {
  const client = createSupabaseAdminClient();
  if (!client) throw new Error("SUPABASE_SERVICE_ROLE_KEY belum dikonfigurasi di server.");
  return client;
}

function uniqueProjectIds(ids: string[]) {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))].slice(0, MAX_BATCH_PROJECTS);
}

function progressPercent(row: BatchProgressRow) {
  const metadataProgress = row.progress_json ?? {};
  const current = Number(metadataProgress.current ?? 0);
  const total = Number(metadataProgress.total ?? row.total_items ?? 0);
  if (Number.isFinite(current) && Number.isFinite(total) && total > 0) {
    return Math.max(0, Math.min(100, Math.round((current / total) * 100)));
  }
  const jobTotal = Number(row.total_items ?? 0);
  if (jobTotal <= 0) return row.status === "completed" ? 100 : 0;
  const completed = Number(row.success_items ?? 0) + Number(row.failed_items ?? 0) + Number(row.skipped_items ?? 0);
  return Math.max(0, Math.min(100, Math.round((completed / jobTotal) * 100)));
}

function jobFailureReason(row: BatchProgressRow) {
  const details = Array.isArray(row.error_details)
    ? row.error_details.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  return row.error_message || details[0] || null;
}

export async function createBelanjaBatch(input: CreateBelanjaBatchInput) {
  const client = adminClient();
  const projectIds = uniqueProjectIds(input.projectIds ?? []);
  if (projectIds.length === 0) throw new Error("Pilih minimal satu desa.");

  const { data: projects, error: projectsError } = await client
    .from("projects")
    .select("id,nama_desa,kecamatan,kabupaten")
    .in("id", projectIds);
  if (projectsError) throw projectsError;

  const found = new Map((projects ?? []).map((row) => [row.id as string, row]));
  const results: Array<{
    projectId: string;
    villageName: string;
    jobId?: string;
    status: "queued" | "failed";
    error?: string;
  }> = [];

  for (const projectId of projectIds) {
    const project = found.get(projectId);
    const villageName = typeof project?.nama_desa === "string" ? project.nama_desa : projectId;
    if (!project) {
      results.push({ projectId, villageName, status: "failed", error: "Project/desa tidak ditemukan." });
      continue;
    }

    try {
      const { data: items, error: itemsError } = await client
        .from("resume_items")
        .select("id")
        .eq("project_id", projectId)
        .neq("is_included_in_resume_total", false)
        .order("urutan", { ascending: true });
      if (itemsError) throw itemsError;
      const itemIds = (items ?? []).map((row) => String(row.id)).filter(Boolean);
      if (itemIds.length === 0) throw new Error("Resume desa tidak memiliki item aktif untuk dikirim.");

      const created = await createBelanjaSyncJob({
        projectId,
        itemIds,
        dryRun: input.dryRun ?? false,
        forceResend: false,
        operationType: "copy_reconcile_v1",
        expectedTransactionCount: DEFAULT_BELANJA_BASE_TRANSACTION_COUNT,
      });
      results.push({ projectId, villageName, jobId: created.job.id, status: "queued" });
    } catch (error) {
      results.push({
        projectId,
        villageName,
        status: "failed",
        error: error instanceof Error ? error.message : "Gagal membuat antrean desa.",
      });
    }
  }

  return {
    results,
    queued: results.filter((row) => row.status === "queued").length,
    failed: results.filter((row) => row.status === "failed").length,
    estimateSecondsPerVillage: DEFAULT_VILLAGE_ESTIMATE_SECONDS,
  };
}

export async function getBelanjaBatchProgress(jobIds: string[]) {
  const client = adminClient();
  const ids = [...new Set(jobIds.map((id) => id.trim()).filter(Boolean))].slice(0, MAX_BATCH_PROJECTS);
  if (ids.length === 0) {
    return { jobs: [], totalPercent: 0, remainingSeconds: 0, estimateSecondsPerVillage: DEFAULT_VILLAGE_ESTIMATE_SECONDS };
  }

  const { data, error } = await client
    .from("belanja_sync_batch_progress_v1")
    .select("id,project_id,status,dry_run,total_items,success_items,failed_items,skipped_items,created_at,started_at,finished_at,error_message,stage,stage_message,progress_json,error_details")
    .in("id", ids);
  if (error) throw error;

  const rows = (data ?? []) as BatchProgressRow[];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const jobs = ids.map((id) => {
    const row = byId.get(id);
    if (!row) return { jobId: id, projectId: "", status: "failed" as const, percent: 0, stage: null, message: null, error: "Job tidak ditemukan.", startedAt: null, finishedAt: null };
    return {
      jobId: row.id,
      projectId: row.project_id,
      status: row.status,
      percent: progressPercent(row),
      stage: row.stage,
      message: row.stage_message,
      error: jobFailureReason(row),
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    };
  });

  const totalPercent = jobs.length > 0 ? Math.round(jobs.reduce((sum, job) => sum + job.percent, 0) / jobs.length) : 0;
  const remainingFraction = jobs.reduce((sum, job) => sum + Math.max(0, 1 - job.percent / 100), 0);
  return {
    jobs,
    totalPercent,
    remainingSeconds: Math.round(remainingFraction * DEFAULT_VILLAGE_ESTIMATE_SECONDS),
    estimateSecondsPerVillage: DEFAULT_VILLAGE_ESTIMATE_SECONDS,
  };
}
