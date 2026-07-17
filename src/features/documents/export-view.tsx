"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Download, FileText, ReceiptText, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { isSpecialPLNKwitansi } from "@/components/templates/multi-stage/PLNTemplate";
import { getKwitansiPageChunk } from "@/components/templates/kwitansi/KwitansiBatchTemplate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MotionPage } from "@/components/ui/motion-page";
import { STAGES, getStageLabel } from "@/constants/stages";
import { DocumentPreviewModal, PreviewPayload } from "@/features/documents/preview-export";
import { useKdkmpStore } from "@/hooks/use-kdkmp-store";
import { moveSpecialNotasToStageEnd } from "@/lib/nota-output-order";
import { groupDocumentsForPresentation } from "@/lib/pln-document-groups";
import { formatRupiah } from "@/utils/format";
import { GeneratedNota, StageCode } from "@/types/domain";

function docsForStage(docs: GeneratedNota[], stageCode: StageCode) {
  return docs.filter((doc) => doc.stageCode === stageCode);
}

function stageLabel(stageCode: StageCode) {
  return stageCode === "RESUME_ALL" ? "DI LUAR PEKERJAAN INTI" : getStageLabel(stageCode);
}

function docSortRank(doc: GeneratedNota) {
  const stageIndex = STAGES.findIndex((stage) => stage.code === doc.stageCode);
  if (doc.vendorId === "vendor-pln" && doc.stageCode === "TAHAP_IV") return 390 + (doc.printOrder ?? 0) / 100;
  return (stageIndex === -1 ? 99 : stageIndex) * 100 + (doc.printOrder ?? 0) / 100;
}

export function ExportView() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { projects, generatedNotas, templateAssignments, loading } = useKdkmpStore();
  const project = projects.find((entry) => entry.id === projectId);
  const [query, setQuery] = useState("");
  const [payload, setPayload] = useState<PreviewPayload | null>(null);

  const allDocs = useMemo(() => {
    return generatedNotas
      .filter((doc) => doc.projectId === projectId)
      .sort((a, b) => docSortRank(a) - docSortRank(b) || a.vendorName.localeCompare(b.vendorName) || a.id.localeCompare(b.id));
  }, [generatedNotas, projectId]);

  const docs = useMemo(
    () => moveSpecialNotasToStageEnd(allDocs.filter((doc) => doc.documentType === "nota")),
    [allDocs],
  );
  const kwitansiDocs = useMemo(() => allDocs.filter((doc) => doc.documentType === "kwitansi"), [allDocs]);
  const missingKwitansiReceivers = useMemo(() => kwitansiDocs.filter((doc) => !doc.kwitansiReceiverName?.trim()), [kwitansiDocs]);

  const filteredDocs = useMemo(() => {
    return docs.filter((doc) => `${doc.vendorName} ${doc.templateName} ${doc.stageName}`.toLowerCase().includes(query.toLowerCase()));
  }, [docs, query]);
  const noteEntries = useMemo(() => groupDocumentsForPresentation(docs), [docs]);
  const filteredNoteEntries = useMemo(() => groupDocumentsForPresentation(filteredDocs), [filteredDocs]);

  const filteredKwitansiDocs = useMemo(() => {
    return kwitansiDocs.filter((doc) => `${doc.vendorName} ${doc.templateName} ${doc.stageName}`.toLowerCase().includes(query.toLowerCase()));
  }, [kwitansiDocs, query]);

  if (loading && !project) {
    return <Card><CardContent className="p-8">Memuat data export...</CardContent></Card>;
  }

  if (!project) {
    return <Card><CardContent className="p-8">Project tidak ditemukan.</CardContent></Card>;
  }

  return (
    <MotionPage>
      <div className="no-print space-y-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-normal">Export / Cetak Final</h2>
            <p className="text-sm text-slate-500">
              Semua download/cetak wajib lewat modal preview. Dokumen tidak otomatis diunduh.
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm"><FileText className="h-4 w-4 text-blue-600" />Resume</CardTitle>
              <CardDescription>PDF Resume project.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                className="w-full"
                onClick={() => setPayload({
                  kind: "resume",
                  title: `Preview Resume - Desa ${project.villageName}`,
                  project,
                  fileName: `resume-${project.villageName}`,
                })}
              >
                Preview Resume
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm"><ReceiptText className="h-4 w-4 text-emerald-600" />Semua Nota</CardTitle>
              <CardDescription>{noteEntries.length} nota.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                className="w-full"
                disabled={docs.length === 0}
                onClick={() => setPayload({
                  kind: "notes",
                  title: `Preview Semua Nota - Desa ${project.villageName}`,
                  project,
                  docs,
                  fileName: `nota-all-${project.villageName}`,
                })}
              >
                Preview Semua Nota
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm"><ReceiptText className="h-4 w-4 text-indigo-600" />Semua Kwitansi</CardTitle>
              <CardDescription>{kwitansiDocs.length} kwitansi.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                className="w-full"
                disabled={kwitansiDocs.length === 0}
                onClick={() => setPayload({
                  kind: "notes",
                  title: `Preview Semua Kwitansi - Desa ${project.villageName}`,
                  project,
                  docs: kwitansiDocs,
                  fileName: `kwitansi-all-${project.villageName}`,
                })}
              >
                Preview Kwitansi
              </Button>
            </CardContent>
          </Card>
        </div>

        {missingKwitansiReceivers.length > 0 ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
            Nama penerima kwitansi belum diisi pada {missingKwitansiReceivers.length} dokumen. Lengkapi nama penerima sebelum dokumen final ditandatangani.
          </div>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Download/Cetak Nota per Tahap</CardTitle>
            <CardDescription>Pilih tahap, cek preview, lalu cetak atau download PDF dari modal. Tahap IV menyertakan satu halaman khusus berisi dua slip PLN.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              {STAGES.map((stage) => {
                const stageDocs = docsForStage(docs, stage.code);
                const stageDocumentCount = groupDocumentsForPresentation(stageDocs).length;
                return (
                  <Button
                    key={stage.code}
                    variant="outline"
                    disabled={stageDocs.length === 0}
                    onClick={() => setPayload({
                      kind: "notes",
                      title: `Preview ${stage.label} - Desa ${project.villageName}`,
                      project,
                      docs: stageDocs,
                      fileName: `nota-${stage.shortLabel}-${project.villageName}`,
                    })}
                  >
                    <Download className="h-4 w-4" />
                    {stage.shortLabel}
                    <Badge className="ml-auto">{stageDocumentCount}</Badge>
                  </Button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Download/Cetak Kwitansi per Kelompok</CardTitle>
            <CardDescription>Kwitansi dipaketkan 4 slip per halaman A4 dan terpisah dari nota.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              {STAGES.map((stage) => {
                const stageDocs = docsForStage(kwitansiDocs, stage.code);
                return (
                  <Button
                    key={stage.code}
                    variant="outline"
                    disabled={stageDocs.length === 0}
                    onClick={() => setPayload({
                      kind: "notes",
                      title: `Preview Kwitansi ${stageLabel(stage.code)} - Desa ${project.villageName}`,
                      project,
                      docs: stageDocs,
                      fileName: `kwitansi-${stage.shortLabel}-${project.villageName}`,
                    })}
                  >
                    <Download className="h-4 w-4" />
                    {stage.code === "RESUME_ALL" ? "Di Luar Pekerjaan Inti" : stage.shortLabel}
                    <Badge className="ml-auto">{stageDocs.length}</Badge>
                  </Button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle>Download/Cetak Satu Nota</CardTitle>
                <CardDescription>Pilih salah satu nota saja.</CardDescription>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <Input className="pl-9 md:w-80" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari vendor/template/tahap" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="max-h-[52vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-900">
                  <tr>
                    <th className="px-4 py-3">Dokumen</th>
                    <th className="px-4 py-3">Kelompok</th>
                    <th className="px-4 py-3">Item</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {filteredNoteEntries.map((entry) => {
                    const doc = entry.primaryDoc;
                    const itemLabel = isSpecialPLNKwitansi(doc) ? `${entry.docs.length} slip` : entry.itemCount;
                    return (
                    <tr key={entry.key}>
                      <td className="px-4 py-3">
                        <p className="font-semibold">{doc.templateName} - {doc.vendorName}</p>
                        <p className="text-xs text-slate-500">{doc.source === "custom" ? "Nota tambahan" : "Generated otomatis"}</p>
                      </td>
                      <td className="px-4 py-3">{stageLabel(doc.stageCode)}</td>
                      <td className="px-4 py-3">{itemLabel}</td>
                      <td className="px-4 py-3 text-right font-semibold">{formatRupiah(entry.totalAmount)}</td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setPayload({
                            kind: "notes",
                            title: `Preview ${doc.templateName} - ${doc.vendorName}`,
                            project,
                            docs: entry.docs,
                            fileName: `${doc.templateName}-${doc.vendorName}-${project.villageName}`,
                          })}
                        >
                          Preview
                        </Button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Download/Cetak Satu Kwitansi</CardTitle>
            <CardDescription>Kwitansi dicetak/export terpisah dari nota.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-[42vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-900">
                  <tr>
                    <th className="px-4 py-3">Kwitansi</th>
                    <th className="px-4 py-3">Tahap</th>
                    <th className="px-4 py-3">Item</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {filteredKwitansiDocs.map((doc) => (
                    <tr key={doc.id}>
                      <td className="px-4 py-3">
                        <p className="font-semibold">{doc.templateName}</p>
                        <p className="text-xs text-slate-500">{doc.kwitansiReceiverName || "Nama penerima belum diedit"}</p>
                      </td>
                      <td className="px-4 py-3">{stageLabel(doc.stageCode)}</td>
                      <td className="px-4 py-3">{doc.items.length}</td>
                      <td className="px-4 py-3 text-right font-semibold">{formatRupiah(doc.totalAmount)}</td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setPayload({
                            kind: "notes",
                            title: `Preview Halaman ${doc.templateName}`,
                            project,
                            docs: getKwitansiPageChunk(
                              kwitansiDocs.filter((entry) => entry.stageCode === doc.stageCode),
                              doc.id,
                            ),
                            fileName: `${doc.templateName}-${project.villageName}`,
                          })}
                        >
                          Preview
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {filteredKwitansiDocs.length === 0 ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-sm text-slate-500" colSpan={5}>Belum ada kwitansi.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <DocumentPreviewModal payload={payload} templateAssignments={templateAssignments} onClose={() => setPayload(null)} />
    </MotionPage>
  );
}
