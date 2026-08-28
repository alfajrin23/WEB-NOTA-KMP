import type { ResumeItem } from "@/types/domain";

type JasaTransactionItem = Pick<
  ResumeItem,
  "id" | "stageCode" | "expenseDate" | "category" | "sortOrder"
>;

export type JasaElectricNotaGroup<T extends JasaTransactionItem = ResumeItem> = {
  key: string;
  transactionKey: string;
  date: string;
  category: string;
  items: T[];
  chunkSubtotal: number;
  transactionTotal: number;
  splitNumber: number;
  splitCount: number;
  isLastSplitNota: boolean;
};

export type JasaElectricNotaPage<T extends JasaTransactionItem = ResumeItem> = {
  vendorKey: string;
  notas: JasaElectricNotaGroup<T>[];
};

function normalizedKeyPart(value: string | undefined | null) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * ResumeItem has no purchaseId/transactionId. In the current source workbook,
 * one Jasa Elektrik purchase can span multiple category codes, while its
 * expense date remains the available purchase boundary. Keep stage in the key
 * so equal dates from different stages cannot be combined. An item without a
 * date fails closed to its own key instead of being totalled by vendor.
 */
export function getJasaElectricTransactionKey(item: JasaTransactionItem) {
  const dateKey = normalizedKeyPart(item.expenseDate);
  if (!dateKey) return `${item.stageCode}|item:${item.id}`;
  return `${item.stageCode}|${dateKey}`;
}

export function buildJasaElectricNotaGroups<T extends JasaTransactionItem>(
  items: readonly T[],
  maxRows: number,
  amountForItem: (item: T) => number,
): JasaElectricNotaGroup<T>[] {
  if (!Number.isInteger(maxRows) || maxRows < 1) {
    throw new Error("Kapasitas baris Nota Jasa Elektrik harus lebih dari 0.");
  }

  const orderedItems = items
    .map((item, sourceIndex) => ({ item, sourceIndex }))
    .sort((a, b) => a.item.sortOrder - b.item.sortOrder || a.sourceIndex - b.sourceIndex)
    .map(({ item }) => item);
  const transactions = new Map<string, { items: T[]; firstSortOrder: number }>();

  for (const item of orderedItems) {
    const transactionKey = getJasaElectricTransactionKey(item);
    const current = transactions.get(transactionKey);
    if (current) current.items.push(item);
    else transactions.set(transactionKey, { items: [item], firstSortOrder: item.sortOrder });
  }

  return [...transactions.entries()]
    .sort((a, b) => a[1].firstSortOrder - b[1].firstSortOrder)
    .flatMap(([transactionKey, transaction]) => {
      const transactionTotal = transaction.items.reduce((sum, item) => sum + amountForItem(item), 0);
      const splitCount = Math.ceil(transaction.items.length / maxRows);
      const groups: JasaElectricNotaGroup<T>[] = [];

      for (let index = 0; index < transaction.items.length; index += maxRows) {
        const splitNumber = Math.floor(index / maxRows) + 1;
        const chunkItems = transaction.items.slice(index, index + maxRows);
        groups.push({
          key: `${transactionKey}|split:${splitNumber}`,
          transactionKey,
          date: chunkItems[0]?.expenseDate ?? "",
          category: chunkItems[0]?.category ?? "",
          items: chunkItems,
          chunkSubtotal: chunkItems.reduce((sum, item) => sum + amountForItem(item), 0),
          transactionTotal,
          splitNumber,
          splitCount,
          isLastSplitNota: splitNumber === splitCount,
        });
      }

      return groups;
    });
}

export function paginateJasaElectricNotaGroups<T extends JasaTransactionItem>(
  groups: readonly JasaElectricNotaGroup<T>[],
  vendorKey: string,
  pageSize = 2,
): JasaElectricNotaPage<T>[] {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error("Jumlah Nota Jasa Elektrik per halaman harus lebih dari 0.");
  }

  const pageBlocks: Array<{ order: number; pages: JasaElectricNotaPage<T>[] }> = [];
  const singleGroups: JasaElectricNotaGroup<T>[] = [];
  const transactions = new Map<string, JasaElectricNotaGroup<T>[]>();

  for (const group of groups) {
    const current = transactions.get(group.transactionKey);
    if (current) current.push(group);
    else transactions.set(group.transactionKey, [group]);
  }

  const groupOrder = (group: JasaElectricNotaGroup<T>) => group.items[0]?.sortOrder ?? Number.MAX_SAFE_INTEGER;
  const chunkPages = (sourceGroups: JasaElectricNotaGroup<T>[]) => {
    const pages: JasaElectricNotaPage<T>[] = [];
    for (let index = 0; index < sourceGroups.length; index += pageSize) {
      pages.push({ vendorKey, notas: sourceGroups.slice(index, index + pageSize) });
    }
    return pages;
  };

  for (const transactionGroups of transactions.values()) {
    if (transactionGroups.length === 1 && transactionGroups[0].splitCount === 1) {
      singleGroups.push(transactionGroups[0]);
      continue;
    }

    pageBlocks.push({
      order: groupOrder(transactionGroups[0]),
      pages: chunkPages(transactionGroups),
    });
  }

  if (singleGroups.length > 0) {
    pageBlocks.push({
      order: groupOrder(singleGroups[0]),
      pages: chunkPages(singleGroups),
    });
  }

  return pageBlocks
    .sort((left, right) => left.order - right.order)
    .flatMap((block) => block.pages);
}
