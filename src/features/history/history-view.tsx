"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, FilePlus2, FileText, ReceiptText, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MotionPage } from "@/components/ui/motion-page";
import { groupDocumentsForPresentation } from "@/lib/pln-document-groups";
import { buildProjectSummary } from "@/lib/resume-calculations";
import { useKdkmpStore } from "@/hooks/use-kdkmp-store";
import { formatRupiah } from "@/utils/format";

export function HistoryView() {
  const { projects, vendors, generatedNotas, customNotes, history, loading } = useKdkmpStore();
  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [visibleCount, setVisibleCount] = useState(12);

  const rows = useMemo(() => {
    return projects
      .map((project) => {
        const summary = buildProjectSummary(project, vendors);
        const docs = groupDocumentsForPresentation(generatedNotas.filter((doc) => doc.projectId === project.id));
        const customs = customNotes.filter((doc) => doc.projectId === project.id);
        const lastHistory = history.find((entry) => entry.projectId === project.id);
        return { project, summary, docs, customs, lastHistory };
      })
      .filter(({ project }) => `${project.villageName} ${project.projectName} ${project.districtName} ${project.regencyName}`.toLowerCase().includes(query.toLowerCase()))
      .filter(({ project }) => !dateFrom || (project.reportDate ?? project.projectDate) >= dateFrom)
      .filter(({ project }) => !dateTo || (project.reportDate ?? project.projectDate) <= dateTo)
      .sort((a, b) => new Date(b.project.updatedAt).getTime() - new Date(a.project.updatedAt).getTime());
  }, [customNotes, dateFrom, dateTo, generatedNotas, history, projects, query, vendors]);

  if (loading && projects.length === 0) {
    return <Card><CardContent className="p-8">Memuat history dari Supabase...</CardContent></Card>;
  }

  return (
    <MotionPage>
      <div className="space-y-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-normal">History Pembuatan Nota/Kwitansi</h2>
            <p className="text-sm text-slate-500">Buka kembali project, resume, hasil generate, edit kwitansi, dan nota tambahan.</p>
          </div>
          <Button asChild>
            <Link href="/tambah-desa"><FilePlus2 className="h-4 w-4" />Tambah Desa</Link>
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Filter History</CardTitle>
            <CardDescription>Data diambil dari tabel projects, generated_notes, kwitansi_edits, custom_notes, dan note_history.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 lg:grid-cols-[1fr_190px_190px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari nama desa, project, kecamatan, kabupaten" />
              </div>
              <div className="relative">
                <CalendarDays className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <Input className="pl-9" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
              </div>
              <div className="relative">
                <CalendarDays className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <Input className="pl-9" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4">
          {rows.slice(0, visibleCount).map(({ project, summary, docs, customs, lastHistory }) => (
            <Card key={project.id}>
              <CardHeader className="gap-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <CardTitle>Desa {project.villageName}</CardTitle>
                    <CardDescription>
                      {project.projectName} - Kec. {project.districtName}, Kab. {project.regencyName}
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge>{project.status}</Badge>
                    <Badge className="bg-blue-50 text-blue-700">{docs.length} nota</Badge>
                    <Badge className="bg-emerald-50 text-emerald-700">{customs.length} custom</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
                  <div className="grid gap-2 text-sm md:grid-cols-3">
                    <div>
                      <p className="text-xs font-semibold text-slate-500">Tanggal laporan</p>
                      <p>{project.reportDate ?? project.projectDate}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-500">Total resume</p>
                      <p className="font-semibold">{formatRupiah(summary.grandTotal)}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-500">Aktivitas terakhir</p>
                      <p>{lastHistory ? `${lastHistory.description} (${new Date(lastHistory.createdAt).toLocaleString("id-ID")})` : "Belum ada history proses."}</p>
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
