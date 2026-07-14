export function formatRupiah(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 2,
  }).format(value);
}

export const INDONESIA_LOCALE = "id-ID";
export const INDONESIA_TIME_ZONE = "Asia/Jakarta";

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const LOCAL_DATE_PATTERN = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/;
const LOCAL_DASH_DATE_PATTERN = /^(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})$/;

function isValidDatePart(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function dateOnlyToDate(value: string) {
  const match = DATE_ONLY_PATTERN.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidDatePart(year, month, day)) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function localDateToDate(value: string) {
  const match = LOCAL_DATE_PATTERN.exec(value.trim()) ?? LOCAL_DASH_DATE_PATTERN.exec(value.trim());
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  if (!isValidDatePart(year, month, day)) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function jakartaWallTimeToDate(year: number, month: number, day: number, hour: number, minute: number, second: number) {
  return new Date(Date.UTC(year, month - 1, day, hour - 7, minute, second));
}

function dateTimeToDate(value: string) {
  const trimmed = value.trim();
  const dateOnly = dateOnlyToDate(trimmed) ?? localDateToDate(trimmed);
  if (dateOnly) return dateOnly;

  const match = DATE_TIME_PATTERN.exec(trimmed);
  if (!match) {
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.valueOf()) ? null : parsed;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] ?? 0);
  const minute = Number(match[5] ?? 0);
  const second = Number(match[6] ?? 0);
  const timezone = match[7];
  if (!isValidDatePart(year, month, day)) return null;

  if (!timezone) return jakartaWallTimeToDate(year, month, day, hour, minute, second);

  const normalized = timezone === "Z" ? trimmed : trimmed.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function partsFromFormatter(date: Date, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(INDONESIA_LOCALE, {
    ...options,
    timeZone: INDONESIA_TIME_ZONE,
  }).formatToParts(date);
}

function partValue(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  return parts.find((part) => part.type === type)?.value ?? "";
}

export function formatDateIndonesia(value: string | Date | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : dateOnlyToDate(value) ?? dateTimeToDate(value);
  if (!date || Number.isNaN(date.valueOf())) return String(value);

  const parts = partsFromFormatter(date, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  return `${partValue(parts, "day")}/${partValue(parts, "month")}/${partValue(parts, "year")}`;
}

export function formatDateLongIndonesia(value: string | Date | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : dateOnlyToDate(value) ?? dateTimeToDate(value);
  if (!date || Number.isNaN(date.valueOf())) return String(value);

  return new Intl.DateTimeFormat(INDONESIA_LOCALE, {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: INDONESIA_TIME_ZONE,
  }).format(date);
}

export function formatDateTimeIndonesia(value: string | Date | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : dateTimeToDate(value);
  if (!date || Number.isNaN(date.valueOf())) return String(value);

  const parts = partsFromFormatter(date, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${partValue(parts, "day")}/${partValue(parts, "month")}/${partValue(parts, "year")} ${partValue(parts, "hour")}:${partValue(parts, "minute")}`;
}

export function formatTimeIndonesia(value: string | Date | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : dateTimeToDate(value);
  if (!date || Number.isNaN(date.valueOf())) return String(value);

  const parts = partsFromFormatter(date, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${partValue(parts, "hour")}:${partValue(parts, "minute")}`;
}

export function todayInIndonesiaIsoDate() {
  const parts = partsFromFormatter(new Date(), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  return `${partValue(parts, "year")}-${partValue(parts, "month")}-${partValue(parts, "day")}`;
}

export function parseDateInputToIso(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";

  const iso = DATE_ONLY_PATTERN.exec(trimmed);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    return isValidDatePart(year, month, day) ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
  }

  const slash = LOCAL_DATE_PATTERN.exec(trimmed);
  const dash = LOCAL_DASH_DATE_PATTERN.exec(trimmed);
  const match = slash ?? dash;
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  if (!isValidDatePart(year, month, day)) return null;

  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

export function addDaysIsoDate(value: string, days: number) {
  const date = dateOnlyToDate(value);
  if (!date || days === 0) return value;
  date.setUTCDate(date.getUTCDate() + days);
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

const units = ["", "Satu", "Dua", "Tiga", "Empat", "Lima", "Enam", "Tujuh", "Delapan", "Sembilan", "Sepuluh", "Sebelas"];

function spellUnderThousand(value: number): string {
  if (value < 12) return units[value];
  if (value < 20) return `${spellUnderThousand(value - 10)} Belas`;
  if (value < 100) return `${spellUnderThousand(Math.floor(value / 10))} Puluh ${spellUnderThousand(value % 10)}`.trim();
  if (value < 200) return `Seratus ${spellUnderThousand(value - 100)}`.trim();
  return `${spellUnderThousand(Math.floor(value / 100))} Ratus ${spellUnderThousand(value % 100)}`.trim();
}

export function terbilangRupiah(value: number) {
  const integer = Math.floor(Math.abs(value));
  if (integer === 0) return "Nol Rupiah";

  const groups = [
    { value: 1_000_000_000_000, label: "Triliun" },
    { value: 1_000_000_000, label: "Milyar" },
    { value: 1_000_000, label: "Juta" },
    { value: 1_000, label: "Ribu" },
  ];

  let rest = integer;
  const parts: string[] = [];

  for (const group of groups) {
    const count = Math.floor(rest / group.value);
    if (count > 0) {
      if (group.value === 1_000 && count === 1) parts.push("Seribu");
      else parts.push(`${spellUnderThousand(count)} ${group.label}`);
      rest %= group.value;
    }
  }

  if (rest > 0) parts.push(spellUnderThousand(rest));
  return `${parts.join(" ").replace(/\s+/g, " ").trim()} Rupiah`;
}

export function getAmount(volume: number, unitPrice: number) {
  return Math.round((Number(volume) || 0) * (Number(unitPrice) || 0));
}
