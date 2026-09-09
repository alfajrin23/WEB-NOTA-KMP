import { NextResponse } from "next/server";
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
    return NextResponse.json({ heartbeat });
  } catch (error) {
    return jsonError(error, "Gagal menyimpan heartbeat runner.", 400);
  }
}
