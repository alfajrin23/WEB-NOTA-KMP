import { shiftResumeItemsFromDefault } from "@/lib/project-date-shift";
import { ResumeItem } from "@/types/domain";

function normalizeKey(value: string | undefined | null) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function vendorKey(item: Pick<ResumeItem, "vendorId" | "vendorName">) {
  if (item.vendorId?.trim()) return `id:${normalizeKey(item.vendorId)}`;
  const vendorName = normalizeKey(item.vendorName);
  return vendorName ? `name:${vendorName}` : "";
}

function categoryKey(item: Pick<ResumeItem, "categoryCode" | "categoryName" | "category">) {
  return normalizeKey(item.categoryCode || item.categoryName || item.category);
}

export function getResumeHistoryItemKey(
  item: Pick<ResumeItem, "stageCode" | "vendorId" | "vendorName" | "itemName" | "unit" | "categoryCode" | "categoryName" | "category">,
) {
  return [
    normalizeKey(item.stageCode),
    vendorKey(item),
    normalizeKey(item.itemName),
    normalizeKey(item.unit),
    categoryKey(item),
  ].join("::");
}

export function applyResumeItemHistory(templateItems: ResumeItem[], historyItems: ResumeItem[] | undefined | null) {
  if (!historyItems?.length) return templateItems;

  const historyByKey = new Map<string, ResumeItem>();
  for (const item of [...historyItems].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const key = getResumeHistoryItemKey(item);
    if (key.trim()) historyByKey.set(key, item);
  }

  return templateItems.map((item) => {
    const history = historyByKey.get(getResumeHistoryItemKey(item));
    if (!history) return item;

    return {
      ...item,
      volume: history.volume,
      unitPrice: history.unitPrice,
      amountOverride: null,
      validationStatus: "valid" as const,
    };
  });
}

export function latestEditedProject<T extends { createdAt?: string; updatedAt?: string; items?: ResumeItem[] }>(projects: T[]) {
  const timestamp = (value: string | undefined) => {
    const parsed = Date.parse(value ?? "");
    return Number.isFinite(parsed) ? parsed : 0;
  };

  return [...projects]
    .filter((project) => (project.items?.length ?? 0) > 0)
    .sort((a, b) => {
      const updatedDiff = timestamp(b.updatedAt) - timestamp(a.updatedAt);
      if (updatedDiff !== 0) return updatedDiff;
      return timestamp(b.createdAt) - timestamp(a.createdAt);
    })[0] ?? null;
}

export function buildResumeItemsForNewProject(templateItems: ResumeItem[], projectDate: string, historyItems?: ResumeItem[] | null) {
  return applyResumeItemHistory(shiftResumeItemsFromDefault(templateItems, projectDate), historyItems);
}
