import { NextResponse } from "next/server";
import { getBelanjaSyncOverview } from "@/lib/belanja-sync/server";
import { jsonError } from "@/lib/belanja-sync/route-helpers";

export async function GET() {
  try {
    const overview = await getBelanjaSyncOverview();
    return NextResponse.json(overview);
  } catch (error) {
    return jsonError(error, "Gagal memuat overview Belanja Sync.");
  }
}
