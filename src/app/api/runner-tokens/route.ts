import { NextResponse } from "next/server";
import { createRunnerToken, listRunnerTokens } from "@/lib/runner-tokens";
import { jsonError, readJsonBody } from "@/lib/belanja-sync/route-helpers";

type CreateRunnerTokenInput = {
  name?: string;
  expiresAt?: string | null;
};

export async function GET() {
  try {
    const runners = await listRunnerTokens();
    return NextResponse.json({ runners });
  } catch (error) {
    return jsonError(error, "Gagal memuat runner token.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const input = await readJsonBody<CreateRunnerTokenInput>(request);
    const result = await createRunnerToken({
      name: input.name ?? "",
      expiresAt: input.expiresAt ?? null,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return jsonError(error, "Gagal membuat runner token.", 400);
  }
}
