import { GeneratedNota, Project, ResumeItem } from "@/types/domain";
import { getResumeItemAmount } from "@/lib/resume-calculations";
import {
  formatDateIndonesia,
  formatProjectKdkmpWilayah,
  formatProjectRecipientAddress,
  formatProjectRecipientName,
  terbilangRupiah,
} from "@/utils/format";

export type Stage1TemplateProps = {
  doc: GeneratedNota;
  docs?: GeneratedNota[];
  project: Project;
  zoom: number;
  debug?: boolean;
};

export type NotaGroup = {
  key: string;
  date: string;
  category: string;
  items: ResumeItem[];
};

export const STAGE1_MAX_ROWS = 14;

const numberFormatter = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

export function formatPlainNumber(value: number) {
  return numberFormatter.format(Math.round(Number(value) || 0));
}

export function formatDateSlash(value: string) {
  return formatDateIndonesia(value);
}

export function itemAmount(item: ResumeItem) {
  return getResumeItemAmount(item);
}

export function groupNotaItems(items: ResumeItem[], maxRows = STAGE1_MAX_ROWS): NotaGroup[] {
  const groups = new Map<string, NotaGroup & { firstSortOrder: number }>();

  for (const item of [...items].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const key = `${item.expenseDate}-${item.category}`;
    const current = groups.get(key);
    if (current) current.items.push(item);
    else groups.set(key, {
      key,
      date: item.expenseDate,
      category: item.category,
      items: [item],
      firstSortOrder: item.sortOrder,
    });
  }

  const splitGroups: Array<NotaGroup & { firstSortOrder: number }> = [];
  for (const group of groups.values()) {
    for (let index = 0; index < group.items.length; index += maxRows) {
      const part = group.items.slice(index, index + maxRows);
      splitGroups.push({
        ...group,
        key: `${group.key}-${Math.floor(index / maxRows) + 1}`,
        items: part,
      });
    }
  }

  return splitGroups.sort((a, b) => a.firstSortOrder - b.firstSortOrder);
}

export function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function padRows(items: ResumeItem[], rows = STAGE1_MAX_ROWS): Array<ResumeItem | null> {
  const blanks = new Array<ResumeItem | null>(Math.max(0, rows - items.length)).fill(null);
  return [...items, ...blanks];
}

export function groupTotal(group: Pick<NotaGroup, "items">) {
  return group.items.reduce((sum, item) => sum + itemAmount(item), 0);
}

export function amountWords(value: number) {
  return terbilangRupiah(value).toUpperCase();
}

export function personName(itemName: string) {
  return itemName.replace(/\s*\(.+?\)\s*/g, "").trim();
}

export function projectKdkmpRecipient(project: Project) {
  return formatProjectKdkmpWilayah(project, "long");
}

export function projectInvoiceRecipient(project: Project) {
  return formatProjectRecipientName(project, "long");
}

export function projectInvoiceAddress(project: Project) {
  return formatProjectRecipientAddress(project);
}
