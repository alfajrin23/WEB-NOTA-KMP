import { NextResponse } from "next/server";
import { createBelanjaBatch, getBelanjaBatchProgress, type CreateBelanjaBatchInput } from "@/lib/belanja-sync/batch-server";
import { jsonError, readJsonBody } from "@/lib/belanja-sync/route-helpers";

export async function POST(request: Request) {
  try {
    const input = await readJsonBody<CreateBelanjaBatchInput>(request);
    const result = await createBelanjaBatch(input);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return jsonError(error, "Gagal membuat batch Belanja Sync.", 400);
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const jobIds = (url.searchParams.get("jobIds") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const result = await getBelanjaBatchProgress(jobIds);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return jsonError(error, "Gagal memuat progress batch Belanja Sync.");
  }
}
