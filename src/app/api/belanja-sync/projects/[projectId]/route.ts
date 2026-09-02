import { NextResponse } from "next/server";
import { getBelanjaProjectState } from "@/lib/belanja-sync/server";
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
