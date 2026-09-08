import { NextResponse } from "next/server";
import { getBelanjaSyncProgressSnapshot } from "@/lib/belanja-sync/progress-server";
import { jsonError } from "@/lib/belanja-sync/route-helpers";

export async function GET() {
  try {
    const snapshot = await getBelanjaSyncProgressSnapshot();
    return NextResponse.json(snapshot, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (error) {
    return jsonError(error, "Gagal memuat progress Belanja Sync.");
  }
}
