import { NextResponse } from "next/server";
import { queueNextMonitoredLiveProject } from "@/lib/belanja-sync/monitored-live-batch-20260909";
import { recordBelanjaRunnerHeartbeat } from "@/lib/belanja-sync/server";
import { jsonError, readJsonBody, requireRunnerToken } from "@/lib/belanja-sync/route-helpers";
import type { BelanjaRunnerHeartbeat } from "@/lib/belanja-sync/types";

type HeartbeatInput = {
  runnerId: string;
  status: BelanjaRunnerHeartbeat["status"];
  targetStatus: BelanjaRunnerHeartbeat["targetStatus"];
  dryRun: boolean;
  targetBaseUrl?: string | null;
  message?: string | null;
  metadataJson?: Record<string, unknown>;
};

export async function POST(request: Request) {
  const authError = await requireRunnerToken(request);
  if (authError) return authError;

  try {
    const input = await readJsonBody<HeartbeatInput>(request);
    const heartbeat = await recordBelanjaRunnerHeartbeat(input);
    const monitoredQueue: Array<Record<string, unknown>> = [];
    if (input.dryRun === false && input.targetStatus === "connected") {
      try {
        for (let index = 0; index < 4; index += 1) {
          const queued = await queueNextMonitoredLiveProject();
          monitoredQueue.push(queued);
          if (queued.complete) break;
        }
      } catch (error) {
        monitoredQueue.push({
          queued: false,
          complete: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return NextResponse.json({ heartbeat, monitoredQueue });
  } catch (error) {
    return jsonError(error, "Gagal menyimpan heartbeat runner.", 400);
  }
}
