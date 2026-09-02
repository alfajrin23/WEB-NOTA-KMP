"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Check, Clipboard, KeyRound, Laptop, Loader2, Plus, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MotionPage } from "@/components/ui/motion-page";
import { cn } from "@/lib/utils";
import type { RunnerToken } from "@/lib/runner-tokens";
import { formatDateTimeIndonesia } from "@/utils/format";

type ExpiryMode = "never" | "30" | "90" | "custom";

type RunnerTokenResponse = {
  runners?: RunnerToken[];
  runner?: RunnerToken;
  token?: string;
  error?: string;
};

function formatOptionalDate(value: string | null) {
  return value ? formatDateTimeIndonesia(value) : "Never";
}

function getRunnerStatus(runner: RunnerToken) {
  if (!runner.active || runner.revokedAt) return "Revoked";
  if (runner.expiresAt && Date.parse(runner.expiresAt) <= Date.now()) return "Expired";
  return "Active";
}

function statusClassName(status: string) {
  if (status === "Active") return "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200";
  if (status === "Expired") return "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-200";
  return "bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300";
}

function addDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

async function parseResponse(response: Response) {
  const payload = await response.json().catch(() => ({})) as RunnerTokenResponse;
  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
  return payload;
}

export function RunnerTokensView() {
  const [runners, setRunners] = useState<RunnerToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [runnerName, setRunnerName] = useState("");
  const [expiryMode, setExpiryMode] = useState<ExpiryMode>("never");
  const [customExpiry, setCustomExpiry] = useState("");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function loadRunners() {
    setLoading(true);
    try {
      const payload = await parseResponse(await fetch("/api/runner-tokens", { cache: "no-store" }));
      setRunners(payload.runners ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memuat runner token.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRunners();
  }, []);

  const activeCount = useMemo(() => runners.filter((runner) => getRunnerStatus(runner) === "Active").length, [runners]);

  function resolveExpiresAt() {
    if (expiryMode === "never") return null;
    if (expiryMode === "30") return addDays(30);
    if (expiryMode === "90") return addDays(90);
    if (!customExpiry) throw new Error("Tanggal custom expiry wajib diisi.");
    const date = new Date(`${customExpiry}T23:59:59+07:00`);
    if (!Number.isFinite(date.valueOf()) || date.getTime() <= Date.now()) throw new Error("Tanggal expiry harus valid dan berada di masa depan.");
    return date.toISOString();
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setCreatedToken(null);
    setCopied(false);
    try {
      const payload = await parseResponse(await fetch("/api/runner-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: runnerName, expiresAt: resolveExpiresAt() }),
      }));
      if (payload.runner) setRunners((current) => [payload.runner!, ...current]);
      setCreatedToken(payload.token ?? null);
      setRunnerName("");
      setExpiryMode("never");
      setCustomExpiry("");
      toast.success("Runner token berhasil dibuat.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal membuat runner token.");
    } finally {
      setCreating(false);
    }
  }

  async function revokeRunner(runner: RunnerToken) {
    if (!window.confirm(`Revoke token untuk ${runner.name}? Request berikutnya dari runner ini akan ditolak.`)) return;
    try {
      const payload = await parseResponse(await fetch(`/api/runner-tokens/${runner.id}/revoke`, { method: "POST" }));
      if (payload.runner) {
        setRunners((current) => current.map((item) => item.id === payload.runner!.id ? payload.runner! : item));
      }
      toast.success("Runner token direvoke.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal revoke runner token.");
    }
  }

  async function copyToken() {
    if (!createdToken) return;
    await navigator.clipboard.writeText(createdToken);
    setCopied(true);
    toast.success("Token disalin.");
  }

  return (
    <MotionPage>
      <div className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-normal text-slate-950 dark:text-slate-50">Playwright Runners</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">{activeCount} runner aktif dari {runners.length} token.</p>
          </div>
          <Button onClick={() => setShowCreate((value) => !value)}>
            <Plus className="h-4 w-4" />
            Create Runner Token
          </Button>
        </div>

        {showCreate ? (
          <Card>
            <CardHeader>
              <CardTitle>Create Runner Token</CardTitle>
              <CardDescription>Token plaintext hanya muncul satu kali setelah dibuat.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-4 lg:grid-cols-[1fr_1fr_auto]" onSubmit={handleCreate}>
                <label className="space-y-1.5">
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Runner Name</span>
                  <Input value={runnerName} onChange={(event) => setRunnerName(event.target.value)} placeholder="Laptop Utama" required />
                </label>
                <div className="space-y-1.5">
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Expiry</span>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                      ["never", "Never"],
                      ["30", "30 Days"],
                      ["90", "90 Days"],
                      ["custom", "Custom"],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        className={cn(
                          "h-10 rounded-xl border px-3 text-sm font-semibold transition",
                          expiryMode === value
                            ? "border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950 dark:text-blue-200"
                            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900",
                        )}
                        onClick={() => setExpiryMode(value as ExpiryMode)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <Button type="submit" className="self-end" disabled={creating}>
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                  Create
                </Button>
                {expiryMode === "custom" ? (
                  <label className="space-y-1.5 lg:col-start-2">
                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Custom Expiry</span>
                    <Input type="date" value={customExpiry} onChange={(event) => setCustomExpiry(event.target.value)} required />
                  </label>
                ) : null}
              </form>
            </CardContent>
          </Card>
        ) : null}

        {createdToken ? (
          <Card className="border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20">
            <CardHeader>
              <CardTitle>Runner token berhasil dibuat.</CardTitle>
              <CardDescription>Token ini hanya ditampilkan sekali. Simpan di `.env.belanja.local` runner Anda.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input readOnly value={createdToken} className="font-mono text-xs" />
                <Button type="button" variant="emerald" onClick={copyToken}>
                  {copied ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
                  Copy Token
                </Button>
              </div>
              <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">IMPORTANT: kalau token hilang, buat token baru dan revoke token lama.</p>
            </CardContent>
          </Card>
        ) : null}

        <div className="grid gap-3">
          {loading ? (
            <Card>
              <CardContent className="flex items-center gap-2 pt-5 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Memuat runner token...
              </CardContent>
            </Card>
          ) : runners.length === 0 ? (
            <Card>
              <CardContent className="flex items-center gap-3 pt-5 text-sm text-slate-500">
                <Laptop className="h-4 w-4" />
                Belum ada runner token.
              </CardContent>
            </Card>
          ) : runners.map((runner) => {
            const status = getRunnerStatus(runner);
            return (
              <Card key={runner.id}>
                <CardContent className="flex flex-col gap-4 pt-5 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Laptop className="h-4 w-4 text-slate-400" />
                      <h3 className="font-semibold text-slate-950 dark:text-slate-50">{runner.name}</h3>
                      <Badge className={statusClassName(status)}>{status}</Badge>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm text-slate-500 sm:grid-cols-3 dark:text-slate-400">
                      <p><span className="font-semibold text-slate-700 dark:text-slate-200">Created:</span> {formatDateTimeIndonesia(runner.createdAt)}</p>
                      <p><span className="font-semibold text-slate-700 dark:text-slate-200">Last Used:</span> {formatOptionalDate(runner.lastUsedAt)}</p>
                      <p><span className="font-semibold text-slate-700 dark:text-slate-200">Expires:</span> {formatOptionalDate(runner.expiresAt)}</p>
                    </div>
                  </div>
                  <Button type="button" variant="destructive" onClick={() => void revokeRunner(runner)} disabled={status !== "Active"}>
                    <ShieldOff className="h-4 w-4" />
                    Revoke
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </MotionPage>
  );
}
