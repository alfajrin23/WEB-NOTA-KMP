import { NextResponse } from "next/server";
import { claimNextBelanjaSyncItem } from "@/lib/belanja-sync/server";
import { jsonError, readJsonBody, requireRunnerToken } from "@/lib/belanja-sync/route-helpers";

type ClaimInput = {
  runnerId: string;
};

export async function POST(request: Request) {
  const authError = await requireRunnerToken(request);
  if (authError) return authError;

  try {
    const input = await readJsonBody<ClaimInput>(request);
    if (!input.runnerId?.trim()) throw new Error("runnerId wajib diisi.");
    const claim = await claimNextBelanjaSyncItem(input.runnerId.trim());
    return NextResponse.json({ claim });
  } catch (error) {
    return jsonError(error, "Gagal claim item Belanja Sync.", 400);
  }
}
