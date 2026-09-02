import { NextResponse } from "next/server";
import { getBearerToken, validateRunnerToken } from "@/lib/runner-tokens";

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

export async function requireRunnerToken(request: Request) {
  const bearer = getBearerToken(request);
  const validation = await validateRunnerToken(bearer);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.status === 401 ? "Unauthorized runner" : validation.error }, { status: validation.status });
  }

  return null;
}
