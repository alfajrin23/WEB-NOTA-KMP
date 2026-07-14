import { ResumeItem, StageCode } from "@/types/domain";

const PRICE_SYNC_STAGE_CODES = new Set<StageCode>(["TAHAP_I", "TAHAP_II", "TAHAP_III", "TAHAP_IV"]);

function normalizeKey(value: string | undefined | null) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function vendorKey(item: Pick<ResumeItem, "vendorId" | "vendorName">) {
  if (item.vendorId?.trim()) return `id:${item.vendorId.trim()}`;
  const vendorName = normalizeKey(item.vendorName);
  return vendorName ? `name:${vendorName}` : "";
}

export function getPriceSyncGroupKey(item: Pick<ResumeItem, "stageCode" | "itemName" | "vendorId" | "vendorName">) {
  if (!PRICE_SYNC_STAGE_CODES.has(item.stageCode)) return "";

  const itemName = normalizeKey(item.itemName);
  const vendor = vendorKey(item);
  if (!itemName || !vendor) return "";

  return `${vendor}::${itemName}`;
}

export function findPriceSyncItems(items: ResumeItem[], sourceItem: ResumeItem) {
  const sourceKey = getPriceSyncGroupKey(sourceItem);
  if (!sourceKey) return [sourceItem];

  return items.filter((item) => getPriceSyncGroupKey(item) === sourceKey);
}

export function findPriceSyncSiblingItems(items: ResumeItem[], sourceItem: ResumeItem) {
  return findPriceSyncItems(items, sourceItem).filter((item) => item.id !== sourceItem.id);
}
