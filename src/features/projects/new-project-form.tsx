"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { ArrowRight, Building2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { MotionPage } from "@/components/ui/motion-page";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useKdkmpStore } from "@/hooks/use-kdkmp-store";
import { DEFAULT_PROJECT_START_DATE } from "@/lib/project-date-shift";
import { ProjectFormValues, projectSchema } from "@/schemas/project.schema";

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
                    <SelectValue placeholder={loading ? "Memuat daftar desa..." : "Pilih referensi anggaran (opsional)"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT_BUDGET_REFERENCE_VALUE}>Default / Template Awal</SelectItem>
                    {[...projects]
                      .sort((a, b) => a.villageName.localeCompare(b.villageName, "id"))
                      .map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.villageName} — {project.districtName}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Pilih desa untuk menyalin qty dan harga satuannya. Jika dibiarkan kosong, sistem memakai history desa terakhir.
                </p>
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
