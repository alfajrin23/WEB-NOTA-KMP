import { NextResponse } from "next/server";
import { getBelanjaRunnerQueueCount } from "@/lib/belanja-sync/server";
import { jsonError, requireRunnerToken } from "@/lib/belanja-sync/route-helpers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authError = await requireRunnerToken(request);
  if (authError) return authError;

  try {
    const queue = await getBelanjaRunnerQueueCount();
    return NextResponse.json(queue, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return jsonError(error, "Gagal menghitung antrean runner Belanja Sync.");
  }
}
