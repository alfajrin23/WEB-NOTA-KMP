import { NextResponse } from "next/server";
import { updateBelanjaSyncJobCheckpoint } from "@/lib/belanja-sync/server";
import { jsonError, readJsonBody, requireRunnerToken } from "@/lib/belanja-sync/route-helpers";
import type { BelanjaCopyReconcileStage, BelanjaSyncJobProgress, BelanjaSyncJobStatus, BelanjaSyncReport } from "@/lib/belanja-sync/types";

type CheckpointInput = {
  runnerId: string;
  stage?: BelanjaCopyReconcileStage;
  stageMessage?: string | null;
  progress?: Partial<BelanjaSyncJobProgress>;
  report?: Partial<BelanjaSyncReport>;
  completedTransactionIds?: string[];
  copiedTransactionIds?: string[];
  status?: BelanjaSyncJobStatus;
  errorMessage?: string | null;
};

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const authError = await requireRunnerToken(request);
  if (authError) return authError;

  try {
    const { jobId } = await context.params;
    const input = await readJsonBody<CheckpointInput>(request);
    if (!input.runnerId?.trim()) throw new Error("runnerId wajib diisi.");
    const job = await updateBelanjaSyncJobCheckpoint(jobId, input);
    return NextResponse.json({ job });
  } catch (error) {
    return jsonError(error, "Gagal menyimpan checkpoint job Belanja Sync.", 400);
  }
}
