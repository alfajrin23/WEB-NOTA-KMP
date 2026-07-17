"use client";

import { memo, useCallback, useMemo, useState } from "react";
import { Download, Loader2, Printer, X, ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { resolveTemplateAssignment } from "@/constants/template-mapping";
import { STAGES } from "@/constants/stages";
import { DocumentTemplateRenderer } from "@/components/templates/DocumentTemplateRenderer";
import { KwitansiBatchTemplate } from "@/components/templates/kwitansi/KwitansiBatchTemplate";
import { isSpecialPLNKwitansi, PLNKwitansiBatchTemplate } from "@/components/templates/multi-stage/PLNTemplate";
import { buildProjectSummary, hashNotaData } from "@/lib/resume-calculations";
import { moveSpecialNotasToStageEnd } from "@/lib/nota-output-order";
import { cn } from "@/lib/utils";
import { formatDateIndonesia, formatNumber, formatRupiah } from "@/utils/format";
import { GeneratedNota, Project, TemplateAssignment } from "@/types/domain";

type PreviewKind = "resume" | "notes";

export type PreviewPayload = {
  kind: PreviewKind;
  title: string;
  project: Project;
  docs?: GeneratedNota[];
  fileName: string;
};

type PrintableNoteGroup =
  | { kind: "document"; key: string; docs: [GeneratedNota] }
  | { kind: "pln"; key: string; docs: GeneratedNota[] };

function groupPrintableNotes(docs: GeneratedNota[]): PrintableNoteGroup[] {
  const groups: PrintableNoteGroup[] = [];

  for (const doc of moveSpecialNotasToStageEnd(docs)) {
    if (!isSpecialPLNKwitansi(doc)) {
      groups.push({ kind: "document", key: doc.id, docs: [doc] });
      continue;
    }

    const groupKey = doc.printGroupKey || "pln-electricity";
    const existing = groups.find((group) => group.kind === "pln" && group.key === groupKey);
    if (existing?.kind === "pln") {
      existing.docs.push(doc);
    } else {
      groups.push({ kind: "pln", key: groupKey, docs: [doc] });
    }
  }

  return groups;
}

function groupKwitansiByStage(docs: GeneratedNota[]) {
  const groups = new Map<string, GeneratedNota[]>();
  for (const doc of docs) {
    const current = groups.get(doc.stageCode);
    if (current) current.push(doc);
    else groups.set(doc.stageCode, [doc]);
  }
  return [...groups.entries()].map(([stageCode, stageDocs]) => ({ stageCode, docs: stageDocs }));
}

function isJasaElectricNota(doc: GeneratedNota) {
  return doc.documentType === "nota" && (doc.vendorId === "vendor-jasa-elektrik" || doc.templateId === "template-jasa-electric");
}

function safeDownloadName(value: string) {
  return value.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

async function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadNotaDocumentsPdf({
  project,
  docs,
  templateAssignments,
  fileName,
}: {
  project: Project;
  docs: GeneratedNota[];
  templateAssignments: TemplateAssignment[];
  fileName: string;
}) {
  if (docs.length === 0) return;
  const { PDFDocument } = await import("pdf-lib");
  const merged = await PDFDocument.create();

  for (const doc of moveSpecialNotasToStageEnd(docs)) {
    const assignment = resolveTemplateAssignment(doc.stageCode, doc.vendorId, templateAssignments);
    const response = await fetch("/api/excel-pdf/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: doc.documentType,
        project,
        vendor: doc.vendor,
        items: doc.items,
        templateAssignment: assignment ? { ...assignment, templateId: doc.templateId } : undefined,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? `Gagal generate PDF ${doc.vendorName}.`);
    }

    const source = await PDFDocument.load(await response.arrayBuffer());
    const pages = await merged.copyPages(source, source.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }

  const bytes = await merged.save();
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  await downloadBlob(new Blob([arrayBuffer], { type: "application/pdf" }), `${safeDownloadName(fileName)}.pdf`);
}

export const ResumePrintPreview = memo(function ResumePrintPreview({ project }: { project: Project }) {
  const summary = useMemo(() => buildProjectSummary(project, []), [project]);
  const itemsByStage = useMemo(() => {
    return STAGES.map((stage) => ({
      ...stage,
      items: project.items.filter((item) => item.stageCode === stage.code).sort((a, b) => a.sortOrder - b.sortOrder),
    }));
  }, [project.items]);

  return (
    <div className="mx-auto w-[210mm] min-h-[297mm] bg-white p-8 text-slate-950 shadow-sm print:shadow-none">
      <div className="border-b border-slate-300 pb-4">
        <h2 className="text-xl font-bold">Resume Project</h2>
        <div className="mt-2 grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
          <span>Desa: {project.villageName}</span>
          <span>Kecamatan: {project.districtName}</span>
          <span>Kabupaten: {project.regencyName}</span>
          <span>Wilayah/Kodim: {project.regionName}</span>
          <span>Project: {project.projectName}</span>
          <span>Tanggal laporan: {formatDateIndonesia(project.reportDate ?? project.projectDate)}</span>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2 text-xs">
        {summary.stages.map((stage) => (
          <div key={stage.stageCode} className="border border-slate-300 p-2">
            <div className="font-semibold">{stage.label}</div>
            <div>{formatRupiah(stage.total)}</div>
          </div>
        ))}
        <div className="border border-slate-900 p-2 font-bold">
          <div>Total Keseluruhan</div>
          <div>{formatRupiah(summary.grandTotal)}</div>
        </div>
      </div>

      <div className="mt-6 space-y-5">
        {itemsByStage.map((stage) => (
          <section key={stage.code}>
            <h3 className="mb-2 text-sm font-bold">{stage.label}</h3>
            <table className="w-full border-collapse text-[10px]">
              <thead>
                <tr className="bg-slate-100">
                  <th className="min-w-20 whitespace-nowrap border border-slate-300 p-1 text-left">Tanggal</th>
                  <th className="border border-slate-300 p-1 text-left">Kategori</th>
                  <th className="border border-slate-300 p-1 text-left">Uraian</th>
                  <th className="border border-slate-300 p-1 text-right">Qty</th>
                  <th className="border border-slate-300 p-1">Sat</th>
                  <th className="border border-slate-300 p-1 text-right">Harga</th>
                  <th className="border border-slate-300 p-1 text-right">Jumlah</th>
                </tr>
              </thead>
              <tbody>
                {stage.items.map((item) => (
                  <tr key={item.id}>
                    <td className="whitespace-nowrap border border-slate-300 p-1 tabular-nums">{formatDateIndonesia(item.expenseDate)}</td>
                    <td className="border border-slate-300 p-1">{item.category}</td>
                    <td className="border border-slate-300 p-1">{item.itemName}</td>
                    <td className="border border-slate-300 p-1 text-right">{formatNumber(item.volume)}</td>
                    <td className="border border-slate-300 p-1 text-center">{item.unit}</td>
                    <td className="border border-slate-300 p-1 text-right">{formatRupiah(item.unitPrice)}</td>
                    <td className="border border-slate-300 p-1 text-right">{formatRupiah(item.amountOverride ?? item.volume * item.unitPrice)}</td>
                  </tr>
                ))}
                {stage.items.length === 0 ? (
                  <tr>
                    <td className="border border-slate-300 p-2 text-center" colSpan={7}>Tidak ada item.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </div>
  );
});

export function DocumentPreviewModal({
  payload,
  templateAssignments,
  onClose,
}: {
  payload: PreviewPayload | null;
  templateAssignments: TemplateAssignment[];
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(0.78);
  const [visibleCount, setVisibleCount] = useState(6);
  const [kwitansiVisibleCount, setKwitansiVisibleCount] = useState(8);
  const [downloading, setDownloading] = useState(false);

  const docs = useMemo(() => moveSpecialNotasToStageEnd(payload?.docs ?? []), [payload?.docs]);
  const isKwitansiPayload = useMemo(() => docs.length > 0 && docs.every((doc) => doc.documentType === "kwitansi"), [docs]);
  const hasSpecialPlnNota = useMemo(() => docs.some((doc) => doc.documentType === "nota" && isSpecialPLNKwitansi(doc)), [docs]);
  const hasJasaElectricNota = useMemo(() => docs.some(isJasaElectricNota), [docs]);
  const missingKwitansiReceivers = useMemo(() => docs.filter((doc) => doc.documentType === "kwitansi" && !doc.kwitansiReceiverName?.trim()), [docs]);
  const renderedNoteDocs = useMemo(() => {
    const visible = docs.slice(0, visibleCount);
    const next = docs[visibleCount];
    const lastVisible = visible[visible.length - 1];
    // Jangan memotong pasangan PLN hanya karena batas lazy preview jatuh di
    // antara slip pertama dan kedua.
    if (lastVisible && isSpecialPLNKwitansi(lastVisible) && next && isSpecialPLNKwitansi(next)) {
      visible.push(next);
    }
    const visiblePlnGroups = new Set(visible.filter(isSpecialPLNKwitansi).map((doc) => doc.printGroupKey || "pln-electricity"));
    for (const doc of docs) {
      const key = doc.printGroupKey || "pln-electricity";
      if (isSpecialPLNKwitansi(doc) && visiblePlnGroups.has(key) && !visible.some((entry) => entry.id === doc.id)) visible.push(doc);
    }
    return visible;
  }, [docs, visibleCount]);
  const renderedNoteGroups = useMemo(() => groupPrintableNotes(renderedNoteDocs), [renderedNoteDocs]);
  const allNoteGroups = useMemo(() => groupPrintableNotes(docs), [docs]);
  const renderedKwitansiDocs = useMemo(() => {
    const visible = docs.slice(0, kwitansiVisibleCount);
    const lastRegular = [...visible].reverse().find((doc) => !isSpecialPLNKwitansi(doc));
    if (!lastRegular) return visible;

    const stageDocs = docs.filter((doc) => !isSpecialPLNKwitansi(doc) && doc.stageCode === lastRegular.stageCode);
    const stageIndex = stageDocs.findIndex((doc) => doc.id === lastRegular.id);
    const pageEnd = Math.ceil((stageIndex + 1) / 4) * 4;
    for (const doc of stageDocs.slice(0, pageEnd)) {
      if (!visible.some((entry) => entry.id === doc.id)) visible.push(doc);
    }
    return visible;
  }, [docs, kwitansiVisibleCount]);
  const renderedRegularKwitansiDocs = useMemo(() => renderedKwitansiDocs.filter((doc) => !isSpecialPLNKwitansi(doc)), [renderedKwitansiDocs]);
  const renderedSpecialPLNKwitansiDocs = useMemo(() => renderedKwitansiDocs.filter(isSpecialPLNKwitansi), [renderedKwitansiDocs]);
  const regularKwitansiDocs = useMemo(() => docs.filter((doc) => !isSpecialPLNKwitansi(doc)), [docs]);
  const specialPLNKwitansiDocs = useMemo(() => docs.filter(isSpecialPLNKwitansi), [docs]);
  const renderedRegularKwitansiGroups = useMemo(() => groupKwitansiByStage(renderedRegularKwitansiDocs), [renderedRegularKwitansiDocs]);
  const regularKwitansiGroups = useMemo(() => groupKwitansiByStage(regularKwitansiDocs), [regularKwitansiDocs]);

  const printPreview = useCallback(() => {
    if (isKwitansiPayload && missingKwitansiReceivers.length > 0) {
      toast.warning(`${missingKwitansiReceivers.length} nama penerima belum diisi; garis tanda tangan tetap dapat dicetak.`);
    }
    window.print();
  }, [isKwitansiPayload, missingKwitansiReceivers.length]);

  const downloadPdf = useCallback(async () => {
    if (!payload) return;
    if (isKwitansiPayload && missingKwitansiReceivers.length > 0) {
      toast.warning(`${missingKwitansiReceivers.length} nama penerima belum diisi; garis tanda tangan tetap dapat dicetak.`);
    }
    if (payload.kind === "resume") {
      toast.info("Dialog cetak dibuka. Pilih Save as PDF untuk menyimpan resume sebagai PDF.");
      window.print();
      return;
    }

    if (hasSpecialPlnNota) {
      toast.info("Dialog cetak dibuka. Pilih Save as PDF agar halaman Kwitansi Pembayaran PLN tetap tergabung dua slip dalam satu A4.");
      window.print();
      return;
    }

    if (hasJasaElectricNota) {
      toast.info("Dialog cetak dibuka. Pilih Save as PDF agar layout Nota Jasa Electric sama dengan preview.");
      window.print();
      return;
    }

    if (isKwitansiPayload) {
      toast.info("Dialog cetak dibuka. Pilih Save as PDF untuk menyimpan kwitansi sebagai PDF.");
      window.print();
      return;
    }

    setDownloading(true);
    try {
      await downloadNotaDocumentsPdf({
        project: payload.project,
        docs,
        templateAssignments,
        fileName: payload.fileName,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal download PDF.");
    } finally {
      setDownloading(false);
    }
  }, [docs, hasJasaElectricNota, hasSpecialPlnNota, isKwitansiPayload, missingKwitansiReceivers.length, payload, templateAssignments]);

  if (!payload) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 p-3 backdrop-blur-sm print:static print:bg-white print:p-0">
      <div className="mx-auto flex h-full max-w-7xl flex-col rounded-xl bg-white shadow-2xl dark:bg-slate-950 print:block print:h-auto print:max-w-none print:rounded-none print:bg-white print:shadow-none">
        <div className="no-print flex flex-col gap-3 border-b border-slate-200 p-4 md:flex-row md:items-center md:justify-between dark:border-slate-800">
          <div>
            <h2 className="text-lg font-bold">{payload.title}</h2>
            <p className="text-sm text-slate-500">
              Preview ditampilkan lebih dulu. PDF baru dibuat setelah tombol Download PDF diklik.
            </p>
            {isKwitansiPayload && missingKwitansiReceivers.length > 0 ? (
              <p className="mt-1 text-sm font-semibold text-amber-600">
                {missingKwitansiReceivers.length} nama penerima kwitansi belum diisi.
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {payload.kind === "notes" ? (
              <>
                <Button variant="outline" onClick={() => setZoom((value) => Math.max(0.52, Number((value - 0.08).toFixed(2))))}>
                  <ZoomOut className="h-4 w-4" />
                  {Math.round(zoom * 100)}%
                </Button>
                <Button variant="outline" onClick={() => setZoom((value) => Math.min(1.1, Number((value + 0.08).toFixed(2))))}>
                  <ZoomIn className="h-4 w-4" />
                </Button>
              </>
            ) : null}
            <Button variant="outline" onClick={printPreview}>
              <Printer className="h-4 w-4" />
              Cetak
            </Button>
            <Button onClick={downloadPdf} disabled={downloading || (payload.kind === "notes" && docs.length === 0)}>
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {downloading ? "Menyiapkan" : "Download PDF"}
            </Button>
            <Button variant="outline" size="icon" onClick={onClose} aria-label="Tutup preview">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className={cn("flex-1 overflow-auto bg-slate-100 p-4 dark:bg-slate-900 print:bg-white print:p-0", payload.kind === "notes" && "print-area")}>
          {payload.kind === "resume" ? (
            <div className="print-area">
              <ResumePrintPreview project={payload.project} />
            </div>
          ) : isKwitansiPayload ? (
            <div>
              <div className="no-print space-y-5">
                {renderedRegularKwitansiGroups.map((group) => (
                  <KwitansiBatchTemplate key={group.stageCode} docs={group.docs} project={payload.project} zoom={zoom} />
                ))}
                {renderedSpecialPLNKwitansiDocs.length > 0 ? (
                  <PLNKwitansiBatchTemplate docs={renderedSpecialPLNKwitansiDocs} project={payload.project} zoom={zoom} />
                ) : null}
                {kwitansiVisibleCount < docs.length ? (
                  <div className="flex justify-center">
                    <Button variant="outline" onClick={() => setKwitansiVisibleCount((count) => count + 8)}>Muat 8 kwitansi lagi</Button>
                  </div>
                ) : null}
              </div>
              <div className="hidden print:block">
                {regularKwitansiGroups.map((group) => (
                  <KwitansiBatchTemplate key={`print-${group.stageCode}`} docs={group.docs} project={payload.project} zoom={1} />
                ))}
                {specialPLNKwitansiDocs.length > 0 ? (
                  <PLNKwitansiBatchTemplate docs={specialPLNKwitansiDocs} project={payload.project} zoom={1} />
                ) : null}
              </div>
            </div>
          ) : (
            <div>
              <div className="no-print space-y-5">
                {renderedNoteGroups.map((group) => group.kind === "pln" ? (
                  <PLNKwitansiBatchTemplate key={group.key} docs={group.docs} project={payload.project} zoom={zoom} />
                ) : (
                  <DocumentTemplateRenderer
                    key={`${group.docs[0].id}-${hashNotaData(group.docs[0])}`}
                    doc={group.docs[0]}
                    project={payload.project}
                    zoom={zoom}
                  />
                ))}
                {visibleCount < docs.length ? (
                  <div className="flex justify-center">
                    <Button variant="outline" onClick={() => setVisibleCount((count) => count + 6)}>Muat 6 dokumen lagi</Button>
                  </div>
                ) : null}
                {docs.length === 0 ? (
                  <Card>
                    <CardContent className="flex h-80 items-center justify-center text-sm text-slate-500">Tidak ada dokumen untuk preview.</CardContent>
                  </Card>
                ) : null}
              </div>
              {docs.length > 0 ? (
                <div className="hidden print:block">
                  {allNoteGroups.map((group) => group.kind === "pln" ? (
                    <PLNKwitansiBatchTemplate key={`print-${group.key}`} docs={group.docs} project={payload.project} zoom={1} />
                  ) : (
                    <DocumentTemplateRenderer
                      key={`print-${group.docs[0].id}-${hashNotaData(group.docs[0])}`}
                      doc={group.docs[0]}
                      project={payload.project}
                      zoom={1}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
