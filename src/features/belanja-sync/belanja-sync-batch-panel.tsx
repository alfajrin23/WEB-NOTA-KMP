"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Loader2, RefreshCcw, Search, Send, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useKdkmpStore } from "@/hooks/use-kdkmp-store";
import { fetchBelanjaSyncOverview, readCachedBelanjaSyncOverview, type BelanjaSyncOverviewPayload } from "@/lib/belanja-sync/client-overview";
import type { BelanjaSyncJobStatus, BelanjaSyncOverviewProject } from "@/lib/belanja-sync/types";
import { formatProjectWilayah } from "@/utils/format";

type DisplayStatus = "belum_dikirim" | "sebagian" | "sedang_dikirim" | "selesai" | "ada_error";
type StatusFilter = "semua" | DisplayStatus;

type BatchEntry = {
  projectId: string;
  villageName: string;
  jobId?: string;
  status: "queued" | "processing" | "completed" | "failed";
  percent: number;
  stage?: string | null;
  message?: string | null;
  error?: string | null;
};

type CreateBatchResponse = {
  results: Array<{
    projectId: string;
    villageName: string;
    jobId?: string;
    status: "queued" | "failed";
    error?: string;
  }>;
  queued: number;
  failed: number;
  estimateSecondsPerVillage: number;
};

type BatchProgressResponse = {
  jobs: Array<{
    jobId: string;
    projectId: string;
    status: BelanjaSyncJobStatus;
    percent: number;
    stage?: string | null;
    message?: string | null;
    error?: string | null;
  }>;
  totalPercent: number;
  remainingSeconds: number;
  estimateSecondsPerVillage: number;
};

function displayStatus(sync?: BelanjaSyncOverviewProject): DisplayStatus {
  if (sync?.latestJob?.status === "pending" || sync?.latestJob?.status === "processing") return "sedang_dikirim";
  if (sync?.status === "ada_error") return "ada_error";
  if (sync?.status === "selesai") return "selesai";
  if (sync?.status === "sebagian") return "sebagian";
  return "belum_dikirim";
}

function statusLabel(status: DisplayStatus) {
  if (status === "sedang_dikirim") return "Sedang Dikirim";
  if (status === "selesai") return "Selesai";
  if (status === "sebagian") return "Sebagian";
  if (status === "ada_error") return "Ada Error";
  return "Belum Dikirim";
}

function statusClass(status: DisplayStatus) {
  if (status === "sedang_dikirim") return "border-sky-200 bg-sky-100 text-sky-800 dark:border-sky-800 dark:bg-sky-950/70 dark:text-sky-200";
  if (status === "selesai") return "border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-200";
  if (status === "sebagian") return "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950/70 dark:text-amber-200";
  if (status === "ada_error") return "border-red-200 bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-950/70 dark:text-red-200";
  return "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200";
}

function activityTime(sync?: BelanjaSyncOverviewProject) {
  const value = sync?.latestJob?.finishedAt ?? sync?.latestJob?.startedAt ?? sync?.latestJob?.createdAt ?? "";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "< 1 menit";
  const roundedMinutes = Math.max(1, Math.ceil(seconds / 60));
  if (roundedMinutes < 60) return `± ${roundedMinutes} menit`;
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  return minutes > 0 ? `± ${hours} jam ${minutes} menit` : `± ${hours} jam`;
}

function isTerminal(status: BatchEntry["status"]) {
  return status === "completed" || status === "failed";
}

export function BelanjaSyncBatchPanel() {
  const { projects, loading: projectsLoading } = useKdkmpStore();
  const [overview, setOverview] = useState<BelanjaSyncOverviewPayload | null>(() => readCachedBelanjaSyncOverview());
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("semua");
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  const [batchDryRun, setBatchDryRun] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchEntries, setBatchEntries] = useState<BatchEntry[]>([]);
  const [batchPercent, setBatchPercent] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [estimateSecondsPerVillage, setEstimateSecondsPerVillage] = useState(741);

  const refresh = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const payload = await fetchBelanjaSyncOverview({ force, maxCacheAgeMs: force ? 0 : 30_000, retries: 1 });
      setOverview(payload);
    } catch (error) {
      toast.warning(error instanceof Error ? error.message : "Status Belanja Sync belum dapat diperbarui.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(false);
  }, [refresh]);

  const overviewByProject = useMemo(
    () => new Map((overview?.projects ?? []).map((entry) => [entry.projectId, entry])),
    [overview?.projects],
  );

  const rows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return projects
      .map((project) => {
        const sync = overviewByProject.get(project.id);
        const status = displayStatus(sync);
        return { project, sync, status, activityAt: activityTime(sync) };
      })
      .filter(({ project, status }) => {
        if (statusFilter !== "semua" && status !== statusFilter) return false;
        if (!normalizedQuery) return true;
        return `${formatProjectWilayah(project)} ${project.villageName} ${project.districtName} ${project.regencyName} ${statusLabel(status)}`
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .sort((a, b) => {
        if (a.status === "sedang_dikirim" && b.status !== "sedang_dikirim") return -1;
        if (b.status === "sedang_dikirim" && a.status !== "sedang_dikirim") return 1;
        if (a.activityAt !== b.activityAt) return b.activityAt - a.activityAt;
        return a.project.villageName.localeCompare(b.project.villageName);
      });
  }, [overviewByProject, projects, query, statusFilter]);

  const selectableRows = useMemo(
    () => rows.filter(({ status }) => status !== "sedang_dikirim" && status !== "selesai"),
    [rows],
  );

  const batchDone = batchEntries.length > 0 && batchEntries.every((entry) => isTerminal(entry.status));
  const queuedJobIds = useMemo(() => batchEntries.flatMap((entry) => entry.jobId ? [entry.jobId] : []), [batchEntries]);

  useEffect(() => {
    if (!batchOpen || queuedJobIds.length === 0 || batchDone) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/belanja-sync/batch?jobIds=${encodeURIComponent(queuedJobIds.join(","))}`, { cache: "no-store" });
        const payload = await response.json() as BatchProgressResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Gagal memuat progress batch.");
        if (cancelled) return;

        const progressByJob = new Map(payload.jobs.map((job) => [job.jobId, job]));
        setBatchEntries((current) => current.map((entry) => {
          if (!entry.jobId) return entry;
          const progress = progressByJob.get(entry.jobId);
          if (!progress) return entry;
          const failed = progress.status === "failed" || progress.status === "completed_with_errors" || progress.status === "cancelled";
          const completed = progress.status === "completed";
          return {
            ...entry,
            status: failed ? "failed" : completed ? "completed" : progress.status === "processing" ? "processing" : "queued",
            percent: progress.percent,
            stage: progress.stage,
            message: progress.message,
            error: progress.error,
          };
        }));
        setBatchPercent(payload.totalPercent);
        setRemainingSeconds(payload.remainingSeconds);
        setEstimateSecondsPerVillage(payload.estimateSecondsPerVillage);
      } catch (error) {
        if (!cancelled) toast.warning(error instanceof Error ? error.message : "Progress batch sementara tidak tersedia.");
      }
    };

    void poll();
    const interval = window.setInterval(() => void poll(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [batchDone, batchOpen, queuedJobIds]);

  useEffect(() => {
    if (!batchDone) return;
    void refresh(true);
  }, [batchDone, refresh]);

  function toggleProject(projectId: string, checked: boolean) {
    setSelectedProjectIds((current) => {
      const next = new Set(current);
      if (checked) next.add(projectId);
      else next.delete(projectId);
      return next;
    });
  }

  function selectVisible() {
    setSelectedProjectIds((current) => {
      const next = new Set(current);
      selectableRows.forEach(({ project }) => next.add(project.id));
      return next;
    });
  }

  async function startBatch() {
    const projectIds = [...selectedProjectIds];
    if (projectIds.length === 0) {
      toast.error("Pilih minimal satu desa.");
      return;
    }
    if (!overview?.runner?.online || overview.runner.targetStatus !== "connected") {
      toast.error("Runner lokal atau koneksi target belum siap. Pastikan VPN/runner connected sebelum kirim batch.");
      return;
    }

    const estimated = formatDuration(projectIds.length * estimateSecondsPerVillage);
    const confirmed = window.confirm(
      `${batchDryRun ? "DRY RUN" : "LIVE"} untuk ${projectIds.length} desa akan dimasukkan ke antrean. Estimasi awal ${estimated}. Jika satu desa gagal, proses akan lanjut ke desa berikutnya. Lanjutkan?`,
    );
    if (!confirmed) return;

    setSubmitting(true);
    setBatchOpen(true);
    setBatchPercent(0);
    setRemainingSeconds(projectIds.length * estimateSecondsPerVillage);
    try {
      const response = await fetch("/api/belanja-sync/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectIds, dryRun: batchDryRun }),
      });
      const payload = await response.json() as CreateBatchResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Gagal membuat batch Belanja Sync.");
      setEstimateSecondsPerVillage(payload.estimateSecondsPerVillage);
      setBatchEntries(payload.results.map((entry) => ({
        projectId: entry.projectId,
        villageName: entry.villageName,
        jobId: entry.jobId,
        status: entry.status === "failed" ? "failed" : "queued",
        percent: 0,
        error: entry.error ?? null,
      })));
      setSelectedProjectIds(new Set());
      if (payload.failed > 0) toast.warning(`${payload.queued} desa masuk antrean, ${payload.failed} desa gagal dibuatkan job dan dilewati.`);
      else toast.success(`${payload.queued} desa masuk antrean Belanja Sync.`);
    } catch (error) {
      setBatchOpen(false);
      toast.error(error instanceof Error ? error.message : "Gagal membuat batch Belanja Sync.");
    } finally {
      setSubmitting(false);
    }
  }

  const successfulVillages = batchEntries.filter((entry) => entry.status === "completed").length;
  const failedVillages = batchEntries.filter((entry) => entry.status === "failed").length;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle>Pengiriman Multi Desa</CardTitle>
            <CardDescription>Pilih beberapa desa, kirim melalui queue existing, dan pantau progress serta ETA dalam satu modal.</CardDescription>
          </div>
          <Button variant="outline" onClick={() => void refresh(true)} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            Refresh Status
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {(["belum_dikirim", "sebagian", "sedang_dikirim", "selesai", "ada_error"] as DisplayStatus[]).map((status) => {
            const count = projects.filter((project) => displayStatus(overviewByProject.get(project.id)) === status).length;
            return (
              <button key={status} type="button" onClick={() => setStatusFilter(status)} className="rounded-lg border border-slate-200 p-3 text-left transition hover:-translate-y-0.5 hover:shadow-sm dark:border-slate-800">
                <Badge className={statusClass(status)}>{statusLabel(status)}</Badge>
                <p className="mt-2 text-2xl font-bold tabular-nums">{count}</p>
                <p className="text-xs text-slate-500">desa</p>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex w-full flex-col gap-2 sm:flex-row xl:max-w-3xl">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" placeholder="Cari desa, kecamatan, kabupaten, atau status" />
            </div>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-800 dark:bg-slate-950">
              <option value="semua">Semua status</option>
              <option value="sedang_dikirim">Sedang Dikirim</option>
              <option value="sebagian">Sebagian</option>
              <option value="belum_dikirim">Belum Dikirim</option>
              <option value="selesai">Selesai</option>
              <option value="ada_error">Ada Error</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={selectVisible}>Pilih yang tampil</Button>
            <Button variant="outline" size="sm" onClick={() => setSelectedProjectIds(new Set())}>Batalkan pilihan</Button>
            <label className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-semibold dark:border-slate-800">
              <input type="checkbox" checked={batchDryRun} onChange={(event) => setBatchDryRun(event.target.checked)} />
              Dry Run
            </label>
            <Button onClick={startBatch} disabled={submitting || selectedProjectIds.size === 0}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Kirim {selectedProjectIds.size} Desa
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 dark:border-slate-800">
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="sticky top-0 z-10 bg-slate-100 text-xs uppercase text-slate-500 dark:bg-slate-900">
                <tr>
                  <th className="px-3 py-3">Pilih</th>
                  <th className="px-3 py-3">Desa</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3 text-right">Progress</th>
                  <th className="px-3 py-3">Terakhir Diproses</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-900">
                {rows.map(({ project, sync, status }) => {
                  const selectable = status !== "sedang_dikirim" && status !== "selesai";
                  const job = sync?.latestJob;
                  const completed = (sync?.successItems ?? 0) + (sync?.failedItems ?? 0) + Math.max(0, (sync?.totalItems ?? 0) - (sync?.successItems ?? 0) - (sync?.failedItems ?? 0) - (sync?.pendingItems ?? 0));
                  const progress = (sync?.totalItems ?? 0) > 0 ? Math.round((completed / (sync?.totalItems ?? 1)) * 100) : 0;
                  return (
                    <tr key={project.id} className="bg-white align-middle hover:bg-slate-50 dark:bg-slate-950 dark:hover:bg-slate-900/70">
                      <td className="px-3 py-3">
                        <input type="checkbox" checked={selectedProjectIds.has(project.id)} disabled={!selectable || submitting} onChange={(event) => toggleProject(project.id, event.target.checked)} aria-label={`Pilih ${project.villageName}`} />
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-semibold">{formatProjectWilayah(project)}</p>
                        <p className="text-xs text-slate-500">Kec. {project.districtName}, Kab. {project.regencyName}</p>
                      </td>
                      <td className="px-3 py-3"><Badge className={statusClass(status)}>{statusLabel(status)}</Badge></td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums">{progress}%</td>
                      <td className="px-3 py-3 text-xs text-slate-500">{job ? new Date(job.finishedAt ?? job.startedAt ?? job.createdAt).toLocaleString("id-ID") : "Belum pernah dikirim"}</td>
                    </tr>
                  );
                })}
                {projectsLoading && projects.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">Memuat desa...</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">Tidak ada desa yang cocok.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-xs text-slate-500">Urutan otomatis menempatkan desa yang sedang dikirim paling atas, lalu desa dengan aktivitas pengiriman terbaru. Desa selesai dinonaktifkan dari batch untuk mencegah pengiriman ulang tidak sengaja.</p>
      </CardContent>

      {batchOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-4" role="dialog" aria-modal="true">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-slate-950">
            <div className="flex items-start justify-between border-b border-slate-200 p-4 dark:border-slate-800">
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">Progress Pengiriman Multi Desa</p>
                <h3 className="text-lg font-bold">{batchDone ? "Batch selesai" : "Batch sedang diproses"}</h3>
              </div>
              <Button size="icon" variant="outline" onClick={() => setBatchOpen(false)} aria-label="Tutup progress batch"><X className="h-4 w-4" /></Button>
            </div>

            <div className="space-y-4 overflow-auto p-4">
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800"><p className="text-xs text-slate-500">Total Desa</p><p className="mt-1 text-xl font-bold">{batchEntries.length}</p></div>
                <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800"><p className="text-xs text-slate-500">Selesai</p><p className="mt-1 text-xl font-bold text-emerald-700 dark:text-emerald-300">{successfulVillages}</p></div>
                <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800"><p className="text-xs text-slate-500">Gagal</p><p className="mt-1 text-xl font-bold text-red-700 dark:text-red-300">{failedVillages}</p></div>
                <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800"><p className="text-xs text-slate-500">Estimasi Sisa</p><p className="mt-1 text-xl font-bold">{batchDone ? "Selesai" : formatDuration(remainingSeconds)}</p></div>
              </div>

              <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">Progress data keseluruhan</p>
                    <p className="text-xs text-slate-500">ETA awal menggunakan median histori job sukses, lalu berkurang mengikuti progress aktual.</p>
                  </div>
                  <span className="text-lg font-bold tabular-nums">{batchPercent}%</span>
                </div>
                <Progress value={batchPercent} />
              </div>

              <div className="space-y-3">
                {batchEntries.map((entry) => (
                  <div key={entry.projectId} className={`rounded-lg border p-3 ${entry.status === "failed" ? "border-red-200 bg-red-50/70 dark:border-red-900 dark:bg-red-950/20" : "border-slate-200 dark:border-slate-800"}`}>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-semibold">{entry.villageName}</p>
                        <p className="text-xs text-slate-500">{entry.stage ?? (entry.status === "queued" ? "Menunggu runner" : entry.status)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {entry.status === "completed" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : entry.status === "failed" ? <XCircle className="h-4 w-4 text-red-600" /> : entry.status === "processing" ? <Loader2 className="h-4 w-4 animate-spin text-sky-600" /> : <Clock3 className="h-4 w-4 text-amber-600" />}
                        <span className="font-bold tabular-nums">{entry.percent}%</span>
                      </div>
                    </div>
                    <Progress value={entry.percent} className="mt-2" />
                    {entry.message ? <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">{entry.message}</p> : null}
                    {entry.error ? <p className="mt-2 flex gap-1 text-xs font-medium text-red-700 dark:text-red-300"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{entry.error}</p> : null}
                  </div>
                ))}
              </div>

              {batchDone && failedVillages > 0 ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100">
                  <p className="font-semibold">Batch selesai dengan {failedVillages} desa gagal.</p>
                  <p className="mt-1">Desa gagal sudah dilewati sehingga desa berikutnya tetap diproses. Alasan kegagalan tercatat pada masing-masing desa di atas.</p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
