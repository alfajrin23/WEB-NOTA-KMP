"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { initialProjects, masterTemplateItems, vendors } from "@/constants/seed-data";
import { ALL_TEMPLATE_ASSIGNMENTS } from "@/constants/template-mapping";
import { getStageLabel } from "@/constants/stages";
import { generateKwitansiDocuments, generateNotaDocuments } from "@/lib/nota-generator";
import { getAutofillKwitansiReceiver, kwitansiSyncKeyForDoc } from "@/lib/kwitansi-rules";
import type { KwitansiSyncKey } from "@/lib/kwitansi-rules";
import { isSpecialPLNKwitansi } from "@/lib/pln-document-groups";
import {
  daysBetweenIsoDates,
  shiftDateLikeStringByDays,
  shiftGeneratedNotaByDays,
  shiftResumeItemsByDays,
  shiftTextDatesByDays,
} from "@/lib/project-date-shift";
import { buildResumeItemsForNewProject, latestEditedProject } from "@/lib/resume-history";
import { findPriceSyncItems } from "@/lib/resume-price-sync";
import { getResumeItemAmount } from "@/lib/resume-calculations";
import {
  backfillProjectKwitansiReceivers,
  cacheProjectBundle,
  createCustomNote,
  createResumeItem,
  createSupabaseProject,
  CustomNoteInput,
  deleteResumeItem as deleteSupabaseResumeItem,
  deleteSupabaseProject,
  duplicateSupabaseProject,
  fetchProjectBundle,
  generateAndPersistKwitansi,
  generateAndPersistNotes,
  isSupabaseConfigured,
  KwitansiEditInput,
  mergeBundleWithGenerated,
  ProjectBundle,
  readCachedProjectBundle,
  reimportSupabaseProjectResume,
  replaceSupabaseProjectResume,
  saveProjectMetadata,
  saveResumeItem,
  saveResumeSummary,
  upsertKwitansiEdit,
} from "@/lib/supabase/project-data";
import {
  CustomNote,
  GeneratedNota,
  KwitansiEdit,
  NoteHistoryEntry,
  Project,
  ResumeItem,
  StageCode,
  TemplateAssignment,
} from "@/types/domain";

const MASTER_KEY = "kdkmp.master-template.v1";
const TEMPLATE_ASSIGNMENTS_KEY = "kdkmp.template-assignments.v1";

function readStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Gagal menyimpan cache lokal ${key}.`, error);
  }
}

function mergeTemplateAssignments(value: TemplateAssignment[]) {
  const byId = new Map(value.map((assignment) => [assignment.id, assignment]));
  for (const assignment of ALL_TEMPLATE_ASSIGNMENTS) {
    const stored = byId.get(assignment.id);
    byId.set(assignment.id, stored ? { ...stored, documentType: assignment.documentType } : assignment);
  }
  return [...byId.values()];
}

function normalizePlnResumeItem(item: ResumeItem): ResumeItem {
  const isInitialPlnInstall =
    item.id.endsWith("t4-003") ||
    item.id.endsWith("project-haurwangi-t4-003") ||
    item.itemName.trim().toLowerCase() === "daya pln 16,500 va";

  if (item.stageCode === "TAHAP_IV" && item.vendorId === "vendor-pln" && isInitialPlnInstall) {
    return {
      ...item,
      itemName: "Pemasangan Listrik Daya 5500 VA. Dan Pemasangan Panel Listrik 3 Phase",
      unit: "Ls",
    };
  }

  if (item.vendorId === "vendor-pln" && item.itemName.trim().toLowerCase() === "penambahan daya listrik menjadi 16.500 va") {
    return {
      ...item,
      itemName: "Penambahan Daya Listrik Menjadi 16.500 VA",
    };
  }

  return item;
}

function normalizePlnResumeItems(items: ResumeItem[]) {
  return items.map((item) => {
    const normalized = normalizePlnResumeItem(item);
    const vendor = vendors.find((entry) => entry.id === normalized.vendorId);
    return {
      ...normalized,
      vendorName: normalized.vendorName ?? vendor?.name ?? "",
      isManualAdded: normalized.isManualAdded ?? false,
      isIncludedInResumeTotal: normalized.isIncludedInResumeTotal ?? true,
      isGeneratedToNote: normalized.isGeneratedToNote ?? false,
    };
  });
}

function normalizeResponsibleName(project: Project) {
  const legacyProject = project as Project & {
    babinsaName?: unknown;
    penanggungJawabName?: unknown;
  };
  const metadata = project.metadataJson ?? {};
  const candidates = [
    project.responsibleName,
    metadata.babinsa_responsible_name,
    metadata.responsible_name,
    metadata.nama_babinsa,
    metadata.penanggung_jawab,
    legacyProject.babinsaName,
    legacyProject.penanggungJawabName,
  ];
  const match = candidates.find((value) => typeof value === "string" && value.trim());
  return typeof match === "string" ? match.trim() : "";
}

function normalizeProjects(projects: Project[]) {
  return projects.map((project) => ({
    ...project,
    responsibleName: normalizeResponsibleName(project),
    items: normalizePlnResumeItems(project.items),
  }));
}

function createLocalProject(
  input: Pick<Project, "projectName" | "villageName" | "districtName" | "regencyName" | "regionName" | "responsibleName" | "projectDate">,
  sourceItems: ResumeItem[],
  options: { historyItems?: ResumeItem[] | null; shiftDatesFromDefault?: boolean } = {},
) {
  const id = `project-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const items = options.shiftDatesFromDefault === false
    ? sourceItems
    : buildResumeItemsForNewProject(sourceItems, input.projectDate, options.historyItems);

  return {
    ...input,
    id,
    templateId: "master-template-kdkmp-v1",
    reportDate: input.projectDate,
    responsibleName: input.responsibleName,
    coordinates: "",
    invoiceRecipientName: `KDKMP Desa ${input.villageName}`,
    invoiceRecipientAddress: `Desa ${input.villageName}, Kec. ${input.districtName}, Kab. ${input.regencyName}`,
    targetGrandTotal: null,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    items: items.map((entry) => ({
      ...entry,
      id: `${id}-${entry.id}`,
    })),
  } satisfies Project;
}

function applyBundle(bundle: ProjectBundle) {
  return {
    projects: normalizeProjects(bundle.projects),
    generatedNotas: bundle.generatedNotas,
    kwitansiEdits: bundle.kwitansiEdits,
    customNotes: bundle.customNotes,
    history: bundle.history,
  };
}

function buildShiftedKwitansiEditInput(doc: GeneratedNota, days: number) {
  const currentDescription = doc.kwitansiPaymentDescription ?? "";
  const currentDate = doc.kwitansiDate ?? "";
  const shiftedDescription = shiftTextDatesByDays(currentDescription, days);
  const shiftedDate = shiftDateLikeStringByDays(currentDate, days);
  const locksAmountToResume = isSpecialPLNKwitansi(doc);

  if (shiftedDescription === currentDescription && shiftedDate === currentDate) return null;

  return {
    namaPenerima: doc.kwitansiReceiverName ?? "",
    warnaTemplate: doc.warnaTemplate ?? "default",
    noKwitansi: doc.kwitansiNumber ?? "",
    namaPemberi: doc.kwitansiPayerName ?? "",
    keterangan: shiftedDescription,
    jabatan: doc.kwitansiRoleName ?? "",
    catatan: doc.kwitansiNote ?? "",
    nominal: locksAmountToResume ? null : doc.kwitansiAmount ?? null,
    uangSejumlah: locksAmountToResume ? "" : doc.kwitansiAmountWords ?? "",
    tanggalKwitansi: shiftedDate,
    kota: doc.kwitansiCity ?? "",
  };
}

export function useKdkmpStore() {
  const [projects, setProjects] = useState<Project[]>(() => normalizeProjects(initialProjects));
  const [generatedNotas, setGeneratedNotas] = useState<GeneratedNota[]>([]);
  const [kwitansiEdits, setKwitansiEdits] = useState<KwitansiEdit[]>([]);
  const [customNotes, setCustomNotes] = useState<CustomNote[]>([]);
  const [history, setHistory] = useState<NoteHistoryEntry[]>([]);
  const [masterItems, setMasterItems] = useState<ResumeItem[]>(normalizePlnResumeItems(masterTemplateItems));
  const [templateAssignments, setTemplateAssignments] = useState<TemplateAssignment[]>(ALL_TEMPLATE_ASSIGNMENTS);
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);
  const generatedNotasRef = useRef(generatedNotas);
  const kwitansiSaveQueuesRef = useRef(new Map<string, Promise<KwitansiEdit | null>>());

  const supabaseReady = isSupabaseConfigured();

  useEffect(() => {
    generatedNotasRef.current = generatedNotas;
  }, [generatedNotas]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setSyncError(null);
    try {
      const bundle = await fetchProjectBundle();
      const next = applyBundle(bundle);
      setProjects(next.projects);
      setGeneratedNotas(next.generatedNotas);
      setKwitansiEdits(next.kwitansiEdits);
      setCustomNotes(next.customNotes);
      setHistory(next.history);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Gagal memuat data Supabase.";
      setSyncError(message);
      toast.error(message);
    } finally {
      setLoading(false);
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!supabaseReady) {
      const cachedData = applyBundle(readCachedProjectBundle());
      setProjects(cachedData.projects);
      setGeneratedNotas(cachedData.generatedNotas);
      setKwitansiEdits(cachedData.kwitansiEdits);
      setCustomNotes(cachedData.customNotes);
      setHistory(cachedData.history);
    }
    setMasterItems(normalizePlnResumeItems(readStorage(MASTER_KEY, masterTemplateItems)));
    setTemplateAssignments(mergeTemplateAssignments(readStorage(TEMPLATE_ASSIGNMENTS_KEY, ALL_TEMPLATE_ASSIGNMENTS)));
    void refresh();
  }, [refresh, supabaseReady]);

  useEffect(() => {
    if (hydrated) writeStorage(MASTER_KEY, masterItems);
  }, [hydrated, masterItems]);

  useEffect(() => {
    if (hydrated) writeStorage(TEMPLATE_ASSIGNMENTS_KEY, templateAssignments);
  }, [hydrated, templateAssignments]);

  useEffect(() => {
    if (!hydrated || supabaseReady) return;
    cacheProjectBundle({
      projects,
      generatedNotas,
      kwitansiEdits,
      customNotes,
      history,
      source: "cache",
    });
  }, [customNotes, generatedNotas, history, hydrated, kwitansiEdits, projects, supabaseReady]);

  const updateProject = useCallback((project: Project) => {
    const next = { ...project, updatedAt: new Date().toISOString() };
    setProjects((current) => current.map((entry) => (entry.id === project.id ? next : entry)));
    if (supabaseReady) {
      void saveProjectMetadata(next).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Gagal menyimpan project."));
    }
  }, [supabaseReady]);

  const updateProjectMeta = useCallback((projectId: string, patch: Partial<Omit<Project, "id" | "items" | "createdAt" | "updatedAt">>) => {
    const source = projects.find((project) => project.id === projectId);
    if (!source) return;
    const next: Project = { ...source, ...patch, updatedAt: new Date().toISOString() };
    setProjects((current) => current.map((project) => (project.id === projectId ? next : project)));
    if (supabaseReady) {
      void saveProjectMetadata(next).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Gagal menyimpan metadata."));
    }
  }, [projects, supabaseReady]);

  const updateProjectStartDate = useCallback(async (projectId: string, nextProjectDate: string, shiftExistingDates: boolean) => {
    const source = projects.find((project) => project.id === projectId);
    if (!source) throw new Error("Project tidak ditemukan.");
    if (!nextProjectDate) throw new Error("Tanggal Awal Project wajib diisi.");

    const shiftDays = daysBetweenIsoDates(source.projectDate, nextProjectDate);
    const shouldShiftDates = shiftExistingDates && shiftDays !== 0;
    const reportDateFollowsProject = !source.reportDate || source.reportDate === source.projectDate;
    const nextReportDate = shouldShiftDates && source.reportDate
      ? shiftDateLikeStringByDays(source.reportDate, shiftDays)
      : reportDateFollowsProject
        ? nextProjectDate
        : source.reportDate;
    const nextItems = shouldShiftDates ? shiftResumeItemsByDays(source.items, shiftDays) : source.items;
    const nextProject: Project = {
      ...source,
      projectDate: nextProjectDate,
      reportDate: nextReportDate,
      updatedAt: new Date().toISOString(),
      items: nextItems,
    };

    if (supabaseReady) {
      if (shouldShiftDates) {
        const editedDocs = generatedNotasRef.current
          .filter((doc) => doc.projectId === projectId && doc.source !== "custom")
          .map((doc) => ({ doc, input: buildShiftedKwitansiEditInput(doc, shiftDays) }))
          .filter((entry): entry is { doc: GeneratedNota; input: NonNullable<ReturnType<typeof buildShiftedKwitansiEditInput>> } => Boolean(entry.input));

        await Promise.all(editedDocs.map(({ doc, input }) => upsertKwitansiEdit(projectId, doc.id, input)));
      }

      await saveProjectMetadata(nextProject);
      if (shouldShiftDates) {
        await Promise.all(nextItems.map((item) => saveResumeItem(projectId, item)));
      }
      await saveResumeSummary(nextProject);

      if (shouldShiftDates) {
        const projectDocs = generatedNotasRef.current.filter((doc) => doc.projectId === projectId && doc.source !== "custom");
        if (projectDocs.some((doc) => doc.documentType === "nota")) {
          await generateAndPersistNotes(nextProject, templateAssignments);
        }
        if (projectDocs.some((doc) => doc.documentType === "kwitansi")) {
          await generateAndPersistKwitansi(nextProject, templateAssignments);
        }
      }

      const refreshedBundle = applyBundle(await fetchProjectBundle());
      setProjects(refreshedBundle.projects);
      setGeneratedNotas(refreshedBundle.generatedNotas);
      generatedNotasRef.current = refreshedBundle.generatedNotas;
      setKwitansiEdits(refreshedBundle.kwitansiEdits);
      setCustomNotes(refreshedBundle.customNotes);
      setHistory(refreshedBundle.history);
    } else {
      setProjects((current) => current.map((project) => (project.id === projectId ? nextProject : project)));
      if (shouldShiftDates) {
        setGeneratedNotas((current) => {
          const nextDocs = current.map((doc) => (
            doc.projectId === projectId
              ? shiftGeneratedNotaByDays(doc, shiftDays, nextProject)
              : doc
          ));
          generatedNotasRef.current = nextDocs;
          return nextDocs;
        });
        setCustomNotes((current) => current.map((note) => (
          note.projectId === projectId
            ? { ...note, dataJson: shiftGeneratedNotaByDays(note.dataJson, shiftDays, nextProject) }
            : note
        )));
      }
    }

    toast.success(shouldShiftDates ? "Tanggal project dan semua tanggal terkait sudah digeser." : "Tanggal Awal Project tersimpan.");
    return nextProject;
  }, [projects, supabaseReady, templateAssignments]);

  const createProject = useCallback(async (
    input: Pick<Project, "projectName" | "villageName" | "districtName" | "regencyName" | "regionName" | "responsibleName" | "projectDate">,
    options: { budgetReferenceProjectId?: string | null } = {},
  ) => {
    const historyProject = options.budgetReferenceProjectId === undefined
      ? latestEditedProject(projects)
      : options.budgetReferenceProjectId === null
        ? null
        : projects.find((project) => project.id === options.budgetReferenceProjectId);

    if (options.budgetReferenceProjectId !== undefined && options.budgetReferenceProjectId !== null && !historyProject) {
      throw new Error("Desa referensi anggaran tidak ditemukan. Muat ulang halaman lalu pilih kembali desa referensi.");
    }

    if (supabaseReady) {
      const project = await createSupabaseProject(input, {
        templateItems: masterItems,
        historyItems: historyProject?.items ?? null,
      });
      setProjects((current) => [project, ...current]);
      toast.success("Project desa tersimpan ke Supabase");
      return project;
    }

    const project = createLocalProject(input, masterItems, { historyItems: historyProject?.items ?? null });
    setProjects((current) => [project, ...current]);
    toast.warning("Supabase belum dikonfigurasi. Project hanya tersimpan sebagai cache lokal sementara.");
    return project;
  }, [masterItems, projects, supabaseReady]);

  const duplicateProject = useCallback((projectId: string) => {
    const source = projects.find((project) => project.id === projectId);
    if (!source) return;

    if (supabaseReady) {
      void duplicateSupabaseProject(source)
        .then((project) => {
          setProjects((current) => [project, ...current]);
          toast.success("Project berhasil diduplikasi ke Supabase");
        })
        .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Gagal duplikasi project."));
      return;
    }

    const copy = createLocalProject(
      {
        projectName: source.projectName,
        villageName: `${source.villageName} Copy`,
        districtName: source.districtName,
        regencyName: source.regencyName,
        regionName: source.regionName,
        responsibleName: source.responsibleName,
        projectDate: source.projectDate,
      },
      source.items,
      { shiftDatesFromDefault: false },
    );
    setProjects((current) => [copy, ...current]);
    toast.success("Project berhasil diduplikasi di cache lokal");
  }, [projects, supabaseReady]);

  const deleteProject = useCallback((projectId: string) => {
    setProjects((current) => current.filter((project) => project.id !== projectId));
    setGeneratedNotas((current) => current.filter((doc) => doc.projectId !== projectId));
    if (supabaseReady) {
      void deleteSupabaseProject(projectId).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Gagal menghapus project."));
    }
  }, [supabaseReady]);

  const updateItem = useCallback((projectId: string, itemId: string, patch: Partial<ResumeItem>) => {
    const source = projects.find((project) => project.id === projectId);
    const sourceItem = source?.items.find((item) => item.id === itemId);
    if (!source || !sourceItem) return;
    const nextItem = { ...sourceItem, ...patch };
    const nextProject = {
      ...source,
      updatedAt: new Date().toISOString(),
      items: source.items.map((item) => (item.id === itemId ? nextItem : item)),
    };

    setProjects((current) => current.map((project) => (project.id === projectId ? nextProject : project)));

    if (supabaseReady) {
      void saveResumeItem(projectId, nextItem)
        .then(() => saveResumeSummary(nextProject))
        .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Gagal menyimpan baris resume."));
    }
  }, [projects, supabaseReady]);

  const updateItemUnitPrice = useCallback(async (projectId: string, itemId: string, unitPrice: number, syncAcrossStages: boolean) => {
    const source = projects.find((project) => project.id === projectId);
    const sourceItem = source?.items.find((item) => item.id === itemId);
    if (!source || !sourceItem) throw new Error("Baris resume tidak ditemukan.");
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error("Harga satuan harus angka valid dan tidak boleh minus.");

    const affectedItems = syncAcrossStages ? findPriceSyncItems(source.items, sourceItem) : [sourceItem];
    const affectedIds = new Set(affectedItems.map((item) => item.id));
    const nextItems = source.items.map((item) => (
      affectedIds.has(item.id)
        ? { ...item, unitPrice, amountOverride: null }
        : item
    ));
    const nextProject: Project = {
      ...source,
      updatedAt: new Date().toISOString(),
      items: nextItems,
    };
    const currentProjectDocs = generatedNotasRef.current.filter((doc) => doc.projectId === projectId && doc.source !== "custom");
    const shouldRegenerateNotas = currentProjectDocs.some((doc) => doc.documentType === "nota");
    const shouldRegenerateKwitansi = currentProjectDocs.some((doc) => doc.documentType === "kwitansi");

    setProjects((current) => current.map((project) => (project.id === projectId ? nextProject : project)));

    if (supabaseReady) {
      await Promise.all(
        nextItems
          .filter((item) => affectedIds.has(item.id) && !item.id.startsWith("temp-"))
          .map((item) => saveResumeItem(projectId, item)),
      );
      await saveResumeSummary(nextProject);

      if (shouldRegenerateNotas) await generateAndPersistNotes(nextProject, templateAssignments);
      if (shouldRegenerateKwitansi) await generateAndPersistKwitansi(nextProject, templateAssignments);

      if (shouldRegenerateNotas || shouldRegenerateKwitansi) {
        const refreshedBundle = applyBundle(await fetchProjectBundle());
        setProjects(refreshedBundle.projects);
        setGeneratedNotas(refreshedBundle.generatedNotas);
        generatedNotasRef.current = refreshedBundle.generatedNotas;
        setKwitansiEdits(refreshedBundle.kwitansiEdits);
        setCustomNotes(refreshedBundle.customNotes);
        setHistory(refreshedBundle.history);
      }
    } else if (shouldRegenerateNotas || shouldRegenerateKwitansi) {
      const nextNotaDocs = shouldRegenerateNotas
        ? generateNotaDocuments(nextProject, vendors, templateAssignments).map((doc) => ({ ...doc, source: "auto" as const, status: "generated" as const }))
        : [];
      const nextKwitansiDocs = shouldRegenerateKwitansi
        ? generateKwitansiDocuments(nextProject, vendors, templateAssignments).map((doc) => ({ ...doc, source: "auto" as const, status: "generated" as const }))
        : [];
      setGeneratedNotas((current) => {
        const nextDocs = [
          ...current.filter((doc) => {
            if (doc.projectId !== projectId || doc.source === "custom") return true;
            if (doc.documentType === "nota") return !shouldRegenerateNotas;
            if (doc.documentType === "kwitansi") return !shouldRegenerateKwitansi;
            return true;
          }),
          ...nextNotaDocs,
          ...nextKwitansiDocs,
        ];
        generatedNotasRef.current = nextDocs;
        return nextDocs;
      });
    }

    return {
      project: nextProject,
      affectedCount: affectedItems.length,
    };
  }, [projects, supabaseReady, templateAssignments]);

  const addItem = useCallback((projectId: string, input: Partial<ResumeItem> = {}) => {
    const project = projects.find((entry) => entry.id === projectId);
    if (!project) return;

    const now = new Date().toISOString();
    const stageCode = input.stageCode ?? "TAHAP_I";
    const stageItems = project.items.filter((item) => item.stageCode === stageCode);
    const lastSort = project.items.reduce((max, item) => Math.max(max, item.sortOrder), 0);
    const templateItem = stageItems.at(-1) ?? project.items.at(-1);
    const item: ResumeItem = {
      id: `temp-${crypto.randomUUID()}`,
      stageCode,
      stageName: input.stageName ?? templateItem?.stageName ?? getStageLabel(stageCode),
      category: input.category ?? templateItem?.category ?? "Kategori baru",
      expenseDate: input.expenseDate ?? project.projectDate,
      itemName: input.itemName ?? "",
      volume: input.volume ?? 1,
      unit: input.unit ?? "Ls",
      unitPrice: input.unitPrice ?? 0,
      amountOverride: input.amountOverride ?? null,
      vendorId: input.vendorId ?? templateItem?.vendorId ?? "",
      vendorName: input.vendorName ?? "",
      notes: input.notes ?? "",
      sortOrder: lastSort + 1,
      sourceFile: input.sourceFile ?? null,
      sourceType: "manual",
      isManualAdded: true,
      isIncludedInResumeTotal: true,
      isGeneratedToNote: false,
      validationStatus: "warning",
    };
    const nextProject = { ...project, updatedAt: now, items: [...project.items, item] };
    setProjects((current) => current.map((entry) => (entry.id === projectId ? nextProject : entry)));

    if (supabaseReady) {
      void createResumeItem(projectId, item)
        .then((saved) => {
          setProjects((current) =>
            current.map((entry) =>
              entry.id === projectId
                ? { ...entry, items: entry.items.map((row) => (row.id === item.id ? saved : row)) }
                : entry,
            ),
          );
          return saveResumeSummary({ ...nextProject, items: [...project.items, saved] });
        })
        .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Gagal menambah baris resume."));
    }

    toast.success("Baris resume ditambahkan");
  }, [projects, supabaseReady]);

  const deleteItem = useCallback((projectId: string, itemId: string) => {
    const source = projects.find((project) => project.id === projectId);
    if (!source) return;
    const nextProject = {
      ...source,
      updatedAt: new Date().toISOString(),
      items: source.items.filter((item) => item.id !== itemId),
    };
    setProjects((current) => current.map((project) => (project.id === projectId ? nextProject : project)));

    if (supabaseReady && !itemId.startsWith("temp-")) {
      void deleteSupabaseResumeItem(itemId)
        .then(() => saveResumeSummary(nextProject))
        .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Gagal menghapus baris resume."));
    }
  }, [projects, supabaseReady]);

  const replaceProjectItems = useCallback((projectId: string, items: ResumeItem[]) => {
    const source = projects.find((project) => project.id === projectId);
    if (!source) return;
    const nextProject = { ...source, updatedAt: new Date().toISOString(), items };
    setProjects((current) => current.map((project) => (project.id === projectId ? nextProject : project)));

    if (supabaseReady) {
      void Promise.all(items.filter((item) => !item.id.startsWith("temp-")).map((item) => saveResumeItem(projectId, item)))
        .then(() => saveResumeSummary(nextProject))
        .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Gagal menyimpan undo/redo."));
    }
  }, [projects, supabaseReady]);

  const resetProjectResumeFromMaster = useCallback(async (projectId: string) => {
    const project = projects.find((entry) => entry.id === projectId);
    if (!project) throw new Error("Project tidak ditemukan.");

    if (supabaseReady) {
      const nextProject = await reimportSupabaseProjectResume(project);
      const normalizedProject = normalizeProjects([nextProject])[0] ?? nextProject;
      setProjects((current) => current.map((entry) => (entry.id === projectId ? normalizedProject : entry)));
      setGeneratedNotas((current) => current.filter((doc) => doc.projectId !== projectId || doc.source === "custom"));
      setKwitansiEdits((current) => current.filter((edit) => !generatedNotas.some((doc) => doc.projectId === projectId && doc.id === edit.noteId && doc.source !== "custom")));
      toast.success("Resume project diimport ulang dari PDF terbaru.");
      return nextProject;
    }

    const now = new Date().toISOString();
    const nextProject: Project = {
      ...project,
      status: "draft",
      updatedAt: now,
      items: buildResumeItemsForNewProject(masterTemplateItems, project.projectDate).map((item) => ({
        ...item,
        id: `${project.id}-${item.id}`,
      })),
    };
    setProjects((current) => current.map((entry) => (entry.id === projectId ? nextProject : entry)));
    setGeneratedNotas((current) => current.filter((doc) => doc.projectId !== projectId || doc.source === "custom"));
    toast.success("Resume project diimport ulang di cache lokal.");
    return nextProject;
  }, [generatedNotas, projects, supabaseReady]);

  const applyResumeImport = useCallback(async (projectId: string, items: ResumeItem[], description: string) => {
    const project = projects.find((entry) => entry.id === projectId);
    if (!project) throw new Error("Project tidak ditemukan.");
    const nextItems = items.map((item, index) => ({
      ...item,
      sortOrder: index + 1,
      isGeneratedToNote: false,
      noteId: null,
    }));

    if (supabaseReady) {
      const nextProject = await replaceSupabaseProjectResume(project, nextItems, description);
      const normalizedProject = normalizeProjects([nextProject])[0] ?? nextProject;
      setProjects((current) => current.map((entry) => (entry.id === projectId ? normalizedProject : entry)));
      setGeneratedNotas((current) => current.filter((doc) => doc.projectId !== projectId || doc.source === "custom"));
      setKwitansiEdits((current) => current.filter((edit) => !generatedNotas.some((doc) => doc.projectId === projectId && doc.id === edit.noteId && doc.source !== "custom")));
      toast.success("Resume project berhasil diperbarui.");
      return nextProject;
    }

    const nextProject: Project = {
      ...project,
      status: "draft",
      updatedAt: new Date().toISOString(),
      items: nextItems.map((item) => ({
        ...item,
        id: item.id.startsWith("import-") ? `${project.id}-${item.id}` : item.id,
      })),
    };
    setProjects((current) => current.map((entry) => (entry.id === projectId ? nextProject : entry)));
    setGeneratedNotas((current) => current.filter((doc) => doc.projectId !== projectId || doc.source === "custom"));
    toast.warning("Supabase belum dikonfigurasi. Resume import hanya disimpan ke cache lokal.");
    return nextProject;
  }, [generatedNotas, projects, supabaseReady]);

  const updateMasterItem = useCallback((itemId: string, patch: Partial<ResumeItem>) => {
    setMasterItems((current) => current.map((item) => (item.id === itemId ? { ...item, ...patch } : item)));
  }, []);

  const updateTemplateAssignment = useCallback((assignmentId: string, patch: Partial<TemplateAssignment>) => {
    setTemplateAssignments((current) => current.map((item) => (item.id === assignmentId ? { ...item, ...patch } : item)));
  }, []);

  const importStoreData = useCallback((data: Partial<{
    projects: Project[];
    masterItems: ResumeItem[];
    templateAssignments: TemplateAssignment[];
  }>) => {
    if (Array.isArray(data.projects)) setProjects(normalizeProjects(data.projects));
    if (Array.isArray(data.masterItems)) setMasterItems(normalizePlnResumeItems(data.masterItems));
    if (Array.isArray(data.templateAssignments)) setTemplateAssignments(mergeTemplateAssignments(data.templateAssignments));
    toast.success("Data JSON berhasil diimpor ke cache lokal");
  }, []);

  const resetAll = useCallback(() => {
    setProjects(initialProjects);
    setGeneratedNotas([]);
    setKwitansiEdits([]);
    setCustomNotes([]);
    setHistory([]);
    setMasterItems(masterTemplateItems);
    setTemplateAssignments(ALL_TEMPLATE_ASSIGNMENTS);
    writeStorage(MASTER_KEY, masterTemplateItems);
    writeStorage(TEMPLATE_ASSIGNMENTS_KEY, ALL_TEMPLATE_ASSIGNMENTS);
    toast.success("Cache lokal dikembalikan ke template awal");
  }, []);

  const generateProjectNotas = useCallback(async (projectId: string) => {
    const project = projects.find((entry) => entry.id === projectId);
    if (!project) throw new Error("Project tidak ditemukan.");

    if (supabaseReady) {
      const docs = await generateAndPersistNotes(project, templateAssignments);
      const bundle: ProjectBundle = {
        projects,
        generatedNotas,
        kwitansiEdits,
        customNotes,
        history,
        source: "supabase",
      };
      const merged = mergeBundleWithGenerated(bundle, projectId, docs, "nota");
      setProjects(merged.projects);
      setGeneratedNotas(merged.generatedNotas);
      generatedNotasRef.current = merged.generatedNotas;
      toast.success(`${docs.length} nota tersimpan ke Supabase`);
      return docs;
    }

    const docs = generateNotaDocuments(project, vendors, templateAssignments).map((doc) => ({ ...doc, source: "auto" as const, status: "generated" as const }));
    const generatedItemToNote = new Map(docs.flatMap((doc) => doc.itemIds.map((itemId) => [itemId, doc.id] as const)));
    setProjects((current) =>
      current.map((entry) =>
        entry.id === projectId
          ? {
            ...entry,
            status: docs.length > 0 ? "generated" : "review",
            items: entry.items.map((item) => ({
              ...item,
              isGeneratedToNote: generatedItemToNote.has(item.id),
              noteId: generatedItemToNote.get(item.id) ?? null,
            })),
          }
          : entry,
      ),
    );
    setGeneratedNotas((current) => {
      const nextDocs = [
        ...current.filter((doc) => (
          doc.projectId !== projectId ||
          doc.source === "custom" ||
          (doc.documentType !== "nota" && !(doc.vendorId === "vendor-pln" && doc.templateId === "template-pln"))
        )),
        ...docs,
      ];
      generatedNotasRef.current = nextDocs;
      return nextDocs;
    });
    toast.warning("Supabase belum dikonfigurasi. Hasil generate hanya ada di cache lokal.");
    return docs;
  }, [customNotes, generatedNotas, history, kwitansiEdits, projects, supabaseReady, templateAssignments]);

  const generateProjectKwitansi = useCallback(async (projectId: string) => {
    const project = projects.find((entry) => entry.id === projectId);
    if (!project) throw new Error("Project tidak ditemukan.");

    if (supabaseReady) {
      const docs = await generateAndPersistKwitansi(project, templateAssignments);
      const backfillResult = await backfillProjectKwitansiReceivers(projectId);
      const bundle: ProjectBundle = {
        projects,
        generatedNotas,
        kwitansiEdits,
        customNotes,
        history,
        source: "supabase",
      };
      const merged = mergeBundleWithGenerated(bundle, projectId, docs, "kwitansi");
      setProjects(merged.projects);
      setGeneratedNotas(merged.generatedNotas);
      generatedNotasRef.current = merged.generatedNotas;
      try {
        const refreshedBundle = applyBundle(await fetchProjectBundle());
        setProjects(refreshedBundle.projects);
        setGeneratedNotas(refreshedBundle.generatedNotas);
        generatedNotasRef.current = refreshedBundle.generatedNotas;
        setKwitansiEdits(refreshedBundle.kwitansiEdits);
        setCustomNotes(refreshedBundle.customNotes);
        setHistory(refreshedBundle.history);
      } catch {
        // Hasil insert sudah valid dan langsung ditampilkan. Sinkronisasi penuh
        // berikutnya akan mengambil kembali metadata edit bila fetch ini gagal.
      }
      toast.success(
        backfillResult.updated > 0
          ? `${docs.length} kwitansi tersimpan; ${backfillResult.updated} nama penerima otomatis diperbarui.`
          : `${docs.length} kwitansi tersimpan ke Supabase`,
      );
      return docs;
    }

    const docs = generateKwitansiDocuments(project, vendors, templateAssignments).map((doc) => ({ ...doc, source: "auto" as const, status: "generated" as const }));
    setGeneratedNotas((current) => {
      const nextDocs = [...current.filter((doc) => doc.projectId !== projectId || doc.source === "custom" || doc.documentType !== "kwitansi"), ...docs];
      generatedNotasRef.current = nextDocs;
      return nextDocs;
    });
    toast.warning("Supabase belum dikonfigurasi. Kwitansi hanya ada di cache lokal.");
    return docs;
  }, [customNotes, generatedNotas, history, kwitansiEdits, projects, supabaseReady, templateAssignments]);

  const backfillKwitansiReceivers = useCallback(async (projectId: string) => {
    if (supabaseReady) {
      const result = await backfillProjectKwitansiReceivers(projectId);
      const refreshedBundle = applyBundle(await fetchProjectBundle());
      setProjects(refreshedBundle.projects);
      setGeneratedNotas(refreshedBundle.generatedNotas);
      generatedNotasRef.current = refreshedBundle.generatedNotas;
      setKwitansiEdits(refreshedBundle.kwitansiEdits);
      setCustomNotes(refreshedBundle.customNotes);
      setHistory(refreshedBundle.history);
      toast.success(
        result.updated > 0
          ? `${result.updated} nama penerima kwitansi otomatis diperbarui.`
          : "Tidak ada nama penerima kosong yang perlu diperbarui.",
      );
      return result;
    }

    let updated = 0;
    setGeneratedNotas((current) => {
      const nextDocs = current.map((doc) => {
        if (doc.projectId !== projectId || doc.documentType !== "kwitansi" || doc.kwitansiReceiverName?.trim()) return doc;
        const receiver = getAutofillKwitansiReceiver(doc);
        if (!receiver) return doc;
        updated += 1;
        return { ...doc, kwitansiReceiverName: receiver };
      });
      generatedNotasRef.current = nextDocs;
      return nextDocs;
    });
    toast.warning(
      updated > 0
        ? `${updated} nama penerima kwitansi diperbarui di cache lokal.`
        : "Tidak ada nama penerima kosong yang perlu diperbarui di cache lokal.",
    );
    return { checked: generatedNotasRef.current.filter((doc) => doc.projectId === projectId && doc.documentType === "kwitansi").length, updated };
  }, [supabaseReady]);

  const updateKwitansiFields = useCallback(async (projectId: string, noteId: string, patch: Partial<Pick<
    GeneratedNota,
    "kwitansiReceiverName" | "kwitansiNumber" | "kwitansiPayerName" | "kwitansiPaymentDescription" | "kwitansiRoleName" | "kwitansiNote" |
    "kwitansiAmount" | "kwitansiAmountWords" | "kwitansiDate" | "kwitansiCity" | "warnaTemplate"
  >>, options: { receiverSource?: "manual" | "sync" | "auto"; receiverSyncKey?: KwitansiSyncKey } = {}) => {
    const source = generatedNotasRef.current.find((doc) => doc.id === noteId);
    if (!source) {
      throw new Error("Kwitansi yang akan disimpan tidak ditemukan.");
    }
    if (!supabaseReady) throw new Error("Supabase belum dikonfigurasi. Perubahan kwitansi belum dapat disimpan permanen.");

    const nextDoc: GeneratedNota = { ...source, ...patch };
    const nextDocs = generatedNotasRef.current.map((doc) => (doc.id === noteId ? nextDoc : doc));
    generatedNotasRef.current = nextDocs;
    setGeneratedNotas(nextDocs);

    const locksAmountToResume = isSpecialPLNKwitansi(nextDoc);
    const input: KwitansiEditInput = {};
    if (Object.prototype.hasOwnProperty.call(patch, "kwitansiReceiverName")) {
      input.namaPenerima = nextDoc.kwitansiReceiverName ?? "";
      input.receiverSource = options.receiverSource ?? "manual";
      const receiverSyncKey = options.receiverSyncKey ?? kwitansiSyncKeyForDoc(nextDoc, nextDoc.kwitansiRoleName);
      if (receiverSyncKey) input.receiverSyncKey = receiverSyncKey;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "warnaTemplate")) input.warnaTemplate = nextDoc.warnaTemplate ?? "default";
    if (Object.prototype.hasOwnProperty.call(patch, "kwitansiNumber")) input.noKwitansi = nextDoc.kwitansiNumber ?? "";
    if (Object.prototype.hasOwnProperty.call(patch, "kwitansiPayerName")) input.namaPemberi = nextDoc.kwitansiPayerName ?? "";
    if (Object.prototype.hasOwnProperty.call(patch, "kwitansiPaymentDescription")) input.keterangan = nextDoc.kwitansiPaymentDescription ?? "";
    if (Object.prototype.hasOwnProperty.call(patch, "kwitansiRoleName")) input.jabatan = nextDoc.kwitansiRoleName ?? "";
    if (Object.prototype.hasOwnProperty.call(patch, "kwitansiNote")) input.catatan = nextDoc.kwitansiNote ?? "";
    if (Object.prototype.hasOwnProperty.call(patch, "kwitansiAmount")) input.nominal = locksAmountToResume ? null : nextDoc.kwitansiAmount ?? null;
    if (Object.prototype.hasOwnProperty.call(patch, "kwitansiAmountWords")) input.uangSejumlah = locksAmountToResume ? "" : nextDoc.kwitansiAmountWords ?? "";
    if (Object.prototype.hasOwnProperty.call(patch, "kwitansiDate")) input.tanggalKwitansi = nextDoc.kwitansiDate ?? "";
    if (Object.prototype.hasOwnProperty.call(patch, "kwitansiCity")) input.kota = nextDoc.kwitansiCity ?? "";
    const previousSave = kwitansiSaveQueuesRef.current.get(noteId) ?? Promise.resolve(null);
    const save = previousSave
      .catch(() => null)
      .then(() => upsertKwitansiEdit(projectId, noteId, input));
    kwitansiSaveQueuesRef.current.set(noteId, save);

    try {
      const edit = await save;
      setKwitansiEdits((current) => [edit, ...current.filter((entry) => entry.noteId !== noteId)]);
      return edit;
    } catch (error) {
      if (generatedNotasRef.current.find((doc) => doc.id === noteId) === nextDoc) {
        generatedNotasRef.current = generatedNotasRef.current.map((doc) => (doc.id === noteId ? source : doc));
        setGeneratedNotas((current) => current.map((doc) => (doc === nextDoc ? source : doc)));
      }
      throw error;
    } finally {
      if (kwitansiSaveQueuesRef.current.get(noteId) === save) kwitansiSaveQueuesRef.current.delete(noteId);
    }
  }, [supabaseReady]);

  const updateKwitansiReceiver = useCallback((projectId: string, noteId: string, namaPenerima: string, warnaTemplate = "default") => {
    return updateKwitansiFields(projectId, noteId, { kwitansiReceiverName: namaPenerima, warnaTemplate });
  }, [updateKwitansiFields]);

  const createProjectCustomNote = useCallback(async (projectId: string, input: CustomNoteInput) => {
    const project = projects.find((entry) => entry.id === projectId);
    if (!project) throw new Error("Project tidak ditemukan.");
    if (!supabaseReady) throw new Error("Supabase belum dikonfigurasi. Nota tambahan wajib tersimpan ke Supabase.");

    const note = await createCustomNote(project, input);
    setCustomNotes((current) => [note, ...current]);
    setGeneratedNotas((current) => [note.dataJson, ...current]);
    toast.success("Nota tambahan tersimpan ke Supabase");
    return note;
  }, [projects, supabaseReady]);

  const totalsByStage = useCallback((project: Project, stageCode?: StageCode) => {
    return project.items
      .filter((item) => !stageCode || item.stageCode === stageCode)
      .reduce((sum, item) => sum + getResumeItemAmount(item), 0);
  }, []);

  return {
    hydrated,
    loading,
    syncError,
    supabaseReady,
    vendors,
    projects,
    masterItems,
    templateAssignments,
    generatedNotas,
    kwitansiEdits,
    customNotes,
    history,
    refresh,
    createProject,
    updateProject,
    updateProjectMeta,
    updateProjectStartDate,
    duplicateProject,
    deleteProject,
    updateItem,
    updateItemUnitPrice,
    addItem,
    deleteItem,
    replaceProjectItems,
    resetProjectResumeFromMaster,
    applyResumeImport,
    updateMasterItem,
    updateTemplateAssignment,
    importStoreData,
    resetAll,
    generateProjectNotas,
    generateProjectKwitansi,
    backfillKwitansiReceivers,
    updateKwitansiFields,
    updateKwitansiReceiver,
    createProjectCustomNote,
    totalsByStage,
  };
}
