import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { BelanjaSyncJobStatus } from "./types";

const DEFAULT_VILLAGE_ESTIMATE_SECONDS = 741;
const MAX_BATCH_PROJECTS = 50;

type JsonRecord = Record<string, unknown>;

type JobRow = {
  id: string;
  project_id: string;
  status: BelanjaSyncJobStatus;
  total_items: number | null;
  success_items: number | null;
  failed_items: number | null;
  skipped_items: number | null;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  metadata_json: JsonRecord | null;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function isTerminal(status: BelanjaSyncJobStatus) {
  return status === "completed" || status === "completed_with_errors" || status === "failed" || status === "cancelled";
}

function progressPercent(row: JobRow) {
  const metadata = asRecord(row.metadata_json);
  const progress = asRecord(metadata.progress);
  const current = Number(progress.current ?? 0);
  const total = Number(progress.total ?? row.total_items ?? 0);
  if (Number.isFinite(current) && Number.isFinite(total) && total > 0) {
    return Math.max(0, Math.min(100, Math.round((current / total) * 100)));
  }
  const jobTotal = Number(row.total_items ?? 0);
  if (jobTotal <= 0) return row.status === "completed" ? 100 : 0;
  const completed = Number(row.success_items ?? 0) + Number(row.failed_items ?? 0) + Number(row.skipped_items ?? 0);
  return Math.max(0, Math.min(100, Math.round((completed / jobTotal) * 100)));
}

export function isMissingBatchProgressView(error: unknown) {
  const value = error && typeof error === "object" ? error as { code?: string; message?: string } : {};
  return value.code === "42P01"
    || value.code === "PGRST205"
    || /belanja_sync_batch_progress_v1|schema cache|does not exist|could not find/i.test(value.message ?? "");
}

export async function getBelanjaBatchProgressFallback(jobIds: string[]) {
  const client = createSupabaseAdminClient();
  if (!client) throw new Error("SUPABASE_SERVICE_ROLE_KEY belum dikonfigurasi di server.");
  const ids = [...new Set(jobIds.map((id) => id.trim()).filter(Boolean))].slice(0, MAX_BATCH_PROJECTS);
  if (ids.length === 0) {
    return { jobs: [], totalPercent: 0, remainingSeconds: 0, estimateSecondsPerVillage: DEFAULT_VILLAGE_ESTIMATE_SECONDS, optimized: false };
  }

  const { data, error } = await client
    .from("belanja_sync_jobs")
    .select("id,project_id,status,total_items,success_items,failed_items,skipped_items,started_at,finished_at,error_message,metadata_json")
    .in("id", ids);
  if (error) throw error;

  const rows = (data ?? []) as JobRow[];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const jobs = ids.map((id) => {
    const row = byId.get(id);
    if (!row) return { jobId: id, projectId: "", status: "failed" as const, percent: 0, stage: null, message: null, error: "Job tidak ditemukan.", startedAt: null, finishedAt: null };
    const metadata = asRecord(row.metadata_json);
    const report = asRecord(metadata.report);
    const reportErrors = Array.isArray(report.errors) ? report.errors.filter((item): item is string => typeof item === "string") : [];
    return {
      jobId: row.id,
      projectId: row.project_id,
      status: row.status,
      percent: progressPercent(row),
      stage: typeof metadata.stage === "string" ? metadata.stage : null,
      message: typeof metadata.stage_message === "string" ? metadata.stage_message : typeof metadata.stageMessage === "string" ? metadata.stageMessage : null,
      error: row.error_message || reportErrors[0] || null,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    };
  });

  const totalPercent = jobs.length > 0 ? Math.round(jobs.reduce((sum, job) => sum + job.percent, 0) / jobs.length) : 0;
  const remainingFraction = jobs.reduce((sum, job) => sum + (isTerminal(job.status) ? 0 : Math.max(0, 1 - job.percent / 100)), 0);
  return {
    jobs,
    totalPercent,
    remainingSeconds: Math.round(remainingFraction * DEFAULT_VILLAGE_ESTIMATE_SECONDS),
    estimateSecondsPerVillage: DEFAULT_VILLAGE_ESTIMATE_SECONDS,
    optimized: false,
  };
}
