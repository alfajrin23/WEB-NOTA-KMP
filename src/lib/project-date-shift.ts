import type { GeneratedNota, Project, ResumeItem } from "@/types/domain";

export const TEMPLATE_SOURCE_START_DATE = "2025-11-03";
export const SIRNAGALIH_PATTERN_START_DATE = TEMPLATE_SOURCE_START_DATE;
export const SIRNAGALIH_PATTERN_LABEL = "Sirnagalih";
export const DEFAULT_PROJECT_START_DATE = TEMPLATE_SOURCE_START_DATE;

const DAY_IN_MS = 24 * 60 * 60 * 1000;

type ResumeItemWithExtraDates = ResumeItem & Record<string, unknown>;

const OPTIONAL_RESUME_DATE_FIELDS = [
  "expenseEndDate",
  "endDate",
  "dateEnd",
  "workDate",
  "paymentDate",
  "purchaseDate",
  "tanggalSelesai",
  "tanggalPekerjaan",
  "tanggalPembayaran",
  "tanggalPembelian",
] as const;

function parseIsoDate(value: string | undefined | null) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, monthIndex, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== monthIndex ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function toIsoDate(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_IN_MS);
}

export function daysBetweenIsoDates(fromDate: string, toDate: string) {
  const from = parseIsoDate(fromDate);
  const to = parseIsoDate(toDate);
  if (!from || !to) return 0;
  return Math.round((to.getTime() - from.getTime()) / DAY_IN_MS);
}

export function getProjectDateShiftDays(projectDate: string) {
  return daysBetweenIsoDates(TEMPLATE_SOURCE_START_DATE, projectDate);
}

export function shiftIsoDateByDays(value: string, days: number) {
  const parsed = parseIsoDate(value);
  if (!parsed || days === 0) return value;
  return toIsoDate(addDays(parsed, days));
}

export function shiftSourceTemplateDateToReferencePattern(value: string) {
  return shiftIsoDateByDays(
    value,
    daysBetweenIsoDates(TEMPLATE_SOURCE_START_DATE, SIRNAGALIH_PATTERN_START_DATE),
  );
}

export function shiftReferencePatternDateToProject(value: string, projectDate: string) {
  return shiftIsoDateByDays(value, daysBetweenIsoDates(SIRNAGALIH_PATTERN_START_DATE, projectDate));
}

function normalizeTwoDigitYear(value: string) {
  return value.length === 2 ? `20${value}` : value;
}

function shiftSeparatedDate(match: string, dayText: string, monthText: string, yearText: string, separator: "/" | "-", days: number) {
  const year = Number(normalizeTwoDigitYear(yearText));
  const monthIndex = Number(monthText) - 1;
  const day = Number(dayText);
  const parsed = new Date(Date.UTC(year, monthIndex, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== monthIndex ||
    parsed.getUTCDate() !== day
  ) {
    return match;
  }

  const shifted = addDays(parsed, days);
  const nextDay = String(shifted.getUTCDate()).padStart(Math.max(2, dayText.length), "0");
  const nextMonth = String(shifted.getUTCMonth() + 1).padStart(Math.max(2, monthText.length), "0");
  const nextYear = String(shifted.getUTCFullYear());
  return [nextDay, nextMonth, nextYear].join(separator);
}

export function shiftDateLikeStringByDays(value: string | undefined, days: number) {
  if (!value || days === 0) return value ?? "";

  const iso = parseIsoDate(value);
  if (iso) return toIsoDate(addDays(iso, days));

  const slashMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (slashMatch) return shiftSeparatedDate(value, slashMatch[1], slashMatch[2], slashMatch[3], "/", days);

  const dashMatch = value.match(/^(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})$/);
  if (dashMatch) return shiftSeparatedDate(value, dashMatch[1], dashMatch[2], dashMatch[3], "-", days);

  return value;
}

export function shiftTextDatesByDays(value: string | undefined, days: number) {
  if (!value || days === 0) return value ?? "";

  return value
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (match) => shiftDateLikeStringByDays(match, days))
    .replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/g, (match, day: string, month: string, year: string) =>
      shiftSeparatedDate(match, day, month, year, "/", days),
    )
    .replace(/\b(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})\b/g, (match, day: string, month: string, year: string) =>
      shiftSeparatedDate(match, day, month, year, "-", days),
    );
}

export function shiftResumeItemByDays(item: ResumeItem, days: number): ResumeItem {
  if (days === 0) return item;

  const next: ResumeItemWithExtraDates = {
    ...item,
    expenseDate: shiftDateLikeStringByDays(item.expenseDate, days),
    itemName: shiftTextDatesByDays(item.itemName, days),
    notes: item.notes ? shiftTextDatesByDays(item.notes, days) : item.notes,
  };

  for (const field of OPTIONAL_RESUME_DATE_FIELDS) {
    if (typeof next[field] === "string") {
      next[field] = shiftDateLikeStringByDays(next[field], days);
    }
  }

  return next;
}

export function shiftResumeItemsByDays(items: ResumeItem[], days: number) {
  if (days === 0) return items;
  return items.map((item) => shiftResumeItemByDays(item, days));
}

export function shiftResumeItemsFromDefault(items: ResumeItem[], projectDate: string) {
  return shiftResumeItemsByDays(items, getProjectDateShiftDays(projectDate));
}

export function shiftGeneratedNotaByDays(doc: GeneratedNota, days: number, project?: Pick<Project, "projectDate" | "reportDate">) {
  if (days === 0) {
    return project
      ? {
        ...doc,
        projectMeta: {
          ...doc.projectMeta,
          projectDate: project.projectDate,
          reportDate: project.reportDate,
        },
      }
      : doc;
  }

  return {
    ...doc,
    tanggal: shiftDateLikeStringByDays(doc.tanggal, days),
    notaDate: shiftDateLikeStringByDays(doc.notaDate, days),
    items: shiftResumeItemsByDays(doc.items, days),
    projectMeta: {
      ...doc.projectMeta,
      projectDate: project?.projectDate ?? shiftDateLikeStringByDays(doc.projectMeta.projectDate, days),
      reportDate: project?.reportDate ?? (doc.projectMeta.reportDate ? shiftDateLikeStringByDays(doc.projectMeta.reportDate, days) : doc.projectMeta.reportDate),
    },
    kwitansiPaymentDescription: doc.kwitansiPaymentDescription
      ? shiftTextDatesByDays(doc.kwitansiPaymentDescription, days)
      : doc.kwitansiPaymentDescription,
    kwitansiDate: doc.kwitansiDate ? shiftDateLikeStringByDays(doc.kwitansiDate, days) : doc.kwitansiDate,
  };
}
