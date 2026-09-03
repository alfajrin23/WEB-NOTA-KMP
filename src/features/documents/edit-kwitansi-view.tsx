"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Download, Eye, Loader2, Pencil, ReceiptText, RefreshCw, Save, Search, UserCheck, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { MotionPage } from "@/components/ui/motion-page";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getKwitansiPageChunk, KwitansiBatchTemplate } from "@/components/templates/kwitansi/KwitansiBatchTemplate";
import { STAGES, getStageLabel } from "@/constants/stages";
import {
  canKwitansiPayerBeBlank,
  cleanKwitansiWorkerRole,
  getDefaultKwitansiPaymentDescription,
  getKwitansiAmount,
  getKwitansiAmountWords,
  getKwitansiDateRange,
  getKwitansiPayerName,
  getKwitansiProjectLines,
  getKwitansiRole,
} from "@/lib/kwitansi-fields";
import { buildKwitansiSyncKeyMap, getKwitansiReceiverSyncPlan, kwitansiSyncKeyForDoc, kwitansiSyncLabel, type KwitansiSyncKey } from "@/lib/kwitansi-rules";
import { getKwitansiGenerationDiagnostics, KWITANSI_TARGET_COUNTS } from "@/lib/nota-generator";
import { useKdkmpStore } from "@/hooks/use-kdkmp-store";
import { formatProjectKdkmpWilayah, formatProjectWilayah, formatRupiah, numericInputValue } from "@/utils/format";
import { GeneratedNota, Project, StageCode } from "@/types/domain";

type StageFilter = StageCode | "all";

type EditableKwitansiDoc = GeneratedNota;

const CORE_KWITANSI_SYNC_STAGES = new Set<StageCode>(["TAHAP_I", "TAHAP_II", "TAHAP_III", "TAHAP_IV", "TAHAP_V"]);
const MANDOR_KWITANSI_SYNC_STAGES = new Set<StageCode>(["TAHAP_I", "TAHAP_II", "TAHAP_III", "TAHAP_IV", "TAHAP_V", "TAHAP_VI"]);

type EditDraft = {
  number: string;
  payer: string;
  amountWords: string;
  paymentDescription: string;
  amount: string;
  date: string;
  receiver: string;
  note: string;
  location: string;
  role: string;
  templateColor: string;
  dateIsManual: boolean;
  paymentDescriptionIsManual: boolean;
};

function receiptTitle(doc: EditableKwitansiDoc) {
  const customDescription = doc.kwitansiPaymentDescription?.trim().split(/\r?\n/)[0];
  if (customDescription) return customDescription;
  const itemNames = doc.items.map((item) => item.itemName.trim()).filter(Boolean);
  if (itemNames.length === 0) return doc.templateName;
  if (itemNames.length === 1) return itemNames[0];
  return `${itemNames[0]} + ${itemNames.length - 1} pekerjaan lain`;
}

function buildDraft(doc: EditableKwitansiDoc, project: Project): EditDraft {
  const defaultPaymentDescription = getDefaultKwitansiPaymentDescription(doc, project);
  const savedPaymentDescription = doc.kwitansiPaymentDescription?.trim();
  const dateRange = getKwitansiDateRange(doc, project);
  const rangeStart = /^\d{4}-\d{2}-\d{2}$/.test(dateRange.start) ? dateRange.start : "";
  const projectLines = getKwitansiProjectLines(doc, project);
  return {
    number: doc.kwitansiNumber ?? "",
    payer: getKwitansiPayerName(doc, project),
    amountWords: doc.kwitansiAmountWords?.trim() || getKwitansiAmountWords(doc),
    paymentDescription: savedPaymentDescription || defaultPaymentDescription,
    amount: String(getKwitansiAmount(doc)),
    date: rangeStart || doc.tanggal || doc.notaDate || project.projectDate,
    receiver: doc.kwitansiReceiverName ?? "",
    note: doc.kwitansiNote ?? "",
    location: doc.kwitansiCity?.trim() || projectLines[0] || formatProjectKdkmpWilayah(project),
    role: projectLines[1] || cleanKwitansiWorkerRole(doc.kwitansiRoleName?.trim() || getKwitansiRole(doc)),
    templateColor: doc.warnaTemplate || "default",
    dateIsManual: Boolean(doc.kwitansiDate?.trim()),
    paymentDescriptionIsManual: Boolean(
      savedPaymentDescription && normalizeEditableText(savedPaymentDescription) !== normalizeEditableText(defaultPaymentDescription),
    ),
  };
}

function normalizeEditableText(value: string) {
  return value.replace(/\r\n/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean).join("\n");
}

function kwitansiStageLabel(stageCode: StageCode) {
  return getStageLabel(stageCode);
}

function normalizedText(value: string | undefined | null) {
  return (value ?? "").trim().toLowerCase();
}

function docWorkText(doc: GeneratedNota) {
  return normalizedText([
    doc.vendorId,
    doc.vendorName,
    doc.templateName,
    doc.kwitansiRoleName,
    doc.kwitansiPaymentDescription,
    ...doc.items.map((item) => item.itemName),
  ].filter(Boolean).join(" "));
}

function docWorkTitle(doc: GeneratedNota) {
  return doc.items.map((item) => item.itemName).filter(Boolean).join(" + ") || doc.templateName;
}

const OUTSIDE_CORE_LABELS = [
  "pencarian",
  "sosialisasi",
  "rapat koordinasi",
  "pengukuran lahan",
  "penyiapan lahan",
  "pematangan lahan",
  "pembersihan lahan",
  "cut n fill",
  "sumur bor",
  "trafo",
  "operasional gerai",
] as const;

function outsideCoreLabel(text: string) {
  return OUTSIDE_CORE_LABELS.find((label) => text.includes(label)) ?? null;
}

function isStageFourAllowedDoc(doc: GeneratedNota) {
  const text = docWorkText(doc);
  if (outsideCoreLabel(text)) return false;
  return (
    text.includes("mandor") ||
    text.includes("kepala tukang") ||
    text.includes("pekerja trampil") ||
    text.includes("pekerja terampil") ||
    text.includes("pekerja buruh") ||
    ((text.includes("sopir") || text.includes("supir")) && !text.includes("pembantu") && !text.includes("kenek")) ||
    text.includes("pembantu") ||
    text.includes("kenek") ||
    text.includes("pratama project mandiri") ||
    text.includes("ppm") ||
    text.includes("listrik")
  );
}

function isSlottedWorkerSyncKey(value: KwitansiSyncKey | undefined | null): value is Exclude<KwitansiSyncKey, "mandor" | "kepala_tukang"> {
  return Boolean(value) && value !== "mandor" && value !== "kepala_tukang";
}

export function EditKwitansiView() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const {
    projects,
    generatedNotas,
    kwitansiEdits,
    vendors,
    templateAssignments,
    generateProjectKwitansi,
    backfillKwitansiReceivers,
    updateKwitansiFields,
    loading,
  } = useKdkmpStore();
  const project = projects.find((entry) => entry.id === projectId);
  const [stageFilter, setStageFilter] = useState<StageFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [generating, setGenerating] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [saving, setSaving] = useState(false);

  const docs = useMemo(() => {
    return generatedNotas
      .filter((doc) => doc.projectId === projectId)
      .filter((doc) => doc.documentType === "kwitansi")
      .map((doc) => doc as EditableKwitansiDoc)
      .sort((a, b) => {
        const stageA = STAGES.findIndex((stage) => stage.code === a.stageCode);
        const stageB = STAGES.findIndex((stage) => stage.code === b.stageCode);
        return stageA - stageB || (a.printOrder ?? 0) - (b.printOrder ?? 0) || a.templateName.localeCompare(b.templateName) || a.id.localeCompare(b.id);
      });
  }, [generatedNotas, projectId]);

  const regularDocs = useMemo(() => docs.filter((doc) => !doc.isSpecialKwitansi && doc.source !== "custom"), [docs]);
  const editedNoteIds = useMemo(() => new Set(kwitansiEdits.map((edit) => edit.noteId)), [kwitansiEdits]);
  const syncKeysByDocId = useMemo(() => buildKwitansiSyncKeyMap(docs, getKwitansiRole), [docs]);

  const filteredDocs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return docs
      .filter((doc) => stageFilter === "all" || doc.stageCode === stageFilter)
      .filter((doc) => {
        if (!normalizedQuery || !project) return true;
        const amount = getKwitansiAmount(doc);
        const haystack = [
          doc.vendorName,
          doc.stageName,
          doc.templateName,
          doc.kwitansiPaymentDescription,
          doc.kwitansiReceiverName,
          doc.kwitansiPayerName,
          getKwitansiPayerName(doc, project),
          project.villageName,
          String(amount),
          formatRupiah(amount),
          ...doc.items.map((item) => item.itemName),
        ].filter(Boolean).join(" ").toLowerCase();
        return haystack.includes(normalizedQuery);
      });
  }, [docs, project, query, stageFilter]);

  const countsByStage = useMemo(() => {
    const counts = new Map<StageCode, number>();
    for (const doc of regularDocs) {
      counts.set(doc.stageCode, (counts.get(doc.stageCode) ?? 0) + 1);
    }
    return counts;
  }, [regularDocs]);

  const generationDiagnostics = useMemo(
    () => project ? getKwitansiGenerationDiagnostics(project, vendors, templateAssignments) : null,
    [project, templateAssignments, vendors],
  );
  const expectedByStage = useMemo(() => {
    const values = new Map<StageCode, number>();
    for (const stage of generationDiagnostics?.stages ?? []) {
      values.set(stage.stageCode, stage.expected);
    }
    return values;
  }, [generationDiagnostics]);

  const countWarnings = useMemo(() => {
    if (docs.length === 0) return [];
    return STAGES
      .map((stage) => ({
        stage,
        actual: countsByStage.get(stage.code) ?? 0,
        expected: generationDiagnostics?.stages.find((entry) => entry.stageCode === stage.code)?.expected ?? KWITANSI_TARGET_COUNTS[stage.code] ?? 0,
      }))
      .filter((entry) => entry.expected > 0 && entry.actual !== entry.expected);
  }, [countsByStage, docs.length, generationDiagnostics]);

  const generationIssues = useMemo(() => {
    const issues = generationDiagnostics?.issues.map((issue) => issue.message) ?? [];
    if (regularDocs.length > 0) {
      const stageFourDocs = regularDocs.filter((doc) => doc.stageCode === "TAHAP_IV" || doc.stageCode === "TAHAP_V");
      const outsideDocs = regularDocs.filter((doc) => doc.stageCode === "TAHAP_VI" || doc.stageCode === "TAHAP_VII" || doc.stageCode === "RESUME_ALL");
      const outsideFound = new Set(outsideDocs.map((doc) => outsideCoreLabel(docWorkText(doc))).filter((label): label is NonNullable<typeof label> => Boolean(label)));
      const missingOutside = OUTSIDE_CORE_LABELS.filter((label) => !outsideFound.has(label));
      for (const label of missingOutside) {
          issues.push(`Kwitansi Tahap 6/7 belum tampil untuk item: ${label}.`);
      }
      for (const doc of stageFourDocs) {
        const text = docWorkText(doc);
        const outsideLabel = outsideCoreLabel(text);
        if (outsideLabel) {
          issues.push(`Item luar inti "${docWorkTitle(doc)}" masih masuk Tahap 4/5; harus dipetakan ke Tahap 6 atau 7.`);
        } else if (!isStageFourAllowedDoc(doc)) {
          issues.push(`Kwitansi Tahap 4 di luar whitelist: ${docWorkTitle(doc)}.`);
        }
      }
      const seen = new Map<string, GeneratedNota[]>();
      for (const doc of regularDocs) {
        const text = docWorkText(doc);
        if (text.includes("pekerja trampil") || text.includes("pekerja terampil") || text.includes("pekerja buruh")) continue;
        const key = [
          doc.stageCode,
          doc.vendorId,
          normalizedText(docWorkTitle(doc)),
          getKwitansiAmount(doc),
          doc.tanggal || doc.notaDate,
        ].join("|");
        seen.set(key, [...(seen.get(key) ?? []), doc]);
      }
      for (const duplicateDocs of seen.values()) {
        if (duplicateDocs.length > 1) {
          issues.push(`Duplikat kwitansi terdeteksi: ${docWorkTitle(duplicateDocs[0])} (${duplicateDocs.length} kali).`);
        }
      }
    }
    for (const warning of countWarnings) {
      const stageHasItemIssue = generationDiagnostics?.issues.some((issue) => issue.stageCode === warning.stage.code);
      if (stageHasItemIssue) continue;
      const difference = warning.expected - warning.actual;
      issues.push(
        difference > 0
          ? `${warning.stage.label} masih kurang ${difference} kwitansi; cek rule penggabungan tenaga lembur, PPM, atau pemecahan pekerja pada resume.`
          : `${warning.stage.label} memiliki ${Math.abs(difference)} kwitansi lebih banyak; cek item duplikat atau rule pemecahan pekerja.`,
      );
    }
    return issues;
  }, [countWarnings, generationDiagnostics, regularDocs]);

  const missingReceiverDocs = useMemo(() => docs.filter((doc) => !doc.kwitansiReceiverName?.trim()), [docs]);
  const selected = selectedId ? filteredDocs.find((doc) => doc.id === selectedId) ?? null : null;
  const selectedPageDocs = useMemo(() => {
    if (!selected) return [];
    const orderedStageDocs = docs.filter((doc) => doc.stageCode === selected.stageCode && !doc.isSpecialKwitansi);
    return getKwitansiPageChunk(orderedStageDocs, selected.id);
  }, [docs, selected]);
  const editingDoc = editingId ? docs.find((doc) => doc.id === editingId) ?? null : null;

  useEffect(() => {
    if (selectedId && !filteredDocs.some((doc) => doc.id === selectedId)) {
      setSelectedId(null);
      setEditingId(null);
      setDraft(null);
    }
  }, [filteredDocs, selectedId]);

  const runGenerateKwitansi = useCallback(async () => {
    setGenerating(true);
    try {
      await generateProjectKwitansi(projectId);
      setSelectedId(null);
      setEditingId(null);
      setDraft(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal generate kwitansi.");
    } finally {
      setGenerating(false);
    }
  }, [generateProjectKwitansi, projectId]);

  const runBackfillReceivers = useCallback(async () => {
    setBackfilling(true);
    try {
      await backfillKwitansiReceivers(projectId);
      setSelectedId(null);
      setEditingId(null);
      setDraft(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memperbarui nama penerima otomatis.");
    } finally {
      setBackfilling(false);
    }
  }, [backfillKwitansiReceivers, projectId]);

  const showPreview = useCallback((doc: EditableKwitansiDoc) => {
    setSelectedId(doc.id);
    setEditingId(null);
    setDraft(null);
  }, []);

  const startEditing = useCallback((doc: EditableKwitansiDoc) => {
    if (!project || doc.source === "custom") return;
    setSelectedId(doc.id);
    setEditingId(doc.id);
    setDraft(buildDraft(doc, project));
  }, [project]);

  const cancelEditing = useCallback(() => {
    if (saving) return;
    setEditingId(null);
    setDraft(null);
  }, [saving]);

  const defaultPaymentDescriptionForDraft = useCallback((next: Pick<EditDraft, "date" | "dateIsManual" | "role">) => {
    if (!editingDoc || !project) return "";
    return getDefaultKwitansiPaymentDescription(
      {
        ...editingDoc,
        kwitansiDate: next.dateIsManual ? next.date : undefined,
        kwitansiRoleName: next.role,
        kwitansiPaymentDescription: undefined,
      },
      project,
    );
  }, [editingDoc, project]);

  const updateDraftDate = useCallback((date: string) => {
    setDraft((current) => {
      if (!current) return current;
      const next = { ...current, date, dateIsManual: true };
      return current.paymentDescriptionIsManual
        ? next
        : { ...next, paymentDescription: defaultPaymentDescriptionForDraft(next) };
    });
  }, [defaultPaymentDescriptionForDraft]);

  const updateDraftRole = useCallback((role: string) => {
    setDraft((current) => {
      if (!current) return current;
      const next = { ...current, role };
      return current.paymentDescriptionIsManual
        ? next
        : { ...next, paymentDescription: defaultPaymentDescriptionForDraft(next) };
    });
  }, [defaultPaymentDescriptionForDraft]);

  const updateDraftPaymentDescription = useCallback((paymentDescription: string) => {
    setDraft((current) => {
      if (!current) return current;
      const automatic = defaultPaymentDescriptionForDraft(current);
      return {
        ...current,
        paymentDescription,
        paymentDescriptionIsManual: normalizeEditableText(paymentDescription) !== normalizeEditableText(automatic),
      };
    });
  }, [defaultPaymentDescriptionForDraft]);

  const saveDraft = useCallback(async () => {
    if (!editingDoc || !draft || saving) return;
    const amount = Number(numericInputValue(draft.amount));
    if (!draft.amount.trim() || !Number.isFinite(amount) || amount < 0) {
      toast.error("Nominal kwitansi harus berupa angka yang valid.");
      return;
    }
    if ((!canKwitansiPayerBeBlank(editingDoc) && !draft.payer.trim()) || !draft.amountWords.trim() || !draft.paymentDescription.trim() || !draft.date) {
      toast.error(
        canKwitansiPayerBeBlank(editingDoc)
          ? "Terbilang, pembayaran, dan tanggal wajib diisi."
          : "Telah terima dari, terbilang, pembayaran, dan tanggal wajib diisi.",
      );
      return;
    }
    if (!draft.receiver.trim()) {
      toast.error("Nama penerima wajib diisi sebelum menyimpan kwitansi.");
      return;
    }

    setSaving(true);
    try {
      const receiverName = draft.receiver.trim();
      const roleName = cleanKwitansiWorkerRole(draft.role.trim());
      const patch: Partial<Pick<
        GeneratedNota,
        "kwitansiReceiverName" | "kwitansiNumber" | "kwitansiPayerName" | "kwitansiPaymentDescription" | "kwitansiRoleName" | "kwitansiNote" |
        "kwitansiAmount" | "kwitansiAmountWords" | "kwitansiDate" | "kwitansiCity" | "warnaTemplate"
      >> = {
        kwitansiNumber: draft.number.trim(),
        kwitansiPayerName: draft.payer.trim(),
        kwitansiAmountWords: draft.amountWords.trim(),
        kwitansiPaymentDescription: draft.paymentDescription.trim(),
        kwitansiAmount: amount,
        kwitansiDate: draft.dateIsManual ? draft.date : undefined,
        kwitansiReceiverName: receiverName,
        kwitansiNote: draft.note.trim(),
        kwitansiCity: draft.location.trim(),
        kwitansiRoleName: roleName,
        warnaTemplate: draft.templateColor,
      };
      const receiverChanged = receiverName !== (editingDoc.kwitansiReceiverName ?? "").trim();
      const sourceSyncKey = receiverChanged
        ? syncKeysByDocId.get(editingDoc.id) ?? kwitansiSyncKeyForDoc(editingDoc, roleName)
        : null;
      const receiverSyncStages = sourceSyncKey === "mandor" ? MANDOR_KWITANSI_SYNC_STAGES : CORE_KWITANSI_SYNC_STAGES;
      const syncPlan = receiverChanged && sourceSyncKey && receiverSyncStages.has(editingDoc.stageCode)
        ? getKwitansiReceiverSyncPlan(docs, editingDoc, syncKeysByDocId, {
          roleText: roleName,
          targetStages: receiverSyncStages,
        })
        : { syncKey: null, targets: [] };
      const { syncKey, targets: syncTargets } = syncPlan;
      const shouldSync = syncTargets.length > 0;

      await updateKwitansiFields(editingDoc.projectId, editingDoc.id, patch, {
        receiverSource: "manual",
        receiverSyncKey: syncKey ?? undefined,
      });
      if (shouldSync) {
        for (const target of syncTargets) {
          await updateKwitansiFields(
            target.projectId,
            target.id,
            { kwitansiReceiverName: receiverName },
            { receiverSource: "sync", receiverSyncKey: syncKey ?? undefined },
          );
        }
      }
      setEditingId(null);
      setDraft(null);
      toast.success(shouldSync ? `Nama penerima ${kwitansiSyncLabel(syncKey!)} disamakan ke ${syncTargets.length + 1} kwitansi.` : "Perubahan kwitansi tersimpan ke Supabase.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menyimpan perubahan kwitansi.");
    } finally {
      setSaving(false);
    }
  }, [docs, draft, editingDoc, saving, syncKeysByDocId, updateKwitansiFields]);

  if (loading && !project) {
    return <Card><CardContent className="p-8">Memuat kwitansi...</CardContent></Card>;
  }

  if (!project) {
    return <Card><CardContent className="p-8">Project tidak ditemukan.</CardContent></Card>;
  }

  return (
    <MotionPage>
      <div className="space-y-5">
        <div className="no-print flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-normal">Kwitansi</h2>
            <p className="text-sm text-slate-500">
              Generate dari resume yang sudah fix, periksa preview, lalu simpan perubahan ke Supabase.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={runGenerateKwitansi} disabled={generating || backfilling || saving}>
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {docs.length > 0 ? "Regenerate Kwitansi" : "Generate Kwitansi"}
            </Button>
            <Button variant="outline" onClick={runBackfillReceivers} disabled={generating || backfilling || saving || docs.length === 0}>
              {backfilling ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCheck className="h-4 w-4" />}
              Perbarui Nama Penerima Otomatis
            </Button>
            <Button asChild variant="emerald">
              <Link href={`/projects/${project.id}/export`}><Download className="h-4 w-4" />Lanjut Export / Cetak</Link>
            </Button>
          </div>
        </div>

        <div className="no-print grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {STAGES.map((stage) => {
            const actual = countsByStage.get(stage.code) ?? 0;
            const expected = expectedByStage.get(stage.code) ?? KWITANSI_TARGET_COUNTS[stage.code] ?? 0;
            const complete = expected > 0 && actual === expected;
            return (
              <div key={stage.code} className={`rounded-xl border p-3 text-sm ${complete ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200" : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"}`}>
                <p className="font-semibold">{stage.shortLabel}</p>
                <p className="mt-1 text-lg font-bold">{actual}/{expected}</p>
              </div>
            );
          })}
        </div>

        {countWarnings.length > 0 || generationIssues.length > 0 ? (
          <div className="no-print rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
            <p className="font-semibold">Data kwitansi belum lengkap.</p>
            {countWarnings.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-3">
                {countWarnings.map((entry) => (
                  <span key={entry.stage.code} className="font-semibold">
                    {entry.stage.shortLabel}: {entry.actual}/{entry.expected}
                  </span>
                ))}
              </div>
            ) : null}
            {generationIssues.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {generationIssues.slice(0, 10).map((issue) => <li key={issue}>{issue}</li>)}
                {generationIssues.length > 10 ? <li>Dan {generationIssues.length - 10} masalah lain pada data resume.</li> : null}
              </ul>
            ) : null}
          </div>
        ) : null}

        {missingReceiverDocs.length > 0 ? (
          <div className="no-print rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
            Nama penerima kwitansi belum diisi. Masih ada {missingReceiverDocs.length} kwitansi yang perlu dilengkapi melalui tombol Edit.
          </div>
        ) : null}

        <div className="no-print grid gap-3 lg:grid-cols-[1fr_220px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <Input
              className="pl-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cari pekerjaan, desa, penerima, nominal, atau pemberi"
            />
          </div>
          <Select value={stageFilter} onValueChange={(value) => setStageFilter(value as StageFilter)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Kwitansi</SelectItem>
              {STAGES.map((stage) => <SelectItem key={stage.code} value={stage.code}>{kwitansiStageLabel(stage.code)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-5 xl:grid-cols-[430px_1fr]">
          <Card className="no-print">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ReceiptText className="h-5 w-5 text-blue-600" />Daftar Kwitansi</CardTitle>
              <CardDescription>{filteredDocs.length} kwitansi sesuai filter.</CardDescription>
            </CardHeader>
            <CardContent className="max-h-[76vh] space-y-3 overflow-auto">
              {filteredDocs.map((doc) => {
                const edited = editedNoteIds.has(doc.id);
                const active = selected?.id === doc.id;
                const syncKey = syncKeysByDocId.get(doc.id);
                return (
                  <article
                    key={doc.id}
                    className={`rounded-xl border p-3 ${active ? "border-blue-500 bg-blue-50 dark:bg-blue-950" : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{kwitansiStageLabel(doc.stageCode)}</p>
                        <p className="mt-1 text-sm font-semibold leading-snug">{receiptTitle(doc)}</p>
                      </div>
                    </div>
                    <dl className="mt-3 grid grid-cols-[92px_1fr] gap-x-2 gap-y-1 text-xs">
                      <dt className="text-slate-500">Wilayah</dt><dd className="font-medium">{formatProjectWilayah(project)}</dd>
                      <dt className="text-slate-500">Nominal</dt><dd className="font-semibold">{formatRupiah(getKwitansiAmount(doc))}</dd>
                      <dt className="text-slate-500">Pemberi</dt><dd className="font-medium">{project ? getKwitansiPayerName(doc, project) || "-" : "-"}</dd>
                      {isSlottedWorkerSyncKey(syncKey) ? (
                        <><dt className="text-slate-500">Slot pekerja</dt><dd className="font-medium">{kwitansiSyncLabel(syncKey)}</dd></>
                      ) : null}
                      <dt className="text-slate-500">Penerima</dt><dd className={doc.kwitansiReceiverName?.trim() ? "font-medium" : "font-medium text-red-600"}>{doc.kwitansiReceiverName?.trim() || "Belum diisi"}</dd>
                    </dl>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <Badge className={edited ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"}>
                        {edited ? "Sudah diedit" : "Belum diedit"}
                      </Badge>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => showPreview(doc)} disabled={saving}>
                          <Eye className="h-3.5 w-3.5" />Preview
                        </Button>
                        <Button size="sm" onClick={() => startEditing(doc)} disabled={doc.source === "custom" || saving} title={doc.source === "custom" ? "Kwitansi custom tidak memakai tabel edit kwitansi." : undefined}>
                          <Pencil className="h-3.5 w-3.5" />Edit
                        </Button>
                      </div>
                    </div>
                  </article>
                );
              })}
              {filteredDocs.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                  {docs.length === 0
                    ? "Belum ada kwitansi. Klik Generate Kwitansi setelah data resume/nota sudah fix."
                    : "Tidak ada kwitansi yang cocok dengan filter atau pencarian."}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <div className="space-y-4">
            {editingDoc && draft ? (
              <Card className="no-print border-blue-200 dark:border-blue-900">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle>Edit Kwitansi</CardTitle>
                      <CardDescription>{kwitansiStageLabel(editingDoc.stageCode)} — {receiptTitle(editingDoc)}</CardDescription>
                    </div>
                    <Button type="button" variant="ghost" size="icon" onClick={cancelEditing} disabled={saving} aria-label="Batal edit">
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <form
                    className="grid gap-3 md:grid-cols-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveDraft();
                    }}
                    aria-busy={saving}
                  >
                  <EditField label="No. kwitansi" value={draft.number} onChange={(value) => setDraft((current) => current ? { ...current, number: value } : current)} />
                  <EditField label="Tanggal kwitansi" type="date" value={draft.date} onChange={updateDraftDate} required />
                  <EditField label="Telah terima dari" value={draft.payer} onChange={(value) => setDraft((current) => current ? { ...current, payer: value } : current)} required={!canKwitansiPayerBeBlank(editingDoc)} />
                  <EditField label="Nama penerima" value={draft.receiver} onChange={(value) => setDraft((current) => current ? { ...current, receiver: value } : current)} required />
                  <EditField label="Nominal" type="currency" min="0" step="1" value={draft.amount} onChange={(value) => setDraft((current) => current ? { ...current, amount: value } : current)} required />
                  <EditField label="Nama desa / lokasi pekerjaan" value={draft.location} onChange={(value) => setDraft((current) => current ? { ...current, location: value } : current)} />
                  <EditField label="Jenis pekerjaan / jabatan" value={draft.role} onChange={updateDraftRole} />
                  <label className="space-y-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
                    <span>Warna template</span>
                    <Select value={draft.templateColor} onValueChange={(value) => setDraft((current) => current ? { ...current, templateColor: value } : current)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">Otomatis</SelectItem>
                        <SelectItem value="blue">Biru</SelectItem>
                        <SelectItem value="pink">Merah muda</SelectItem>
                        <SelectItem value="green">Hijau</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                  <EditField label="Uang sejumlah / terbilang" value={draft.amountWords} onChange={(value) => setDraft((current) => current ? { ...current, amountWords: value } : current)} multiline required className="md:col-span-2" />
                  <EditField label="Untuk pembayaran" value={draft.paymentDescription} onChange={updateDraftPaymentDescription} multiline required className="md:col-span-2" />
                  <EditField label="Keterangan tambahan" value={draft.note} onChange={(value) => setDraft((current) => current ? { ...current, note: value } : current)} multiline className="md:col-span-2" />
                  <div className="flex flex-wrap justify-end gap-2 md:col-span-2">
                    <Button type="button" variant="outline" onClick={cancelEditing} disabled={saving}>Batal</Button>
                    <Button type="submit" variant="emerald" disabled={saving}>
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      {saving ? "Menyimpan..." : "Save ke Supabase"}
                    </Button>
                  </div>
                  </form>
                </CardContent>
              </Card>
            ) : null}

            <div className="print-area overflow-auto rounded-xl bg-slate-100 p-4 dark:bg-slate-900/50">
              {selected ? (
                <KwitansiBatchTemplate docs={selectedPageDocs} project={project} zoom={0.78} />
              ) : (
                <Card>
                  <CardContent className="flex h-96 items-center justify-center text-sm text-slate-500">Pilih kwitansi untuk preview.</CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>
      </div>
    </MotionPage>
  );
}

function EditField({
  label,
  value,
  onChange,
  multiline = false,
  className = "",
  ...inputProps
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <label className={`space-y-1 text-xs font-semibold text-slate-600 dark:text-slate-300 ${className}`}>
      <span>{label}</span>
      {multiline ? (
        <textarea
          value={value}
          required={inputProps.required}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-20 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-950 shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-50"
        />
      ) : (
        inputProps.type === "date" ? (
          <DateInput
            {...inputProps}
            value={value}
            onValueChange={onChange}
            onInvalidDate={() => toast.error("Format tanggal harus dd/mm/yyyy.")}
            className="h-9 font-normal"
          />
        ) : inputProps.type === "currency" ? (
          <CurrencyInput
            {...inputProps}
            value={value}
            onValueChange={onChange}
            className="h-9 font-normal"
          />
        ) : (
          <Input {...inputProps} value={value} onChange={(event) => onChange(event.target.value)} className="h-9 font-normal" />
        )
      )}
    </label>
  );
}
