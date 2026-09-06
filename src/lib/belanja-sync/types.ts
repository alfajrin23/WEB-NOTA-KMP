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

export const BELANJA_COPY_RECONCILE_STAGES = [
  "PRE_FLIGHT",
  "SOURCE_OPENED",
  "SOURCE_SELECTED",
  "COPY_STARTED",
  "COPY_CONFIRMED",
  "DESTINATION_COPIED",
  "RECONCILING",
  "VERIFYING",
  "COMPLETED",
  "FAILED",
] as const;

export type BelanjaSyncJobStatus = (typeof BELANJA_JOB_STATUSES)[number];
export type BelanjaSyncItemStatus = (typeof BELANJA_ITEM_STATUSES)[number];
export type BelanjaCopyReconcileStage = (typeof BELANJA_COPY_RECONCILE_STAGES)[number];
export type BelanjaSyncOperationType = "legacy_item_submit" | "copy_reconcile_v1";

export type KdkmpIdentity = {
  province?: string;
  regency: string;
  district: string;
  village: string;
  label?: string;
};

export type BelanjaTransactionKind = "material" | "honorarium" | "equipment";

export type BelanjaTransactionIdentity = {
  key: string;
  stageKey: string;
  stageText: string;
  categoryCode: string;
  categoryText: string;
  categoryKey: string;
  belanjaCategoryText: string;
  belanjaCategoryKey: string;
  transactionDate: string;
  kind: BelanjaTransactionKind;
  occurrence: number;
};

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

export type BelanjaTransactionLine = BelanjaPayload & {
  lineId: string;
  sequence: number;
  role?: "mandor" | "kepala_tukang" | "tukang" | "kuli_kenek" | "other";
  recipient?: string;
};

export type BelanjaTransactionPayload = BelanjaPayload & {
  operationType: "copy_reconcile_v1";
  transactionId: string;
  transactionKey: string;
  sequence: number;
  kind: BelanjaTransactionKind;
  lineCount: number;
  sourceResumeItemIds: string[];
  transactionIdentity: BelanjaTransactionIdentity;
  lines: BelanjaTransactionLine[];
  totalAmount: number;
  recipientMap?: Record<string, string>;
};

export type BelanjaPayloadValidation = {
  valid: boolean;
  errors: string[];
  computedJumlah: number;
  difference: number;
};

export type BelanjaSyncJobProgress = {
  stage: BelanjaCopyReconcileStage;
  message?: string;
  current?: number;
  total?: number;
  copiedTransactions?: number;
  verifiedTransactions?: number;
  materialCompleted?: number;
  materialTotal?: number;
  honorariumCompleted?: number;
  honorariumTotal?: number;
  equipmentCompleted?: number;
  equipmentTotal?: number;
  updatedAt?: string;
};

export type BelanjaSyncReport = {
  source?: KdkmpIdentity;
  destination?: KdkmpIdentity;
  expectedTransactions?: number;
  copiedTransactions?: number;
  verifiedTransactions?: number;
  expectedTotalAmount?: number;
  actualTotalAmount?: number;
  totalDifference?: number;
  materialsUpdated?: number;
  honorariumUpdated?: number;
  equipmentUpdated?: number;
  budgetRepairAttempts?: number;
  budgetRepairedTransactions?: number;
  budgetRepairDetails?: string[];
  reconciliation?: {
    initialExpectedTotal?: number;
    initialActualTotal?: number;
    initialDifference?: number;
    mismatchedStages?: string[];
    updatedTransactions?: number;
    scanMs?: number;
    editMs?: number;
    verifyMs?: number;
    stages?: Array<{ stageKey: string; expectedTotal: number; actualTotal: number; difference: number; signatureMatches: boolean }>;
    finalStatus: "RECONCILING" | "VERIFIED";
  };
  errors?: string[];
  status?: BelanjaCopyReconcileStage | BelanjaSyncJobStatus;
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
  operationType?: BelanjaSyncOperationType | string | null;
  stage?: BelanjaCopyReconcileStage | null;
  stageMessage?: string | null;
  progress?: BelanjaSyncJobProgress | null;
  report?: BelanjaSyncReport | null;
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
  metadataJson?: Record<string, unknown>;
};

export type BelanjaProjectSyncState = {
  projectId: string;
  schemaReady: boolean;
  jobs: BelanjaSyncJob[];
  items: BelanjaSyncItem[];
  latestBySourceItemId: Record<string, BelanjaSyncItem>;
  runner: BelanjaRunnerHeartbeat | null;
  activeJob?: BelanjaSyncJob | null;
  errorMessage?: string | null;
};

export type BelanjaSyncOverviewProject = {
  projectId: string;
  status: "belum_dikirim" | "sebagian" | "selesai" | "ada_error";
  totalItems: number;
  successItems: number;
  failedItems: number;
  pendingItems: number;
  latestJob?: BelanjaSyncJob | null;
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
  operationType?: BelanjaSyncOperationType;
  expectedTransactionCount?: number;
};

export type ClaimedBelanjaSyncItem = {
  job: BelanjaSyncJob;
  item: BelanjaSyncItem;
};

export type ClaimedBelanjaSyncJob = {
  job: BelanjaSyncJob;
  items: BelanjaSyncItem[];
  transactions: BelanjaTransactionPayload[];
  sourceKdkmp: KdkmpIdentity;
  destinationKdkmp: KdkmpIdentity;
  expectedTransactionCount: number;
  stage: BelanjaCopyReconcileStage;
  completedTransactionIds: string[];
};
