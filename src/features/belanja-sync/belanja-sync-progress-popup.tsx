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
import { useEffect, useMemo, useState } from "react";
import type { BelanjaCopyReconcileStage, BelanjaSyncJob } from "@/lib/belanja-sync/types";
import { cn } from "@/lib/utils";

const TERMINAL_FRESH_MS = 90_000;

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

function finishedRecently(job: BelanjaSyncJob) {
  if (!job.finishedAt) return false;
  const finishedAt = new Date(job.finishedAt).getTime();
  return Number.isFinite(finishedAt) && Date.now() - finishedAt <= TERMINAL_FRESH_MS;
}

function jobProgress(job: BelanjaSyncJob) {
  const current = job.progress?.current;
  const total = job.progress?.total;
  if (typeof current === "number" && typeof total === "number" && total > 0) {
    return Math.min(100, Math.max(0, Math.round((current / total) * 100)));
  }
  if (job.totalItems <= 0) return job.status === "completed" ? 100 : 0;
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
  if (job.stage && STAGE_LABELS[job.stage]) return STAGE_LABELS[job.stage];
  if (job.status === "pending") return "Menunggu runner mengambil job";
  if (job.status === "processing") return "Sedang mengirim ke Web Belanja";
  if (isSuccessful(job)) return "Semua data berhasil dikirim";
  if (job.status === "completed_with_errors") return "Selesai dengan beberapa error";
  if (job.status === "cancelled") return "Pengiriman dibatalkan";
  return "Pengiriman gagal";
}

type BelanjaSyncProgressPopupProps = {
  job: BelanjaSyncJob | null | undefined;
  projectLabel: string;
  destinationLabel?: string;
  runnerOnline?: boolean;
  targetConnected?: boolean;
};

export function BelanjaSyncProgressPopup({
  job,
  projectLabel,
  destinationLabel,
  runnerOnline = true,
  targetConnected = true,
}: BelanjaSyncProgressPopupProps) {
  const [dismissedJobId, setDismissedJobId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!job || isActive(job)) return;
    setNow(Date.now());
    const timer = window.setTimeout(() => setNow(Date.now()), TERMINAL_FRESH_MS + 250);
    return () => window.clearTimeout(timer);
  }, [job?.id, job?.status, job?.finishedAt]);

  useEffect(() => {
    if (job && job.id !== dismissedJobId && isActive(job)) setDismissedJobId(null);
  }, [dismissedJobId, job]);

  const visible = Boolean(
    job
      && job.id !== dismissedJobId
      && (isActive(job) || (job.finishedAt && now - new Date(job.finishedAt).getTime() <= TERMINAL_FRESH_MS)),
  );

  const progress = useMemo(() => (job ? jobProgress(job) : 0), [job]);
  const success = job ? isSuccessful(job) : false;
  const hasError = job ? job.status === "failed" || job.status === "completed_with_errors" || job.failedItems > 0 : false;
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
    : hasError
      ? AlertTriangle
      : job?.status === "cancelled"
        ? XCircle
        : job?.status === "pending"
          ? Clock3
          : Loader2;

  return (
    <AnimatePresence>
      {visible && job ? (
        <motion.aside
          key={job.id}
          initial={{ opacity: 0, x: 36, y: 18, scale: 0.96 }}
          animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
          exit={{ opacity: 0, x: 28, y: 12, scale: 0.97 }}
          transition={{ type: "spring", stiffness: 420, damping: 32 }}
          className={cn(
            "fixed bottom-4 left-4 right-4 z-[120] overflow-hidden rounded-2xl border bg-white/95 shadow-2xl shadow-slate-950/20 backdrop-blur-xl dark:bg-slate-950/95 sm:left-auto sm:w-[390px]",
            success && "border-emerald-200 dark:border-emerald-900",
            hasError && "border-amber-200 dark:border-amber-900",
            !success && !hasError && "border-blue-200 dark:border-blue-900",
          )}
          aria-live="polite"
          aria-atomic="true"
        >
          <motion.div
            className={cn(
              "h-1 origin-left",
              success ? "bg-emerald-500" : hasError ? "bg-amber-500" : "bg-blue-500",
            )}
            animate={{ scaleX: Math.max(progress, 2) / 100 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
          />

          <div className="relative p-4">
            {!success && !hasError && isActive(job) ? (
              <motion.div
                className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-blue-400/10"
                animate={{ scale: [1, 1.25, 1], opacity: [0.35, 0.65, 0.35] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
              />
            ) : null}

            <div className="flex items-start gap-3">
              <div className={cn(
                "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
                success && "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
                hasError && "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
                !success && !hasError && "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
              )}>
                {isActive(job) && !hasError ? (
                  <motion.span
                    className="absolute inset-0 rounded-full border-2 border-current opacity-25"
                    animate={{ scale: [1, 1.35], opacity: [0.3, 0] }}
                    transition={{ duration: 1.4, repeat: Infinity }}
                  />
                ) : null}
                <Icon className={cn("h-5 w-5", job.status === "processing" && !hasError && "animate-spin")} />
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
                    <p className="mt-0.5 truncate text-xs font-semibold text-slate-600 dark:text-slate-300">{projectLabel}</p>
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
                {destinationLabel ? (
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
                    <Send className="h-3.5 w-3.5" />
                    <span className="truncate">Tujuan: {destinationLabel}</span>
                  </div>
                ) : null}

                <div className="mt-3">
                  <div className="mb-1.5 flex items-center justify-between text-xs font-semibold">
                    <span className="text-slate-500">{progressDetail(job)}</span>
                    <motion.span
                      key={progress}
                      initial={{ scale: 0.8, opacity: 0.5 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className={cn(success ? "text-emerald-600" : hasError ? "text-amber-600" : "text-blue-600")}
                    >
                      {progress}%
                    </motion.span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <motion.div
                      className={cn(
                        "h-full rounded-full",
                        success ? "bg-emerald-500" : hasError ? "bg-amber-500" : "bg-blue-500",
                      )}
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
                    Progress selesai dan data target telah terverifikasi.
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
