import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

export function jsonError(error: unknown, fallback = "Request gagal.", status = 500) {
  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json({ error: message }, { status });
}

export async function readJsonBody<T>(request: Request): Promise<T> {
  try {
    return await request.json() as T;
  } catch {
    throw new Error("Body JSON tidak valid.");
  }
}

function secureCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function requireRunnerToken(request: Request) {
  const expected = process.env.BELANJA_RUNNER_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: "BELANJA_RUNNER_TOKEN belum dikonfigurasi di server." }, { status: 503 });
  }

  const header = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(header)?.[1] ?? "";
  if (!bearer || !secureCompare(bearer, expected)) {
    return NextResponse.json({ error: "Runner token tidak valid." }, { status: 401 });
  }
  return null;
}
