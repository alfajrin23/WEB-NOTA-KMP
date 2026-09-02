import { NextResponse } from "next/server";
import { revokeRunnerToken } from "@/lib/runner-tokens";
import { jsonError } from "@/lib/belanja-sync/route-helpers";

export async function POST(_request: Request, context: { params: Promise<{ tokenId: string }> }) {
  try {
    const { tokenId } = await context.params;
    const runner = await revokeRunnerToken(tokenId);
    return NextResponse.json({ runner });
  } catch (error) {
    return jsonError(error, "Gagal revoke runner token.", 400);
  }
}
