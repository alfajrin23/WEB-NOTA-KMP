"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowRight, FileCheck2, Loader2, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MotionPage } from "@/components/ui/motion-page";
import { STAGES } from "@/constants/stages";
import { buildProjectSummary, buildResumeValidationReport, validateProjectResume } from "@/lib/resume-calculations";
import { groupDocumentsForPresentation } from "@/lib/pln-document-groups";
import { useKdkmpStore } from "@/hooks/use-kdkmp-store";
import { formatProjectWilayah, formatRupiah } from "@/utils/format";

export function GenerateNotaView() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const projectId = params.id;
  const { projects, vendors, templateAssignments, generatedNotas, generateProjectNotas, loading, supabaseReady } = useKdkmpStore();
  const [generating, setGenerating] = useState(false);

  const project = projects.find((entry) => entry.id === projectId);
  const existingDocs = useMemo(() => generatedNotas.filter((doc) => doc.projectId === projectId && doc.documentType === "nota"), [generatedNotas, projectId]);
  const existingDocumentCount = useMemo(() => groupDocumentsForPresentation(existingDocs).length, [existingDocs]);
  const summary = useMemo(() => (project ? buildProjectSummary(project, vendors) : null), [project, vendors]);
  const issues = useMemo(() => (project ? validateProjectResume(project, vendors, templateAssignments) : []), [project, templateAssignments, vendors]);
  const validationReport = useMemo(() => (project ? buildResumeValidationReport(project, existingDocs, vendors, templateAssignments) : null), [existingDocs, project, templateAssignments, vendors]);
  const vendorReadyItemCount = useMemo(() => project?.items.filter((item) => item.vendorId).length ?? 0, [project]);

  async function runGenerate() {
    if (!project) return;
    setGenerating(true);
    try {
      await generateProjectNotas(project.id);
      router.push(`/projects/${project.id}/cek-nota`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal generate nota.");
    } finally {
      setGenerating(false);
    }
  }

  if (loading && !project) {
    return <Card><CardContent className="p-8">Memuat project...</CardContent></Card>;
  }

  if (!project || !summary) {
    return <Card><CardContent className="p-8">Project tidak ditemukan.</CardContent></Card>;
  }

  return (
    <MotionPage>
      <div className="space-y-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-normal">Generate Nota Otomatis</h2>
            <p className="text-sm text-slate-500">
              Sumber data dari resume {formatProjectWilayah(project)}. Hasil generate disimpan ke Supabase.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href={`/projects/${project.id}/resume`}><ArrowLeft className="h-4 w-4" />Kembali Resume</Link>
            </Button>
            <Button onClick={runGenerate} disabled={generating || project.items.length === 0}>
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              {existingDocs.length > 0 ? "Regenerate dari Resume" : "Generate dari Resume"}
            </Button>
          </div>
        </div>

        {!supabaseReady ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
            Supabase belum dikonfigurasi. Hasil generate hanya tersedia sebagai cache sementara.
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm text-slate-500">Total Resume</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{formatRupiah(summary.grandTotal)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm text-slate-500">Nota Tersimpan</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{existingDocumentCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm text-slate-500">Validasi Resume</CardTitle>
            </CardHeader>
            <CardContent>
              <Badge className={validationReport?.hasWarnings ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}>
                {validationReport?.hasWarnings ? `${issues.length} warning/info` : "Resume siap"}
              </Badge>
            </CardContent>
          </Card>
        </div>

        {validationReport ? (
          <Card className={validationReport.hasWarnings ? "border-amber-200 dark:border-amber-900" : "border-emerald-200 dark:border-emerald-900"}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {validationReport.hasWarnings ? <AlertTriangle className="h-5 w-5 text-amber-600" /> : null}
                Validasi Sebelum Generate
              </CardTitle>
              <CardDescription>
                Nota dibuat dari item resume yang punya template nota, termasuk vendor kosong atau vendor strip lewat template internal/non-vendor. Kwitansi dibuat di step berikutnya.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <ValidationBox label="Total Resume" value={formatRupiah(validationReport.resumeTotal)} />
                <ValidationBox label="Total Nota Dibuat" value={formatRupiah(validationReport.generatedTotal)} />
                <ValidationBox label="Belum Masuk Nota" value={formatRupiah(validationReport.ungeneratedTotal)} warn={validationReport.ungeneratedTotal > 0} />
                <ValidationBox label="Item siap vendor" value={`${vendorReadyItemCount} item`} warn={vendorReadyItemCount === 0} />
              </div>
              <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-900">
                    <tr>
                      <th className="px-4 py-3">Tahap</th>
                      <th className="px-4 py-3 text-right">Item</th>
                      <th className="px-4 py-3 text-right">Total Resume</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {validationReport.stageRows.map((entry) => (
                      <tr key={entry.stageCode}>
                        <td className="px-4 py-3 font-semibold">{entry.label}</td>
                        <td className="px-4 py-3 text-right">{entry.itemCount}</td>
                        <td className="px-4 py-3 text-right font-semibold">{formatRupiah(entry.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-3 md:grid-cols-4">
                <ValidationBox label="Vendor kosong/internal" value={`${validationReport.missingVendorItems.length} item`} />
                <ValidationBox label='Vendor "-"' value={`${validationReport.dashVendorItems.length} item`} />
                <ValidationBox label="Belum template" value={`${validationReport.missingTemplateItems.length} item`} warn={validationReport.missingTemplateItems.length > 0} />
                <ValidationBox label="Belum masuk nota" value={`${validationReport.notGeneratedItems.length} item`} warn={validationReport.notGeneratedItems.length > 0} />
                <ValidationBox label="Jumlah kosong/nol" value={`${validationReport.zeroAmountItems.length} item`} warn={validationReport.zeroAmountItems.length > 0} />
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Ringkasan Tahap</CardTitle>
            <CardDescription>Grouping nota otomatis mengikuti tahap, vendor, dan mapping template yang sudah ada.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-900">
                  <tr>
                    <th className="px-4 py-3">Tahap</th>
                    <th className="px-4 py-3">Item Resume</th>
                    <th className="px-4 py-3">Vendor</th>
                    <th className="px-4 py-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {STAGES.map((stage) => {
                    const row = summary.stages.find((entry) => entry.stageCode === stage.code);
                    return (
                      <tr key={stage.code}>
                        <td className="px-4 py-3 font-semibold">{stage.label}</td>
                        <td className="px-4 py-3">{row?.itemCount ?? 0}</td>
                        <td className="px-4 py-3">{row?.vendorCount ?? 0}</td>
                        <td className="px-4 py-3 text-right font-semibold">{formatRupiah(row?.total ?? 0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button asChild variant="emerald">
            <Link href={`/projects/${project.id}/cek-nota`}>
              <FileCheck2 className="h-4 w-4" />
              Cek Hasil Nota
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </MotionPage>
  );
}

function ValidationBox({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className={warn ? "mt-1 text-lg font-bold text-amber-700" : "mt-1 text-lg font-bold"}>{value}</p>
    </div>
  );
}
