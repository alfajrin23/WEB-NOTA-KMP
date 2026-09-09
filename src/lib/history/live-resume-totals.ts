"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const PAGE_SIZE = 1000;

type LiveTotalRow = {
  project_id: string;
  total_resume: number | string | null;
};

type ResumeAmountRow = {
  project_id: string;
  qty: number | string | null;
  harga_satuan: number | string | null;
  jumlah: number | string | null;
  jumlah_override: number | string | null;
  is_jumlah_manual: boolean | null;
  is_included_in_resume_total: boolean | null;
};

function toNumber(value: number | string | null | undefined) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function rowAmount(row: ResumeAmountRow) {
  if (row.is_included_in_resume_total === false) return 0;
  if (row.is_jumlah_manual === true) return toNumber(row.jumlah_override ?? row.jumlah);
  return toNumber(row.qty) * toNumber(row.harga_satuan);
}

function schemaMissing(error: { code?: string; message?: string } | null | undefined) {
  return Boolean(
    error?.code === "PGRST205"
      || error?.code === "42P01"
      || /history_resume_totals_v1|schema cache|relation .* does not exist/i.test(error?.message ?? ""),
  );
}

async function fallbackTotals(projectIds: string[]) {
  const client = createSupabaseBrowserClient();
  if (!client || projectIds.length === 0) return {} as Record<string, number>;

  const totals: Record<string, number> = {};
  let page = 0;
  while (true) {
    const from = page * PAGE_SIZE;
    const { data, error } = await client
      .from("resume_items")
      .select("project_id,qty,harga_satuan,jumlah,jumlah_override,is_jumlah_manual,is_included_in_resume_total")
      .in("project_id", projectIds)
      .order("project_id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;

    const rows = (data ?? []) as ResumeAmountRow[];
    for (const row of rows) totals[row.project_id] = (totals[row.project_id] ?? 0) + rowAmount(row);
    if (rows.length < PAGE_SIZE) break;
    page += 1;
  }
  return totals;
}

export async function fetchLiveResumeTotals(projectIds: string[]) {
  const client = createSupabaseBrowserClient();
  const ids = [...new Set(projectIds.filter(Boolean))];
  if (!client || ids.length === 0) return {} as Record<string, number>;

  const { data, error } = await client
    .from("history_resume_totals_v1")
    .select("project_id,total_resume")
    .in("project_id", ids);

  if (error) {
    if (schemaMissing(error)) return fallbackTotals(ids);
    throw error;
  }

  return Object.fromEntries(
    ((data ?? []) as LiveTotalRow[]).map((row) => [row.project_id, toNumber(row.total_resume)]),
  ) as Record<string, number>;
}
