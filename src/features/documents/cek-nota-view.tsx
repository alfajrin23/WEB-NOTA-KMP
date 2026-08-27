"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowRight, FilePlus2, ReceiptText, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MotionPage } from "@/components/ui/motion-page";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { STAGES, getStageLabel } from "@/constants/stages";
import { DocumentTemplateRenderer } from "@/components/templates/DocumentTemplateRenderer";
import { isSpecialPLNKwitansi, PLNKwitansiBatchTemplate } from "@/components/templates/multi-stage/PLNTemplate";
import { hashNotaData } from "@/lib/resume-calculations";
import { getPLNDocumentGroup, groupDocumentsForPresentation } from "@/lib/pln-document-groups";
import { moveSpecialNotasToStageEnd } from "@/lib/nota-output-order";
import { useKdkmpStore } from "@/hooks/use-kdkmp-store";
import { formatProjectWilayah, formatRupiah } from "@/utils/format";
import { GeneratedNota, StageCode } from "@/types/domain";

type StageFilter = StageCode | "all";

function docSortRank(doc: { stageCode: StageCode; vendorId: string }) {
  const stageIndex = STAGES.findIndex((stage) => stage.code === doc.stageCode);
  if (doc.vendorId === "vendor-pln" && doc.stageCode === "TAHAP_V") return 490;
  if (doc.vendorId === "vendor-pln" && doc.stageCode === "TAHAP_VI") return 590;
  return (stageIndex === -1 ? 99 : stageIndex) * 100;
}

type PreviewGroup =
  | { kind: "document"; key: string; docs: [GeneratedNota] }
  | { kind: "pln"; key: string; docs: GeneratedNota[] };

function groupPreviewDocuments(source: GeneratedNota[]): PreviewGroup[] {
  const groups: PreviewGroup[] = [];
  for (const doc of source) {
    if (!isSpecialPLNKwitansi(doc)) {
      groups.push({ kind: "document", key: doc.id, docs: [doc] });
      continue;
    }
    const key = doc.printGroupKey || "pln-electricity";
    const existing = groups.find((group) => group.kind === "pln" && group.key === key);
    if (existing?.kind === "pln") existing.docs.push(doc);
    else groups.push({ kind: "pln", key, docs: [doc] });
  }
  return groups;
}

export function CekNotaView() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { projects, vendors, generatedNotas, loading } = useKdkmpStore();
  const project = projects.find((entry) => entry.id === projectId);
  const [stageFilter, setStageFilter] = useState<StageFilter>("all");
  const [vendorFilter, setVendorFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<"selected" | "all">("selected");
  const [visibleCount, setVisibleCount] = useState(6);

  const docs = useMemo(() => {
    const sortedDocs = generatedNotas
      .filter((doc) => doc.projectId === projectId && doc.documentType === "nota")
      .sort((a, b) => docSortRank(a) - docSortRank(b) || a.vendorName.localeCompare(b.vendorName));
    return moveSpecialNotasToStageEnd(sortedDocs);
  }, [generatedNotas, projectId]);

  const filteredDocs = useMemo(() => {
    return docs
      .filter((doc) => stageFilter === "all" || doc.stageCode === stageFilter)
      .filter((doc) => vendorFilter === "all" || doc.vendorId === vendorFilter)
      .filter((doc) => `${doc.vendorName} ${doc.stageName} ${doc.templateName} ${doc.categoryNames.join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  }, [docs, query, stageFilter, vendorFilter]);
  const documentEntries = useMemo(() => groupDocumentsForPresentation(docs), [docs]);
  const filteredEntries = useMemo(() => groupDocumentsForPresentation(filteredDocs), [filteredDocs]);

  const selected = filteredDocs.find((doc) => doc.id === selectedId) ?? filteredDocs[0] ?? null;
  const renderedDocs = useMemo(() => {
    if (selected && previewMode === "selected" && isSpecialPLNKwitansi(selected)) {
      return getPLNDocumentGroup(docs, selected);
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
    setVisibleCount(6);
  }, [previewMode, query, stageFilter, vendorFilter]);

  if (loading && !project) {
    return <Card><CardContent className="p-8">Memuat hasil nota...</CardContent></Card>;
  }

  if (!project) {
    return <Card><CardContent className="p-8">Project tidak ditemukan.</CardContent></Card>;
  }

  return (
    <MotionPage>
      <div className="space-y-5">
        <div className="no-print flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-normal">Cek Hasil Nota Otomatis</h2>
            <p className="text-sm text-slate-500">
              {documentEntries.length} nota tersimpan untuk {formatProjectWilayah(project)}. PDF tidak dibuat saat halaman dibuka.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href={`/projects/${project.id}/custom-note`}><FilePlus2 className="h-4 w-4" />Nota Tambahan</Link>
            </Button>
            <Button asChild variant="emerald">
              <Link href={`/projects/${project.id}/edit-kwitansi`}>Lanjut Kwitansi Tahapan<ArrowRight className="h-4 w-4" /></Link>
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
              <SelectItem value="all">Preview semua filter</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
          <Card className="no-print">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ReceiptText className="h-5 w-5 text-blue-600" />Dokumen Generated</CardTitle>
              <CardDescription>{filteredEntries.length} dokumen sesuai filter.</CardDescription>
            </CardHeader>
            <CardContent className="max-h-[68vh] space-y-2 overflow-auto">
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
                    <Badge>{doc.source === "custom" ? "custom" : doc.documentType}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {getStageLabel(doc.stageCode)} - {itemLabel} - {formatRupiah(entry.totalAmount)}
                  </p>
                </button>
                );
              })}
              {filteredEntries.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                  Belum ada nota. Generate nota dari resume terlebih dahulu.
                </p>
              ) : null}
            </CardContent>
          </Card>

          <div className="print-area space-y-5 overflow-auto rounded-xl bg-slate-100 p-4 dark:bg-slate-900/50">
            {renderedGroups.map((group) => group.kind === "pln" ? (
              <PLNKwitansiBatchTemplate key={group.key} docs={group.docs} project={project} zoom={0.78} />
            ) : (
              <DocumentTemplateRenderer
                key={`${group.docs[0].id}-${hashNotaData(group.docs[0])}`}
                doc={group.docs[0]}
                project={project}
                zoom={0.78}
              />
            ))}
            {previewMode === "all" && visibleCount < filteredDocs.length ? (
              <div className="no-print flex justify-center">
                <Button variant="outline" onClick={() => setVisibleCount((count) => count + 6)}>Muat 6 nota lagi</Button>
              </div>
            ) : null}
            {renderedDocs.length === 0 ? (
              <Card>
                <CardContent className="flex h-96 items-center justify-center text-sm text-slate-500">Pilih dokumen untuk preview.</CardContent>
              </Card>
            ) : null}
          </div>
        </div>
      </div>
    </MotionPage>
  );
}
