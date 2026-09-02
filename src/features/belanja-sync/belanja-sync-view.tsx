"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, RefreshCcw, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MotionPage } from "@/components/ui/motion-page";
import type { BelanjaRunnerHeartbeat, BelanjaSyncOverviewProject } from "@/lib/belanja-sync/types";
import { useKdkmpStore } from "@/hooks/use-kdkmp-store";
import { formatProjectWilayah, formatDateTimeIndonesia } from "@/utils/format";

type OverviewPayload = {
  schemaReady: boolean;
  runner: BelanjaRunnerHeartbeat | null;
  projects: BelanjaSyncOverviewProject[];
  errorMessage?: string;
};

function statusLabel(status: BelanjaSyncOverviewProject["status"]) {
  if (status === "selesai") return "Selesai";
  if (status === "sebagian") return "Sebagian";
  if (status === "ada_error") return "Ada Error";
  return "Belum Dikirim";
}

function statusClass(status: BelanjaSyncOverviewProject["status"]) {
  if (status === "selesai") return "bg-emerald-50 text-emerald-700";
  if (status === "sebagian") return "bg-blue-50 text-blue-700";
  if (status === "ada_error") return "bg-red-50 text-red-700";
  return "bg-slate-100 text-slate-600";
}

export function BelanjaSyncView() {
  const { projects } = useKdkmpStore();
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/belanja-sync/overview", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Gagal memuat overview Belanja Sync.");
      setOverview(payload as OverviewPayload);
    } catch (error) {
      setOverview({
        schemaReady: false,
        runner: null,
        projects: [],
        errorMessage: error instanceof Error ? error.message : "Gagal memuat overview Belanja Sync.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const overviewByProject = useMemo(
    () => new Map((overview?.projects ?? []).map((project) => [project.projectId, project])),
    [overview?.projects],
  );

  const rows = useMemo(() => {
    return projects
      .map((project) => ({ project, sync: overviewByProject.get(project.id) }))
      .sort((a, b) => {
        const score = (row: typeof a) => row.sync?.status === "ada_error" ? 0 : row.sync?.status === "sebagian" ? 1 : row.sync?.status === "selesai" ? 3 : 2;
        return score(a) - score(b) || a.project.villageName.localeCompare(b.project.villageName);
      });
  }, [overviewByProject, projects]);

  return (
    <MotionPage>
      <div className="space-y-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-normal">Belanja Sync</h2>
            <p className="text-sm text-slate-500">Queue dan status runner lokal untuk pengiriman Resume ke Web Belanja.</p>
          </div>
          <Button variant="outline" onClick={refresh} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            Refresh
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Status Runner</CardTitle>
            <CardDescription>Runner berjalan di PC Windows yang tersambung VPN, bukan di Vercel.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-4">
            <Metric label="Runner" value={overview?.runner?.online ? "Online" : "Offline"} tone={overview?.runner?.online ? "ok" : "default"} />
            <Metric label="Target" value={overview?.runner?.targetStatus ?? "unknown"} tone={overview?.runner?.targetStatus === "connected" ? "ok" : "warn"} />
            <Metric label="Mode" value={overview?.runner?.dryRun === false ? "LIVE" : "DRY RUN"} tone={overview?.runner?.dryRun === false ? "warn" : "default"} />
            <Metric label="Heartbeat" value={overview?.runner ? formatDateTimeIndonesia(overview.runner.lastSeenAt) : "-"} />
          </CardContent>
        </Card>

        {!overview?.schemaReady ? (
          <Card className="border-amber-200 dark:border-amber-900">
            <CardContent className="p-5 text-sm text-amber-800 dark:text-amber-100">
              {overview?.errorMessage ?? "Migration Belanja Sync belum dijalankan atau SUPABASE_SERVICE_ROLE_KEY belum tersedia di server."}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Progress Per Desa</CardTitle>
            <CardDescription>Buka Resume desa untuk memilih item dan membuat job pengiriman.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="bg-slate-100 text-xs uppercase text-slate-500 dark:bg-slate-900">
                  <tr>
                    <th className="px-4 py-3">Desa</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Success</th>
                    <th className="px-4 py-3 text-right">Gagal</th>
                    <th className="px-4 py-3 text-right">Pending</th>
                    <th className="px-4 py-3">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-900">
                  {rows.map(({ project, sync }) => (
                    <tr key={project.id} className="bg-white dark:bg-slate-950">
                      <td className="px-4 py-3">
                        <p className="font-semibold">{formatProjectWilayah(project)}</p>
                        <p className="text-xs text-slate-500">Kec. {project.districtName}, Kab. {project.regencyName}</p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={statusClass(sync?.status ?? "belum_dikirim")}>{statusLabel(sync?.status ?? "belum_dikirim")}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right">{sync?.successItems ?? 0}</td>
                      <td className="px-4 py-3 text-right">{sync?.failedItems ?? 0}</td>
                      <td className="px-4 py-3 text-right">{sync?.pendingItems ?? 0}</td>
                      <td className="px-4 py-3">
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/projects/${project.id}/resume`}><Send className="h-4 w-4" />Buka Resume</Link>
                        </Button>
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

function Metric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "ok" | "warn" }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className={tone === "ok" ? "mt-1 font-bold text-emerald-700" : tone === "warn" ? "mt-1 font-bold text-amber-700" : "mt-1 font-bold"}>{value}</p>
    </div>
  );
}
