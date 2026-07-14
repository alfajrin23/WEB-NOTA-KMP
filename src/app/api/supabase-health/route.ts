import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return NextResponse.json(
      {
        ok: false,
        reason: "missing_env",
        message: "Isi NEXT_PUBLIC_SUPABASE_URL dan NEXT_PUBLIC_SUPABASE_ANON_KEY di .env.local, lalu restart dev server.",
      },
      { status: 500 },
    );
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json(
      {
        ok: false,
        reason: "client_not_created",
      },
      { status: 500 },
    );
  }

  const { data, error, count } = await supabase
    .from("projects")
    .select("id,nama_desa,nama_project,status,created_at,updated_at", { count: "exact" })
    .limit(5);

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        reason: "query_failed",
        message: error.message,
        details: error,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    table: "projects",
    count,
    sample: data,
  });
}
