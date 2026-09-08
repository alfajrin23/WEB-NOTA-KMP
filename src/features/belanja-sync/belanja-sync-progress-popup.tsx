"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  CopyCheck,
  Loader2,
  Send,
  ShieldCheck,
  X,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchBelanjaSyncProgress,
  readCachedBelanjaSyncProgress,
  type BelanjaSyncProgressSnapshot,
} from "@/lib/belanja-sync/client-progress";
import type { BelanjaCopyReconcileStage, BelanjaSyncJob } from "@/lib/belanja-sync/types";
import { cn } from "@/lib/utils";

const TERMINAL_FRESH_MS = 16_000;
const ACTIVE_POLL_MS = 6_000;
const BELANJA_PAGE_IDLE_POLL_MS = 10_000;
const GLOBAL_IDLE_POLL_MS = 300_000;

const STAGE_LABELS: Record<BelanjaCopyReconcileStage, string> = {
  PRE_FLIGHT: "Menyiapkan pengiriman",
  SOURCE_OPENED: "Membuka template Maleber",
  SOURCE_SELECTED: "Template sumber dipilih",
  COPY_STARTED: "Menyalin transaksi",
  COPY_CONFIRMED: "Salinan dikonfirmasi",
  DESTINATION_COPIED: "Data tujuan siap",
  RECONCILING: "Menyesuaikan data Resume",
  VERIFYING: "Memverifikasi anggaran",
  COMPLETED: "Pengiriman selesai",
  FAILED: "Pengiriman gagal",
};

function isActive(job: BelanjaSyncJob) {
  return job.status === "pending" || job.status === "processing";
}

function isSuccessful(job: BelanjaSyncJob) {
  return job.status === "completed" && job.failedItems === 0;
}

function isTerminal(job: BelanjaSyncJob) {
  return job.status === "completed"
    || job.status === "completed_with_errors"
    || job.status === "failed"
    || job.status === "cancelled";
}

function finishedRecently(job: BelanjaSyncJob, now: number) {
  if (!job.finishedAt) return false;
  const finishedAt = new Date(job.finishedAt).getTime();
  return Number.isFinite(finishedAt) && now - finishedAt <= TERMINAL_FRESH_MS;
}

function jobProgress(job: BelanjaSyncJob) {
  if (isTerminal(job)) return 100;
  const current = job.progress?.current;
  const total = job.progress?.total;
  if (typeof current === "number" && typeof total === "number" && total > 0) {
    return Math.min(100, Math.max(0, Math.round((current / total) * 100)));
  }
  if (job.totalItems <= 0) return 0;
  const done = job.successItems + job.failedItems + job.skippedItems;
  return Math.min(100, Math.max(0, Math.round((done / job.totalItems) * 100)));
}

function progressDetail(job: BelanjaSyncJob) {
  const current = job.progress?.current;
  const total = job.progress?.total;
  if (typeof current === "number" && typeof total === "number" && total > 0) {
    return `${current} dari ${total} transaksi`;
  }
  return `${job.successItems + job.failedItems + job.skippedItems} dari ${job.totalItems} item`;
}

function stageLabel(job: BelanjaSyncJob) {
  if (job.status === "completed_with_errors") return "Selesai dengan beberapa error";
  if (job.status === "cancelled") return "Pengiriman dibatalkan";
  if (job.status === "failed") return "Pengiriman gagal";
  if (isSuccessful(job)) return "Semua data berhasil dikirim";
  if (job.stage && STAGE_LABELS[job.stage]) return STAGE_LABELS[job.stage];
  if (job.status === "pending") return "Menunggu runner mengambil job";
  return "Sedang mengirim ke Web Belanja";
}

function destinationLabel(job: BelanjaSyncJob) {
  const destination = job.report?.destination;
  if (!destination) return null;
  return [destination.village, destination.district, destination.regency].filter(Boolean).join(" • ");
}

function projectLabel(job: BelanjaSyncJob) {
  const village = job.report?.destination?.village;
  return village ? `Desa ${village}` : "Pengiriman Resume ke Web Belanja";
}

function visibleJob(snapshot: BelanjaSyncProgressSnapshot | null, now: number) {
  const job = snapshot?.job ?? null;
  if (!job) return null;
  if (isActive(job)) return job;
  return isTerminal(job) && finishedRecently(job, now) ? job : null;
}

function idlePollInterval() {
  if (typeof window === "undefined") return GLOBAL_IDLE_POLL_MS;
  return window.location.pathname.startsWith("/belanja-sync")
    ? BELANJA_PAGE_IDLE_POLL_MS
    : GLOBAL_IDLE_POLL_MS;
}

export function BelanjaSyncProgressPopup() {
  const [snapshot, setSnapshot] = useState<BelanjaSyncProgressSnapshot | null>(() => readCachedBelanjaSyncProgress());
  const [now, setNow] = useState(() => Date.now());
  const [dismissedJobId, setDismissedJobId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const payload = await fetchBelanjaSyncProgress(5_000);
      setSnapshot(payload);
      setNow(Date.now());
    } catch {
      setNow(Date.now());
    }
  }, []);

  const job = useMemo(() => visibleJob(snapshot, now), [now, snapshot]);
  const hasActiveJob = Boolean(job && isActive(job));

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!hasActiveJob) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, ACTIVE_POLL_MS);
    return () => window.clearInterval(interval);
  }, [hasActiveJob, refresh]);

  useEffect(() => {
    if (hasActiveJob) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, idlePollInterval());
    return () => window.clearInterval(interval);
  }, [hasActiveJob, refresh]);

  useEffect(() => {
    const handleFocus = () => void refresh();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refresh]);

  useEffect(() => {
    const latestJob = snapshot?.job;
    if (!latestJob || !isTerminal(latestJob) || !latestJob.finishedAt) return;
    const finishedAt = Date.parse(latestJob.finishedAt);
    if (!Number.isFinite(finishedAt)) return;
    const remaining = Math.max(0, TERMINAL_FRESH_MS - (Date.now() - finishedAt));
    const timeout = window.setTimeout(() => setNow(Date.now()), remaining + 50);
    return () => window.clearTimeout(timeout);
  }, [snapshot?.job]);

  useEffect(() => {
    if (job && job.id !== dismissedJobId && isActive(job)) setDismissedJobId(null);
  }, [dismissedJobId, job]);

  const visible = Boolean(job && job.id !== dismissedJobId);
  const progress = useMemo(() => (job ? jobProgress(job) : 0), [job]);
  const success = job ? isSuccessful(job) : false;
  const failed = job?.status === "failed" || job?.status === "cancelled";
  const warning = Boolean(job && !failed && (job.status === "completed_with_errors" || job.failedItems > 0));
  const runnerOnline = snapshot?.runner?.online ?? false;
  const targetConnected = snapshot?.runner?.targetStatus === "connected";
  const pendingBlocked = job?.status === "pending" && (!runnerOnline || !targetConnected);

  const message = job?.stageMessage || job?.progress?.message || (pendingBlocked
    ? !runnerOnline
      ? "Runner lokal belum online. Jalankan runner pada PC yang terhubung VPN."
      : "Runner online, tetapi koneksi ke website target belum tersambung."
    : job
      ? stageLabel(job)
      : "");

  const Icon = success
    ? CheckCircle2
    : failed
      ? XCircle
      : warning
        ? AlertTriangle
        : job?.status === "pending"
          ? Clock3
          : Loader2;

  const accentClass = success
    ? "bg-emerald-500"
    : failed
      ? "bg-red-500"
      : warning
        ? "bg-amber-500"
        : "bg-blue-500";

  const reportDifference = job?.report?.totalDifference;
  const destination = job ? destinationLabel(job) : null;

  return (
    <AnimatePresence>
      {visible && job ? (
        <motion.aside
          key={job.id}
          initial={{ opacity: 0, x: 40, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
          exit={{ opacity: 0, x: 30, y: 12, scale: 0.97 }}
          transition={{ type: "spring", stiffness: 420, damping: 32 }}
          className={cn(
            "fixed bottom-4 left-4 right-4 z-[120] overflow-hidden rounded-2xl border bg-white/95 shadow-2xl shadow-slate-950/20 backdrop-blur-xl dark:bg-slate-950/95 sm:left-auto sm:w-[390px]",
            success && "border-emerald-200 dark:border-emerald-900",
            failed && "border-red-200 dark:border-red-900",
            warning && "border-amber-200 dark:border-amber-900",
            !success && !failed && !warning && "border-blue-200 dark:border-blue-900",
          )}
          aria-live="polite"
          aria-atomic="true"
        >
          <motion.div
            className={cn("h-1 origin-left", accentClass)}
            animate={{ scaleX: Math.max(progress, 2) / 100 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
          />

          <div className="relative p-4">
            {!success && !failed && !warning && isActive(job) ? (
              <motion.div
                className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-blue-400/10"
                animate={{ scale: [1, 1.28, 1], opacity: [0.3, 0.65, 0.3] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
              />
            ) : null}

            <div className="flex items-start gap-3">
              <div className={cn(
                "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
                success && "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
                failed && "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
                warning && "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
                !success && !failed && !warning && "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
              )}>
                {isActive(job) && !failed && !warning ? (
                  <motion.span
                    className="absolute inset-0 rounded-full border-2 border-current opacity-25"
                    animate={{ scale: [1, 1.35], opacity: [0.3, 0] }}
                    transition={{ duration: 1.4, repeat: Infinity }}
                  />
                ) : null}
                <Icon className={cn("h-5 w-5", job.status === "processing" && !failed && !warning && "animate-spin")} />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-bold text-slate-900 dark:text-slate-50">{stageLabel(job)}</p>
                      <span className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                        job.dryRun
                          ? "bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
                      )}>
                        {job.dryRun ? "Dry Run" : "Live"}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs font-semibold text-slate-600 dark:text-slate-300">{projectLabel(job)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDismissedJobId(job.id)}
                    className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    aria-label="Tutup progress pengiriman"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <p className="mt-2 text-sm leading-5 text-slate-600 dark:text-slate-300">{message}</p>
                <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
                  <Send className="h-3.5 w-3.5" />
                  <span className="truncate">{destination ? `Tujuan: ${destination}` : "Tujuan: Web Belanja"}</span>
                </div>

                <div className="mt-3">
                  <div className="mb-1.5 flex items-center justify-between text-xs font-semibold">
                    <span className="text-slate-500">{progressDetail(job)}</span>
                    <motion.span
                      key={progress}
                      initial={{ scale: 0.82, opacity: 0.55 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className={cn(
                        success && "text-emerald-600",
                        failed && "text-red-600",
                        warning && "text-amber-600",
                        !success && !failed && !warning && "text-blue-600",
                      )}
                    >
                      {progress}%
                    </motion.span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <motion.div
                      className={cn("h-full rounded-full", accentClass)}
                      animate={{ width: `${progress}%` }}
                      transition={{ duration: 0.45, ease: "easeOut" }}
                    />
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px]">
                  <div className="rounded-lg bg-emerald-50 px-2 py-1.5 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                    <CheckCircle2 className="mx-auto mb-0.5 h-3.5 w-3.5" />
                    <span className="font-bold">{job.successItems}</span> sukses
                  </div>
                  <div className="rounded-lg bg-slate-50 px-2 py-1.5 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                    <CopyCheck className="mx-auto mb-0.5 h-3.5 w-3.5" />
                    <span className="font-bold">{job.skippedItems}</span> skip
                  </div>
                  <div className={cn(
                    "rounded-lg px-2 py-1.5",
                    job.failedItems > 0
                      ? "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300"
                      : "bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-400",
                  )}>
                    <AlertTriangle className="mx-auto mb-0.5 h-3.5 w-3.5" />
                    <span className="font-bold">{job.failedItems}</span> gagal
                  </div>
                </div>

                {success ? (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    {reportDifference === 0
                      ? "Progress selesai. Anggaran target terverifikasi tanpa selisih."
                      : "Progress selesai dan data berhasil dikirim ke web target."}
                  </motion.div>
                ) : null}
              </div>
            </div>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
