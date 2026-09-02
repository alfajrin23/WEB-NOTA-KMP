import { NextResponse } from "next/server";
import { markBelanjaSyncItemSuccess } from "@/lib/belanja-sync/server";
import { jsonError, readJsonBody, requireRunnerToken } from "@/lib/belanja-sync/route-helpers";

type SuccessInput = {
  runnerId: string;
  targetReference?: string | null;
  dryRun?: boolean;
  metadataJson?: Record<string, unknown>;
};

export async function POST(request: Request, context: { params: Promise<{ itemId: string }> }) {
  const authError = requireRunnerToken(request);
  if (authError) return authError;

  try {
    const { itemId } = await context.params;
    const input = await readJsonBody<SuccessInput>(request);
    if (!input.runnerId?.trim()) throw new Error("runnerId wajib diisi.");
    const result = await markBelanjaSyncItemSuccess(itemId, input);
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error, "Gagal menyimpan status sukses item.", 400);
  }
}
