import { NextResponse } from "next/server";
import { claimNextBelanjaSyncItem, claimNextBelanjaSyncJob } from "@/lib/belanja-sync/server";
import { jsonError, readJsonBody, requireRunnerToken } from "@/lib/belanja-sync/route-helpers";

type ClaimInput = {
  runnerId: string;
  runnerVersion?: string | null;
};

export async function POST(request: Request) {
  const authError = await requireRunnerToken(request);
  if (authError) return authError;

  try {
    const input = await readJsonBody<ClaimInput>(request);
    if (!input.runnerId?.trim()) throw new Error("runnerId wajib diisi.");
    const jobClaim = await claimNextBelanjaSyncJob(input.runnerId.trim(), {
      runnerVersion: input.runnerVersion ?? null,
    });
    if (jobClaim) return NextResponse.json({ claim: null, jobClaim });
    const claim = await claimNextBelanjaSyncItem(input.runnerId.trim());
    return NextResponse.json({ claim, jobClaim: null });
  } catch (error) {
    return jsonError(error, "Gagal claim item Belanja Sync.", 400);
  }
}
