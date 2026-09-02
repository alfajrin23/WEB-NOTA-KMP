import { NextResponse } from "next/server";
import { getBelanjaProjectState, resetBelanjaProjectSyncState } from "@/lib/belanja-sync/server";
import { jsonError } from "@/lib/belanja-sync/route-helpers";

export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params;
    const state = await getBelanjaProjectState(projectId);
    return NextResponse.json(state);
  } catch (error) {
    return jsonError(error, "Gagal memuat status Belanja Sync.");
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params;
    const result = await resetBelanjaProjectSyncState(projectId);
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error, "Gagal reset status Belanja Sync.", 400);
  }
}
