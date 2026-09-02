import { NextResponse } from "next/server";
import { markBelanjaSyncItemFailed } from "@/lib/belanja-sync/server";
import { jsonError, readJsonBody, requireRunnerToken } from "@/lib/belanja-sync/route-helpers";

type FailedInput = {
  runnerId: string;
  errorMessage: string;
  retryable?: boolean;
  metadataJson?: Record<string, unknown>;
};

export async function POST(request: Request, context: { params: Promise<{ itemId: string }> }) {
  const authError = await requireRunnerToken(request);
  if (authError) return authError;

  try {
    const { itemId } = await context.params;
    const input = await readJsonBody<FailedInput>(request);
    if (!input.runnerId?.trim()) throw new Error("runnerId wajib diisi.");
    if (!input.errorMessage?.trim()) throw new Error("errorMessage wajib diisi.");
    const result = await markBelanjaSyncItemFailed(itemId, input);
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error, "Gagal menyimpan status gagal item.", 400);
  }
}
