import { Database, Server } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTimeIndonesia } from "@/utils/format";

export default async function SupabaseTestPage() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return (
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Server className="h-5 w-5 text-red-600" />Supabase belum dikonfigurasi</CardTitle>
          <CardDescription>Isi `.env.local`, lalu restart dev server.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p><code>NEXT_PUBLIC_SUPABASE_URL</code> = Project URL dari Supabase.</p>
          <p><code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> = anon public key dari Supabase API settings.</p>
        </CardContent>
      </Card>
    );
  }

  const { data, error, count } = await supabase
    .from("projects")
    .select("id,nama_desa,nama_project,status,created_at,updated_at", { count: "exact" })
    .limit(5);
  const displayData = data?.map((row) => ({
    ...row,
    created_at: formatDateTimeIndonesia(row.created_at),
    updated_at: formatDateTimeIndonesia(row.updated_at),
  }));

  return (
    <Card className="max-w-4xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Database className="h-5 w-5 text-blue-600" />Supabase Connection Test</CardTitle>
        <CardDescription>Query test ke tabel `projects`.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            <p className="font-semibold">Query gagal</p>
            <p>{error.message}</p>
          </div>
        ) : (
          <>
            <Badge className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">Connected</Badge>
            <p className="text-sm text-slate-500">Jumlah record: {count ?? 0}</p>
            <pre className="overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-50">{JSON.stringify(displayData, null, 2)}</pre>
          </>
        )}
      </CardContent>
    </Card>
  );
}
