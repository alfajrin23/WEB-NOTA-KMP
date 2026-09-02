import { NextResponse } from "next/server";
import { cancelBelanjaSyncJob } from "@/lib/belanja-sync/server";
import { jsonError } from "@/lib/belanja-sync/route-helpers";

export async function POST(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await context.params;
    const job = await cancelBelanjaSyncJob(jobId);
    return NextResponse.json({ job });
  } catch (error) {
    return jsonError(error, "Gagal membatalkan Belanja Sync job.", 400);
  }
}
