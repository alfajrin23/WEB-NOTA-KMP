"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, Download, FileCheck2, Loader2, Pencil, ReceiptText, Save } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { MotionPage } from "@/components/ui/motion-page";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getStageLabel } from "@/constants/stages";
import { getResumeItemAmount } from "@/lib/resume-calculations";
import { generateNotaDocuments } from "@/lib/nota-generator";
import { useKdkmpStore } from "@/hooks/use-kdkmp-store";
import { DocumentPreviewModal, PreviewPayload } from "@/features/documents/preview-export";
import { formatProjectWilayah, formatRupiah } from "@/utils/format";
import type { GeneratedNota, Project, ResumeItem } from "@/types/domain";

type DraftEdit = { itemName: string; unitPrice: number };
type EditScope = "note" | "all";

type VendorRow = {
  project: Project;
  item: ResumeItem;
};

type GeneratedProjectEntry = {
  project: Project;
  docs: GeneratedNota[];
};

function draftItem(item: ResumeItem, draft: DraftEdit | undefined) {
  if (!draft) return item;
  return { ...item, itemName: draft.itemName, unitPrice: draft.unitPrice, amountOverride: null };
}

export function VendorNoteView() {
  const {
    projects,
    vendors,
    loading,
    supabaseReady,
    templateAssignments,
    refresh,
    updateVendorItem,
    generateProjectNotas,
  } = useKdkmpStore();
  const [selectedVendorId, setSelectedVendorId] = useState("none");
  const [drafts, setDrafts] = useState<Record<string, DraftEdit>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingPrice, setEditingPrice] = useState(0);
  const [editScope, setEditScope] = useState<EditScope>("note");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [persisting, setPersisting] = useState(false);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[] | null>(null);
  const [generatedEntries, setGeneratedEntries] = useState<GeneratedProjectEntry[]>([]);
  const [previewPayload, setPreviewPayload] = useState<PreviewPayload | null>(null);

  const vendorOptions = useMemo(() => {
    const ids = new Set(
      projects.flatMap((project) => project.items.map((item) => item.vendorId).filter(Boolean)),
    );
    return vendors.filter((vendor) => ids.has(vendor.id));
  }, [projects, vendors]);

  const selectedVendor = vendors.find((vendor) => vendor.id === selectedVendorId);
  const rows = useMemo<VendorRow[]>(() => {
    if (!selectedVendor) return [];
    return projects.flatMap((project) => project.items
      .filter((item) => item.vendorId === selectedVendor.id)
      .map((item) => ({ project, item })));
  }, [projects, selectedVendor]);

  const projectGroups = useMemo(() => {
    const groups = new Map<string, VendorRow[]>();
    for (const row of rows) groups.set(row.project.id, [...(groups.get(row.project.id) ?? []), row]);
    return [...groups.values()];
  }, [rows]);

  const selectedIds = selectedProjectIds ?? projectGroups.map((group) => group[0].project.id);
  const selectedGroups = useMemo(
    () => projectGroups.filter((group) => selectedIds.includes(group[0].project.id)),
    [projectGroups, selectedIds],
  );
  const allProjectsSelected = projectGroups.length > 0 && selectedGroups.length === projectGroups.length;
  const total = useMemo(
    () => selectedGroups.flat().reduce((sum, row) => sum + getResumeItemAmount(draftItem(row.item, drafts[row.item.id])), 0),
    [drafts, selectedGroups],
  );

  function startEdit(row: VendorRow) {
    const current = draftItem(row.item, drafts[row.item.id]);
    setEditingId(row.item.id);
    setEditingName(current.itemName);
    setEditingPrice(current.unitPrice);
    setEditScope("note");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingName("");
    setEditingPrice(0);
  }

  async function saveEdit(row: VendorRow) {
    const nextName = editingName.trim();
    if (!nextName) {
      toast.error("Nama barang wajib diisi.");
      return;
    }
    if (!Number.isFinite(editingPrice) || editingPrice < 0) {
      toast.error("Harga satuan harus angka valid dan tidak boleh minus.");
      return;
    }

    setSavingId(row.item.id);
    try {
      if (editScope === "all") {
        const result = await updateVendorItem({
          projectId: row.project.id,
          itemId: row.item.id,
          itemName: nextName,
          nameScope: "all",
        });
        toast.success(`Nama barang diperbarui pada ${result.affectedCount} baris di seluruh nota vendor.`);
      }
      setDrafts((current) => ({ ...current, [row.item.id]: { itemName: nextName, unitPrice: editingPrice } }));
      setGeneratedEntries([]);
      setPreviewPayload(null);
      cancelEdit();
      if (editScope === "note") toast.success("Perubahan disimpan untuk nota ini saja. Sumber resume tetap aman.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menyimpan perubahan barang.");
    } finally {
      setSavingId(null);
    }
  }

  async function generateVendorNotes() {
    if (selectedGroups.length === 0) {
      toast.error("Centang minimal satu desa untuk di-generate.");
      return;
    }
    if (!selectedVendor) {
      toast.error("Pilih vendor terlebih dahulu.");
      return;
    }

    setGenerating(true);
    try {
      const nextEntries: GeneratedProjectEntry[] = [];
      for (const group of selectedGroups) {
        const overrides = Object.fromEntries(
          group
            .map(({ item }) => [item.id, drafts[item.id]])
            .filter((entry): entry is [string, DraftEdit] => Boolean(entry[1])),
        );

        // Bentuk preview dari data yang sudah ada di halaman terlebih dahulu.
        // Penyimpanan ke Supabase dilakukan setelah preview siap agar tombol
        // tidak menunggu seluruh proses insert dan refresh bundle selesai.
        const generationProject = Object.keys(overrides).length === 0
          ? group[0].project
          : {
            ...group[0].project,
            items: group[0].project.items.map((item) => overrides[item.id]
              ? { ...item, ...overrides[item.id], amountOverride: null }
              : item),
          };
        const docs = generateNotaDocuments(generationProject, vendors, templateAssignments)
          .filter((doc) => doc.vendorId === selectedVendorId)
          .map((doc) => ({ ...doc, source: "auto" as const, status: "generated" as const }));
        nextEntries.push({
          project: group[0].project,
          docs,
        });
      }

      setGeneratedEntries(nextEntries.filter((entry) => entry.docs.length > 0));
      toast.success(`Preview nota ${selectedVendor.name} siap untuk ${selectedGroups.length} desa.`);

      // Persist secara terpisah supaya preview tetap dapat dibuka meskipun
      // Supabase membutuhkan waktu lebih lama untuk menyimpan semua desa.
      setPersisting(true);
      void (async () => {
        try {
          if (supabaseReady) {
            for (const group of selectedGroups) {
              const overrides = Object.fromEntries(
                group
                  .map(({ item }) => [item.id, drafts[item.id]])
                  .filter((entry): entry is [string, DraftEdit] => Boolean(entry[1])),
              );
              await generateProjectNotas(group[0].project.id, overrides, { refresh: false, notify: false });
            }
            await refresh();
            toast.success(`Data nota ${selectedVendor.name} sudah tersimpan ke Supabase.`);
          } else {
            toast.warning("Preview siap. Supabase belum dikonfigurasi sehingga data hanya tersimpan di cache lokal.");
          }
        } catch (error) {
          toast.error(error instanceof Error ? `Preview siap, tetapi penyimpanan gagal: ${error.message}` : "Preview siap, tetapi penyimpanan ke Supabase gagal.");
        } finally {
          setPersisting(false);
        }
      })();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal membuat nota vendor.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <MotionPage>
      <div className="space-y-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-normal">Buat Nota 1 Vendor</h2>
            <p className="text-sm text-slate-500">Pilih satu vendor untuk menampilkan seluruh pekerjaan dan materialnya dari semua wilayah.</p>
          </div>
          <Button onClick={generateVendorNotes} disabled={generating || persisting || selectedGroups.length === 0}>
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : persisting ? <Check className="h-4 w-4" /> : <FileCheck2 className="h-4 w-4" />}
            {generating ? "Menyiapkan Preview..." : persisting ? "Preview Siap · Menyimpan..." : "Generate Nota Vendor"}
          </Button>
        </div>

        {!supabaseReady ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
            Supabase belum dikonfigurasi. Data yang tersedia berasal dari cache lokal dan hasil generate tidak permanen.
          </div>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ReceiptText className="h-5 w-5 text-blue-600" />Pilih Nota Vendor</CardTitle>
            <CardDescription>Data wilayah dan material akan muncul setelah vendor dipilih.</CardDescription>
          </CardHeader>
          <CardContent>
            <Select value={selectedVendorId} onValueChange={(value) => { setSelectedVendorId(value); setSelectedProjectIds(null); setDrafts({}); setGeneratedEntries([]); setPreviewPayload(null); cancelEdit(); }}>
              <SelectTrigger className="max-w-xl"><SelectValue placeholder="Pilih vendor" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Pilih vendor</SelectItem>
                {vendorOptions.map((vendor) => <SelectItem key={vendor.id} value={vendor.id}>{vendor.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {selectedVendor ? (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">Vendor</CardTitle></CardHeader><CardContent><p className="text-xl font-bold">{selectedVendor.name}</p></CardContent></Card>
              <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">Desa Dipilih</CardTitle></CardHeader><CardContent><p className="text-xl font-bold">{selectedGroups.length} / {projectGroups.length}</p></CardContent></Card>
              <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">Total Material Dipilih</CardTitle></CardHeader><CardContent><p className="text-xl font-bold">{formatRupiah(total)}</p><p className="text-xs text-slate-500">{selectedGroups.flat().length} baris material</p></CardContent></Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Desa yang Akan Di-generate</CardTitle>
                <CardDescription>Centang desa yang ingin dibuatkan nota. Desa yang tidak dicentang akan dilewati.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold dark:border-blue-900 dark:bg-blue-950/30">
                  <input
                    type="checkbox"
                    checked={allProjectsSelected}
                    onChange={() => setSelectedProjectIds(allProjectsSelected ? [] : projectGroups.map((group) => group[0].project.id))}
                    className="h-4 w-4 accent-blue-600"
                  />
                  Centang semua desa ({projectGroups.length})
                </label>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {projectGroups.map((group) => {
                    const project = group[0].project;
                    const checked = selectedIds.includes(project.id);
                    const groupTotal = group.reduce((sum, row) => sum + getResumeItemAmount(draftItem(row.item, drafts[row.item.id])), 0);
                    return (
                      <label key={project.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${checked ? "border-blue-500 bg-blue-50/70 dark:bg-blue-950/30" : "border-slate-200 dark:border-slate-800"}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setSelectedProjectIds((current) => {
                            const next = new Set(current ?? projectGroups.map((entry) => entry[0].project.id));
                            if (next.has(project.id)) next.delete(project.id);
                            else next.add(project.id);
                            return [...next];
                          })}
                          className="mt-1 h-4 w-4 accent-blue-600"
                        />
                        <span className="min-w-0"><span className="block font-semibold">{formatProjectWilayah(project)}</span><span className="mt-1 block text-xs text-slate-500">{group.length} material · {formatRupiah(groupTotal)}</span></span>
                      </label>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Data Material per Wilayah</CardTitle>
                <CardDescription>Edit nama barang atau harga sebelum nota dibuat. Gunakan pilihan cakupan saat mengubah nama barang.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {projectGroups.map((group) => {
                  const project = group[0].project;
                  return (
                    <div key={project.id} className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
                      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-4 py-3 dark:bg-slate-900">
                        <div><p className="font-semibold">{formatProjectWilayah(project)}</p><p className="text-xs text-slate-500">{project.projectName}</p></div>
                        <Button asChild size="sm" variant="outline"><Link href={`/projects/${project.id}/resume`}>Buka Resume</Link></Button>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[980px] text-left text-sm">
                          <thead className="border-t border-slate-200 bg-white text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-950">
                            <tr><th className="px-4 py-3">No</th><th className="px-4 py-3">Tahap</th><th className="px-4 py-3">Nama Barang / Material</th><th className="px-4 py-3 text-right">Qty</th><th className="px-4 py-3">Satuan</th><th className="px-4 py-3 text-right">Harga Satuan</th><th className="px-4 py-3 text-right">Jumlah</th><th className="px-4 py-3 text-right">Aksi</th></tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                            {group.map((row, index) => {
                              const current = draftItem(row.item, drafts[row.item.id]);
                              const isEditing = editingId === row.item.id;
                              return (
                                <tr key={row.item.id} className={isEditing ? "bg-blue-50/60 dark:bg-blue-950/20" : undefined}>
                                  <td className="px-4 py-3 text-slate-500">{index + 1}</td>
                                  <td className="px-4 py-3"><Badge>{getStageLabel(row.item.stageCode)}</Badge></td>
                                  <td className="max-w-[300px] px-4 py-3 font-medium">
                                    {isEditing ? <Input value={editingName} onChange={(event) => setEditingName(event.target.value)} autoFocus /> : <span>{current.itemName}</span>}
                                    {isEditing ? (
                                      <div className="mt-3 space-y-2 rounded-lg border border-blue-200 bg-white p-3 text-xs dark:border-blue-900 dark:bg-slate-950">
                                        <p className="font-semibold text-slate-700 dark:text-slate-200">Cakupan perubahan nama barang</p>
                                        <label className="flex cursor-pointer items-start gap-2"><input type="radio" name={`scope-${row.item.id}`} checked={editScope === "note"} onChange={() => setEditScope("note")} className="mt-0.5" /><span><b>Hanya nota ini</b><br /><span className="text-slate-500">Resume dan nota wilayah lain tidak berubah.</span></span></label>
                                        <label className="flex cursor-pointer items-start gap-2"><input type="radio" name={`scope-${row.item.id}`} checked={editScope === "all"} onChange={() => setEditScope("all")} className="mt-0.5" /><span><b>Semua nota vendor</b><br /><span className="text-slate-500">Semua baris vendor dengan nama lama yang sama ikut diperbarui.</span></span></label>
                                      </div>
                                    ) : null}
                                  </td>
                                  <td className="px-4 py-3 text-right tabular-nums">{current.volume}</td>
                                  <td className="px-4 py-3">{current.unit}</td>
                                  <td className="px-4 py-3 text-right">
                                    {isEditing ? <CurrencyInput value={editingPrice} onValueChange={(value) => setEditingPrice(Number(value || 0))} /> : <span className="tabular-nums">{formatRupiah(current.unitPrice)}</span>}
                                  </td>
                                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatRupiah(getResumeItemAmount(current))}</td>
                                  <td className="px-4 py-3 text-right">
                                    {isEditing ? (
                                      <div className="flex justify-end gap-2"><Button size="sm" onClick={() => void saveEdit(row)} disabled={savingId === row.item.id}>{savingId === row.item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Simpan</Button><Button size="sm" variant="ghost" onClick={cancelEdit}>Batal</Button></div>
                                    ) : <Button size="sm" variant="outline" onClick={() => startEdit(row)}><Pencil className="h-4 w-4" />Edit</Button>}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
                {projectGroups.length === 0 ? <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">Belum ada material untuk vendor ini.</p> : null}
              </CardContent>
            </Card>

            <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/20">
              <div><p className="font-semibold">Siap membuat nota?</p><p className="text-sm text-slate-600 dark:text-slate-300">{selectedGroups.length} desa terpilih untuk vendor {selectedVendor.name}.</p></div>
              <div className="flex items-center gap-2"><Check className="hidden h-5 w-5 text-emerald-600 sm:block" /><Button variant="emerald" onClick={generateVendorNotes} disabled={generating || persisting || selectedGroups.length === 0}>{generating ? "Menyiapkan Preview..." : persisting ? "Preview Siap · Menyimpan..." : "Generate Sekarang"}</Button></div>
            </div>

            {generatedEntries.length > 0 ? (
              <Card className="border-blue-200 dark:border-blue-900">
                <CardHeader>
                  <CardTitle>Nota Berhasil Dibuat</CardTitle>
                  <CardDescription>{generatedEntries.length} desa siap dipreview dan di-download sebagai satu file PDF gabungan.{persisting ? " Penyimpanan Supabase masih berjalan di latar belakang." : ""}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-3">
                  <Button
                    onClick={() => setPreviewPayload({
                      kind: "notes",
                      title: `Preview Nota ${selectedVendor.name}`,
                      project: generatedEntries[0].project,
                      projectEntries: generatedEntries,
                      fileName: `nota-${selectedVendor.name}-${generatedEntries.map((entry) => entry.project.villageName).join("-")}`,
                    })}
                  >
                    <FileCheck2 className="h-4 w-4" />Preview PDF
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setPreviewPayload({
                      kind: "notes",
                      title: `Download Nota ${selectedVendor.name}`,
                      project: generatedEntries[0].project,
                      projectEntries: generatedEntries,
                      fileName: `nota-${selectedVendor.name}-${generatedEntries.map((entry) => entry.project.villageName).join("-")}`,
                    })}
                  >
                    <Download className="h-4 w-4" />Preview & Download PDF
                  </Button>
                </CardContent>
              </Card>
            ) : null}
          </>
        ) : (
          <Card><CardContent className="p-10 text-center text-sm text-slate-500">{loading ? "Memuat data wilayah dan material..." : "Pilih vendor untuk melihat data nota dari seluruh wilayah."}</CardContent></Card>
        )}
      </div>
      <DocumentPreviewModal payload={previewPayload} templateAssignments={templateAssignments} onClose={() => setPreviewPayload(null)} />
    </MotionPage>
  );
}
