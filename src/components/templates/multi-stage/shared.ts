import { getResumeItemAmount } from "@/lib/resume-calculations";
import { GeneratedNota, Project, ResumeItem } from "@/types/domain";
import {
  addDaysIsoDate,
  formatDateIndonesia,
  formatDateLongIndonesia,
  formatProjectKdkmpWilayah,
  formatProjectRecipientName,
  terbilangRupiah,
} from "@/utils/format";

export type MultiStageTemplateProps = {
  doc: GeneratedNota;
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

const numberFormatter = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

export function formatPlainNumber(value: number) {
  return numberFormatter.format(Math.round(Number(value) || 0));
}

export function formatRupiahPlain(value: number) {
  return `Rp${formatPlainNumber(value)}`;
}

export function formatRupiahWithDot(value: number) {
  return `Rp. ${formatPlainNumber(value)}`;
}

export function formatDateSlash(value: string) {
  return formatDateIndonesia(value);
}

export function formatDateLong(value: string) {
  return formatDateLongIndonesia(value);
}

export function addDays(value: string, days: number) {
  return addDaysIsoDate(value, days);
}

export function itemAmount(item: ResumeItem) {
  return getResumeItemAmount(item);
}

export function groupTotal(group: Pick<NotaGroup, "items">) {
  return group.items.reduce((sum, item) => sum + itemAmount(item), 0);
}

export function groupNotaItems(items: ResumeItem[], maxRows: number): NotaGroup[] {
  const groups = new Map<string, NotaGroup>();

  for (const item of [...items].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const key = `${item.expenseDate}-${item.category}`;
    const current = groups.get(key);
    if (current) current.items.push(item);
    else groups.set(key, { key, date: item.expenseDate, category: item.category, items: [item] });
  }

  const splitGroups: NotaGroup[] = [];
  for (const group of groups.values()) {
    for (let index = 0; index < group.items.length; index += maxRows) {
      splitGroups.push({
        ...group,
        key: `${group.key}-${Math.floor(index / maxRows) + 1}`,
        items: group.items.slice(index, index + maxRows),
      });
    }
  }

  return splitGroups.sort((a, b) => a.date.localeCompare(b.date) || a.category.localeCompare(b.category));
}

export function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function padRows(items: ResumeItem[], rows: number): Array<ResumeItem | null> {
  return [...items, ...new Array<ResumeItem | null>(Math.max(0, rows - items.length)).fill(null)];
}

export function amountWords(value: number) {
  return terbilangRupiah(value);
}

export function amountWordsItalic(value: number) {
  return terbilangRupiah(value).replace(/\s+/g, " ");
}

export function projectRecipient(project: Project) {
  return formatProjectRecipientName(project, "long");
}

export function projectKdkmpRecipient(project: Project) {
  return formatProjectKdkmpWilayah(project, "long");
}

export function splitLongText(value: string, limit = 48) {
  if (value.length <= limit) return [value];
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > limit && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 2);
}
