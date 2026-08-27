"use client";

import { useMemo, useState } from "react";
import { FileSpreadsheet, Search, Settings2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { MotionPage } from "@/components/ui/motion-page";
import { useKdkmpStore } from "@/hooks/use-kdkmp-store";
import { STAGES } from "@/constants/stages";
import { TEMPLATE_DEFINITIONS, findTemplateDefinition } from "@/constants/template-mapping";
import { getResumeItemAmount } from "@/lib/resume-calculations";
import { formatRupiah } from "@/utils/format";
import { ResumeItem, StageCode } from "@/types/domain";

const stages: { code: StageCode | "all"; label: string }[] = [
  { code: "all", label: "Semua" },
  ...STAGES.map((stage) => ({ code: stage.code, label: stage.label })),
];

function categoryDisplayName(item: Pick<ResumeItem, "category" | "categoryCode" | "categoryName">) {
  const code = item.categoryCode?.trim() ?? "";
  const name = (item.categoryName ?? item.category ?? "Tanpa kategori").trim();
  if (!code || name.toUpperCase().startsWith(`${code.toUpperCase()} `) || name.toUpperCase().startsWith(`${code.toUpperCase()}.`)) return name;
  return `${code} ${name}`;
}

export function MasterTemplateView() {
  const { masterItems, vendors, templateAssignments, updateMasterItem, updateTemplateAssignment } = useKdkmpStore();
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<StageCode | "all">("all");

  const rows = useMemo(() => masterItems
    .filter((item) => stage === "all" || item.stageCode === stage)
    .filter((item) => `${item.itemName} ${categoryDisplayName(item)}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => a.sortOrder - b.sortOrder), [masterItems, query, stage]);

  const mappingRows = useMemo(() => {
    return templateAssignments
      .filter((assignment) => stage === "all" || assignment.stageCode === stage)
      .map((assignment) => ({
        assignment,
        template: findTemplateDefinition(assignment.templateId),
        vendor: vendors.find((vendor) => vendor.id === assignment.vendorId),
        stageOrder: STAGES.findIndex((entry) => entry.code === assignment.stageCode),
        stageLabel: STAGES.find((entry) => entry.code === assignment.stageCode)?.label ?? assignment.stageCode,
      }))
      .sort((a, b) => a.stageOrder - b.stageOrder || (a.vendor?.name ?? "Fallback").localeCompare(b.vendor?.name ?? "Fallback"));
  }, [stage, templateAssignments, vendors]);

  return (
    <MotionPage>
      <div className="space-y-5">
        <div>
          <h2 className="text-2xl font-bold tracking-normal">Template Manager</h2>
          <p className="text-sm text-slate-500">Mapping template nota/kwitansi dan master resume utama.</p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200">
                <FileSpreadsheet className="h-5 w-5" />
              </div>
              <div>
                <CardTitle>Mapping Template Vendor</CardTitle>
                <CardDescription>Alias typo lama tetap dipertahankan agar file seperti Tamplet/Tamplate masih terbaca.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Select value={stage} onValueChange={(value) => setStage(value as StageCode | "all")}>
              <SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {stages.map((entry) => <SelectItem key={entry.code} value={entry.code}>{entry.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="overflow-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="bg-slate-100 text-xs uppercase text-slate-500 dark:bg-slate-900">
                  <tr>
                    <th className="px-3 py-3">Tahap</th>
                    <th className="px-3 py-3">Vendor</th>
                    <th className="px-3 py-3">Jenis</th>
                    <th className="px-3 py-3">Template</th>
                    <th className="px-3 py-3">File utama</th>
                    <th className="px-3 py-3">Alias</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-900">
                  {mappingRows.map(({ assignment, template, vendor, stageLabel }) => (
                    <tr key={assignment.id}>
                      <td className="px-3 py-3">{stageLabel}</td>
                      <td className="px-3 py-3 font-semibold">{vendor?.name ?? "Fallback vendor"}</td>
                      <td className="px-3 py-3"><Badge>{assignment.documentType}</Badge></td>
                      <td className="px-3 py-3">
                        <Select
                          value={assignment.templateId}
                          onValueChange={(templateId) => {
                            const nextTemplate = findTemplateDefinition(templateId);
                            updateTemplateAssignment(assignment.id, {
                              templateId,
                              documentType: nextTemplate?.documentType ?? assignment.documentType,
                              preferredFileName: nextTemplate?.canonicalFileName ?? assignment.preferredFileName,
                              aliases: nextTemplate?.aliases ?? assignment.aliases,
                            });
                          }}
                        >
                          <SelectTrigger className="min-w-64"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {TEMPLATE_DEFINITIONS
                              .filter((entry) => entry.stageCodes.includes(assignment.stageCode))
                              .map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-3 py-3 text-slate-600 dark:text-slate-300">{assignment.preferredFileName ?? template?.canonicalFileName ?? "-"}</td>
                      <td className="px-3 py-3 text-xs text-slate-500">{assignment.aliases.join(", ") || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Daftar Template Tersedia</CardTitle>
            <CardDescription>Template baru bisa ditambah di konfigurasi tanpa mengubah generator nota.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {TEMPLATE_DEFINITIONS.map((template) => (
                <div key={template.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-semibold">{template.label}</h3>
                    <Badge>{template.documentType}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">{template.stageCodes.map((code) => STAGES.find((entry) => entry.code === code)?.label ?? code).join(", ")}</p>
                  <p className="mt-2 text-xs text-slate-500">Alias: {template.aliases.join(", ") || "-"}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">
                <Settings2 className="h-5 w-5" />
              </div>
              <div>
                <CardTitle>Template Resume Utama</CardTitle>
              <CardDescription>Master resume memakai rincian Excel dan mencakup Tahap 1 sampai Tahap 7.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[1fr_240px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari item template" />
              </div>
              <Select value={stage} onValueChange={(value) => setStage(value as StageCode | "all")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {stages.map((entry) => <SelectItem key={entry.code} value={entry.code}>{entry.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="overflow-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full min-w-[1080px] text-left text-sm">
                <thead className="bg-slate-100 text-xs uppercase text-slate-500 dark:bg-slate-900">
                  <tr>
                    <th className="px-3 py-3">Tahap</th>
                    <th className="px-3 py-3">Kategori</th>
                    <th className="px-3 py-3">Barang/Jasa</th>
                    <th className="px-3 py-3">Vol</th>
                    <th className="px-3 py-3">Sat</th>
                    <th className="px-3 py-3">Harga Default</th>
                    <th className="px-3 py-3">Vendor</th>
                    <th className="px-3 py-3">Jumlah</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-900">
                  {rows.map((item) => (
                    <tr key={item.id}>
                      <td className="px-3 py-2 text-xs text-slate-500">{item.stageName}</td>
                      <td className="px-3 py-2"><Input value={categoryDisplayName(item)} onChange={(event) => updateMasterItem(item.id, { category: event.target.value })} /></td>
                      <td className="px-3 py-2"><Input value={item.itemName} onChange={(event) => updateMasterItem(item.id, { itemName: event.target.value })} /></td>
                      <td className="px-3 py-2"><Input className="w-24 text-right" type="number" value={item.volume} onChange={(event) => updateMasterItem(item.id, { volume: Number(event.target.value) })} /></td>
                      <td className="px-3 py-2"><Input className="w-24" value={item.unit} onChange={(event) => updateMasterItem(item.id, { unit: event.target.value })} /></td>
                      <td className="px-3 py-2"><CurrencyInput className="w-32" value={item.unitPrice} onValueChange={(value) => updateMasterItem(item.id, { unitPrice: Number(value || 0) })} /></td>
                      <td className="px-3 py-2">
                        <select className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm dark:border-slate-800 dark:bg-slate-950" value={item.vendorId} onChange={(event) => updateMasterItem(item.id, { vendorId: event.target.value })}>
                          {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2 font-semibold">{formatRupiah(getResumeItemAmount(item))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </MotionPage>
  );
}
