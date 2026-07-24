"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ArrowDownUp, Copy, FileText, Plus, ReceiptText, Search, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { MotionPage } from "@/components/ui/motion-page";
import { useKdkmpStore } from "@/hooks/use-kdkmp-store";
import { STAGES } from "@/constants/stages";
import { groupDocumentsForPresentation } from "@/lib/pln-document-groups";
import { buildProjectSummary, validateProjectResume } from "@/lib/resume-calculations";
import { formatProjectWilayah, formatRupiah } from "@/utils/format";

const colors = ["#2563eb", "#10b981", "#0f766e", "#38bdf8", "#64748b"];

export function DashboardView() {
  const { projects, vendors, templateAssignments, generatedNotas, duplicateProject, deleteProject, hydrated, loading } = useKdkmpStore();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"newest" | "name" | "total">("newest");
  const documentEntries = useMemo(() => groupDocumentsForPresentation(generatedNotas), [generatedNotas]);

  const projectSummaries = useMemo(() => {
    return projects.map((project) => ({
      project,
      summary: buildProjectSummary(project, vendors),
      issues: validateProjectResume(project, vendors, templateAssignments),
    }));
  }, [projects, templateAssignments, vendors]);

  const rows = useMemo(() => {
    return projectSummaries
      .map(({ project, summary, issues }) => ({
        ...project,
        total: summary.grandTotal,
        warnings: issues.length,
        notaCount: documentEntries.filter((entry) => entry.primaryDoc.projectId === project.id).length,
      }))
      .filter((project) => `${project.villageName} ${project.districtName} ${project.regencyName}`.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => {
        if (sort === "name") return a.villageName.localeCompare(b.villageName);
        if (sort === "total") return b.total - a.total;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
  }, [documentEntries, projectSummaries, query, sort]);

  const totalNominal = projectSummaries.reduce((sum, row) => sum + row.summary.grandTotal, 0);
  const allIssues = projectSummaries.flatMap(({ project, issues }) => issues.map((issue) => ({ ...issue, project })));
  const stageTotals = STAGES.map((stage) => ({
    ...stage,
    total: projectSummaries.reduce(
      (sum, row) => sum + (row.summary.stages.find((entry) => entry.stageCode === stage.code)?.total ?? 0),
      0,
    ),
  }));

  const chartByStage = useMemo(() => {
    return stageTotals.map((stage) => ({ name: stage.shortLabel, total: stage.total }));
  }, [stageTotals]);

  const notaStatus = useMemo(() => {
    const map = new Map<string, { stage: string; vendor: string; count: number; total: number }>();
    for (const entry of documentEntries) {
      const nota = entry.primaryDoc;
      const key = `${nota.stageCode}-${nota.vendorId}`;
      const current = map.get(key) ?? { stage: nota.stageName, vendor: nota.vendorName, count: 0, total: 0 };
      current.count += 1;
      current.total += entry.totalAmount;
      map.set(key, current);
    }
    return [...map.values()].sort((a, b) => a.stage.localeCompare(b.stage) || a.vendor.localeCompare(b.vendor));
  }, [documentEntries]);

  if (!hydrated || loading) {
    return <DashboardSkeleton />;
  }

  const cards = [
    { label: "Total Wilayah", value: projects.length.toString(), icon: Users, tone: "text-blue-600" },
    { label: "Total Nominal", value: formatRupiah(totalNominal), icon: FileText, tone: "text-emerald-600" },
    { label: "Total Nota", value: documentEntries.length.toString(), icon: ReceiptText, tone: "text-sky-600" },
    { label: "Total Vendor", value: vendors.length.toString(), icon: Users, tone: "text-slate-600" },
  ];

  return (
    <MotionPage>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-normal">Dashboard</h2>
            <p className="text-sm text-slate-500">Pantau project wilayah, nominal, vendor, dan nota yang siap dicetak.</p>
          </div>
          <Button asChild>
            <Link href="/tambah-desa">
              <Plus className="h-4 w-4" />
              Tambah Desa / Kelurahan
            </Link>
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <Card key={card.label} className="overflow-hidden">
                <CardHeader className="flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm text-slate-500">{card.label}</CardTitle>
                  <Icon className={`h-5 w-5 ${card.tone}`} />
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold tracking-normal">{card.value}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          {stageTotals.map((stage) => (
            <Card key={stage.code}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-500">{stage.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-lg font-bold tracking-normal">{formatRupiah(stage.total)}</p>
              </CardContent>
            </Card>
          ))}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-500">Total Keseluruhan</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-lg font-bold tracking-normal">{formatRupiah(totalNominal)}</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.45fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Chart Total Pengeluaran</CardTitle>
            </CardHeader>
            <CardContent className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartByStage}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={(value) => `${Number(value) / 1000000} jt`} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(value) => formatRupiah(Number(value))} />
                  <Bar dataKey="total" radius={[8, 8, 0, 0]}>
                    {chartByStage.map((_, index) => <Cell key={index} fill={colors[index % colors.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Chart Per Tahap</CardTitle>
            </CardHeader>
            <CardContent className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={chartByStage} dataKey="total" nameKey="name" innerRadius={62} outerRadius={105} paddingAngle={3}>
                    {chartByStage.map((_, index) => <Cell key={index} fill={colors[index % colors.length]} />)}
                  </Pie>
                  <Tooltip formatter={(value) => formatRupiah(Number(value))} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Status Nota per Tahap dan Vendor</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-72 overflow-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full min-w-[620px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-900">
                    <tr>
                      <th className="px-3 py-3">Tahap</th>
                      <th className="px-3 py-3">Vendor</th>
                      <th className="px-3 py-3">Nota</th>
                      <th className="px-3 py-3 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-900">
                    {notaStatus.map((row) => (
                      <tr key={`${row.stage}-${row.vendor}`}>
                        <td className="px-3 py-2">{row.stage}</td>
                        <td className="px-3 py-2 font-semibold">{row.vendor}</td>
                        <td className="px-3 py-2"><Badge>{row.count} dokumen</Badge></td>
                        <td className="px-3 py-2 text-right font-semibold">{formatRupiah(row.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                Warning Data Resume
              </CardTitle>
            </CardHeader>
            <CardContent>
              {allIssues.length === 0 ? (
                <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30">
                  Tidak ada warning aktif.
                </p>
              ) : (
                <div className="max-h-72 space-y-2 overflow-auto pr-1">
                  {allIssues.slice(0, 12).map((issue) => (
                    <Link
                      key={`${issue.project.id}-${issue.id}`}
                      href={`/projects/${issue.project.id}/resume`}
                      className="block rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 transition hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span>{issue.message}</span>
                        <Badge className={issue.severity === "error" ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-200" : "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100"}>
                          {issue.severity}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs opacity-80">{formatProjectWilayah(issue.project)}</p>
                    </Link>
                  ))}
                  {allIssues.length > 12 && <p className="text-xs text-slate-500">+{allIssues.length - 12} warning lain.</p>}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="gap-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <CardTitle>Daftar Desa / Kelurahan</CardTitle>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <Input className="pl-9 sm:w-72" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari desa/kelurahan, kecamatan, kabupaten" />
                </div>
                <Button variant="outline" onClick={() => setSort(sort === "newest" ? "name" : sort === "name" ? "total" : "newest")}>
                  <ArrowDownUp className="h-4 w-4" />
                  {sort === "newest" ? "Terbaru" : sort === "name" ? "Nama" : "Nominal"}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full min-w-[780px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-900">
                  <tr>
                    <th className="px-4 py-3">Desa / Kelurahan</th>
                    <th className="px-4 py-3">Project</th>
                    <th className="px-4 py-3">Nominal</th>
                    <th className="px-4 py-3">Nota</th>
                    <th className="px-4 py-3">Progress</th>
                    <th className="px-4 py-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {rows.map((project) => (
                    <tr key={project.id} className="bg-white transition hover:bg-slate-50 dark:bg-slate-950 dark:hover:bg-slate-900/60">
                      <td className="px-4 py-4">
                        <Link href={`/projects/${project.id}/resume`} className="font-semibold text-blue-700 hover:underline dark:text-blue-300">
                          {formatProjectWilayah(project)}
                        </Link>
                        <p className="text-xs text-slate-500">Kec. {project.districtName}, Kab. {project.regencyName}</p>
                      </td>
                      <td className="px-4 py-4">{project.projectName}</td>
                      <td className="px-4 py-4 font-semibold">{formatRupiah(project.total)}</td>
                      <td className="px-4 py-4"><Badge>{project.notaCount} dokumen</Badge></td>
                      <td className="px-4 py-4">
                        <div className="space-y-1">
                          <Progress value={project.warnings > 0 ? 65 : 100} />
                          {project.warnings > 0 && <p className="text-xs text-amber-600">{project.warnings} warning</p>}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex justify-end gap-2">
                          <Button asChild size="sm" variant="outline">
                            <Link href={`/projects/${project.id}/resume`}>Edit</Link>
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => duplicateProject(project.id)} aria-label="Duplicate project">
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => deleteProject(project.id)} aria-label="Delete project">
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      </td>
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

function DashboardSkeleton() {
  return (
    <MotionPage>
      <div className="space-y-6" aria-busy="true" aria-label="Memuat dashboard">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <Skeleton className="h-10 w-32" />
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Card key={index}>
              <CardHeader className="space-y-3">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.45fr_1fr]">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>

        <Skeleton className="h-80 w-full" />
      </div>
    </MotionPage>
  );
}
