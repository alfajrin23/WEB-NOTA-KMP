"use client";

import { useCallback, useRef } from "react";
import { toast } from "sonner";
import { useKdkmpStore as useBaseKdkmpStore } from "./use-kdkmp-store";
import { isSpecialPLNKwitansi } from "@/lib/pln-document-groups";
import { shiftDateLikeStringByDays, shiftTextDatesByDays } from "@/lib/project-date-shift";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  fetchProjectBundle,
  generateAndPersistKwitansi,
  generateAndPersistNotes,
  type KwitansiEditInput,
  upsertKwitansiEdit,
} from "@/lib/supabase/project-data";
import type { GeneratedNota, Project } from "@/types/domain";

type DateAnchor = "project" | "report";

type ShiftProjectDatesResult = {
  project_id: string;
  shift_days: number;
  project_date: string;
  report_date: string | null;
  shifted_items: number;
};

function shiftedKwitansiEditInput(doc: GeneratedNota, days: number): KwitansiEditInput | null {
  if (days === 0) return null;

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

function firstShiftResult(data: unknown): ShiftProjectDatesResult | null {
  if (Array.isArray(data)) {
    return (data[0] ?? null) as ShiftProjectDatesResult | null;
  }
  if (data && typeof data === "object") return data as ShiftProjectDatesResult;
  return null;
}

/**
 * Reliability layer for project/report date edits.
 *
 * The legacy store persists a start-date shift through hundreds of independent
 * REST updates. This wrapper routes date shifts through one PostgreSQL RPC, then
 * regenerates existing auto documents and refreshes only the active project.
 * All other store behavior remains delegated to the existing implementation.
 */
export function useKdkmpStore() {
  const store = useBaseKdkmpStore();
  const mutationQueuesRef = useRef(new Map<string, Promise<Project>>());

  const refreshProject = useCallback(async (projectId: string) => {
    const bundle = await fetchProjectBundle(projectId);
    const project = bundle.projects.find((entry) => entry.id === projectId);
    if (!project) throw new Error("Project tidak ditemukan setelah pembaruan tanggal.");
    await store.refresh({ background: true });
    return project;
  }, [store]);

  const runAtomicDateShift = useCallback(async (
    projectId: string,
    anchor: DateAnchor,
    nextDate: string,
  ): Promise<Project> => {
    if (!nextDate) throw new Error(anchor === "project" ? "Tanggal Awal Project wajib diisi." : "Tanggal laporan wajib diisi.");
    if (!store.supabaseReady) throw new Error("Supabase belum dikonfigurasi. Pembaruan tanggal permanen membutuhkan koneksi Supabase.");

    const client = createSupabaseBrowserClient();
    if (!client) throw new Error("Koneksi Supabase tidak tersedia.");

    const { data, error } = await client.rpc("shift_project_dates", {
      p_project_id: projectId,
      p_anchor: anchor,
      p_new_date: nextDate,
    });
    if (error) throw new Error(`Gagal memperbarui tanggal project: ${error.message}`);

    const result = firstShiftResult(data);
    if (!result) throw new Error("Supabase tidak mengembalikan hasil pembaruan tanggal.");
    const shiftDays = Number(result.shift_days ?? 0);

    // Fetch only this project. At this point project metadata + resume item dates
    // are already committed atomically by PostgreSQL.
    let bundle = await fetchProjectBundle(projectId);
    const updatedProject = bundle.projects.find((entry) => entry.id === projectId);
    if (!updatedProject) throw new Error("Project tidak ditemukan setelah tanggal diperbarui.");

    const projectDocs = bundle.generatedNotas.filter((doc) => doc.projectId === projectId && doc.source !== "custom");
    const editUpdates = projectDocs
      .map((doc) => ({ doc, input: shiftedKwitansiEditInput(doc, shiftDays) }))
      .filter((entry): entry is { doc: GeneratedNota; input: KwitansiEditInput } => Boolean(entry.input));

    // Manual kwitansi dates/descriptions should follow the same delta. A failed
    // edit carry-over must not roll back the already-consistent core project data.
    const editResults = await Promise.allSettled(
      editUpdates.map(({ doc, input }) => upsertKwitansiEdit(projectId, doc.id, input)),
    );
    const failedEditCount = editResults.filter((entry) => entry.status === "rejected").length;

    const hasNota = projectDocs.some((doc) => doc.documentType === "nota");
    const hasKwitansi = projectDocs.some((doc) => doc.documentType === "kwitansi");
    const documentErrors: string[] = [];

    if (hasNota) {
      try {
        await generateAndPersistNotes(updatedProject, store.templateAssignments);
      } catch (documentError) {
        documentErrors.push(documentError instanceof Error ? documentError.message : "Gagal regenerate nota.");
      }
    }
    if (hasKwitansi) {
      try {
        await generateAndPersistKwitansi(updatedProject, store.templateAssignments);
      } catch (documentError) {
        documentErrors.push(documentError instanceof Error ? documentError.message : "Gagal regenerate kwitansi.");
      }
    }

    // Read again after document regeneration so UI, item rows, notes, and edits
    // all converge on the same database state.
    bundle = await fetchProjectBundle(projectId);
    const finalProject = bundle.projects.find((entry) => entry.id === projectId) ?? updatedProject;
    await store.refresh({ background: true });

    if (failedEditCount > 0 || documentErrors.length > 0) {
      const details = [
        failedEditCount > 0 ? `${failedEditCount} edit kwitansi perlu dicek ulang` : "",
        ...documentErrors,
      ].filter(Boolean).join("; ");
      toast.warning(`Tanggal utama dan item sudah tersimpan. ${details}`);
    } else {
      toast.success(
        anchor === "project"
          ? `Tanggal Awal Project tersimpan dan ${result.shifted_items ?? 0} tanggal item ikut digeser ${shiftDays} hari.`
          : `Tanggal laporan tersimpan dan ${result.shifted_items ?? 0} tanggal item ikut digeser ${shiftDays} hari.`,
      );
    }

    return finalProject;
  }, [store]);

  const enqueueDateShift = useCallback((projectId: string, anchor: DateAnchor, nextDate: string) => {
    const previous = mutationQueuesRef.current.get(projectId);
    const task = (previous ? previous.catch(() => undefined) : Promise.resolve(undefined))
      .then(() => runAtomicDateShift(projectId, anchor, nextDate));

    mutationQueuesRef.current.set(projectId, task);
    void task.finally(() => {
      if (mutationQueuesRef.current.get(projectId) === task) mutationQueuesRef.current.delete(projectId);
    });
    return task;
  }, [runAtomicDateShift]);

  const saveProjectStartDateOnly = useCallback(async (projectId: string, nextProjectDate: string) => {
    const source = store.projects.find((project) => project.id === projectId);
    if (!source) throw new Error("Project tidak ditemukan.");
    if (!nextProjectDate) throw new Error("Tanggal Awal Project wajib diisi.");
    if (!store.supabaseReady) return store.updateProjectStartDate(projectId, nextProjectDate, false);

    const client = createSupabaseBrowserClient();
    if (!client) throw new Error("Koneksi Supabase tidak tersedia.");
    const reportDateFollowsProject = !source.reportDate || source.reportDate === source.projectDate;
    const nextReportDate = reportDateFollowsProject ? nextProjectDate : source.reportDate;
    const { error } = await client
      .from("projects")
      .update({
        project_date: nextProjectDate,
        tanggal_laporan: nextReportDate,
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId);
    if (error) throw new Error(`Gagal menyimpan Tanggal Awal Project: ${error.message}`);

    const project = await refreshProject(projectId);
    toast.success("Tanggal Awal Project tersimpan tanpa menggeser tanggal item.");
    return project;
  }, [refreshProject, store]);

  const updateProjectStartDate = useCallback((
    projectId: string,
    nextProjectDate: string,
    shiftExistingDates: boolean,
  ) => {
    const source = store.projects.find((project) => project.id === projectId);
    if (!source) return Promise.reject(new Error("Project tidak ditemukan."));
    if (nextProjectDate === source.projectDate) return Promise.resolve(source);

    return shiftExistingDates
      ? enqueueDateShift(projectId, "project", nextProjectDate)
      : saveProjectStartDateOnly(projectId, nextProjectDate);
  }, [enqueueDateShift, saveProjectStartDateOnly, store.projects]);

  const updateProjectMeta = useCallback((
    projectId: string,
    patch: Parameters<typeof store.updateProjectMeta>[1],
  ) => {
    const hasReportDate = Object.prototype.hasOwnProperty.call(patch, "reportDate");
    if (!hasReportDate) {
      store.updateProjectMeta(projectId, patch);
      return;
    }

    const { reportDate, ...otherPatch } = patch;
    if (Object.keys(otherPatch).length > 0) store.updateProjectMeta(projectId, otherPatch);
    if (!reportDate) {
      toast.error("Tanggal laporan wajib diisi.");
      return;
    }

    const source = store.projects.find((project) => project.id === projectId);
    const currentReportDate = source?.reportDate ?? source?.projectDate;
    if (!source || reportDate === currentReportDate) return;

    void enqueueDateShift(projectId, "report", reportDate).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Gagal memperbarui Tanggal laporan.");
    });
  }, [enqueueDateShift, store]);

  return {
    ...store,
    updateProjectMeta,
    updateProjectStartDate,
  };
}
