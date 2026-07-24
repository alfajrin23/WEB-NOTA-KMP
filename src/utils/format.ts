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

export function formatThousands(value: number | string | null | undefined) {
  const text = String(value ?? "").replace(/\D/g, "");
  if (!text) return "";
  return new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 0,
  }).format(Number(text));
}

export function numericInputValue(value: string | number | null | undefined) {
  return String(value ?? "").replace(/\D/g, "");
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

export type WilayahTypeValue = "desa" | "kelurahan";
export type WilayahLabelVariant = "long" | "short";

type ProjectWilayahLike = {
  wilayahType?: WilayahTypeValue | string | null;
  villageName?: string | null;
  districtName?: string | null;
  regencyName?: string | null;
  invoiceRecipientName?: string | null;
  invoiceRecipientAddress?: string | null;
};

const WILAYAH_LABELS: Record<WilayahTypeValue, Record<WilayahLabelVariant, string>> = {
  desa: { long: "Desa", short: "Ds." },
  kelurahan: { long: "Kelurahan", short: "Kel." },
};

export const WILAYAH_TYPE_OPTIONS: Array<{ value: WilayahTypeValue; label: string }> = [
  { value: "desa", label: "Desa" },
  { value: "kelurahan", label: "Kelurahan" },
];

export function normalizeWilayahType(value: string | null | undefined): WilayahTypeValue {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "kelurahan" || normalized === "kel" || normalized === "kel.") return "kelurahan";
  return "desa";
}

export function wilayahLabel(type: string | null | undefined, variant: WilayahLabelVariant = "long") {
  return WILAYAH_LABELS[normalizeWilayahType(type)][variant];
}

export function stripWilayahPrefix(name: string | null | undefined) {
  return (name ?? "")
    .trim()
    .replace(/^(?:desa|ds\.?|kelurahan|kel\.?)\s+/i, "")
    .trim();
}

export function formatWilayah(
  type: string | null | undefined,
  name: string | null | undefined,
  variant: WilayahLabelVariant = "long",
) {
  const label = wilayahLabel(type, variant);
  const cleanName = stripWilayahPrefix(name);
  return cleanName ? `${label} ${cleanName}` : label;
}

export function formatKdkmpWilayah(
  type: string | null | undefined,
  name: string | null | undefined,
  variant: WilayahLabelVariant = "short",
) {
  return `KDKMP ${formatWilayah(type, name, variant)}`;
}

export function formatProjectWilayah(project: ProjectWilayahLike, variant: WilayahLabelVariant = "long") {
  return formatWilayah(project.wilayahType, project.villageName, variant);
}

export function formatProjectKdkmpWilayah(project: ProjectWilayahLike, variant: WilayahLabelVariant = "short") {
  return formatKdkmpWilayah(project.wilayahType, project.villageName, variant);
}

function compactIdentity(value: string) {
  return value
    .toLowerCase()
    .replace(/\bkelurahan\b/g, "kel")
    .replace(/\bdesa\b/g, "ds")
    .replace(/\./g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isAutoKdkmpWilayahText(value: string | null | undefined, name: string | null | undefined) {
  const text = (value ?? "").trim();
  const cleanName = stripWilayahPrefix(name);
  if (!text || !cleanName) return false;

  const candidates = [
    formatKdkmpWilayah("desa", cleanName, "long"),
    formatKdkmpWilayah("desa", cleanName, "short"),
    formatKdkmpWilayah("kelurahan", cleanName, "long"),
    formatKdkmpWilayah("kelurahan", cleanName, "short"),
  ];
  return candidates.some((candidate) => compactIdentity(candidate) === compactIdentity(text));
}

function isAutoWilayahAddress(value: string | null | undefined, project: ProjectWilayahLike) {
  const text = (value ?? "").trim();
  const cleanName = stripWilayahPrefix(project.villageName);
  if (!text || !cleanName) return false;

  const district = project.districtName?.trim() ?? "";
  const regency = project.regencyName?.trim() ?? "";
  const candidates = [
    `${formatWilayah("desa", cleanName, "long")}, Kec. ${district}, Kab. ${regency}`,
    `${formatWilayah("kelurahan", cleanName, "long")}, Kec. ${district}, Kab. ${regency}`,
    `${formatWilayah("desa", cleanName, "long")} Kec. ${district}`,
    `${formatWilayah("kelurahan", cleanName, "long")} Kec. ${district}`,
  ];
  return candidates.some((candidate) => compactIdentity(candidate) === compactIdentity(text));
}

export function formatProjectRecipientName(project: ProjectWilayahLike, variant: WilayahLabelVariant = "long") {
  const custom = project.invoiceRecipientName?.trim();
  if (custom && !isAutoKdkmpWilayahText(custom, project.villageName)) return custom;
  return formatProjectKdkmpWilayah(project, variant);
}

export function formatProjectRecipientAddress(project: ProjectWilayahLike) {
  const custom = project.invoiceRecipientAddress?.trim();
  if (custom && !isAutoWilayahAddress(custom, project)) return custom;

  const district = project.districtName?.trim() || "-";
  const regency = project.regencyName?.trim() || "-";
  return `${formatProjectWilayah(project, "long")}, Kec. ${district}, Kab. ${regency}`;
}
