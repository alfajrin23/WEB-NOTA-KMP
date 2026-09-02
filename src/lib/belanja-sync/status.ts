import type { BelanjaSyncItemStatus } from "./types";

export function isBelanjaItemActive(status: BelanjaSyncItemStatus | undefined | null) {
  return status === "pending" || status === "processing" || status === "needs_review";
}

export function isBelanjaItemSuccess(status: BelanjaSyncItemStatus | undefined | null) {
  return status === "success";
}

export function shouldQueueBelanjaItem(
  existingStatus: BelanjaSyncItemStatus | undefined | null,
  forceResend = false,
) {
  if (!existingStatus) return { queue: true, reason: null };
  if (isBelanjaItemActive(existingStatus)) {
    return { queue: false, reason: "Item sudah ada di antrean aktif, tidak dibuat duplikat." };
  }
  if (!forceResend && isBelanjaItemSuccess(existingStatus)) {
    return { queue: false, reason: "Item sudah SUCCESS di Web Belanja, tidak dikirim ulang." };
  }
  return { queue: true, reason: null };
}

export function nextFailedBelanjaStatus(attemptCount: number, maxAttempts: number, retryable: boolean) {
  return retryable && attemptCount < maxAttempts ? "pending" as const : "failed" as const;
}
