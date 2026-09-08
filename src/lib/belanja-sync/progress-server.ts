import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type {
  BelanjaCopyReconcileStage,
  BelanjaRunnerHeartbeat,
  BelanjaSyncJob,
  BelanjaSyncJobProgress,
  BelanjaSyncJobStatus,
  BelanjaSyncReport,
} from "./types";

const JOB_SELECT = "id,project_id,status,dry_run,total_items,success_items,failed_items,skipped_items,created_at,started_at,finished_at,error_message,metadata_json";
const HEARTBEAT_SELECT = "runner_id,status,target_status,dry_run,last_seen_at,target_base_url,message,metadata_json";
const RUNNER_ONLINE_WINDOW_MS = 120_000;

type JsonRecord = Record<string, unknown>;

type JobRow = {
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

type HeartbeatRow = {
  runner_id: string;
  status: BelanjaRunnerHeartbeat["status"];
  target_status: BelanjaRunnerHeartbeat["targetStatus"];
  dry_run: boolean | null;
  last_seen_at: string;
  target_base_url: string | null;
  message: string | null;
  metadata_json: JsonRecord | null;
};

export type BelanjaSyncProgressSnapshot = {
  schemaReady: boolean;
  runner: BelanjaRunnerHeartbeat | null;
  job: BelanjaSyncJob | null;
  errorMessage?: string;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function asOptionalString(value: unknown) {
  return typeof value === "string" ? value : null;
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

function rowToJob(row: JobRow | null | undefined): BelanjaSyncJob | null {
  if (!row) return null;
  const metadata = asRecord(row.metadata_json);
  const operationType = typeof metadata.operation_type === "string"
    ? metadata.operation_type
    : typeof metadata.operationType === "string"
      ? metadata.operationType
      : "legacy_item_submit";

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
    operationType,
    stage: asCopyStage(metadata.stage),
    stageMessage: asOptionalString(metadata.stage_message ?? metadata.stageMessage),
    progress: metadata.progress && typeof metadata.progress === "object" && !Array.isArray(metadata.progress)
      ? metadata.progress as BelanjaSyncJobProgress
      : null,
    report: metadata.report && typeof metadata.report === "object" && !Array.isArray(metadata.report)
      ? metadata.report as BelanjaSyncReport
      : null,
  };
}

function rowToHeartbeat(row: HeartbeatRow | null | undefined): BelanjaRunnerHeartbeat | null {
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

function schemaUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /SUPABASE_SERVICE_ROLE_KEY|schema cache|relation .*belanja_sync_|relation .*belanja_runner_|could not find .*belanja_sync_|could not find .*belanja_runner_/i.test(message);
}

/**
 * Small global-popup payload. This intentionally avoids the 300-project
 * overview view; the popup only needs one active/latest job and one heartbeat.
 */
export async function getBelanjaSyncProgressSnapshot(): Promise<BelanjaSyncProgressSnapshot> {
  try {
    const client = createSupabaseAdminClient();
    if (!client) throw new Error("SUPABASE_SERVICE_ROLE_KEY belum dikonfigurasi di server.");

    const [activeResult, latestResult, heartbeatResult] = await Promise.all([
      client
        .from("belanja_sync_jobs")
        .select(JOB_SELECT)
        .in("status", ["pending", "processing"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      client
        .from("belanja_sync_jobs")
        .select(JOB_SELECT)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      client
        .from("belanja_runner_heartbeats")
        .select(HEARTBEAT_SELECT)
        .order("last_seen_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (activeResult.error) throw activeResult.error;
    if (latestResult.error) throw latestResult.error;
    if (heartbeatResult.error) throw heartbeatResult.error;

    const activeJob = rowToJob(activeResult.data as JobRow | null);
    const latestJob = rowToJob(latestResult.data as JobRow | null);
    return {
      schemaReady: true,
      runner: rowToHeartbeat(heartbeatResult.data as HeartbeatRow | null),
      job: activeJob ?? latestJob,
    };
  } catch (error) {
    if (schemaUnavailable(error)) {
      return {
        schemaReady: false,
        runner: null,
        job: null,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
    throw error;
  }
}
