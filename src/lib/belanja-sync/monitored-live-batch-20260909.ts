import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createBelanjaSyncJob } from "./server";

const MONITOR_BATCH_ID = "list-desa-live-20260909-v1";

const MONITORED_PROJECT_IDS = [
  "add6c6c0-fd4a-48e0-94a7-56b07fc73f62",
  "f6b753d0-9011-4aad-9f00-d4547d31327a",
  "bda837ef-57d6-428c-a208-b1074436acf4",
  "ddbaf022-a70e-4473-abac-3b47e959ac25",
  "47ac30fc-fc2b-46a8-a53b-d923b6318f9a",
  "c890b52b-2d95-450a-a6bb-e7338593527c",
  "287161d2-df6e-44f7-bbcf-0d412696de82",
  "5e51d4cc-9268-46de-a218-a343bc90ec4c",
  "e6d7ee01-2276-4888-b4ff-46061835b537",
  "271ed934-4b44-436d-8f0c-1d0c8bd079ce",
  "68ef09b1-ff75-4719-8344-50f9a2a992eb",
  "d06c12f0-f1f2-4840-a6c2-7ac230d3e27a",
  "c56c4111-8dd3-4192-8726-5af18ae16ecb",
  "a7ad1c26-2241-4efc-81b1-a6fcebd663cc",
  "505947f9-1874-4fc3-a0c1-5aa864cdd404",
  "6c89d3b7-2823-493f-9974-eccd23af180e",
  "9adac303-7acd-4c2a-925c-407c0baebbed",
  "755c8ee5-a695-4a62-b6cb-317793373348",
  "98b42a75-e7d1-4117-8a98-5c3d3c7ac7b4",
  "b4a366b7-5b88-44af-8879-a8aa84390625",
  "5a235798-5251-475c-8b9f-c836c8e007e4",
  "892edbbd-d791-4bf4-a06a-01deb39ec53f",
  "2a7d5c7d-aea8-404d-82de-b9261b3f234e",
  "19ecda79-792c-43d2-a62a-d6d17c20c072",
  "c0e471fc-3a6f-4de6-b86d-c06ca99936eb",
  "ba693114-11be-4508-ba91-b1ee71bd8299",
  "6695d1d8-552a-41ae-b1ea-443212862257",
  "8bd42bc5-4d40-4c96-8093-eefe886d5b63",
  "e31a6df0-a0c4-4730-8f68-96be1f05f704",
  "fbe35f4c-889e-43e5-a4b8-b2eecf3a575f",
  "455ca27b-398a-415e-98d4-d3e4d107a434",
  "d495d628-beec-4257-bdc0-8c9b1cfe62de",
] as const;

export async function queueNextMonitoredLiveProject() {
  const client = createSupabaseAdminClient();
  if (!client) return { queued: false, complete: false, reason: "admin-client-unavailable" };

  const { data: markedRows, error: markedError } = await client
    .from("belanja_sync_jobs")
    .select("project_id")
    .contains("metadata_json", { monitor_batch_id: MONITOR_BATCH_ID });
  if (markedError) throw new Error(markedError.message);

  const marked = new Set((markedRows ?? []).map((row) => String(row.project_id)));
  const projectId = MONITORED_PROJECT_IDS.find((id) => !marked.has(id));
  if (!projectId) return { queued: false, complete: true, total: MONITORED_PROJECT_IDS.length };

  const { data: itemRows, error: itemError } = await client
    .from("resume_items")
    .select("id")
    .eq("project_id", projectId)
    .or("is_included_in_resume_total.is.null,is_included_in_resume_total.eq.true")
    .order("urutan", { ascending: true });
  if (itemError) throw new Error(itemError.message);

  const itemIds = (itemRows ?? []).map((row) => String(row.id));
  if (itemIds.length === 0) throw new Error(`Project ${projectId} tidak memiliki item Resume untuk dikirim.`);

  const result = await createBelanjaSyncJob({
    projectId,
    itemIds,
    dryRun: false,
    forceResend: false,
    operationType: "copy_reconcile_v1",
    expectedTransactionCount: 43,
  });

  const { data: currentJob, error: currentJobError } = await client
    .from("belanja_sync_jobs")
    .select("metadata_json")
    .eq("id", result.job.id)
    .single();
  if (currentJobError) throw new Error(currentJobError.message);

  const metadata = currentJob?.metadata_json && typeof currentJob.metadata_json === "object"
    ? currentJob.metadata_json as Record<string, unknown>
    : {};

  const { error: markerError } = await client
    .from("belanja_sync_jobs")
    .update({
      metadata_json: {
        ...metadata,
        monitor_batch_id: MONITOR_BATCH_ID,
        monitor_batch_source: "list desa must input web target.xlsx",
      },
    })
    .eq("id", result.job.id);
  if (markerError) throw new Error(markerError.message);

  return {
    queued: true,
    complete: false,
    projectId,
    jobId: result.job.id,
    dryRun: result.job.dryRun,
    status: result.job.status,
    markedCount: marked.size + 1,
    total: MONITORED_PROJECT_IDS.length,
  };
}
