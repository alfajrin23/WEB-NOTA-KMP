"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock3, Loader2, RefreshCcw, RotateCcw, Search, Send, Terminal, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MotionPage } from "@/components/ui/motion-page";
import { Progress } from "@/components/ui/progress";
import { buildBelanjaPayload, summarizeBelanjaPayloads, validateBelanjaPayload } from "@/lib/belanja-sync/payload";
import type { BelanjaProjectSyncState, BelanjaRunnerHeartbeat, BelanjaSyncItem, BelanjaSyncJob, BelanjaSyncOverviewProject } from "@/lib/belanja-sync/types";
import { cn } from "@/lib/utils";
import { useKdkmpStore } from "@/hooks/use-kdkmp-store";
import type { Project } from "@/types/domain";
import { formatDateIndonesia, formatProjectWilayah, formatDateTimeIndonesia, formatRupiah } from "@/utils/format";

type OverviewPayload = {
  schemaReady: boolean;
  runner: BelanjaRunnerHeartbeat | null;
  projects: BelanjaSyncOverviewProject[];
  errorMessage?: string;
};

type ModalRowStatus = "not_sent" | "pending" | "processing" | "success" | "failed" | "skipped" | "needs_review" | "dry_run";

function statusLabel(status: BelanjaSyncOverviewProject["status"]) {
  if (status === "selesai") return "Selesai";
  if (status === "sebagian") return "Sebagian";
  if (status === "ada_error") return "Ada Error";
  return "Belum Dikirim";
}

function statusClass(status: BelanjaSyncOverviewProject["status"]) {
  if (status === "selesai") return "bg-emerald-50 text-emerald-700";
  if (status === "sebagian") return "bg-blue-50 text-blue-700";
  if (status === "ada_error") return "bg-red-50 text-red-700";
  return "bg-slate-100 text-slate-600";
}

function modalStatusOf(latest: BelanjaSyncItem | undefined): ModalRowStatus {
  if (!latest) return "not_sent";
  if (latest.status === "skipped" && latest.errorMessage?.includes("DRY_RUN_OK")) return "dry_run";
  return latest.status;
}

function modalStatusLabel(status: ModalRowStatus) {
  if (status === "not_sent") return "Belum Dikirim";
  if (status === "pending") return "Pending";
  if (status === "processing") return "Sedang Dikirim";
  if (status === "success") return "Terkirim ke Web";
  if (status === "failed") return "Gagal";
  if (status === "needs_review") return "Needs Review";
  if (status === "dry_run") return "Dry Run OK";
  return "Skipped";
}

function modalStatusClass(status: ModalRowStatus) {
  if (status === "success") return "bg-emerald-50 text-emerald-700";
  if (status === "failed" || status === "needs_review") return "bg-red-50 text-red-700";
  if (status === "pending" || status === "processing") return "bg-blue-50 text-blue-700";
  if (status === "dry_run") return "bg-cyan-50 text-cyan-700";
  if (status === "skipped") return "bg-slate-100 text-slate-600";
  return "bg-amber-50 text-amber-700";
}

function canSelectForSend(status: ModalRowStatus) {
  return status !== "pending" && status !== "processing" && status !== "success";
}

function latestJobProgress(job: BelanjaSyncJob | null) {
  if (!job || job.totalItems <= 0) return 0;
  return Math.round(((job.successItems + job.failedItems + job.skippedItems) / job.totalItems) * 100);
}

export function BelanjaSyncView() {
  const { projects } = useKdkmpStore();
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [modalProject, setModalProject] = useState<Project | null>(null);
  const [modalState, setModalState] = useState<BelanjaProjectSyncState | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalSubmitting, setModalSubmitting] = useState(false);
  const [modalQuery, setModalQuery] = useState("");
  const [modalDryRun, setModalDryRun] = useState(true);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/belanja-sync/overview", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Gagal memuat overview Belanja Sync.");
      setOverview(payload as OverviewPayload);
    } catch (error) {
      setOverview({
        schemaReady: false,
        runner: null,
        projects: [],
        errorMessage: error instanceof Error ? error.message : "Gagal memuat overview Belanja Sync.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadModalState = useCallback(async (project: Project, initializeSelection = false) => {
    setModalLoading(true);
    try {
      const response = await fetch(`/api/belanja-sync/projects/${project.id}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Gagal memuat detail Belanja Sync.");
      const state = payload as BelanjaProjectSyncState;
      setModalState(state);
      if (initializeSelection) {
        const defaultIds = project.items
          .filter((item) => item.isIncludedInResumeTotal !== false)
          .filter((item) => {
            const rowPayload = buildBelanjaPayload(project, item);
            const validation = validateBelanjaPayload(rowPayload);
            const status = modalStatusOf(state.latestBySourceItemId[item.id]);
            return validation.valid && canSelectForSend(status);
          })
          .map((item) => item.id);
        setSelectedItemIds(new Set(defaultIds));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memuat detail Belanja Sync.");
    } finally {
      setModalLoading(false);
    }
  }, []);

  const openSendModal = useCallback((project: Project) => {
    setModalProject(project);
    setModalState(null);
    setModalQuery("");
    setModalDryRun(true);
    setSelectedItemIds(new Set());
    void loadModalState(project, true);
  }, [loadModalState]);

  const closeSendModal = useCallback(() => {
    setModalProject(null);
    setModalState(null);
    setModalQuery("");
    setSelectedItemIds(new Set());
  }, []);

  useEffect(() => {
    if (!modalProject) return;
    const interval = window.setInterval(() => void loadModalState(modalProject, false), 3_000);
    return () => window.clearInterval(interval);
  }, [loadModalState, modalProject]);

  const overviewByProject = useMemo(
    () => new Map((overview?.projects ?? []).map((project) => [project.projectId, project])),
    [overview?.projects],
  );

  const rows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return projects
      .map((project) => ({ project, sync: overviewByProject.get(project.id) }))
      .filter(({ project, sync }) => {
        if (!normalizedQuery) return true;
        const failedText = (sync?.failedDetails ?? [])
          .map((detail) => `${detail.itemName} ${detail.tanggal} ${detail.errorMessage}`)
          .join(" ");
        const haystack = [
          formatProjectWilayah(project),
          project.villageName,
          project.districtName,
          project.regencyName,
          statusLabel(sync?.status ?? "belum_dikirim"),
          failedText,
        ].join(" ").toLowerCase();
        return haystack.includes(normalizedQuery);
      })
      .sort((a, b) => {
        const score = (row: typeof a) => row.sync?.status === "ada_error" ? 0 : row.sync?.status === "sebagian" ? 1 : row.sync?.status === "selesai" ? 3 : 2;
        return score(a) - score(b) || a.project.villageName.localeCompare(b.project.villageName);
      });
  }, [overviewByProject, projects, query]);

  const modalRows = useMemo(() => {
    if (!modalProject) return [];
    return modalProject.items
      .filter((item) => item.isIncludedInResumeTotal !== false)
      .map((item) => {
        const latest = modalState?.latestBySourceItemId[item.id];
        const payload = buildBelanjaPayload(modalProject, item);
        const validation = validateBelanjaPayload(payload);
        const status = modalStatusOf(latest);
        return { item, latest, payload, validation, status };
      });
  }, [modalProject, modalState?.latestBySourceItemId]);

  const filteredModalRows = useMemo(() => {
    const normalizedQuery = modalQuery.trim().toLowerCase();
    if (!normalizedQuery) return modalRows;
    return modalRows.filter((row) => {
      const haystack = [
        row.payload.tanggal,
        row.payload.namaItem,
        row.payload.satuan,
        row.payload.tahap,
        row.payload.kategori,
        row.payload.vendor,
        modalStatusLabel(row.status),
        row.latest?.targetReference,
        row.latest?.errorMessage,
        row.validation.errors.join(" "),
      ].join(" ").toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [modalQuery, modalRows]);

  const selectedModalRows = useMemo(
    () => modalRows.filter((row) => selectedItemIds.has(row.item.id)),
    [modalRows, selectedItemIds],
  );
  const selectedSummary = useMemo(
    () => summarizeBelanjaPayloads(selectedModalRows.map((row) => row.payload)),
    [selectedModalRows],
  );
  const modalLatestJob = modalState?.jobs[0] ?? null;
  const modalProgress = latestJobProgress(modalLatestJob);
  const processingRow = modalRows.find((row) => row.status === "processing");
  const nextPendingRow = modalRows.find((row) => row.status === "pending");

  function toggleModalItem(itemId: string, checked: boolean) {
    setSelectedItemIds((current) => {
      const next = new Set(current);
      if (checked) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  }

  function selectAllModalRows() {
    setSelectedItemIds(new Set(
      modalRows
        .filter((row) => row.validation.valid && canSelectForSend(row.status))
        .map((row) => row.item.id),
    ));
  }

  function clearModalRows() {
    setSelectedItemIds(new Set());
  }

  async function createModalJob() {
    if (!modalProject) return;
    if (selectedItemIds.size === 0) {
      toast.error("Pilih minimal satu item Resume.");
      return;
    }
    const invalidRows = selectedModalRows.filter((row) => !row.validation.valid);
    if (invalidRows.length > 0) {
      toast.error(`${invalidRows.length} item belum valid untuk dikirim.`);
      return;
    }
    const confirmed = window.confirm(
      modalDryRun
        ? `Buat DRY RUN untuk ${selectedItemIds.size} item dari ${formatProjectWilayah(modalProject)}? Data hanya divalidasi, belum tersimpan ke web target.`
        : `KIRIM LIVE ${selectedItemIds.size} item dari ${formatProjectWilayah(modalProject)} ke Web Belanja? Data akan disubmit ke web target.`,
    );
    if (!confirmed) return;

    setModalSubmitting(true);
    try {
      const response = await fetch("/api/belanja-sync/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: modalProject.id,
          itemIds: [...selectedItemIds],
          dryRun: modalDryRun,
          forceResend: false,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Gagal membuat job Belanja Sync.");
      setModalState(result.state as BelanjaProjectSyncState);
      setSelectedItemIds(new Set());
      toast.success(result.message ?? "Job masuk antrean Belanja Sync.");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal membuat job Belanja Sync.");
    } finally {
      setModalSubmitting(false);
    }
  }

  async function resetModalProjectState() {
    if (!modalProject) return;
    if (!window.confirm(`Reset status Belanja Sync untuk ${formatProjectWilayah(modalProject)}? Riwayat job dan item sync akan dihapus dari aplikasi Nota, tetapi transaksi yang sudah terkirim di Web Belanja tidak ikut dihapus.`)) return;

    setModalSubmitting(true);
    try {
      const response = await fetch(`/api/belanja-sync/projects/${modalProject.id}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Gagal reset status Belanja Sync.");
      setModalState(result.state as BelanjaProjectSyncState);
      setSelectedItemIds(new Set());
      toast.success("Status Belanja Sync direset.");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal reset status Belanja Sync.");
    } finally {
      setModalSubmitting(false);
    }
  }

  const modalStatusMessage = useMemo(() => {
    if (!modalLatestJob) return "Pilih item Resume lalu buat job pengiriman.";
    if (!modalState?.runner?.online) return "Pending: runner lokal belum aktif atau heartbeat belum masuk ke Vercel.";
    if (modalState.runner.targetStatus !== "connected") return "Pending: runner hidup, tetapi website target/VPN belum connected.";
    if (processingRow) return `Sedang mengirim: ${processingRow.payload.namaItem}`;
    if (nextPendingRow) return `Menunggu runner mengambil item berikutnya: ${nextPendingRow.payload.namaItem}`;
    if (modalLatestJob.failedItems > 0) return "Selesai dengan item gagal. Lihat detail error di tabel.";
    return "Job selesai.";
  }, [modalLatestJob, modalState?.runner, nextPendingRow, processingRow]);

  return (
    <MotionPage>
      <div className="space-y-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-normal">Belanja Sync</h2>
            <p className="text-sm text-slate-500">Queue dan status runner lokal untuk pengiriman Resume ke Web Belanja.</p>
          </div>
          <Button variant="outline" onClick={refresh} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            Refresh
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Status Runner</CardTitle>
            <CardDescription>Runner berjalan di PC Windows yang tersambung VPN, bukan di Vercel.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-4">
            <Metric label="Runner" value={overview?.runner?.online ? "Online" : "Offline"} tone={overview?.runner?.online ? "ok" : "default"} />
            <Metric label="Target" value={overview?.runner?.targetStatus ?? "unknown"} tone={overview?.runner?.targetStatus === "connected" ? "ok" : "warn"} />
            <Metric label="Default Job" value={overview?.runner?.dryRun === false ? "LIVE" : "DRY RUN"} tone={overview?.runner?.dryRun === false ? "warn" : "default"} />
            <Metric label="Heartbeat" value={overview?.runner ? formatDateTimeIndonesia(overview.runner.lastSeenAt) : "-"} />
            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800 md:col-span-4">
              <p className="flex items-center gap-2 text-xs font-semibold text-slate-500"><Terminal className="h-3.5 w-3.5" />Runner lokal</p>
              <code className="mt-1 block w-fit rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-900 dark:text-slate-200">
                npm run belanja:runner
              </code>
            </div>
          </CardContent>
        </Card>

        {!overview?.schemaReady ? (
          <Card className="border-amber-200 dark:border-amber-900">
            <CardContent className="p-5 text-sm text-amber-800 dark:text-amber-100">
              {overview?.errorMessage ?? "Migration Belanja Sync belum dijalankan atau SUPABASE_SERVICE_ROLE_KEY belum tersedia di server."}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Progress Per Desa</CardTitle>
            <CardDescription>Pilih desa untuk membuat job pengiriman dan memantau progress item.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="relative w-full md:max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="pl-9"
                  placeholder="Cari desa, kecamatan, status, atau error"
                />
              </div>
              <p className="text-xs font-semibold text-slate-500">{rows.length} desa ditampilkan</p>
            </div>
            <div className="overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full min-w-[1080px] text-left text-sm">
                <thead className="bg-slate-100 text-xs uppercase text-slate-500 dark:bg-slate-900">
                  <tr>
                    <th className="px-4 py-3">Desa</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Success</th>
                    <th className="px-4 py-3 text-right">Gagal</th>
                    <th className="px-4 py-3 text-right">Pending</th>
                    <th className="px-4 py-3">Info Gagal</th>
                    <th className="px-4 py-3">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-900">
                  {rows.map(({ project, sync }) => (
                    <tr key={project.id} className="bg-white dark:bg-slate-950">
                      <td className="px-4 py-3">
                        <p className="font-semibold">{formatProjectWilayah(project)}</p>
                        <p className="text-xs text-slate-500">Kec. {project.districtName}, Kab. {project.regencyName}</p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={statusClass(sync?.status ?? "belum_dikirim")}>{statusLabel(sync?.status ?? "belum_dikirim")}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right">{sync?.successItems ?? 0}</td>
                      <td className="px-4 py-3 text-right">{sync?.failedItems ?? 0}</td>
                      <td className="px-4 py-3 text-right">{sync?.pendingItems ?? 0}</td>
                      <td className="max-w-[360px] px-4 py-3">
                        {sync?.failedDetails?.length ? (
                          <div className="space-y-2 text-xs">
                            {sync.failedDetails.slice(0, 2).map((detail) => (
                              <div key={`${project.id}-${detail.sourceResumeItemId}`} className="rounded border border-red-100 bg-red-50 p-2 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100">
                                <p className="font-semibold">{detail.itemName || "Item tanpa nama"}</p>
                                <p>{detail.tanggal ? formatDateIndonesia(detail.tanggal) : "-"} - {formatRupiah(detail.jumlah)}</p>
                                <p className="line-clamp-2">{detail.errorMessage}</p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" onClick={() => openSendModal(project)}>
                            <Send className="h-4 w-4" />
                            Kirim ke Web Belanja
                          </Button>
                          <Button asChild size="sm" variant="outline">
                            <Link href={`/projects/${project.id}/resume`}>Buka Resume</Link>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-sm text-slate-500" colSpan={7}>
                        Tidak ada desa yang cocok dengan pencarian.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {modalProject ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true">
            <div className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl dark:bg-slate-950">
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-4 dark:border-slate-800">
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-500">Kirim ke Web Belanja</p>
                  <h3 className="text-lg font-bold">{formatProjectWilayah(modalProject)}</h3>
                  <p className="text-sm text-slate-500">Kec. {modalProject.districtName}, Kab. {modalProject.regencyName}</p>
                </div>
                <Button size="icon" variant="outline" onClick={closeSendModal} aria-label="Tutup modal">
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="space-y-4 overflow-auto p-4">
                <div className="grid gap-3 md:grid-cols-5">
                  <Metric label="Total Resume" value={modalRows.length.toString()} />
                  <Metric label="Terpilih" value={`${selectedItemIds.size} item`} />
                  <Metric label="Nilai Terpilih" value={formatRupiah(selectedSummary.totalAmount)} />
                  <Metric label="Runner" value={modalState?.runner?.online ? "Online" : "Offline"} tone={modalState?.runner?.online ? "ok" : "warn"} />
                  <Metric label="Target" value={modalState?.runner?.targetStatus ?? "unknown"} tone={modalState?.runner?.targetStatus === "connected" ? "ok" : "warn"} />
                </div>

                {!modalDryRun && modalState?.runner?.dryRun !== false ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                    <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />Runner default DRY RUN</div>
                    <p className="mt-1">Job ini tetap akan diproses LIVE. Mapping Belanja harus sudah terverifikasi lewat dry run atau riwayat sukses sebelumnya, atau set `BELANJA_FIELD_MAP_VERIFIED=true` pada runner yang memang sudah dicek.</p>
                  </div>
                ) : null}

                <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold">{modalStatusMessage}</p>
                      {modalLatestJob ? (
                        <p className="text-xs text-slate-500">
                          {modalLatestJob.successItems} sukses, {modalLatestJob.failedItems} gagal, {modalLatestJob.skippedItems} skipped dari {modalLatestJob.totalItems} item
                        </p>
                      ) : (
                        <p className="text-xs text-slate-500">Belum ada job aktif untuk modal ini.</p>
                      )}
                    </div>
                    <Badge className={modalDryRun ? "bg-cyan-50 text-cyan-700" : "bg-amber-50 text-amber-700"}>
                      {modalDryRun ? "DRY RUN" : "LIVE"}
                    </Badge>
                  </div>
                  <Progress value={modalProgress} />
                </div>

                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="relative w-full lg:max-w-md">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={modalQuery}
                      onChange={(event) => setModalQuery(event.target.value)}
                      className="pl-9"
                      placeholder="Cari item, tahap, vendor, ref, atau error"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" onClick={selectAllModalRows} disabled={modalLoading}>Pilih Semua</Button>
                    <Button variant="outline" size="sm" onClick={clearModalRows} disabled={modalLoading}>Batalkan Semua</Button>
                    <Button variant="outline" size="sm" onClick={resetModalProjectState} disabled={modalSubmitting || modalLoading}>
                      <RotateCcw className="h-4 w-4" />
                      Reset Status
                    </Button>
                    <label className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-semibold dark:border-slate-800">
                      <input type="checkbox" checked={modalDryRun} onChange={(event) => setModalDryRun(event.target.checked)} />
                      Dry Run
                    </label>
                    <Button onClick={createModalJob} disabled={modalSubmitting || modalLoading || selectedItemIds.size === 0}>
                      {modalSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      {modalDryRun ? "Buat Dry Run" : "Kirim LIVE ke Web"}
                    </Button>
                  </div>
                </div>

                {!modalState?.runner?.online ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                    <div className="flex items-center gap-2 font-semibold"><Clock3 className="h-4 w-4" />Pending menunggu runner lokal</div>
                    <code className="mt-2 block w-fit rounded bg-white px-2 py-1 text-xs font-semibold dark:bg-slate-950">npm run belanja:runner</code>
                  </div>
                ) : null}

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
                        <th className="px-3 py-3">Status</th>
                        <th className="px-3 py-3">Progress / Error</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-900">
                      {filteredModalRows.map((row) => {
                        const selectable = row.validation.valid && canSelectForSend(row.status);
                        return (
                          <tr key={row.item.id} className="bg-white align-top hover:bg-blue-50/50 dark:bg-slate-950 dark:hover:bg-slate-900">
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                checked={selectedItemIds.has(row.item.id)}
                                disabled={!selectable || modalSubmitting}
                                onChange={(event) => toggleModalItem(row.item.id, event.target.checked)}
                                aria-label={`Pilih ${row.payload.namaItem}`}
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
                            <td className="px-3 py-2 text-right tabular-nums">{formatRupiah(row.payload.jumlah)}</td>
                            <td className="px-3 py-2">
                              <Badge className={cn("w-fit", modalStatusClass(row.status))}>{modalStatusLabel(row.status)}</Badge>
                            </td>
                            <td className="max-w-96 px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
                              {row.status === "success" ? (
                                <p className="flex gap-1 text-emerald-700"><CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />{row.latest?.targetReference ?? "Sudah tersubmit ke Web Belanja."}</p>
                              ) : !row.validation.valid ? (
                                <p className="flex gap-1 text-red-700"><XCircle className="mt-0.5 h-3 w-3 shrink-0" />{row.validation.errors.join(" ")}</p>
                              ) : row.status === "failed" || row.status === "needs_review" ? (
                                <p className="flex gap-1 text-red-700"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{row.latest?.errorMessage ?? "Gagal tanpa pesan error."}</p>
                              ) : row.status === "dry_run" ? (
                                <p className="flex gap-1 text-cyan-700"><CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />Dry run berhasil. Belum submit ke web target.</p>
                              ) : row.status === "processing" ? (
                                <p className="flex gap-1 text-blue-700"><Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin" />Sedang diproses runner.</p>
                              ) : row.status === "pending" ? (
                                <p className="flex gap-1 text-blue-700"><Clock3 className="mt-0.5 h-3 w-3 shrink-0" />Menunggu giliran runner.</p>
                              ) : (
                                <p>{row.latest?.errorMessage ?? "-"}</p>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {filteredModalRows.length === 0 ? (
                        <tr>
                          <td className="px-3 py-8 text-center text-sm text-slate-500" colSpan={9}>
                            Tidak ada item yang cocok.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </MotionPage>
  );
}

function Metric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "ok" | "warn" }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className={tone === "ok" ? "mt-1 font-bold text-emerald-700" : tone === "warn" ? "mt-1 font-bold text-amber-700" : "mt-1 font-bold"}>{value}</p>
    </div>
  );
}
