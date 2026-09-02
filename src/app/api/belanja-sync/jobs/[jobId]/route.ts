import { NextResponse } from "next/server";
import { getBelanjaSyncJob } from "@/lib/belanja-sync/server";
import { jsonError } from "@/lib/belanja-sync/route-helpers";

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await context.params;
    const job = await getBelanjaSyncJob(jobId);
    return NextResponse.json(job);
  } catch (error) {
    return jsonError(error, "Gagal memuat Belanja Sync job.");
  }
}
