"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarDays, FilePlus2, FileText, Loader2, ReceiptText, RefreshCcw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { MotionPage } from "@/components/ui/motion-page";
import { fetchBelanjaSyncOverview, readCachedBelanjaSyncOverview } from "@/lib/belanja-sync/client-overview";
import { fetchLiveResumeTotals } from "@/lib/history/live-resume-totals";
import { groupDocumentsForPresentation } from "@/lib/pln-document-groups";
import { buildProjectSummary } from "@/lib/resume-calculations";
import { useKdkmpStore } from "@/hooks/use-kdkmp-store";
import type { BelanjaSyncOverviewProject } from "@/lib/belanja-sync/types";
import { formatDateIndonesia, formatDateTimeIndonesia, formatProjectWilayah, formatRupiah } from "@/utils/format";

function belanjaStatusLabel(status: BelanjaSyncOverviewProject["status"] | undefined) {
  if (status === "selesai") return "Selesai";
  if (status === "sebagian") return "Sebagian";
  if (status === "ada_error") return "Ada error";
  return "Belum dikirim";
}

function belanjaStatusClass(status: BelanjaSyncOverviewProject["status"] | undefined) {
  if (status === "selesai") return "bg-emerald-50 text-emerald-700";
  if (status === "sebagian") return "bg-blue-50 text-blue-700";
  if (status === "ada_error") return "bg-red-50 text-red-700";
  return "bg-slate-100 text-slate-600";
}

function overviewMap(projects: BelanjaSyncOverviewProject[] | undefined) {
  return Object.fromEntries((projects ?? []).map((project) => [project.projectId, project]));
}

export function HistoryView() {
  const {
    projects,
    vendors,
    generatedNotas,
    customNotes,
    history,
    loading,
    syncError,
    refresh,
    dashboardProjectStats,
    dashboardSummaryOnly,
  } = useKdkmpStore();
  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [visibleCount, setVisibleCount] = useState(12);
  const [belanjaOverview, setBelanjaOverview] = useState<Record<string, BelanjaSyncOverviewProject>>({});
  const [belanjaOverviewLoading, setBelanjaOverviewLoading] = useState(false);
  const [belanjaOverviewError, setBelanjaOverviewError] = useState<string | null>(null);
  const [resumeTotals, setResumeTotals] = useState<Record<string, number>>({});
  const [resumeTotalsLoading, setResumeTotalsLoading] = useState(false);
  const [resumeTotalsError, setResumeTotalsError] = useState<string | null>(null);

  const loadBelanjaOverview = useCallback(async (options: { force?: boolean } = {}) => {
    setBelanjaOverviewLoading(true);
    try {
      const payload = await fetchBelanjaSyncOverview({ force: options.force });
      setBelanjaOverview(overviewMap(payload.projects));
      setBelanjaOverviewError(payload.schemaReady ? null : payload.errorMessage ?? "Belanja Sync belum siap.");
    } catch (error) {
      const cached = readCachedBelanjaSyncOverview();
      if (cached?.projects?.length) setBelanjaOverview(overviewMap(cached.projects));
      setBelanjaOverviewError(error instanceof Error ? error.message : "Gagal memuat status Belanja Sync.");
    } finally {
      setBelanjaOverviewLoading(false);
    }
  }, []);

  const loadResumeTotals = useCallback(async (projectIds: string[]) => {
    if (projectIds.length === 0) {
      setResumeTotals({});
      setResumeTotalsError(null);
      return;
    }
    setResumeTotalsLoading(true);
    try {
      setResumeTotals(await fetchLiveResumeTotals(projectIds));
      setResumeTotalsError(null);
    } catch (error) {
      setResumeTotalsError(error instanceof Error ? error.message : "Gagal memuat total Resume terbaru.");
    } finally {
      setResumeTotalsLoading(false);
    }
  }, []);

  useEffect(() => {
    const cached = readCachedBelanjaSyncOverview();
    if (cached?.projects?.length) setBelanjaOverview(overviewMap(cached.projects));
    void loadBelanjaOverview();
  }, [loadBelanjaOverview]);

  useEffect(() => {
    void loadResumeTotals(projects.map((project) => project.id));
  }, [loadResumeTotals, projects]);

  const dashboardStatsByProject = useMemo(() => {
    return new Map(dashboardProjectStats.map((row) => [row.projectId, row]));
  }, [dashboardProjectStats]);

  function retryDataLoad() {
    void refresh();
    void loadBelanjaOverview({ force: true });
    void loadResumeTotals(projects.map((project) => project.id));
  }

  const rows = useMemo(() => {
    return projects
      .map((project) => {
        const dashboardStats = dashboardStatsByProject.get(project.id);
        const baseSummary = dashboardSummaryOnly && project.items.length === 0 && dashboardStats
          ? { grandTotal: dashboardStats.grandTotal }
          : buildProjectSummary(project, vendors);
        const liveGrandTotal = resumeTotals[project.id];
        const summary = {
          ...baseSummary,
          grandTotal: typeof liveGrandTotal === "number" ? liveGrandTotal : baseSummary.grandTotal,
        };
        const docs = groupDocumentsForPresentation(generatedNotas.filter((doc) => doc.projectId === project.id));
        const customs = customNotes.filter((doc) => doc.projectId === project.id);
        const docCount = dashboardSummaryOnly && dashboardStats
          ? dashboardStats.generatedNoteCount ?? Math.max((dashboardStats.notaCount ?? 0) - (dashboardStats.customNoteCount ?? 0), 0)
          : docs.length;
        const customCount = dashboardSummaryOnly && dashboardStats
          ? dashboardStats.customNoteCount ?? customs.length
          : customs.length;
        const lastHistory = history.find((entry) => entry.projectId === project.id);
        return { project, summary, docs, customs, docCount, customCount, lastHistory };
      })
      .filter(({ project }) => `${project.villageName} ${project.projectName} ${project.districtName} ${project.regencyName}`.toLowerCase().includes(query.toLowerCase()))
      .filter(({ project }) => !dateFrom || (project.reportDate ?? project.projectDate) >= dateFrom)
      .filter(({ project }) => !dateTo || (project.reportDate ?? project.projectDate) <= dateTo)
      .sort((a, b) => new Date(b.project.updatedAt).getTime() - new Date(a.project.updatedAt).getTime());
  }, [customNotes, dashboardStatsByProject, dashboardSummaryOnly, dateFrom, dateTo, generatedNotas, history, projects, query, resumeTotals, vendors]);

  if (loading && projects.length === 0) {
    return <Card><CardContent className="p-8">Memuat ringkasan history dari Supabase...</CardContent></Card>;
  }

  const dataError = syncError ?? resumeTotalsError ?? belanjaOverviewError;
  const dataLoading = loading || resumeTotalsLoading || belanjaOverviewLoading;

  return (
    <MotionPage>
      <div className="space-y-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-normal">History Pembuatan Nota/Kwitansi</h2>
            <p className="text-sm text-slate-500">Buka kembali project, resume, hasil generate, edit kwitansi, dan nota tambahan.</p>
          </div>
          <Button asChild>
            <Link href="/tambah-desa"><FilePlus2 className="h-4 w-4" />Tambah Desa / Kelurahan</Link>
          </Button>
        </div>

        {dataError ? (
          <Card className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
            <CardContent className="flex flex-col gap-3 p-4 text-sm text-amber-900 dark:text-amber-100 md:flex-row md:items-center md:justify-between">
              <div className="flex gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>Data terakhir tetap ditampilkan. Sinkronisasi terbaru gagal: {dataError}</p>
              </div>
              <Button variant="outline" size="sm" onClick={retryDataLoad} disabled={dataLoading}>
                {dataLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                Refresh
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Filter History</CardTitle>
            <CardDescription>Total Resume dibaca langsung dari agregat item Resume terbaru di Supabase agar selalu sinkron.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 lg:grid-cols-[1fr_190px_190px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari nama desa/kelurahan, project, kecamatan, kabupaten" />
              </div>
              <div className="relative">
                <CalendarDays className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <DateInput className="pl-9" value={dateFrom} onValueChange={setDateFrom} aria-label="Tanggal mulai" />
              </div>
              <div className="relative">
                <CalendarDays className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <DateInput className="pl-9" value={dateTo} onValueChange={setDateTo} aria-label="Tanggal akhir" />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4">
          {rows.slice(0, visibleCount).map(({ project, summary, docCount, customCount, lastHistory }) => (
            <Card key={project.id}>
              <CardHeader className="gap-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <CardTitle>{formatProjectWilayah(project)}</CardTitle>
                    <CardDescription>
                      {project.projectName} - Kec. {project.districtName}, Kab. {project.regencyName}
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge>{project.status}</Badge>
                    <Badge className="bg-blue-50 text-blue-700">{docCount} nota</Badge>
                    <Badge className="bg-emerald-50 text-emerald-700">{customCount} custom</Badge>
                    <Badge className={belanjaStatusClass(belanjaOverview[project.id]?.status)}>
                      Belanja: {belanjaStatusLabel(belanjaOverview[project.id]?.status)}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
                  <div className="grid gap-2 text-sm md:grid-cols-3">
                    <div>
                      <p className="text-xs font-semibold text-slate-500">Tanggal laporan</p>
                      <p>{formatDateIndonesia(project.reportDate ?? project.projectDate)}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-500">Total resume</p>
                      <p className="font-semibold">{formatRupiah(summary.grandTotal)}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-500">Aktivitas terakhir</p>
                      <p>{lastHistory ? `${lastHistory.description} (${formatDateTimeIndonesia(lastHistory.createdAt)})` : "Belum ada history proses."}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
                    <Button asChild size="sm" variant="outline"><Link href={`/projects/${project.id}/resume`}><FileText className="h-4 w-4" />Resume</Link></Button>
                    <Button asChild size="sm" variant="outline"><Link href={`/projects/${project.id}/cek-nota`}><ReceiptText className="h-4 w-4" />Cek Nota</Link></Button>
                    <Button asChild size="sm" variant="outline"><Link href={`/projects/${project.id}/edit-kwitansi`}>Edit Kwitansi</Link></Button>
                    <Button asChild size="sm" variant="outline"><Link href={`/projects/${project.id}/custom-note`}>Custom Note</Link></Button>
                    <Button asChild size="sm"><Link href={`/projects/${project.id}/export`}>Export</Link></Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {visibleCount < rows.length ? (
          <div className="flex justify-center">
            <Button variant="outline" onClick={() => setVisibleCount((count) => count + 12)}>Muat history lagi</Button>
          </div>
        ) : null}

        {rows.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-sm text-slate-500">Belum ada history sesuai filter.</CardContent>
          </Card>
        ) : null}
      </div>
    </MotionPage>
  );
}
