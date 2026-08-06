import { GeneratedNota, Project, ResumeItem, StageCode } from "@/types/domain";
import { formatDateIndonesia, formatProjectKdkmpWilayah, parseDateInputToIso, terbilangRupiah } from "@/utils/format";
import { getResumeItemAmount } from "./resume-calculations";

function normalized(value: string | undefined | null) {
  return (value ?? "").trim().toLowerCase();
}

function parseDate(value: string | undefined | null) {
  if (!value) return null;
  const iso = parseDateInputToIso(value);
  if (iso) {
    const [year, month, day] = iso.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDateString(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function formatKwitansiDate(value: string | undefined | null) {
  const date = parseDate(value);
  if (!date) return value ?? "";
  return formatDateIndonesia(toDateString(date));
}

export function getKwitansiAmount(doc: GeneratedNota) {
  if (typeof doc.kwitansiAmount === "number" && Number.isFinite(doc.kwitansiAmount)) return doc.kwitansiAmount;
  return doc.items.reduce((sum, item) => sum + getResumeItemAmount(item), 0) || doc.totalAmount;
}

export function getKwitansiAmountWords(doc: GeneratedNota) {
  if (doc.kwitansiAmountWords?.trim()) return doc.kwitansiAmountWords.trim();
  return terbilangRupiah(getKwitansiAmount(doc));
}

export function getKwitansiDate(doc: GeneratedNota) {
  return doc.kwitansiDate?.trim() || doc.tanggal || doc.notaDate;
}

export function getKwitansiCity(doc: GeneratedNota, project: Project) {
  return doc.kwitansiCity?.trim() || project.regencyName || project.districtName;
}

export function getKwitansiPayerName(doc: GeneratedNota, project: Project) {
  return (
    doc.kwitansiPayerName?.trim() ||
    project.responsibleName?.trim() ||
    doc.projectMeta.responsibleName?.trim() ||
    ""
  );
}

function stageRoman(stageCode: StageCode) {
  if (stageCode === "TAHAP_I") return "I";
  if (stageCode === "TAHAP_II") return "II";
  if (stageCode === "TAHAP_III") return "III";
  if (stageCode === "TAHAP_IV") return "IV";
  return "IV";
}

export function getKwitansiStageText(stageCode: StageCode) {
  return `Pekerjaan Tahap ${stageRoman(stageCode)}`;
}

export function getKwitansiStageShortText(stageCode: StageCode) {
  return `Tahap ${stageRoman(stageCode)}`;
}

function cleanRole(value: string) {
  const role = value
    .replace(/\s*\(.+?\)\s*/g, "")
    .replace(/^pek\.\s*/i, "Pekerjaan ")
    .replace(/\btrampil\b/gi, "Terampil")
    .replace(/\s+/g, " ")
    .trim();

  const roleKey = normalized(role);
  if (/^(pembantu|kenek)\s+(sopir|supir)\b/.test(roleKey)) return "Kenek Supir";
  if (/^(sopir|supir)\b/.test(roleKey)) return "Supir";
  if (roleKey.includes("tukang listrik") || roleKey.includes("pekerja listrik")) return "Pekerja Listrik";
  return role;
}

function isPpmDoc(doc: GeneratedNota) {
  return doc.vendorId === "vendor-ppm" || normalized(doc.vendorName).includes("pratama project mandiri");
}

function isLemburDoc(doc: GeneratedNota) {
  return doc.categoryNames.some((category) => normalized(category).includes("tenaga lembur"));
}

function isOutsideCoreWork(doc: GeneratedNota) {
  return doc.stageCode === "RESUME_ALL" || doc.kwitansiGroupCode === "LUAR_INTI" || doc.items.some((item) => item.stageCode === "RESUME_ALL");
}

function isPpmServiceDoc(doc: GeneratedNota) {
  const itemName = normalized(doc.items[0]?.itemName);
  return isPpmDoc(doc) || itemName.includes("cut n fill") || itemName.includes("sumur bor");
}

function outsideWorkRole(doc: GeneratedNota) {
  const itemName = normalized(doc.items[0]?.itemName);
  if (itemName.includes("sosialisasi") || itemName.includes("rapat koordinasi")) return "Babinsa";
  if (
    itemName.includes("pencarian dan survei") ||
    itemName.includes("pengukuran lahan") ||
    itemName.includes("pembersihan lahan") ||
    itemName.includes("pematangan lahan")
  ) return "Mandor";
  return null;
}

function outsideCoreWorkName(doc: GeneratedNota, fallbackRole: string) {
  const raw = cleanRole(doc.items[0]?.itemName || fallbackRole);
  const text = normalized(raw);

  if (text.includes("pencarian") || text.includes("survei kelayakan lahan") || text.includes("survey kelayakan lahan")) {
    return "Pencarian dan Survei Kelayakan Lahan";
  }
  if (text.includes("sosialisasi")) return "Sosialisasi Pembangunan";
  if (text.includes("rapat koordinasi")) return "Rapat Koordinasi Pembangunan";
  if (text.includes("pengukuran lahan")) {
    return text.includes("persyaratan")
      ? "Proses Pengukuran Lahan Sesuai Persyaratan"
      : "Proses Pengukuran Lahan";
  }
  if (text.includes("pematangan lahan")) return "Pematangan Lahan";
  if (text.includes("pembersihan lahan")) return "Pembersihan Lahan";
  if (/\bcut\s+(?:n|and)?\s*fill\b/.test(text)) return "Cut n Fill";
  if (text.includes("sumur bor")) return "Sumur Bor";

  return raw;
}

function outsideCoreContextLine(workName: string, project: Project, dateText: string) {
  const text = normalized(workName);
  const prefix = text.endsWith("pembangunan") ? "" : "Pembangunan ";
  const dateSuffix = dateText ? ` pada tanggal ${dateText}` : "";
  return `${prefix}${formatProjectKdkmpWilayah(project)}${dateSuffix}`.trim();
}

export function getDefaultKwitansiRole(doc: GeneratedNota) {
  if (isPpmServiceDoc(doc)) return "Pemilik";
  if (isLemburDoc(doc)) return "Mandor";
  const outsideRole = outsideWorkRole(doc);
  if (outsideRole) return outsideRole;
  const first = doc.items[0];
  return first ? cleanRole(first.itemName) : doc.templateName;
}

export function getKwitansiRole(doc: GeneratedNota) {
  return doc.kwitansiRoleName?.trim() || getDefaultKwitansiRole(doc);
}

function itemDurationDays(item: ResumeItem) {
  const schedule = item as ResumeItem & {
    workDays?: number;
    workingDays?: number;
    durationDays?: number;
  };
  const explicitDays = [schedule.workDays, schedule.workingDays, schedule.durationDays]
    .find((value) => typeof value === "number" && Number.isFinite(value) && value > 0);
  if (explicitDays) return Math.max(1, Math.round(explicitDays));

  const unit = normalized(item.unit);
  const volume = Number(item.volume || 0);
  if (!Number.isFinite(volume) || volume <= 0) return 1;

  if (unit.includes("hari")) return Math.max(1, Math.round(volume));
  if (unit.includes("jam")) {
    const divisorMatch = /(\d+(?:[,.]\d+)?)\s*jam\s*\/\s*hari/i.exec(item.itemName);
    const isOvertime = normalized(item.categoryName ?? item.category).includes("tenaga lembur") || item.categoryCode === "E" || item.categoryCode === "I";
    const defaultDivisor = isOvertime ? 8 : 6;
    const divisor = divisorMatch ? Number(divisorMatch[1].replace(",", ".")) : defaultDivisor;
    return Math.max(1, Math.ceil(volume / (Number.isFinite(divisor) && divisor > 0 ? divisor : defaultDivisor)));
  }

  return 1;
}

function itemEndDate(item: ResumeItem) {
  const start = parseDate(item.expenseDate);
  if (!start) return null;
  const schedule = item as ResumeItem & {
    expenseEndDate?: string;
    endDate?: string;
    dateEnd?: string;
    tanggalSelesai?: string;
  };
  const explicitEnd = [schedule.expenseEndDate, schedule.endDate, schedule.dateEnd, schedule.tanggalSelesai]
    .map(parseDate)
    .find((date): date is Date => Boolean(date));
  if (explicitEnd) return explicitEnd;
  return addDays(start, itemDurationDays(item) - 1);
}

export function getKwitansiDateRange(doc: GeneratedNota, project: Project) {
  if (doc.kwitansiDate?.trim()) {
    const customRange = doc.kwitansiDate.trim().split(/\s+s\.?\s*d\.?\s+/i);
    if (customRange.length === 2) {
      const customStart = parseDate(customRange[0]);
      const customEnd = parseDate(customRange[1]);
      if (customStart && customEnd) return { start: toDateString(customStart), end: toDateString(customEnd) };
    }
    const override = parseDate(doc.kwitansiDate.trim());
    const value = override ? toDateString(override) : doc.kwitansiDate.trim();
    return { start: value, end: value };
  }

  const ranges = doc.items
    .map((item) => {
      const start = parseDate(item.expenseDate);
      if (!start) return null;
      return { start, end: itemEndDate(item) ?? start };
    })
    .filter((entry): entry is { start: Date; end: Date } => Boolean(entry));

  if (ranges.length === 0) {
    const fallback = parseDate(doc.tanggal) ?? parseDate(doc.notaDate) ?? parseDate(project.projectDate);
    const value = fallback ? toDateString(fallback) : "";
    return { start: value, end: value };
  }

  const start = ranges.reduce((min, entry) => (entry.start < min ? entry.start : min), ranges[0].start);
  const end = ranges.reduce((max, entry) => (entry.end > max ? entry.end : max), ranges[0].end);
  return { start: toDateString(start), end: toDateString(end) };
}

function isWorkRole(role: string) {
  const text = normalized(role);
  return (
    text.includes("mandor") ||
    text.includes("tukang") ||
    /\bpekerja(?:\s|$)/.test(text) ||
    text.includes("supir") ||
    text.includes("kenek")
  );
}

export function getDefaultKwitansiPaymentLines(doc: GeneratedNota, project: Project) {
  const role = getKwitansiRole(doc);
  const { start, end } = getKwitansiDateRange(doc, project);
  const startText = formatKwitansiDate(start);
  const endText = formatKwitansiDate(end || start);
  const stageText = getKwitansiStageText(doc.stageCode);

  if (isPpmDoc(doc)) {
    return [
      `Pembayaran Sewa Kebutuhan Peralatan dan Kendaraan ${getKwitansiStageShortText(doc.stageCode)}`,
      `Pembangunan ${formatProjectKdkmpWilayah(project)} Kec. ${project.districtName} Kab. ${project.regencyName}`,
    ];
  }

  if (isLemburDoc(doc)) {
    return [
      `Pembayaran Upah Lembur Mandor dan Pekerja Tanggal ${startText} s.d ${endText}`,
      `${getKwitansiStageShortText(doc.stageCode)} ${formatProjectKdkmpWilayah(project)}`,
    ];
  }

  if (isOutsideCoreWork(doc)) {
    const workName = outsideCoreWorkName(doc, role);
    return [
      `Pembayaran ${workName} ${outsideCoreContextLine(workName, project, startText)}`,
    ];
  }

  const prefix = isWorkRole(role) ? "Pembayaran Honor" : "Pembayaran";
  const dateText = !startText ? "" : startText === endText ? `Tanggal ${startText}` : `Tanggal ${startText} s.d ${endText}`;
  return [
    `${prefix} ${role} ${dateText}`.trim(),
    `Pembangunan ${formatProjectKdkmpWilayah(project)} ${stageText}`,
  ];
}

export function getDefaultKwitansiPaymentDescription(doc: GeneratedNota, project: Project) {
  return getDefaultKwitansiPaymentLines(doc, project).join("\n");
}

export function getKwitansiPaymentLines(doc: GeneratedNota, project: Project) {
  const custom = doc.kwitansiPaymentDescription?.trim();
  if (custom) return custom.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return getDefaultKwitansiPaymentLines(doc, project);
}

export function getKwitansiProjectLines(doc: GeneratedNota, project: Project) {
  const role = getKwitansiRole(doc);
  const customLocation = doc.kwitansiCity?.trim();
  if (customLocation) return [customLocation, role];
  if (isPpmServiceDoc(doc)) return ["CV. PRATAMA PROJECT MANDIRI", role];
  return [formatProjectKdkmpWilayah(project), role];
}
