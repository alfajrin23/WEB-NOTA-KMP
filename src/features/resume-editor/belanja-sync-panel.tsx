"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCcw, RotateCcw, Search, Send, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { buildBelanjaPayload, summarizeBelanjaPayloads, validateBelanjaPayload } from "@/lib/belanja-sync/payload";
import type { BelanjaProjectSyncState, BelanjaSyncItem, BelanjaSyncJob } from "@/lib/belanja-sync/types";
import { cn } from "@/lib/utils";
import { getResumeItemAmount } from "@/lib/resume-calculations";
import type { Project, ResumeItem } from "@/types/domain";
import { formatDateIndonesia, formatRupiah } from "@/utils/format";

type StatusFilter = "unsent" | "success" | "failed" | "all";
type RowStatus = "not_sent" | "pending" | "processing" | "success" | "failed" | "skipped" | "needs_review" | "dry_run";

function isDryRunItem(latest: BelanjaSyncItem | undefined) {
  return latest?.status === "skipped" && latest.errorMessage?.includes("DRY_RUN_OK");
}

function statusOf(latest: BelanjaSyncItem | undefined): RowStatus {
  if (!latest) return "not_sent";
  if (isDryRunItem(latest)) return "dry_run";
  return latest.status;
}

function statusLabel(status: RowStatus) {
  if (status === "not_sent") return "Belum Dikirim";
  if (status === "pending") return "Antrean";
  if (status === "processing") return "Diproses";
  if (status === "success") return "Terkirim ke Web";
  if (status === "failed") return "Gagal";
  if (status === "needs_review") return "Needs Review";
  if (status === "dry_run") return "Dry Run OK";
  return "Skipped";
}

function statusClass(status: RowStatus) {
  if (status === "success") return "bg-emerald-50 text-emerald-700";
  if (status === "failed" || status === "needs_review") return "bg-red-50 text-red-700";
  if (status === "pending" || status === "processing") return "bg-blue-50 text-blue-700";
  if (status === "dry_run") return "bg-cyan-50 text-cyan-700";
  if (status === "skipped") return "bg-slate-100 text-slate-600";
  return "bg-amber-50 text-amber-700";
}

function jobLabel(status: BelanjaSyncJob["status"]) {
  if (status === "completed_with_errors") return "completed + error";
  return status;
}

function canSelectForJob(status: RowStatus, forceResend: boolean) {
  if (status === "pending" || status === "processing") return false;
  if (status === "success") return forceResend;
  return true;
}

function rowMatchesFilter(status: RowStatus, filter: StatusFilter) {
  if (filter === "all") return true;
  if (filter === "success") return status === "success";
  if (filter === "failed") return status === "failed" || status === "needs_review";
  return status === "not_sent" || status === "dry_run" || status === "skipped";
}

export function BelanjaSyncPanel({ project }: { project: Project }) {
  const [state, setState] = useState<BelanjaProjectSyncState | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>("unsent");
  const [query, setQuery] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const [forceResend, setForceResend] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const initializedProjectRef = useRef<string | null>(null);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch(`/api/belanja-sync/projects/${project.id}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Gagal memuat status Belanja Sync.");
      setState(payload as BelanjaProjectSyncState);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memuat status Belanja Sync.");
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(true), 10_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const rows = useMemo(() => {
    return project.items
      .filter((item) => item.isIncludedInResumeTotal !== false)
      .map((item) => {
        const latest = state?.latestBySourceItemId[item.id];
        const payload = buildBelanjaPayload(project, item);
        const validation = validateBelanjaPayload(payload);
        const status = statusOf(latest);
        return { item, latest, payload, validation, status };
      });
  }, [project, state?.latestBySourceItemId]);

  useEffect(() => {
    if (!state || initializedProjectRef.current === project.id) return;
    const defaultSelected = rows
      .filter((row) => row.validation.valid && canSelectForJob(row.status, false) && row.status !== "success")
      .map((row) => row.item.id);
    setSelectedIds(new Set(defaultSelected));
    initializedProjectRef.current = project.id;
  }, [project.id, rows, state]);

  const failedRows = useMemo(
    () => rows.filter((row) => row.status === "failed" || row.status === "needs_review" || !row.validation.valid),
    [rows],
  );
  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (!rowMatchesFilter(row.status, filter)) return false;
      if (!normalizedQuery) return true;
      const haystack = [
        row.payload.tanggal,
        row.payload.namaItem,
        row.payload.satuan,
        row.payload.tahap,
        row.payload.kategori,
        row.payload.vendor,
        statusLabel(row.status),
        row.latest?.targetReference,
        row.latest?.errorMessage,
        row.validation.errors.join(" "),
      ].join(" ").toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [filter, query, rows]);
  const selectedRows = useMemo(() => rows.filter((row) => selectedIds.has(row.item.id)), [rows, selectedIds]);
  const selectedSummary = useMemo(() => summarizeBelanjaPayloads(selectedRows.map((row) => row.payload)), [selectedRows]);
  const latestJob = state?.jobs[0] ?? null;
  const progressValue = latestJob && latestJob.totalItems > 0
    ? Math.round(((latestJob.successItems + latestJob.failedItems + latestJob.skippedItems) / latestJob.totalItems) * 100)
    : 0;

  const runnerOnline = state?.runner?.online ?? false;
  const successCount = rows.filter((row) => row.status === "success").length;
  const failedCount = rows.filter((row) => row.status === "failed" || row.status === "needs_review").length;
  const pendingCount = rows.filter((row) => row.status === "pending" || row.status === "processing").length;

  function toggleItem(item: ResumeItem, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(item.id);
      else next.delete(item.id);
      return next;
    });
  }

  function selectFiltered() {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const row of filteredRows) {
        if (row.validation.valid && canSelectForJob(row.status, forceResend)) next.add(row.item.id);
      }
      return next;
    });
  }

  function clearFiltered() {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const row of filteredRows) next.delete(row.item.id);
      return next;
    });
  }

  async function createJob(resend = false) {
    if (selectedIds.size === 0) {
      toast.error("Pilih minimal satu item Resume.");
      return;
    }
    const invalidRows = selectedRows.filter((row) => !row.validation.valid);
    if (invalidRows.length > 0) {
      toast.error(`${invalidRows.length} item belum valid untuk dikirim.`);
      return;
    }
    const confirmed = window.confirm(
      resend
        ? `Kirim ulang ${selectedIds.size} item ke Web Belanja? Aksi ini bisa membuat transaksi duplikat jika item sudah pernah sukses.`
        : dryRun
          ? `Buat DRY RUN untuk ${selectedIds.size} item Resume? Data hanya divalidasi, belum tersimpan ke web target.`
          : `KIRIM LIVE ${selectedIds.size} item Resume ke Web Belanja? Data akan disubmit ke web target.`,
    );
    if (!confirmed) return;

    setSubmitting(true);
    try {
      const response = await fetch("/api/belanja-sync/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          itemIds: [...selectedIds],
          dryRun,
          forceResend: resend,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Gagal membuat job.");
      setState(result.state as BelanjaProjectSyncState);
      toast.success(result.message ?? (dryRun ? "Job dry run masuk antrean runner." : "Job live masuk antrean runner."));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal membuat job.");
    } finally {
      setSubmitting(false);
    }
  }

  async function retryJob(jobId: string) {
    if (!window.confirm("Retry item gagal pada job ini? Item SUCCESS tetap tidak akan dikirim ulang.")) return;
    setSubmitting(true);
    try {
      const response = await fetch(`/api/belanja-sync/jobs/${jobId}/retry-failed`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Gagal retry job.");
      await refresh(true);
      toast.success("Item gagal dikembalikan ke antrean.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal retry job.");
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelJob(jobId: string) {
    if (!window.confirm("Batalkan job ini? Item yang sedang processing akan ditandai needs review.")) return;
    setSubmitting(true);
    try {
      const response = await fetch(`/api/belanja-sync/jobs/${jobId}/cancel`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Gagal membatalkan job.");
      await refresh(true);
      toast.success("Job dibatalkan.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal membatalkan job.");
    } finally {
      setSubmitting(false);
    }
  }

  async function resetSyncState() {
    if (!window.confirm("Reset status Belanja Sync untuk project ini? Riwayat job dan item sync akan dihapus dari aplikasi Nota, tetapi transaksi yang sudah terkirim di Web Belanja tidak ikut dihapus.")) return;
    setSubmitting(true);
    try {
      const response = await fetch(`/api/belanja-sync/projects/${project.id}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Gagal reset status Belanja Sync.");
      setState(result.state as BelanjaProjectSyncState);
      setSelectedIds(new Set());
      initializedProjectRef.current = null;
      toast.success("Status Belanja Sync direset.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal reset status Belanja Sync.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="border-blue-200 dark:border-blue-900">
      <CardHeader className="gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle>Sinkronisasi Web Belanja</CardTitle>
            <CardDescription>
              Preview payload dari Resume. Runner lokal tetap harus dijalankan di PC yang tersambung VPN.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge className={runnerOnline ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}>
              Runner {runnerOnline ? "Online" : "Offline"}
            </Badge>
            <Badge className={state?.runner?.dryRun === false ? "bg-amber-50 text-amber-700" : "bg-cyan-50 text-cyan-700"}>
              Default Runner {state?.runner?.dryRun === false ? "LIVE" : "DRY RUN"}
            </Badge>
            <Badge className={state?.runner?.targetStatus === "connected" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}>
              Target {state?.runner?.targetStatus ?? "unknown"}
            </Badge>
            <Button variant="outline" size="sm" onClick={() => refresh()} disabled={loading || submitting}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={resetSyncState} disabled={loading || submitting}>
              <RotateCcw className="h-4 w-4" />
              Reset Status
            </Button>
          </div>
        </div>

        {!state?.schemaReady ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
            <div className="mb-1 flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />Migration belum aktif</div>
            <p>{state?.errorMessage ?? "Jalankan migration supabase/migrations/20260901_belanja_sync.sql dan isi SUPABASE_SERVICE_ROLE_KEY di server."}</p>
          </div>
        ) : null}

        {!dryRun && state?.runner?.dryRun !== false ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
            <div className="mb-1 flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />Runner default DRY RUN</div>
            <p>Job ini tetap akan diproses LIVE. Pastikan runner lokal memakai `BELANJA_FIELD_MAP_VERIFIED=true` sebelum item diproses.</p>
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-5">
          <SyncMetric label="Total Resume" value={rows.length.toString()} />
          <SyncMetric label="Terkirim Web" value={successCount.toString()} tone="ok" />
          <SyncMetric label="Pending" value={pendingCount.toString()} />
          <SyncMetric label="Gagal" value={failedCount.toString()} tone={failedCount > 0 ? "bad" : "default"} />
          <SyncMetric label="Terpilih" value={`${selectedIds.size} / ${formatRupiah(selectedSummary.totalAmount)}`} />
        </div>

        {latestJob ? (
          <div className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold">Job terakhir: {jobLabel(latestJob.status)}</p>
                <p className="text-slate-500">
                  {latestJob.successItems} sukses, {latestJob.failedItems} gagal, {latestJob.skippedItems} skipped dari {latestJob.totalItems} item
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {latestJob.failedItems > 0 ? <Button variant="outline" size="sm" onClick={() => retryJob(latestJob.id)} disabled={submitting}>Retry Gagal</Button> : null}
                {latestJob.status === "pending" || latestJob.status === "processing" ? (
                  <Button variant="destructive" size="sm" onClick={() => cancelJob(latestJob.id)} disabled={submitting}>Batalkan Job</Button>
                ) : null}
              </div>
            </div>
            <Progress value={progressValue} />
          </div>
        ) : null}

        {failedRows.length > 0 ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100">
            <div className="mb-2 flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4" />
              {failedRows.length} item perlu dicek
            </div>
            <div className="grid gap-2 lg:grid-cols-2">
              {failedRows.slice(0, 4).map((row) => (
                <div key={row.item.id} className="rounded border border-red-100 bg-white/70 p-2 dark:border-red-900 dark:bg-slate-950/50">
                  <p className="font-semibold">{row.payload.namaItem}</p>
                  <p className="text-xs">
                    {formatDateIndonesia(row.payload.tanggal)} - {row.payload.tahap} - {formatRupiah(row.payload.jumlah)}
                  </p>
                  <p className="mt-1 text-xs">
                    {row.validation.valid
                      ? row.latest?.errorMessage ?? "Runner menandai item gagal tanpa pesan error."
                      : row.validation.errors.join(" ")}
                  </p>
                  {row.latest ? <p className="mt-1 text-xs">Percobaan: {row.latest.attemptCount}</p> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 lg:grid-cols-[220px_1fr]">
          <Select value={filter} onValueChange={(value) => setFilter(value as StatusFilter)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="unsent">Belum Dikirim</SelectItem>
              <SelectItem value="success">Berhasil</SelectItem>
              <SelectItem value="failed">Gagal</SelectItem>
              <SelectItem value="all">Semua</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[260px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-8 pl-9 text-sm"
                placeholder="Cari item, tahap, vendor, ref, atau error"
              />
            </div>
            <Button variant="outline" size="sm" onClick={selectFiltered}>Pilih Semua</Button>
            <Button variant="outline" size="sm" onClick={clearFiltered}>Batalkan Semua</Button>
            <label className="inline-flex h-8 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-semibold dark:border-slate-800">
              <input type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} />
              Dry Run
            </label>
            <label className="inline-flex h-8 items-center gap-2 rounded-lg border border-red-200 px-3 text-xs font-semibold text-red-700 dark:border-red-900">
              <input
                type="checkbox"
                checked={forceResend}
                onChange={(event) => {
                  if (event.target.checked && !window.confirm("Aktifkan pilih item SUCCESS untuk kirim ulang? Ini berpotensi membuat duplikasi transaksi.")) return;
                  setForceResend(event.target.checked);
                }}
              />
              Izinkan Kirim Ulang
            </label>
            <Button onClick={() => createJob(false)} disabled={submitting || selectedIds.size === 0}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {dryRun ? `Buat Dry Run ${selectedIds.size} Item` : `Kirim LIVE ${selectedIds.size} Item`}
            </Button>
            {forceResend ? (
              <Button variant="destructive" onClick={() => createJob(true)} disabled={submitting || selectedIds.size === 0}>
                Kirim Ulang Terpilih
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="max-h-[520px] overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead className="sticky top-0 z-10 bg-slate-100 text-xs uppercase text-slate-500 dark:bg-slate-900">
              <tr>
                <th className="px-3 py-3">Pilih</th>
                <th className="px-3 py-3">Tanggal</th>
                <th className="px-3 py-3">Nama Item</th>
                <th className="px-3 py-3 text-right">Qty</th>
                <th className="px-3 py-3">Satuan</th>
                <th className="px-3 py-3 text-right">Harga Satuan</th>
                <th className="px-3 py-3 text-right">Jumlah</th>
                <th className="px-3 py-3">Status Sync</th>
                <th className="px-3 py-3">Target Ref / Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-900">
              {filteredRows.map((row) => {
                const selectable = row.validation.valid && canSelectForJob(row.status, forceResend);
                return (
                  <tr key={row.item.id} className="bg-white align-top hover:bg-blue-50/50 dark:bg-slate-950 dark:hover:bg-slate-900">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(row.item.id)}
                        disabled={!selectable}
                        onChange={(event) => toggleItem(row.item, event.target.checked)}
                        aria-label={`Pilih ${row.item.itemName}`}
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{formatDateIndonesia(row.payload.tanggal)}</td>
                    <td className="px-3 py-2">
                      <p className="font-medium">{row.payload.namaItem}</p>
                      <p className="text-xs text-slate-500">{row.payload.tahap} - {row.payload.kategori}</p>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.payload.qty}</td>
                    <td className="px-3 py-2">{row.payload.satuan}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatRupiah(row.payload.hargaSatuan)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatRupiah(getResumeItemAmount(row.item))}</td>
                    <td className="px-3 py-2"><Badge className={cn("w-fit", statusClass(row.status))}>{statusLabel(row.status)}</Badge></td>
                    <td className="max-w-80 px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
                      {row.latest?.targetReference ? <p className="font-semibold text-emerald-700">{row.latest.targetReference}</p> : null}
                      {!row.validation.valid ? (
                        <p className="flex gap-1 text-red-700"><XCircle className="mt-0.5 h-3 w-3 shrink-0" />{row.validation.errors.join(" ")}</p>
                      ) : row.status === "success" ? (
                        <p className="flex gap-1 text-emerald-700"><CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />Sudah tersubmit ke Web Belanja. Tidak dikirim ulang default.</p>
                      ) : row.status === "dry_run" ? (
                        <p className="flex gap-1 text-cyan-700"><CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />Dry run berhasil. Belum submit ke web target.</p>
                      ) : (
                        <p>{row.latest?.errorMessage ?? "-"}</p>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredRows.length === 0 ? (
                <tr>
                  <td className="px-3 py-8 text-center text-sm text-slate-500" colSpan={9}>
                    Tidak ada item yang cocok dengan filter atau pencarian.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function SyncMetric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "ok" | "bad" }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className={cn("mt-1 text-sm font-bold", tone === "ok" && "text-emerald-700", tone === "bad" && "text-red-700")}>{value}</p>
    </div>
  );
}
