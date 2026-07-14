"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { AlertTriangle, ChevronDown, ChevronRight, Download, Plus, Redo2, RefreshCcw, Save, Search, Trash2, Undo2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { MotionPage } from "@/components/ui/motion-page";
import { useKdkmpStore } from "@/hooks/use-kdkmp-store";
import { STAGES, getStageLabel } from "@/constants/stages";
import { buildProjectSummary, buildResumeValidationReport, getComputedAmount, getResumeItemAmount, ResumeValidationReport, validateProjectResume } from "@/lib/resume-calculations";
import { shiftResumeItemsFromDefault } from "@/lib/project-date-shift";
import { findPriceSyncSiblingItems } from "@/lib/resume-price-sync";
import { compareResumeItems, mergeResumeItems, ParsedResume, ResumeImportDiff } from "@/lib/resume-import/parser";
import { formatNumber, formatRupiah, formatThousands, formatTimeIndonesia, numericInputValue } from "@/utils/format";
import { ResumeItem, StageCode } from "@/types/domain";
import { cn } from "@/lib/utils";

type DraftSnapshot = ResumeItem[];
type ProjectMetadataDraft = {
  projectName: string;
  villageName: string;
  districtName: string;
  regencyName: string;
  regionName: string;
  projectDate: string;
  reportDate?: string;
  responsibleName: string;
  coordinates?: string;
  invoiceRecipientName?: string;
  invoiceRecipientAddress?: string;
};

export function ResumeEditor() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const {
    projects,
    vendors,
    templateAssignments,
    loading,
    syncError,
    supabaseReady,
    updateProjectMeta,
    updateProjectStartDate,
    updateItem,
    updateItemUnitPrice,
    addItem,
    deleteItem,
    replaceProjectItems,
    resetProjectResumeFromMaster,
    applyResumeImport,
    generatedNotas,
  } = useKdkmpStore();
  const project = projects.find((entry) => entry.id === projectId);
  const [stage, setStage] = useState<StageCode>("TAHAP_I");
  const [query, setQuery] = useState("");
  const [vendorFilter, setVendorFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [savedAt, setSavedAt] = useState(new Date());
  const [past, setPast] = useState<DraftSnapshot[]>([]);
  const [future, setFuture] = useState<DraftSnapshot[]>([]);
  const [importingResume, setImportingResume] = useState(false);
  const [importPreview, setImportPreview] = useState<{ parsed: ParsedResume; diff: ResumeImportDiff } | null>(null);
  const resumeFileInputRef = useRef<HTMLInputElement | null>(null);

  const summary = useMemo(() => (project ? buildProjectSummary(project, vendors) : null), [project, vendors]);
  const projectGeneratedNotas = useMemo(() => generatedNotas.filter((doc) => doc.projectId === projectId && doc.documentType === "nota"), [generatedNotas, projectId]);
  const generatedItemIds = useMemo(
    () => new Set(projectGeneratedNotas.flatMap((doc) => doc.itemIds.length > 0 ? doc.itemIds : doc.items.map((item) => item.id))),
    [projectGeneratedNotas],
  );
  const validationReport = useMemo(
    () => (project ? buildResumeValidationReport(project, projectGeneratedNotas, vendors, templateAssignments) : null),
    [project, projectGeneratedNotas, templateAssignments, vendors],
  );
  const issues = useMemo(
    () => (project ? validateProjectResume(project, vendors, templateAssignments) : []),
    [project, templateAssignments, vendors],
  );

  const visibleItems = useMemo(() => {
    if (!project) return [];
    return project.items
      .filter((item) => item.stageCode === stage)
      .filter((item) => item.itemName.toLowerCase().includes(query.toLowerCase()) || item.category.toLowerCase().includes(query.toLowerCase()))
      .filter((item) => {
        if (vendorFilter === "all") return true;
        if (vendorFilter === "missing") return !item.vendorId && (item.vendorName ?? "").trim() !== "-";
        if (vendorFilter === "dash") return (item.vendorName ?? "").trim() === "-";
        if (vendorFilter === "not-generated") return !(generatedItemIds.has(item.id) || item.isGeneratedToNote);
        return item.vendorId === vendorFilter;
      })
      .filter((item) => categoryFilter === "all" || item.category === categoryFilter)
      .filter((item) => !collapsed.has(item.category))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [categoryFilter, collapsed, generatedItemIds, project, query, stage, vendorFilter]);

  const categories = useMemo(() => {
    if (!project) return [];
    const map = new Map<string, number>();
    for (const item of project.items.filter((entry) => entry.stageCode === stage)) {
      map.set(item.category, (map.get(item.category) ?? 0) + getResumeItemAmount(item));
    }
    return [...map.entries()];
  }, [project, stage]);

  const remember = useCallback(() => {
    if (!project) return;
    setPast((current) => [...current, project.items].slice(-30));
    setFuture([]);
  }, [project]);

  const patch = useCallback((item: ResumeItem, data: Partial<ResumeItem>) => {
    remember();
    updateItem(projectId, item.id, data);
    setSavedAt(new Date());
  }, [projectId, remember, updateItem]);

  function undo() {
    if (!project || past.length === 0) return;
    const previous = past.at(-1);
    if (!previous) return;
    setFuture((current) => [project.items, ...current]);
    replaceProjectItems(projectId, previous);
    setPast((current) => current.slice(0, -1));
    toast.info("Undo diterapkan");
  }

  function redo() {
    if (!project || future.length === 0) return;
    const next = future[0];
    setPast((current) => [...current, project.items]);
    replaceProjectItems(projectId, next);
    setFuture((current) => current.slice(1));
    toast.info("Redo diterapkan");
  }

  const addResumeRow = useCallback(() => {
    remember();
    addItem(projectId, { stageCode: stage, stageName: getStageLabel(stage) });
    setSavedAt(new Date());
  }, [addItem, projectId, remember, stage]);

  const deleteResumeRow = useCallback((itemId: string) => {
    remember();
    deleteItem(projectId, itemId);
    setSavedAt(new Date());
  }, [deleteItem, projectId, remember]);

  const reimportResume = useCallback(async () => {
    if (!project) return;
    const confirmed = window.confirm(
      "Reset master akan mengganti seluruh baris resume project ini dengan master resume terbaru dan menghapus generated notes otomatis lama. Lanjutkan?",
    );
    if (!confirmed) return;

    try {
      await resetProjectResumeFromMaster(project.id);
      setPast([]);
      setFuture([]);
      setSavedAt(new Date());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal import ulang resume.");
    }
  }, [project, resetProjectResumeFromMaster]);

  const handleResumeUpload = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !project) return;

    setImportingResume(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/resume-import/parse", { method: "POST", body: formData });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Gagal parsing resume.");
      const parsed = result as ParsedResume;
      const parsedForProject = {
        ...parsed,
        items: shiftResumeItemsFromDefault(parsed.items, project.projectDate),
      };
      const diff = compareResumeItems(project.items, parsedForProject.items);
      setImportPreview({ parsed: parsedForProject, diff });
      toast.success(`${parsedForProject.items.length} item resume berhasil dibaca dari file.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal upload resume.");
    } finally {
      setImportingResume(false);
    }
  }, [project]);

  const applyImportPreview = useCallback(async (mode: "replace" | "merge") => {
    if (!project || !importPreview) return;
    const confirmed = window.confirm(
      mode === "replace"
        ? "Replace akan mengganti seluruh resume aktif dan menghapus generated notes otomatis lama. Lanjutkan?"
        : "Merge akan memperbarui item yang cocok dan menambahkan item baru. Generated notes otomatis lama akan dihapus agar bisa digenerate ulang. Lanjutkan?",
    );
    if (!confirmed) return;

    try {
      remember();
      const nextItems = mode === "replace" ? importPreview.parsed.items : mergeResumeItems(project.items, importPreview.parsed.items);
      await applyResumeImport(project.id, nextItems, `Resume ${mode === "replace" ? "direplace" : "dimerge"} dari ${importPreview.parsed.sourceFile}.`);
      setImportPreview(null);
      setPast([]);
      setFuture([]);
      setSavedAt(new Date());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menerapkan import resume.");
    }
  }, [applyResumeImport, importPreview, project, remember]);

  const handleProjectStartDateCommit = useCallback(async (value: string) => {
    if (!project || value === project.projectDate) return;
    if (!value) {
      toast.error("Tanggal Awal Project wajib diisi.");
      return;
    }

    const shiftExistingDates = window.confirm(
      "Tanggal Awal Project berubah. Pilih OK untuk menggeser ulang semua tanggal resume, nota, dan kwitansi berdasarkan tanggal baru. Pilih Cancel untuk hanya menyimpan tanggal project tanpa mengubah tanggal dokumen yang sudah ada.",
    );

    try {
      await updateProjectStartDate(project.id, value, shiftExistingDates);
      setPast([]);
      setFuture([]);
      setSavedAt(new Date());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memperbarui Tanggal Awal Project.");
    }
  }, [project, updateProjectStartDate]);

  const handleUnitPriceCommit = useCallback((item: ResumeItem, value: string) => {
    if (!project) return;
    const unitPrice = Number(value);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      toast.error("Harga satuan harus angka valid dan tidak boleh minus.");
      return;
    }
    if (unitPrice === item.unitPrice) return;

    const siblings = findPriceSyncSiblingItems(project.items, item);
    const shouldSync = siblings.length > 0 && window.confirm(
      "Harga satuan barang ini juga ditemukan pada tahap lain dengan vendor yang sama. Apakah ingin menyamakan harga untuk semua tahap?",
    );

    remember();
    void updateItemUnitPrice(project.id, item.id, unitPrice, shouldSync)
      .then(({ affectedCount }) => {
        setSavedAt(new Date());
        toast.success(
          shouldSync
            ? `Harga satuan disamakan untuk ${affectedCount} item barang dari vendor yang sama.`
            : "Harga satuan item diperbarui.",
        );
      })
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : "Gagal menyimpan harga satuan.");
      });
  }, [project, remember, updateItemUnitPrice]);

  const handleTargetGrandTotalCommit = useCallback((targetGrandTotal: number | null) => {
    if (!project) return;
    updateProjectMeta(project.id, { targetGrandTotal });
    setSavedAt(new Date());
    toast.success(targetGrandTotal == null ? "Target grand total resume dikosongkan." : "Target grand total resume tersimpan.");
  }, [project, updateProjectMeta]);

  const columns = useMemo<ColumnDef<ResumeItem>[]>(() => [
    {
      header: "Tanggal",
      accessorKey: "expenseDate",
      cell: ({ row }) => (
        <EditableInput
          type="date"
          value={row.original.expenseDate}
          className="w-32 min-w-32 whitespace-nowrap text-center tabular-nums"
          onCommit={(value) => patch(row.original, { expenseDate: value })}
        />
      ),
    },
    {
      header: "Tahap",
      accessorKey: "stageCode",
      cell: ({ row }) => (
        <select
          value={row.original.stageCode}
          onChange={(event) => {
            const stageCode = event.target.value as StageCode;
            patch(row.original, { stageCode, stageName: getStageLabel(stageCode) });
          }}
          className="h-9 min-w-36 rounded-lg border border-slate-200 bg-white px-2 text-sm dark:border-slate-800 dark:bg-slate-950"
        >
          {STAGES.map((entry) => <option key={entry.code} value={entry.code}>{entry.shortLabel}</option>)}
        </select>
      ),
    },
    {
      header: "Nama Barang/Jasa",
      accessorKey: "itemName",
      cell: ({ row }) => <EditableInput value={row.original.itemName} className="min-w-64" onCommit={(value) => patch(row.original, { itemName: value })} />,
    },
    {
      header: "Vol",
      accessorKey: "volume",
      cell: ({ row }) => <EditableInput type="number" value={row.original.volume.toString()} className="w-24 text-right" onCommit={(value) => patch(row.original, { volume: Number(value) })} />,
    },
    {
      header: "Satuan",
      accessorKey: "unit",
      cell: ({ row }) => <EditableInput value={row.original.unit} className="w-24 text-center" onCommit={(value) => patch(row.original, { unit: value })} />,
    },
    {
      header: "Harga",
      accessorKey: "unitPrice",
      cell: ({ row }) => (
        <EditableInput
          type="currency"
          value={row.original.unitPrice.toString()}
          className="w-32 text-right"
          onCommit={(value) => handleUnitPriceCommit(row.original, value)}
          commitOnBlurOnly
        />
      ),
    },
    {
      header: "Jumlah",
      cell: ({ row }) => (
        <div className="min-w-36 text-right">
          <span className="block font-semibold">{formatRupiah(getResumeItemAmount(row.original))}</span>
          {typeof row.original.amountOverride === "number" && Number.isFinite(row.original.amountOverride) && (
            <span className="text-[11px] text-amber-600">manual</span>
          )}
        </div>
      ),
    },
    {
      header: "Override",
      accessorKey: "amountOverride",
      cell: ({ row }) => (
        <EditableInput
          type="currency"
          value={row.original.amountOverride?.toString() ?? ""}
          placeholder={formatThousands(getComputedAmount(row.original))}
          className="w-36 text-right"
          onCommit={(value) => patch(row.original, { amountOverride: value.trim() ? Number(value) : null })}
        />
      ),
    },
    {
      header: "Vendor",
      accessorKey: "vendorId",
      cell: ({ row }) => {
        const selectedValue = row.original.vendorId || ((row.original.vendorName ?? "").trim() === "-" ? "__dash__" : "");
        return (
          <select
            value={selectedValue}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "__dash__") {
                patch(row.original, { vendorId: "", vendorName: "-" });
                return;
              }
              const vendor = vendors.find((entry) => entry.id === value);
              patch(row.original, { vendorId: value, vendorName: vendor?.name ?? "" });
            }}
            className="h-9 min-w-40 rounded-lg border border-slate-200 bg-white px-2 text-sm dark:border-slate-800 dark:bg-slate-950"
          >
            <option value="">Belum ada vendor</option>
            <option value="__dash__">-</option>
            {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
          </select>
        );
      },
    },
    {
      header: "Status",
      cell: ({ row }) => {
        const dashVendor = (row.original.vendorName ?? "").trim() === "-";
        const missingVendor = !row.original.vendorId && !dashVendor;
        const generated = generatedItemIds.has(row.original.id) || row.original.isGeneratedToNote;
        return (
          <div className="flex min-w-36 flex-col gap-1">
            {missingVendor ? <Badge className="w-fit bg-amber-50 text-amber-700">Belum vendor</Badge> : null}
            {dashVendor ? <Badge className="w-fit bg-amber-50 text-amber-700">Vendor -</Badge> : null}
            {!missingVendor && !dashVendor ? <Badge className="w-fit bg-emerald-50 text-emerald-700">Vendor OK</Badge> : null}
            {generated ? <Badge className="w-fit bg-blue-50 text-blue-700">Sudah nota</Badge> : <Badge className="w-fit bg-slate-100 text-slate-600">Belum nota</Badge>}
          </div>
        );
      },
    },
    {
      header: "Kategori",
      accessorKey: "category",
      cell: ({ row }) => <EditableInput value={row.original.category} className="min-w-72 text-xs" onCommit={(value) => patch(row.original, { category: value })} />,
    },
    {
      header: "Ket.",
      accessorKey: "notes",
      cell: ({ row }) => <EditableInput value={row.original.notes ?? ""} className="min-w-44" onCommit={(value) => patch(row.original, { notes: value })} />,
    },
    {
      header: "",
      id: "actions",
      cell: ({ row }) => (
        <Button size="icon" variant="ghost" onClick={() => deleteResumeRow(row.original.id)} aria-label="Hapus baris">
          <Trash2 className="h-4 w-4 text-red-500" />
        </Button>
      ),
    },
  ], [deleteResumeRow, generatedItemIds, handleUnitPriceCommit, patch, vendors]);

  const table = useReactTable({ data: visibleItems, columns, getCoreRowModel: getCoreRowModel() });

  if (loading && !project) {
    return (
      <Card>
        <CardContent className="p-8">
          <p className="font-semibold">Memuat data project dari Supabase...</p>
        </CardContent>
      </Card>
    );
  }

  if (!project) {
    return (
      <Card>
        <CardContent className="p-8">
          <p className="font-semibold">Project tidak ditemukan.</p>
        </CardContent>
      </Card>
    );
  }

  const stageTotal = summary?.stages.find((entry) => entry.stageCode === stage)?.total ?? 0;
  const grandTotal = summary?.grandTotal ?? 0;
  const stageIssues = issues.filter((issue) => issue.stageCode === stage);

  return (
    <MotionPage>
      <div className="space-y-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-normal">Resume Editor</h2>
            <p className="text-sm text-slate-500">
              Desa {project.villageName}, Kec. {project.districtName}, Kab. {project.regencyName}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={undo} disabled={past.length === 0}><Undo2 className="h-4 w-4" />Undo</Button>
            <Button variant="outline" onClick={redo} disabled={future.length === 0}><Redo2 className="h-4 w-4" />Redo</Button>
            <Button variant="outline" onClick={reimportResume}><RefreshCcw className="h-4 w-4" />Reset Master</Button>
            <Button variant="outline" onClick={() => resumeFileInputRef.current?.click()} disabled={importingResume}>
              <Upload className="h-4 w-4" />{importingResume ? "Membaca..." : "Upload/Update Resume"}
            </Button>
            <input ref={resumeFileInputRef} type="file" accept="application/pdf,text/plain,.txt" className="hidden" onChange={handleResumeUpload} />
            <Button variant="outline" onClick={addResumeRow}><Plus className="h-4 w-4" />Tambah Baris</Button>
            <Button asChild variant="emerald"><Link href={`/projects/${project.id}/generate-nota`}><Download className="h-4 w-4" />Lanjut Buat Nota/Kwitansi Otomatis</Link></Button>
          </div>
        </div>

        {syncError || !supabaseReady ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
            {syncError ?? "Supabase belum dikonfigurasi. Perubahan hanya disimpan sebagai cache sementara sampai env Supabase diisi."}
          </div>
        ) : null}

        <ProjectMetadataCard
          project={project}
          onPatch={(data) => {
            updateProjectMeta(project.id, data);
            setSavedAt(new Date());
          }}
          onProjectDateCommit={handleProjectStartDateCommit}
        />

        {validationReport ? <ResumeValidationPanel report={validationReport} /> : null}
        {importPreview ? (
          <ResumeImportPreview
            preview={importPreview}
            onCancel={() => setImportPreview(null)}
            onReplace={() => applyImportPreview("replace")}
            onMerge={() => applyImportPreview("merge")}
          />
        ) : null}

        <div className="grid gap-4 md:grid-cols-3">
          <Card><CardHeader><CardTitle className="text-sm text-slate-500">Subtotal Tahap</CardTitle></CardHeader><CardContent><p className="text-xl font-bold">{formatRupiah(stageTotal)}</p></CardContent></Card>
          <Card><CardHeader><CardTitle className="text-sm text-slate-500">Grand Total</CardTitle></CardHeader><CardContent><p className="text-xl font-bold">{formatRupiah(grandTotal)}</p></CardContent></Card>
          <Card>
            <CardHeader><CardTitle className="text-sm text-slate-500">Validasi & Autosave</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Badge className="gap-2 bg-emerald-50 text-emerald-700"><Save className="h-3 w-3" />Tersimpan {formatTimeIndonesia(savedAt)}</Badge>
              {stageIssues.length > 0 && <Badge className="gap-2 bg-amber-50 text-amber-700"><AlertTriangle className="h-3 w-3" />{stageIssues.length} warning tahap ini</Badge>}
            </CardContent>
          </Card>
        </div>

        <ResumeTargetPanel
          grandTotal={grandTotal}
          targetGrandTotal={project.targetGrandTotal ?? null}
          onCommit={handleTargetGrandTotalCommit}
        />

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {summary?.stages.map((entry) => (
            <Card key={entry.stageCode}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-500">{entry.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-lg font-bold">{formatRupiah(entry.total)}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader className="gap-4">
            <Tabs value={stage} onValueChange={(value) => setStage(value as StageCode)}>
              <TabsList className="flex flex-wrap">
                {STAGES.map((entry) => <TabsTrigger key={entry.code} value={entry.code}>{entry.label}</TabsTrigger>)}
              </TabsList>
            </Tabs>
            <div className="grid gap-3 xl:grid-cols-[1fr_220px_260px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search barang atau kategori" />
              </div>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger><SelectValue placeholder="Filter kategori" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Kategori</SelectItem>
                  {categories.map(([category]) => <SelectItem key={category} value={category}>{category}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={vendorFilter} onValueChange={setVendorFilter}>
                <SelectTrigger><SelectValue placeholder="Filter vendor" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Vendor</SelectItem>
                  <SelectItem value="missing">Belum ada vendor</SelectItem>
                  <SelectItem value="dash">Vendor strip</SelectItem>
                  <SelectItem value="not-generated">Belum tergenerate nota</SelectItem>
                  {vendors.map((vendor) => <SelectItem key={vendor.id} value={vendor.id}>{vendor.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {stageIssues.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                <div className="mb-2 flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />Validasi ringan</div>
                <div className="grid gap-1 md:grid-cols-2">
                  {stageIssues.slice(0, 6).map((issue) => <p key={issue.id}>{issue.message}</p>)}
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {categories.map(([category, total]) => (
                <button
                  key={category}
                  onClick={() => setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(category)) next.delete(category);
                    else next.add(category);
                    return next;
                  })}
                  className={cn("inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold dark:border-slate-800", collapsed.has(category) && "bg-slate-100 dark:bg-slate-900")}
                >
                  {collapsed.has(category) ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  {category}
                  <span className="text-slate-500">{formatRupiah(total)}</span>
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            <div className="max-h-[68vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full min-w-[1280px] border-collapse text-left text-sm">
                <thead className="sticky top-0 z-10 bg-slate-100 text-xs uppercase text-slate-500 dark:bg-slate-900">
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <th key={header.id} className="border-b border-slate-200 px-3 py-3 dark:border-slate-800">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 bg-white hover:bg-blue-50/50 dark:border-slate-900 dark:bg-slate-950 dark:hover:bg-slate-900">
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="px-3 py-2 align-middle">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex justify-end text-sm font-semibold">
              Total baris tampil: {formatNumber(visibleItems.reduce((sum, item) => sum + getResumeItemAmount(item), 0))}
            </div>
          </CardContent>
        </Card>
      </div>
    </MotionPage>
  );
}

function parseRupiahInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return { status: "empty" as const, value: null };
  if (trimmed.includes("-")) return { status: "invalid" as const, value: null };

  const digits = numericInputValue(trimmed);
  if (!digits) return { status: "invalid" as const, value: null };

  const amount = Number(digits);
  if (!Number.isFinite(amount) || amount < 0) return { status: "invalid" as const, value: null };
  return { status: "valid" as const, value: amount };
}

function formatTargetInput(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? formatThousands(value) : "";
}

function ResumeTargetPanel({
  grandTotal,
  targetGrandTotal,
  onCommit,
}: {
  grandTotal: number;
  targetGrandTotal: number | null;
  onCommit: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState(formatTargetInput(targetGrandTotal));

  useEffect(() => {
    setDraft(formatTargetInput(targetGrandTotal));
  }, [targetGrandTotal]);

  const parsed = parseRupiahInput(draft);
  const activeTarget = parsed.status === "valid" ? parsed.value : parsed.status === "empty" ? null : targetGrandTotal;
  const hasTarget = typeof activeTarget === "number" && Number.isFinite(activeTarget);
  const difference = hasTarget ? activeTarget - grandTotal : 0;
  const absoluteDifference = Math.abs(difference);
  const statusLabel = !hasTarget
    ? "Target belum aktif"
    : difference > 0
      ? `Perlu ditambahkan ${formatRupiah(absoluteDifference)}`
      : difference < 0
        ? `Perlu dikurangi ${formatRupiah(absoluteDifference)}`
        : "Sudah sesuai target";
  const suggestion = !hasTarget
    ? "Isi target untuk melihat selisih terhadap grand total resume."
    : difference > 0
      ? `Total resume masih kurang ${formatRupiah(absoluteDifference)}. Silakan tambahkan item barang atau naikkan harga/volume untuk mencapai target.`
      : difference < 0
        ? `Total resume lebih ${formatRupiah(absoluteDifference)}. Silakan kurangi item barang, harga, atau volume untuk menyesuaikan target.`
        : "Grand total resume sudah sesuai dengan target yang ditentukan.";

  const commit = useCallback(() => {
    const next = parseRupiahInput(draft);
    if (next.status === "empty") {
      onCommit(null);
      setDraft("");
      return;
    }
    if (next.status === "invalid") {
      toast.error("Target Grand Total Resume harus nominal valid dan tidak boleh minus.");
      setDraft(formatTargetInput(targetGrandTotal));
      return;
    }
    onCommit(next.value);
    setDraft(formatTargetInput(next.value));
  }, [draft, onCommit, targetGrandTotal]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Target Grand Total Resume</CardTitle>
        <CardDescription>Target hanya menjadi alat kontrol selisih. Sistem tidak mengubah barang otomatis.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <label className="space-y-2">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Target Grand Total Resume</span>
          <Input
            value={draft}
            inputMode="numeric"
            placeholder="0"
            onChange={(event) => setDraft(formatThousands(event.target.value))}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
          {parsed.status === "invalid" ? <span className="text-xs text-red-600">Nominal harus angka valid dan tidak boleh minus.</span> : null}
        </label>
        <div className="grid gap-3 md:grid-cols-4">
          <TargetMetric label="Grand Total Saat Ini" value={formatRupiah(grandTotal)} />
          <TargetMetric label="Target Resume" value={hasTarget ? formatRupiah(activeTarget) : "-"} />
          <TargetMetric label="Selisih" value={hasTarget ? formatRupiah(absoluteDifference) : "-"} />
          <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
            <p className="text-xs font-semibold text-slate-500">Status</p>
            <Badge className={cn(
              "mt-2 w-fit",
              !hasTarget && "bg-slate-100 text-slate-600",
              difference > 0 && "bg-amber-50 text-amber-700",
              difference < 0 && "bg-blue-50 text-blue-700",
              hasTarget && difference === 0 && "bg-emerald-50 text-emerald-700",
            )}>
              {statusLabel}
            </Badge>
          </div>
          <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600 md:col-span-4 dark:bg-slate-900 dark:text-slate-300">
            {suggestion}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function TargetMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-bold text-slate-950 dark:text-slate-50">{value}</p>
    </div>
  );
}

function ResumeValidationPanel({ report }: { report: ResumeValidationReport }) {
  const sampleMissingVendor = report.missingVendorItems.slice(0, 6);
  const sampleDashVendor = report.dashVendorItems.slice(0, 6);
  const sampleMissingTemplate = report.missingTemplateItems.slice(0, 6);
  const sampleNotGenerated = report.notGeneratedItems.slice(0, 6);
  const sampleZero = report.zeroAmountItems.slice(0, 6);
  const sampleManual = report.manualMismatchItems.slice(0, 6);

  return (
    <Card className={report.hasWarnings ? "border-amber-200 dark:border-amber-900" : "border-emerald-200 dark:border-emerald-900"}>
      <CardHeader>
        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle>Validasi Resume</CardTitle>
            <CardDescription>
              Total dihitung dari seluruh item resume aktif di database. Nota yang belum tergenerate tetap masuk total resume.
            </CardDescription>
          </div>
          <Badge className={report.hasWarnings ? "w-fit bg-amber-50 text-amber-700" : "w-fit bg-emerald-50 text-emerald-700"}>
            {report.hasWarnings ? "Ada data perlu dicek" : "Resume lengkap"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <ValidationMetric label="Total Resume" value={formatRupiah(report.resumeTotal)} />
          <ValidationMetric label="Total Nota Dibuat" value={formatRupiah(report.generatedTotal)} tone={report.generatedTotal > 0 ? "ok" : "default"} />
          <ValidationMetric label="Belum Masuk Nota" value={formatRupiah(report.ungeneratedTotal)} tone={report.ungeneratedTotal === 0 ? "ok" : "warn"} />
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <ValidationMetric label="Item resume" value={report.itemCount.toString()} />
          <ValidationMetric label="Vendor kosong/internal" value={report.missingVendorItems.length.toString()} />
          <ValidationMetric label='Vendor "-"' value={report.dashVendorItems.length.toString()} />
          <ValidationMetric label="Vendor KWITANSI" value={report.kwitansiItems.length.toString()} />
          <ValidationMetric label="Belum template" value={report.missingTemplateItems.length.toString()} tone={report.missingTemplateItems.length === 0 ? "ok" : "warn"} />
          <ValidationMetric label="Belum tergenerate" value={report.notGeneratedItems.length.toString()} tone={report.notGeneratedItems.length === 0 ? "ok" : "warn"} />
          <ValidationMetric label="Jumlah nol" value={report.zeroAmountItems.length.toString()} tone={report.zeroAmountItems.length === 0 ? "ok" : "warn"} />
          <ValidationMetric label="Jumlah manual beda" value={report.manualMismatchItems.length.toString()} tone={report.manualMismatchItems.length === 0 ? "ok" : "warn"} />
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-900">
              <tr>
                <th className="px-4 py-3">Tahap</th>
                <th className="px-4 py-3 text-right">Item</th>
                <th className="px-4 py-3 text-right">Total Resume</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {report.stageRows.map((entry) => (
                <tr key={entry.stageCode}>
                  <td className="px-4 py-3 font-semibold">{entry.label}</td>
                  <td className="px-4 py-3 text-right">{entry.itemCount}</td>
                  <td className="px-4 py-3 text-right font-semibold">{formatRupiah(entry.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-900">
              <tr>
                <th className="px-4 py-3">Kategori</th>
                <th className="px-4 py-3">Tahap</th>
                <th className="px-4 py-3 text-right">Item</th>
                <th className="px-4 py-3 text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {report.categoryRows.map((entry) => (
                <tr key={`${entry.stageCode}-${entry.categoryCode}`}>
                  <td className="px-4 py-3 font-semibold">{entry.category}</td>
                  <td className="px-4 py-3">{entry.stageCode}</td>
                  <td className="px-4 py-3 text-right">{entry.itemCount}</td>
                  <td className="px-4 py-3 text-right font-semibold">{formatRupiah(entry.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <ValidationList title="Item belum punya vendor" items={sampleMissingVendor} empty="Semua item sudah punya vendor." />
          <ValidationList title='Item vendor "-"' items={sampleDashVendor} empty='Tidak ada vendor "-".' />
          <ValidationList title="Item belum punya template nota" items={sampleMissingTemplate} empty="Semua vendor sudah punya template untuk tahapnya." />
          <ValidationList title="Item belum masuk nota otomatis" items={sampleNotGenerated} empty="Semua item sudah masuk nota." />
          <ValidationList title="Item jumlah kosong/nol" items={sampleZero} empty="Tidak ada jumlah kosong/nol." />
          <ValidationList title="Item qty x harga beda dengan jumlah manual" items={sampleManual} empty="Tidak ada selisih jumlah manual." />
        </div>
      </CardContent>
    </Card>
  );
}

function ResumeImportPreview({
  preview,
  onCancel,
  onReplace,
  onMerge,
}: {
  preview: { parsed: ParsedResume; diff: ResumeImportDiff };
  onCancel: () => void;
  onReplace: () => void;
  onMerge: () => void;
}) {
  return (
    <Card className="border-blue-200 dark:border-blue-900">
      <CardHeader>
        <CardTitle>Preview Update Resume</CardTitle>
        <CardDescription>
          File {preview.parsed.sourceFile} dibaca menjadi {preview.parsed.items.length} item. Pilih aksi sebelum data lama ditimpa.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <ValidationMetric label="Item baru" value={preview.diff.added.length.toString()} />
          <ValidationMetric label="Item berubah" value={preview.diff.changed.length.toString()} />
          <ValidationMetric label="Item dihapus" value={preview.diff.removed.length.toString()} />
          <ValidationMetric label="Total lama" value={formatRupiah(preview.diff.oldTotal)} />
          <ValidationMetric label="Total file baru" value={formatRupiah(preview.diff.newTotal)} />
          <ValidationMetric label="Selisih" value={formatSignedRupiah(preview.diff.newTotal - preview.diff.oldTotal)} tone={preview.diff.newTotal === preview.diff.oldTotal ? "ok" : "warn"} />
        </div>
        {preview.parsed.warnings.length > 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
            <p className="mb-2 font-semibold">Warning import</p>
            <div className="grid gap-1 md:grid-cols-2">
              {preview.parsed.warnings.slice(0, 8).map((warning) => <p key={warning}>{warning}</p>)}
            </div>
          </div>
        ) : null}
        <div className="grid gap-3 lg:grid-cols-3">
          <ValidationList title="Contoh item baru" items={preview.diff.added.slice(0, 5)} empty="Tidak ada item baru." />
          <ValidationList title="Contoh item dihapus" items={preview.diff.removed.slice(0, 5)} empty="Tidak ada item dihapus." />
          <div className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-800">
            <p className="mb-2 font-semibold">Contoh item berubah</p>
            {preview.diff.changed.length > 0 ? (
              <div className="space-y-1">
                {preview.diff.changed.slice(0, 5).map((entry) => (
                  <p key={entry.before.id} className="text-slate-600 dark:text-slate-300">
                    {entry.before.itemName}: {entry.fields.join(", ")}
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-slate-500">Tidak ada item berubah.</p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>Batal</Button>
          <Button variant="outline" onClick={onMerge}>Merge Data Baru</Button>
          <Button variant="emerald" onClick={onReplace}>Replace Semua Data Resume</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ValidationMetric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "ok" | "warn" }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className={cn("mt-1 text-lg font-bold", tone === "ok" && "text-emerald-700", tone === "warn" && "text-amber-700")}>{value}</p>
    </div>
  );
}

function ValidationList({ title, items, empty }: { title: string; items: ResumeItem[]; empty: string }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-800">
      <p className="mb-2 font-semibold">{title}</p>
      {items.length > 0 ? (
        <div className="space-y-1">
          {items.map((item) => (
            <p key={item.id} className="text-slate-600 dark:text-slate-300">
              {item.stageCode} - {item.category}: {item.itemName} ({formatRupiah(getResumeItemAmount(item))})
            </p>
          ))}
        </div>
      ) : (
        <p className="text-slate-500">{empty}</p>
      )}
    </div>
  );
}

function formatSignedRupiah(value: number) {
  if (value === 0) return formatRupiah(0);
  return `${value > 0 ? "+" : "-"}${formatRupiah(Math.abs(value))}`;
}

function ProjectMetadataCard({
  project,
  onPatch,
  onProjectDateCommit,
}: {
  project: ProjectMetadataDraft;
  onPatch: (data: Partial<ProjectMetadataDraft>) => void;
  onProjectDateCommit: (value: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Project Metadata</CardTitle>
        <CardDescription>Dipakai otomatis di resume, nota, kwitansi, invoice, dan preview.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <LabeledEditable label="Nama project" value={project.projectName} onCommit={(value) => onPatch({ projectName: value })} />
          <LabeledEditable label="Wilayah/Kodim" value={project.regionName} onCommit={(value) => onPatch({ regionName: value })} />
          <LabeledEditable label="Desa/KDKMP" value={project.villageName} onCommit={(value) => onPatch({ villageName: value })} />
          <LabeledEditable label="Kecamatan" value={project.districtName} onCommit={(value) => onPatch({ districtName: value })} />
          <LabeledEditable label="Kabupaten" value={project.regencyName} onCommit={(value) => onPatch({ regencyName: value })} />
          <LabeledEditable label="Tanggal Awal Project" type="date" value={project.projectDate} onCommit={onProjectDateCommit} required />
          <LabeledEditable label="Tanggal laporan" type="date" value={project.reportDate ?? project.projectDate} onCommit={(value) => onPatch({ reportDate: value })} />
          <LabeledEditable
            label="Nama Babinsa / Penanggung Jawab"
            value={project.responsibleName}
            onCommit={(value) => onPatch({ responsibleName: value.trim() })}
            required
          />
          <LabeledEditable label="Koordinat" value={project.coordinates ?? ""} onCommit={(value) => onPatch({ coordinates: value })} />
          <LabeledEditable label="Penerima invoice" value={project.invoiceRecipientName ?? ""} onCommit={(value) => onPatch({ invoiceRecipientName: value })} />
          <div className="md:col-span-2">
            <LabeledEditable label="Alamat penerima invoice" value={project.invoiceRecipientAddress ?? ""} onCommit={(value) => onPatch({ invoiceRecipientAddress: value })} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function LabeledEditable({
  label,
  value,
  onCommit,
  type = "text",
  required = false,
  requiredMessage,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  type?: string;
  required?: boolean;
  requiredMessage?: string;
}) {
  return (
    <label className="space-y-1 text-xs font-semibold text-slate-500">
      <span>{label}{required ? " *" : ""}</span>
      <EditableInput
        value={value}
        type={type}
        onCommit={onCommit}
        required={required}
        requiredMessage={requiredMessage ?? `${label} wajib diisi.`}
        className="text-sm font-normal text-slate-950 dark:text-slate-50"
      />
    </label>
  );
}

function EditableInput({
  value,
  onCommit,
  type = "text",
  className,
  placeholder,
  required = false,
  requiredMessage = "Field wajib diisi.",
  commitOnBlurOnly = false,
}: {
  value: string;
  onCommit: (value: string) => void;
  type?: string;
  className?: string;
  placeholder?: string;
  required?: boolean;
  requiredMessage?: string;
  commitOnBlurOnly?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const lastCommitted = useRef(value);
  const timeoutRef = useRef<number | null>(null);
  const dirty = draft !== value;

  useEffect(() => {
    setDraft(value);
    lastCommitted.current = value;
  }, [value]);

  useEffect(() => {
    if (commitOnBlurOnly) return;
    if (!dirty || draft === lastCommitted.current) return;
    if (required && !draft.trim()) return;
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      lastCommitted.current = draft;
      onCommit(draft);
    }, 300);
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, [commitOnBlurOnly, dirty, draft, onCommit, required]);

  const flush = useCallback(() => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    if (required && !draft.trim()) {
      toast.error(requiredMessage);
      setDraft(value);
      return;
    }
    if (draft !== lastCommitted.current) {
      lastCommitted.current = draft;
      onCommit(draft);
    }
  }, [draft, onCommit, required, requiredMessage, value]);

  if (type === "date") {
    return (
      <DateInput
        value={value}
        required={required}
        placeholder={placeholder ?? "dd/mm/yyyy"}
        onInvalidDate={() => toast.error("Format tanggal harus dd/mm/yyyy.")}
        onValueChange={(nextValue) => {
          if (required && !nextValue.trim()) {
            toast.error(requiredMessage);
            return;
          }
          if (nextValue !== lastCommitted.current) {
            lastCommitted.current = nextValue;
            onCommit(nextValue);
          }
        }}
        className={cn("h-9 rounded-lg border-transparent bg-transparent shadow-none hover:border-slate-200 focus:bg-white dark:focus:bg-slate-950", className)}
      />
    );
  }

  if (type === "currency") {
    return (
      <CurrencyInput
        value={draft}
        placeholder={placeholder}
        required={required}
        onValueChange={(value) => setDraft(value)}
        onBlur={flush}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className={cn("h-9 rounded-lg border-transparent bg-transparent shadow-none hover:border-slate-200 focus:bg-white dark:focus:bg-slate-950", className)}
      />
    );
  }

  return (
    <Input
      type={type}
      value={draft}
      placeholder={placeholder}
      required={required}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={flush}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      className={cn("h-9 rounded-lg border-transparent bg-transparent shadow-none hover:border-slate-200 focus:bg-white dark:focus:bg-slate-950", className)}
    />
  );
}
