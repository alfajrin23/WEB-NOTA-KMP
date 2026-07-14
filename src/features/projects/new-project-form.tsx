"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { ArrowRight, Building2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MotionPage } from "@/components/ui/motion-page";
import { useKdkmpStore } from "@/hooks/use-kdkmp-store";
import { DEFAULT_PROJECT_START_DATE } from "@/lib/project-date-shift";
import { ProjectFormValues, projectSchema } from "@/schemas/project.schema";

export function NewProjectForm() {
  const router = useRouter();
  const { createProject, supabaseReady } = useKdkmpStore();
  const [saving, setSaving] = useState(false);
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

  async function submit(values: ProjectFormValues) {
    setSaving(true);
    try {
      const project = await createProject(values);
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
              Project baru otomatis menyalin Master Template aktif dan disimpan ke Supabase.
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
                  <Input
                    type={name === "projectDate" ? "date" : "text"}
                    required={name === "responsibleName" || name === "projectDate"}
                    placeholder={name === "responsibleName" ? "Contoh: Sigit Soegiarto" : undefined}
                    {...form.register(name as keyof ProjectFormValues)}
                  />
                  {form.formState.errors[name as keyof ProjectFormValues]?.message ? (
                    <span className="text-xs text-red-600">{form.formState.errors[name as keyof ProjectFormValues]?.message}</span>
                  ) : null}
                </label>
              ))}
              <div className="md:col-span-2">
                <Button type="submit" className="w-full sm:w-auto" disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                  {saving ? "Menyimpan" : "Simpan & Lanjut Resume"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </MotionPage>
  );
}
