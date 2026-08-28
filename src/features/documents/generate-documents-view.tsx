"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Download, Loader2, Printer, ReceiptText, Ruler, Search, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { MotionPage } from "@/components/ui/motion-page";
import { useKdkmpStore } from "@/hooks/use-kdkmp-store";
import { STAGES, getStageLabel } from "@/constants/stages";
import { resolveTemplateAssignment } from "@/constants/template-mapping";
import { GeneratedNota, StageCode } from "@/types/domain";
import { formatRupiah } from "@/utils/format";
import { hashNotaData } from "@/lib/resume-calculations";
import { getPLNDocumentGroup, groupDocumentsForPresentation } from "@/lib/pln-document-groups";
import { moveSpecialNotasToStageEnd } from "@/lib/nota-output-order";
import { getTwoUpVendorBatchKey, getTwoUpVendorDocumentGroup, isTwoUpVendorNota } from "@/lib/nota-pagination";
import { DocumentTemplateRenderer } from "@/components/templates/DocumentTemplateRenderer";
import { isSpecialPLNKwitansi, PLNKwitansiBatchTemplate } from "@/components/templates/multi-stage/PLNTemplate";
import { getKwitansiPageChunk, KwitansiBatchTemplate } from "@/components/templates/kwitansi/KwitansiBatchTemplate";

type StageFilter = StageCode | "all";

function safeDownloadName(value: string) {
  return value.replace(/[^\w-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

type PreviewGroup =
  | { kind: "document"; key: string; docs: GeneratedNota[] }
  | { kind: "kwitansi"; key: string; docs: GeneratedNota[] }
  | { kind: "pln"; key: string; docs: GeneratedNota[] };

function isRegularKwitansi(doc: GeneratedNota) {
  return doc.documentType === "kwitansi" && !isSpecialPLNKwitansi(doc);
}

function groupPreviewDocuments(source: GeneratedNota[]): PreviewGroup[] {
  const groups: PreviewGroup[] = [];
  for (const doc of source) {
    if (isRegularKwitansi(doc)) {
      const key = `kwitansi-${doc.stageCode}`;
      const existing = groups.find((group) => group.kind === "kwitansi" && group.key === key);
      if (existing?.kind === "kwitansi") existing.docs.push(doc);
      else groups.push({ kind: "kwitansi", key, docs: [doc] });
      continue;
    }
    if (!isSpecialPLNKwitansi(doc)) {
      const batchKey = getTwoUpVendorBatchKey(doc);
      const existing = batchKey
        ? groups.find((group) => group.kind === "document" && group.key === batchKey)
        : undefined;
      if (existing?.kind === "document") existing.docs.push(doc);
      else groups.push({ kind: "document", key: batchKey ?? doc.id, docs: [doc] });
      continue;
    }
    const key = doc.printGroupKey || "pln-electricity";
    const existing = groups.find((group) => group.kind === "pln" && group.key === key);
    if (existing?.kind === "pln") existing.docs.push(doc);
    else groups.push({ kind: "pln", key, docs: [doc] });
  }
  return groups;
}

export function GenerateDocumentsView() {
  const params = useParams<{ id?: string }>();
  const { projects, vendors, templateAssignments, generatedNotas } = useKdkmpStore();
  const project = projects.find((entry) => entry.id === params.id) ?? projects[0];
  const [stageFilter, setStageFilter] = useState<StageFilter>("all");
  const [vendorFilter, setVendorFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<"selected" | "all">("selected");
  const [visibleCount, setVisibleCount] = useState(8);
  const [zoom, setZoom] = useState(0.86);
  const [debugLayout, setDebugLayout] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const docs = useMemo(() => {
    if (!project) return [];
    const sortedDocs = generatedNotas
      .filter((doc) => doc.projectId === project.id)
      .sort((a, b) => {
        const stageA = STAGES.findIndex((stage) => stage.code === a.stageCode);
        const stageB = STAGES.findIndex((stage) => stage.code === b.stageCode);
        return stageA - stageB || a.documentType.localeCompare(b.documentType) || a.templateName.localeCompare(b.templateName) || a.id.localeCompare(b.id);
      });
    return moveSpecialNotasToStageEnd(sortedDocs);
  }, [generatedNotas, project]);

  const filteredDocs = useMemo(() => {
    return docs
      .filter((doc) => stageFilter === "all" || doc.stageCode === stageFilter)
      .filter((doc) => vendorFilter === "all" || doc.vendorId === vendorFilter)
      .filter((doc) => `${doc.vendorName} ${doc.stageName} ${doc.templateName} ${doc.categoryNames.join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  }, [docs, query, stageFilter, vendorFilter]);
  const filteredEntries = useMemo(() => groupDocumentsForPresentation(filteredDocs), [filteredDocs]);

  const selected = filteredDocs.find((doc) => doc.id === selectedId) ?? filteredDocs[0] ?? null;
  const renderedDocs = useMemo(() => {
    if (selected && previewMode === "selected" && isRegularKwitansi(selected)) {
      const orderedStageDocs = docs.filter((doc) => isRegularKwitansi(doc) && doc.stageCode === selected.stageCode);
      return getKwitansiPageChunk(orderedStageDocs, selected.id);
    }
    if (selected && previewMode === "selected" && isSpecialPLNKwitansi(selected)) {
      return getPLNDocumentGroup(docs, selected);
    }
    if (selected && previewMode === "selected" && isTwoUpVendorNota(selected)) {
      return getTwoUpVendorDocumentGroup(filteredDocs, selected);
    }
    const source = previewMode === "all" ? filteredDocs.slice(0, visibleCount) : selected ? [selected] : [];
    const last = source[source.length - 1];
    const next = filteredDocs[visibleCount];
    if (previewMode === "all" && last && next && isSpecialPLNKwitansi(last) && isSpecialPLNKwitansi(next)) source.push(next);
    const visiblePlnGroups = new Set(source.filter(isSpecialPLNKwitansi).map((doc) => doc.printGroupKey || "pln-electricity"));
    for (const doc of filteredDocs) {
      const key = doc.printGroupKey || "pln-electricity";
      if (isSpecialPLNKwitansi(doc) && visiblePlnGroups.has(key) && !source.some((entry) => entry.id === doc.id)) source.push(doc);
    }
    const lastRegularKwitansi = [...source].reverse().find(isRegularKwitansi);
    if (previewMode === "all" && lastRegularKwitansi) {
      const stageDocs = filteredDocs.filter((doc) => isRegularKwitansi(doc) && doc.stageCode === lastRegularKwitansi.stageCode);
      const stageIndex = stageDocs.findIndex((doc) => doc.id === lastRegularKwitansi.id);
      const pageEnd = Math.ceil((stageIndex + 1) / 4) * 4;
      for (const doc of stageDocs.slice(0, pageEnd)) {
        if (!source.some((entry) => entry.id === doc.id)) source.push(doc);
      }
    }
    return source;
  }, [docs, filteredDocs, previewMode, selected, visibleCount]);
  const renderedGroups = useMemo(() => groupPreviewDocuments(renderedDocs), [renderedDocs]);

  const vendorOptions = useMemo(() => {
    const ids = new Set(docs.map((doc) => doc.vendorId));
    return vendors.filter((vendor) => ids.has(vendor.id));
  }, [docs, vendors]);

  useEffect(() => {
    if (!selectedId && filteredDocs[0]) setSelectedId(filteredDocs[0].id);
    if (selectedId && filteredDocs.length > 0 && !filteredDocs.some((doc) => doc.id === selectedId)) {
      setSelectedId(filteredDocs[0].id);
    }
  }, [filteredDocs, selectedId]);

  useEffect(() => {
    setVisibleCount(8);
  }, [previewMode, query, stageFilter, vendorFilter]);

  const downloadPdf = useCallback(async (doc: GeneratedNota | null) => {
    if (!project || !doc || isDownloading) return;
    if (isSpecialPLNKwitansi(doc) || isRegularKwitansi(doc) || isTwoUpVendorNota(doc)) {
      // Renderer browser adalah sumber layout untuk PLN dua-slip, kwitansi,
      // dan semua template nota dua-up.
      window.print();
      return;
    }
    setIsDownloading(true);
    setError(null);
    try {
      const templateAssignment = resolveTemplateAssignment(doc.stageCode, doc.vendorId, templateAssignments);
      const response = await fetch("/api/excel-pdf/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: doc.documentType,
          project,
          vendor: doc.vendor,
          items: doc.items,
          templateAssignment,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Gagal download PDF.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${safeDownloadName(`${doc.templateName}-${doc.vendorName}-${doc.stageName}`)}.pdf`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "Gagal download PDF.");
    } finally {
      setIsDownloading(false);
    }
  }, [isDownloading, project, templateAssignments]);

  if (!project) {
    return <Card><CardContent className="p-8">Project belum tersedia.</CardContent></Card>;
  }

  return (
    <MotionPage>
      <div className="space-y-5">
        <div className="no-print flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-normal">Preview Nota & Kwitansi</h2>
            <p className="text-sm text-slate-500">Preview langsung dari resume. PDF hanya dibuat saat download/print dipilih.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setZoom((value) => Math.max(0.58, Number((value - 0.08).toFixed(2))))} aria-label="Zoom out">
              <ZoomOut className="h-4 w-4" />
              {Math.round(zoom * 100)}%
            </Button>
            <Button variant="outline" onClick={() => setZoom((value) => Math.min(1.2, Number((value + 0.08).toFixed(2))))} aria-label="Zoom in">
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button variant={debugLayout ? "default" : "outline"} onClick={() => setDebugLayout((value) => !value)} aria-label="Toggle debug layout">
              <Ruler className="h-4 w-4" />
              Debug
            </Button>
            <Button variant="outline" onClick={() => window.print()} disabled={renderedDocs.length === 0}>
              <Printer className="h-4 w-4" />
              Print
            </Button>
            <Button onClick={() => downloadPdf(selected)} disabled={!selected || isDownloading}>
              {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {isDownloading ? "Menyiapkan PDF" : "Download PDF"}
            </Button>
          </div>
        </div>

        <div className="no-print grid gap-3 xl:grid-cols-[1fr_190px_220px_220px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari vendor, template, kategori" />
          </div>
          <Select value={stageFilter} onValueChange={(value) => setStageFilter(value as StageFilter)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Tahap</SelectItem>
              {STAGES.map((stage) => <SelectItem key={stage.code} value={stage.code}>{stage.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={vendorFilter} onValueChange={setVendorFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Vendor</SelectItem>
              {vendorOptions.map((vendor) => <SelectItem key={vendor.id} value={vendor.id}>{vendor.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={previewMode} onValueChange={(value) => setPreviewMode(value as "selected" | "all")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="selected">Preview terpilih</SelectItem>
              <SelectItem value="all">Preview semua hasil filter</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {error && (
          <div className="no-print rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
          <Card className="no-print">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ReceiptText className="h-5 w-5 text-blue-600" />Dokumen dari Resume</CardTitle>
              <CardDescription>{filteredEntries.length} dokumen sesuai filter.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {filteredEntries.map((entry) => {
                const doc = entry.primaryDoc;
                const itemLabel = isSpecialPLNKwitansi(doc) ? `${entry.docs.length} slip` : `${entry.itemCount} item`;
                return (
                <button
                  key={entry.key}
                  onClick={() => {
                    setSelectedId(doc.id);
                    setPreviewMode("selected");
                  }}
                  className={`w-full rounded-xl border p-3 text-left transition ${selected?.id === doc.id && previewMode === "selected" ? "border-blue-500 bg-blue-50 dark:bg-blue-950" : "border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:hover:bg-slate-900"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold">{doc.templateName} - {doc.vendorName}</p>
                    <Badge>{doc.documentType}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{getStageLabel(doc.stageCode)} - {itemLabel} - {formatRupiah(entry.totalAmount)}</p>
                </button>
                );
              })}
              {filteredEntries.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">Tidak ada nota untuk filter ini.</p>}
            </CardContent>
          </Card>

          <div className="print-area space-y-5 overflow-auto rounded-xl bg-slate-100 p-4 dark:bg-slate-900/50">
            {renderedGroups.map((group) => group.kind === "pln" ? (
              <PLNKwitansiBatchTemplate key={group.key} docs={group.docs} project={project} zoom={zoom} debug={debugLayout} />
            ) : group.kind === "kwitansi" ? (
              <KwitansiBatchTemplate key={group.key} docs={group.docs} project={project} zoom={zoom} debug={debugLayout} />
            ) : (
              <DocumentTemplateRenderer
                key={`${group.docs[0].id}-${hashNotaData(group.docs[0])}`}
                doc={group.docs[0]}
                docs={group.docs}
                project={project}
                zoom={zoom}
                debug={debugLayout}
              />
            ))}
            {previewMode === "all" && visibleCount < filteredDocs.length && (
              <div className="no-print flex justify-center">
                <Button variant="outline" onClick={() => setVisibleCount((count) => count + 8)}>Muat 8 nota lagi</Button>
              </div>
            )}
            {renderedDocs.length === 0 && (
              <Card>
                <CardContent className="flex h-96 items-center justify-center text-sm text-slate-500">Pilih dokumen untuk preview.</CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </MotionPage>
  );
}
