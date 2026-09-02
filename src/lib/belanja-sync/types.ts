export const BELANJA_JOB_STATUSES = [
  "pending",
  "processing",
  "completed",
  "completed_with_errors",
  "failed",
  "cancelled",
] as const;

export const BELANJA_ITEM_STATUSES = [
  "pending",
  "processing",
  "success",
  "failed",
  "skipped",
  "needs_review",
] as const;

export type BelanjaSyncJobStatus = (typeof BELANJA_JOB_STATUSES)[number];
export type BelanjaSyncItemStatus = (typeof BELANJA_ITEM_STATUSES)[number];

export type BelanjaPayload = {
  sourceItemId: string;
  projectId: string;
  tanggal: string;
  namaItem: string;
  qty: number;
  satuan: string;
  hargaSatuan: number;
  jumlah: number;
  desa?: string;
  kecamatan?: string;
  kabupaten?: string;
  tahap?: string;
  categoryCode?: string;
  kategori?: string;
  expenseType?: "material" | "labor" | "equipment";
  vendor?: string;
  durationDays?: number | null;
  keterangan?: string;
};

export type BelanjaPayloadValidation = {
  valid: boolean;
  errors: string[];
  computedJumlah: number;
  difference: number;
};

export type BelanjaSyncJob = {
  id: string;
  projectId: string;
  status: BelanjaSyncJobStatus;
  dryRun: boolean;
  totalItems: number;
  successItems: number;
  failedItems: number;
  skippedItems: number;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  errorMessage?: string | null;
  metadataJson?: Record<string, unknown>;
};

export type BelanjaSyncItem = {
  id: string;
  jobId: string;
  projectId: string;
  sourceResumeItemId: string;
  status: BelanjaSyncItemStatus;
  attemptCount: number;
  maxAttempts: number;
  targetReference?: string | null;
  payload: BelanjaPayload;
  errorMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  metadataJson?: Record<string, unknown>;
};

export type BelanjaRunnerHeartbeat = {
  runnerId: string;
  status: "ready" | "busy" | "paused" | "error";
  targetStatus: "unknown" | "connected" | "disconnected";
  dryRun: boolean;
  lastSeenAt: string;
  online: boolean;
  targetBaseUrl?: string | null;
  message?: string | null;
};

export type BelanjaProjectSyncState = {
  projectId: string;
  schemaReady: boolean;
  jobs: BelanjaSyncJob[];
  items: BelanjaSyncItem[];
  latestBySourceItemId: Record<string, BelanjaSyncItem>;
  runner: BelanjaRunnerHeartbeat | null;
  errorMessage?: string | null;
};

export type BelanjaSyncOverviewProject = {
  projectId: string;
  status: "belum_dikirim" | "sebagian" | "selesai" | "ada_error";
  totalItems: number;
  successItems: number;
  failedItems: number;
  pendingItems: number;
  failedDetails?: Array<{
    sourceResumeItemId: string;
    itemName: string;
    tanggal: string;
    jumlah: number;
    status: Extract<BelanjaSyncItemStatus, "failed" | "needs_review">;
    errorMessage: string;
    updatedAt: string;
  }>;
};

export type CreateBelanjaSyncJobInput = {
  projectId: string;
  itemIds: string[];
  dryRun?: boolean;
  forceResend?: boolean;
};

export type ClaimedBelanjaSyncItem = {
  job: BelanjaSyncJob;
  item: BelanjaSyncItem;
};
