import { NextResponse } from "next/server";
import { createBelanjaSyncJob } from "@/lib/belanja-sync/server";
import { jsonError, readJsonBody } from "@/lib/belanja-sync/route-helpers";
import type { CreateBelanjaSyncJobInput } from "@/lib/belanja-sync/types";

export async function POST(request: Request) {
  try {
    const input = await readJsonBody<CreateBelanjaSyncJobInput>(request);
    const result = await createBelanjaSyncJob(input);
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error, "Gagal membuat Belanja Sync job.", 400);
  }
}
