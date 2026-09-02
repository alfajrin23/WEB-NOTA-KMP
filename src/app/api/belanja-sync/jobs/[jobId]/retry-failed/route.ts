import { NextResponse } from "next/server";
import { retryFailedBelanjaSyncJob } from "@/lib/belanja-sync/server";
import { jsonError } from "@/lib/belanja-sync/route-helpers";

export async function POST(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await context.params;
    const result = await retryFailedBelanjaSyncJob(jobId);
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error, "Gagal retry item gagal.", 400);
  }
}
