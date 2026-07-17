"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { ArrowRight, Building2, CircleDollarSign, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { MotionPage } from "@/components/ui/motion-page";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useKdkmpStore } from "@/hooks/use-kdkmp-store";
import { DEFAULT_PROJECT_START_DATE } from "@/lib/project-date-shift";
import { buildProjectSummary } from "@/lib/resume-calculations";
import { latestEditedProject } from "@/lib/resume-history";
import { ProjectFormValues, projectSchema } from "@/schemas/project.schema";
import { formatDateIndonesia, formatRupiah } from "@/utils/format";

const DEFAULT_BUDGET_REFERENCE_VALUE = "__default_budget_template__";

export function NewProjectForm() {
  const router = useRouter();
  const { createProject, loading, projects, supabaseReady } = useKdkmpStore();
  const [saving, setSaving] = useState(false);
  const [budgetReferenceValue, setBudgetReferenceValue] = useState<string>();
  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      projectName: "Pembangunan Gedung KDKMP",
      villageName: "",
      districtName: "",
      regencyName: "Cianjur",
      regionName: "KODIM 0608/CIANJUR",
      responsibleName: "",
      projectDate: DEFAULT_PROJECT_START_DATE,
    },
  });
  const projectDateValue = form.watch("projectDate");
  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => a.villageName.localeCompare(b.villageName, "id")),
    [projects],
  );
  const projectBudgetSummaries = useMemo(
    () => new Map(projects.map((project) => [project.id, buildProjectSummary(project, [])])),
    [projects],
  );
  const fallbackReferenceProject = useMemo(() => latestEditedProject(projects), [projects]);
  const selectedReferenceProject = budgetReferenceValue && budgetReferenceValue !== DEFAULT_BUDGET_REFERENCE_VALUE
    ? projects.find((project) => project.id === budgetReferenceValue) ?? null
    : null;
  const effectiveReferenceProject = budgetReferenceValue === undefined
    ? fallbackReferenceProject
    : selectedReferenceProject;
  const effectiveReferenceSummary = effectiveReferenceProject
    ? projectBudgetSummaries.get(effectiveReferenceProject.id)
    : null;
  const usesTemplateDefault = budgetReferenceValue === DEFAULT_BUDGET_REFERENCE_VALUE
    || (budgetReferenceValue === undefined && !fallbackReferenceProject);
  const usesHistoryFallback = budgetReferenceValue === undefined && Boolean(fallbackReferenceProject);

  async function submit(values: ProjectFormValues) {
    setSaving(true);
    try {
      const budgetReferenceProjectId = budgetReferenceValue === undefined
        ? undefined
        : budgetReferenceValue === DEFAULT_BUDGET_REFERENCE_VALUE
          ? null
          : budgetReferenceValue;
      const project = await createProject(values, { budgetReferenceProjectId });
      router.push(`/projects/${project.id}/resume`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menyimpan project.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <MotionPage>
      <div className="mx-auto max-w-3xl">
        <Card>
          <CardHeader>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200">
              <Building2 className="h-6 w-6" />
            </div>
            <CardTitle className="text-xl">Tambah Desa</CardTitle>
            <CardDescription>
              Project baru memakai Master Template aktif. Qty dan harga satuan dapat mengikuti anggaran desa referensi.
              {!supabaseReady ? " Supabase belum dikonfigurasi, data hanya menjadi cache sementara." : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={form.handleSubmit(submit)} className="grid gap-4 md:grid-cols-2">
              {[
                ["projectName", "Nama Project"],
                ["villageName", "Nama Desa"],
                ["districtName", "Kecamatan"],
                ["regencyName", "Kabupaten"],
                ["regionName", "Wilayah"],
                ["responsibleName", "Nama Babinsa / Penanggung Jawab"],
                ["projectDate", "Tanggal Awal Project"],
              ].map(([name, label]) => (
                <label key={name} className="space-y-2">
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {label}{name === "responsibleName" || name === "projectDate" ? " *" : ""}
                  </span>
                  {name === "projectDate" ? (
                    <>
                      <input type="hidden" value={projectDateValue} readOnly {...form.register("projectDate")} />
                      <DateInput
                        value={projectDateValue}
                        required
                        onValueChange={(value) => form.setValue("projectDate", value, { shouldDirty: true, shouldValidate: true })}
                        onInvalidDate={() => toast.error("Format tanggal harus dd/mm/yyyy.")}
                      />
                    </>
                  ) : (
                    <Input
                      type="text"
                      required={name === "responsibleName"}
                      placeholder={name === "responsibleName" ? "Contoh: Sigit Soegiarto" : undefined}
                      {...form.register(name as keyof ProjectFormValues)}
                    />
                  )}
                  {form.formState.errors[name as keyof ProjectFormValues]?.message ? (
                    <span className="text-xs text-red-600">{form.formState.errors[name as keyof ProjectFormValues]?.message}</span>
                  ) : null}
                </label>
              ))}
              <div className="space-y-2 md:col-span-2">
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  Referensi Anggaran Dari Desa
                </span>
                <Select
                  value={budgetReferenceValue}
                  onValueChange={setBudgetReferenceValue}
                  disabled={saving || loading}
                >
                  <SelectTrigger>
                    <SelectValue className="truncate text-left" placeholder={loading ? "Memuat daftar desa..." : "Pilih referensi anggaran (opsional)"} />
                  </SelectTrigger>
                  <SelectContent className="max-w-[calc(100vw-2rem)]">
                    <SelectItem className="whitespace-normal" value={DEFAULT_BUDGET_REFERENCE_VALUE}>
                      Default / Template Awal - Qty & harga bawaan
                    </SelectItem>
                    {sortedProjects.map((project) => (
                      <SelectItem className="whitespace-normal" key={project.id} value={project.id}>
                        {project.villageName} - Kec. {project.districtName} - {formatRupiah(projectBudgetSummaries.get(project.id)?.grandTotal ?? 0)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Pilih desa untuk menyalin qty dan harga satuannya. Keterangan di bawah menunjukkan anggaran yang benar-benar akan dipakai.
                </p>
                <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 dark:border-blue-900 dark:bg-blue-950/30">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200">
                      <CircleDollarSign className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        {usesTemplateDefault
                          ? "Anggaran: Default / Template Awal"
                          : usesHistoryFallback
                            ? `Anggaran otomatis dari ${effectiveReferenceProject?.villageName ?? "desa terakhir"}`
                            : `Anggaran dari ${effectiveReferenceProject?.villageName ?? "desa referensi"}`}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">
                        {usesTemplateDefault
                          ? "Qty dan harga satuan memakai nilai bawaan Master Template aktif."
                          : `${effectiveReferenceProject?.projectName ?? "Project"}, Kec. ${effectiveReferenceProject?.districtName ?? "-"}. ${usesHistoryFallback ? "Pilihan masih kosong, jadi sistem memakai history desa terakhir sesuai fallback lama." : "Desa ini dipilih sebagai sumber anggaran."}`}
                      </p>
                    </div>
                  </div>

                  {effectiveReferenceProject && effectiveReferenceSummary ? (
                    <>
                      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        <BudgetReferenceMetric label="Total Anggaran" value={formatRupiah(effectiveReferenceSummary.grandTotal)} />
                        <BudgetReferenceMetric label="Jumlah Item" value={`${effectiveReferenceProject.items.length.toLocaleString("id-ID")} item`} />
                        <BudgetReferenceMetric
                          label="Target Resume"
                          value={typeof effectiveReferenceProject.targetGrandTotal === "number" && Number.isFinite(effectiveReferenceProject.targetGrandTotal)
                            ? formatRupiah(effectiveReferenceProject.targetGrandTotal)
                            : "Belum diisi"}
                        />
                        <BudgetReferenceMetric label="Terakhir Diperbarui" value={formatDateIndonesia(effectiveReferenceProject.updatedAt) || "-"} />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {effectiveReferenceSummary.stages.map((stage) => (
                          <span key={stage.stageCode} className="rounded-lg border border-blue-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:border-blue-900 dark:bg-slate-950 dark:text-slate-200">
                            {stage.label}: {formatRupiah(stage.total)}
                          </span>
                        ))}
                      </div>
                    </>
                  ) : null}

                  <p className="mt-3 border-t border-blue-200 pt-3 text-xs font-medium text-blue-800 dark:border-blue-900 dark:text-blue-200">
                    Hanya Qty/Volume dan Harga Satuan yang disalin. Nama desa, Babinsa, tanggal project, nota, dan kwitansi tetap mengikuti desa baru.
                  </p>
                </div>
              </div>
              <div className="md:col-span-2">
                <Button type="submit" className="w-full sm:w-auto" disabled={saving || loading}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                  {saving ? "Menyimpan" : loading ? "Memuat Data Desa" : "Simpan & Lanjut Resume"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </MotionPage>
  );
}

function BudgetReferenceMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-blue-100 bg-white/80 p-2.5 dark:border-blue-900 dark:bg-slate-950/80">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100">{value}</p>
    </div>
  );
}
