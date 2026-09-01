import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { EXCEL_BASE_ROWS } from "../src/constants/excel-base-data.ts";

const ROOT = process.cwd();
const RUN_DATE = "20260831";
const STAMP = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const OUTPUT_DIR = path.join(ROOT, "reconstruction-output");
const EXECUTE = process.argv.includes("--execute");
const VERIFY_ONLY = process.argv.includes("--verify-only");
const MIN_QTY = Number(getArg("--min-qty") || 1);
const TEMPLATE_SOURCE_START_DATE = "2025-11-03";
const SIRNAGALIH_PATTERN_START_DATE = TEMPLATE_SOURCE_START_DATE;
const PAGE_SIZE = 1000;

const REQUESTED_PROJECTS = [
  { no: 1, kecamatan: "Cianjur", desa: "Desa Mekarsari", budget: 1_564_086_000, keterangan: "Belum di input di web", babinsa: "Sigit Soegiarto", projectDate: "2025-11-03" },
  { no: 2, kecamatan: "Cilaku", desa: "Desa Mulyasari", budget: 1_390_618_000, keterangan: "Belum di input di web", babinsa: "Ade Erawan", projectDate: "2025-11-08" },
  { no: 3, kecamatan: "Mande", desa: "Desa Mulyasari", budget: 1_445_218_000, keterangan: "Belum di input di web", babinsa: "Dindin Kamaludin", projectDate: "2025-11-30" },
  { no: 4, kecamatan: "Cipanas", desa: "Desa Cipanas", budget: 1_460_818_000, keterangan: "Belum di input di web", babinsa: "Asep Dedi Mulyadi", projectDate: "2025-12-17" },
  { no: 5, kecamatan: "Sukanagara", desa: "Desa Sindangsari", budget: 1_481_930_000, keterangan: "Belum Print", babinsa: "Jonny Sitorus", projectDate: "2026-01-13" },
  { no: 6, kecamatan: "Cilaku", desa: "Desa Sindangsari", budget: 1_393_618_000, keterangan: "Belum Print", babinsa: "Ahmad Shobirin", projectDate: "2026-01-14" },
  { no: 7, kecamatan: "Cidaun", desa: "Desa Karyabakti", budget: 1_566_308_000, keterangan: "Belum Print", babinsa: "Koswara", projectDate: "2026-01-29" },
  { no: 8, kecamatan: "Sukanagara", desa: "Desa Ciguha", budget: 1_481_952_000, keterangan: "Belum Print", babinsa: "Oggi Yuli Arfianto", projectDate: "2026-02-09" },
  { no: 9, kecamatan: "Cianjur", desa: "Kel. Muka", budget: 1_387_618_000, keterangan: "Belum Print", babinsa: "Rochman Pancaningrat", projectDate: "2026-03-02" },
  { no: 10, kecamatan: "Cidaun", desa: "Desa Jayapura", budget: 1_567_419_000, keterangan: "Belum Print", babinsa: "Asep Mulyana", projectDate: "2026-03-02" },
  { no: 11, kecamatan: "Cidaun", desa: "Desa Cibuluh", budget: 1_574_085_000, keterangan: "Belum Print", babinsa: "Tantowi", projectDate: "2026-03-08" },
  { no: 12, kecamatan: "Agrabinta", desa: "Desa Sinarlaut", budget: 1_554_898_000, keterangan: "Belum Print", babinsa: "Engkos Koswara", projectDate: "2026-03-10" },
  { no: 13, kecamatan: "Naringgul", desa: "Desa Sukabakti", budget: 1_580_751_000, keterangan: "Belum Print", babinsa: "Asep Kurniawan", projectDate: "2026-03-10" },
  { no: 14, kecamatan: "Cikalongkulon", desa: "Desa Cigunungherang", budget: 1_479_318_000, keterangan: "Belum Print", babinsa: "Wendy Ardiyanto", projectDate: "2026-03-27" },
  { no: 15, kecamatan: "Cidaun", desa: "Desa Kertajadi", budget: 1_569_641_000, keterangan: "Belum Print", babinsa: "Asep Irawan", projectDate: "2026-03-30" },
  { no: 16, kecamatan: "Cidaun", desa: "Desa Cisalak", budget: 1_570_752_000, keterangan: "Belum Print", babinsa: "Dadang Romansyah", projectDate: "2026-04-08" },
  { no: 17, kecamatan: "Naringgul", desa: "Desa Margasari", budget: 1_582_973_000, keterangan: "Belum Print", babinsa: "Awan Setiyawan", projectDate: "2026-04-09" },
  { no: 18, kecamatan: "Cidaun", desa: "Desa Cidamar", budget: 1_568_530_000, keterangan: "Belum Print", babinsa: "Prasetyo", projectDate: "2026-04-16" },
  { no: 19, kecamatan: "Takokak", desa: "Desa Waringinsari", budget: 1_482_084_000, keterangan: "Belum Print", babinsa: "Deni Hasanudin", projectDate: "2026-04-17" },
  { no: 20, kecamatan: "Naringgul", desa: "Desa Wangunjaya", budget: 1_579_640_000, keterangan: "Belum Print", babinsa: "Didin Hartono", projectDate: "2026-04-18" },
  { no: 21, kecamatan: "Agrabinta", desa: "Desa Tanjungsari", budget: 1_556_109_000, keterangan: "Belum Print", babinsa: "Basuni Priatna", projectDate: "2026-04-21" },
  { no: 22, kecamatan: "Agrabinta", desa: "Desa Bojongkaso", budget: 1_557_320_000, keterangan: "Belum Print", babinsa: "Aris Munandar", projectDate: "2026-04-28" },
  { no: 23, kecamatan: "Agrabinta", desa: "Desa Mekarsari", budget: 1_559_642_000, keterangan: "Belum Print", babinsa: "Asep Mulyana", projectDate: "2026-04-28" },
  { no: 24, kecamatan: "Tanggeung", desa: "Desa Sirnajaya", budget: 1_494_072_000, keterangan: "Belum Print", babinsa: "Suratno", projectDate: "2026-04-29" },
  { no: 25, kecamatan: "Cidaun", desa: "Desa Gelarpawitan", budget: 1_572_974_000, keterangan: "Belum Print", babinsa: "Apipudin", projectDate: "2026-05-04" },
  { no: 26, kecamatan: "Cidaun", desa: "Desa Karangwangi", budget: 1_571_863_000, keterangan: "Belum Print", babinsa: "Dasep Kurnia", projectDate: "2026-05-05" },
  { no: 27, kecamatan: "Cidaun", desa: "Desa Sukapura", budget: 1_576_307_000, keterangan: "Belum Print", babinsa: "Aris Rosandi", projectDate: "2026-05-10" },
  { no: 28, kecamatan: "Naringgul", desa: "Desa Wanasari", budget: 1_581_862_000, keterangan: "Belum Print", babinsa: "Dodi Hidayat", projectDate: "2026-05-10" },
  { no: 29, kecamatan: "Agrabinta", desa: "Desa Bunisari", budget: 1_558_531_000, keterangan: "Belum Print", babinsa: "Hendra Dili Rosadi", projectDate: "2026-05-11" },
  { no: 30, kecamatan: "Cidaun", desa: "Desa Cimaragang", budget: 1_575_196_000, keterangan: "Belum Print", babinsa: "Hamzah", projectDate: "2026-05-12" },
  { no: 31, kecamatan: "Agrabinta", desa: "Desa Neglasari", budget: 1_564_086_000, keterangan: "Belum Print", babinsa: "Satria Bangun Samudra", projectDate: "2026-05-14" },
  { no: 32, kecamatan: "Agrabinta", desa: "Desa Wangunjaya", budget: 1_562_975_000, keterangan: "Belum Print", babinsa: "Gian Sugiarto", projectDate: "2026-05-16" },
  { no: 33, kecamatan: "Cikadu", desa: "Desa Kalapanunggal", budget: 1_543_999_000, keterangan: "Belum Print", babinsa: "Mulyadi", projectDate: "2026-05-17" },
  { no: 34, kecamatan: "Agrabinta", desa: "Desa Mulyasari", budget: 1_560_753_000, keterangan: "Belum Print", babinsa: "Agus Kusnadi", projectDate: "2026-05-19" },
];

const STAGE_LABELS = {
  TAHAP_I: "I - PEKERJAAN PERSIAPAN",
  TAHAP_II: "II - PEKERJAAN STRUKTUR",
  TAHAP_III: "III - PEKERJAAN ARSITEKTUR",
  TAHAP_IV: "IV - PEKERJAAN MEKANIKAL",
  TAHAP_V: "V - PEKERJAAN ELEKTRIKAL",
  TAHAP_VI: "VI - PEKERJAAN DI LUAR KONSTRUKSI INTI",
  TAHAP_VII: "VII. DUKUNGAN OPERASIONAL GERAI",
};

const STAGE_ORDER = Object.keys(STAGE_LABELS);
const VENDOR_IDS = {
  "MURAH MAJU": "vendor-murah-maju",
  AMANAH: "vendor-amanah",
  CBB: "vendor-cbb",
  CBS: "vendor-cbs",
  MANDAU: "vendor-mandau",
  PPM: "vendor-ppm",
  HPM: "vendor-hpm",
  "CAHAYA TIMUR": "vendor-cahaya-timur",
  "CAHAYA TIMUR KERAMIK": "vendor-cahaya-timur",
  PLN: "vendor-pln",
  "JASA ELEKTRIK": "vendor-jasa-elektrik",
  KWITANSI: "vendor-kwitansi",
  "NOTA KOSONG": "vendor-internal",
};

function getArg(name) {
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .flatMap((rawLine) => {
        const line = rawLine.trim();
        if (!line || line.startsWith("#") || !line.includes("=")) return [];
        const separator = line.indexOf("=");
        const key = line.slice(0, separator).trim();
        let value = line.slice(separator + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        return [[key, value]];
      }),
  );
}

const env = { ...loadEnvFile(path.join(ROOT, ".env.local")), ...process.env };
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL dan Supabase key belum tersedia di .env.local.");
}

function cleanText(value) {
  return String(value ?? "")
    .replaceAll("Ãƒâ€š", "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeName(value) {
  const normalized = cleanText(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^(desa|ds|kel|kelurahan)\.?\s+/, "")
    .replace(/[^a-z0-9]+/g, "");
  const aliases = {
    bungbangsari: "bumbangsari",
    pagermaneuh: "pagermaneh",
    pasirdalem: "pasirdalam",
    wariginsari: "waringinsari",
  };
  return aliases[normalized] ?? normalized;
}

function displayVillageName(rawName) {
  return cleanText(rawName).replace(/^(desa|ds|kel|kelurahan)\.?\s+/i, "").trim();
}

function wilayahType(rawName) {
  return /^(kel|kelurahan)\.?\s+/i.test(cleanText(rawName)) ? "kelurahan" : "desa";
}

function projectKey(project) {
  return `${normalizeName(project.nama_desa || project.desa)}|${normalizeName(project.kecamatan)}`;
}

function requestKey(row) {
  return `${normalizeName(row.desa)}|${normalizeName(row.kecamatan)}`;
}

function recipientPrefix(type) {
  return type === "kelurahan" ? "Kelurahan" : "Desa";
}

function invoiceRecipientName(name, type) {
  return `KDKMP ${recipientPrefix(type)} ${name}`;
}

function invoiceRecipientAddress(name, kecamatan, type) {
  return `${recipientPrefix(type)} ${name}, Kec. ${kecamatan}, Kab. Cianjur`;
}

function dateToUtc(value) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function shiftDate(value, projectDate) {
  const base = dateToUtc(TEMPLATE_SOURCE_START_DATE);
  const pattern = dateToUtc(SIRNAGALIH_PATTERN_START_DATE);
  const source = dateToUtc(value);
  const target = dateToUtc(projectDate) ?? base;
  if (!base || !pattern || !source || !target) return value;
  const templateToPatternDays = Math.round((pattern.getTime() - base.getTime()) / 86400000);
  const patternToTargetDays = Math.round((target.getTime() - pattern.getTime()) / 86400000);
  const days = templateToPatternDays + patternToTargetDays;
  const shifted = new Date(source.getTime() + days * 86400000);
  return shifted.toISOString().slice(0, 10);
}

function uuidFor(projectId, excelRow) {
  const hash = crypto.createHash("sha1").update(`${projectId}:excel-resume:${excelRow}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function vendorId(name) {
  return VENDOR_IDS[String(name ?? "").trim()] ?? null;
}

function num(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value) {
  return Math.round(num(value));
}

function round2(value) {
  return Math.round((num(value) + Number.EPSILON) * 100) / 100;
}

function bool(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function amountOf(item) {
  if (bool(item.is_jumlah_manual) && item.jumlah_override != null && item.jumlah_override !== "") {
    return money(item.jumlah_override);
  }
  return money(num(item.qty) * num(item.harga_satuan));
}

function included(item) {
  return item.is_included_in_resume_total !== false && item.is_included_in_resume_total !== "false";
}

function projectTotal(items) {
  return items.filter(included).reduce((sum, item) => sum + amountOf(item), 0);
}

function normalizeText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasBesiSize(item, size) {
  return new RegExp(`\\b${size}\\b`).test(normalizeText(item.uraian ?? item.itemName ?? ""));
}

function isCbbSteelAdjuster(item) {
  const name = normalizeText(item.uraian ?? item.itemName ?? "");
  return item.vendor_id === "vendor-cbb" && name.includes("besi") && (hasBesiSize(item, "13") || hasBesiSize(item, "10") || hasBesiSize(item, "8"));
}

function isBesi13(item) {
  const name = normalizeText(item.uraian ?? item.itemName ?? "");
  return item.vendor_id === "vendor-cbb" && name.includes("besi") && hasBesiSize(item, "13");
}

function isInternalFineAdjuster(item) {
  const name = normalizeText(item.uraian ?? item.itemName ?? "");
  return item.vendor_id === "vendor-internal" && (name.includes("air kerja") || name.includes("bbm") || name.includes("solar"));
}

function isFlexAdjuster(item) {
  return included(item) && num(item.harga_satuan) > 0 && (isCbbSteelAdjuster(item) || isInternalFineAdjuster(item));
}

function adjusterRankForIncrease(item) {
  const name = normalizeText(item.uraian);
  if (isBesi13(item)) return 0;
  if (name.includes("10")) return 1;
  if (name.includes("8")) return 2;
  if (name.includes("air kerja")) return 3;
  if (name.includes("solar") || name.includes("bbm")) return 4;
  return 9;
}

function adjusterRankForDecrease(item) {
  const name = normalizeText(item.uraian);
  if (name.includes("10")) return 0;
  if (name.includes("8")) return 1;
  if (name.includes("air kerja")) return 2;
  if (name.includes("solar") || name.includes("bbm")) return 3;
  if (isBesi13(item)) return 4;
  return 9;
}

const terbilangUnits = ["", "Satu", "Dua", "Tiga", "Empat", "Lima", "Enam", "Tujuh", "Delapan", "Sembilan", "Sepuluh", "Sebelas"];
function spellUnderThousand(value) {
  if (value < 12) return terbilangUnits[value];
  if (value < 20) return `${spellUnderThousand(value - 10)} Belas`;
  if (value < 100) return `${spellUnderThousand(Math.floor(value / 10))} Puluh ${spellUnderThousand(value % 10)}`.trim();
  if (value < 200) return `Seratus ${spellUnderThousand(value - 100)}`.trim();
  return `${spellUnderThousand(Math.floor(value / 100))} Ratus ${spellUnderThousand(value % 100)}`.trim();
}

function terbilangRupiah(value) {
  const integer = Math.floor(Math.abs(num(value)));
  if (integer === 0) return "Nol Rupiah";
  const groups = [
    { value: 1_000_000_000_000, label: "Triliun" },
    { value: 1_000_000_000, label: "Milyar" },
    { value: 1_000_000, label: "Juta" },
    { value: 1_000, label: "Ribu" },
  ];
  let rest = integer;
  const parts = [];
  for (const group of groups) {
    const count = Math.floor(rest / group.value);
    if (!count) continue;
    parts.push(group.value === 1_000 && count === 1 ? "Seribu" : `${spellUnderThousand(count)} ${group.label}`);
    rest %= group.value;
  }
  if (rest > 0) parts.push(spellUnderThousand(rest));
  return `${parts.join(" ").replace(/\s+/g, " ").trim()} Rupiah`;
}

function makeProjectRow(input) {
  const desa = displayVillageName(input.desa);
  const type = wilayahType(input.desa);
  const recipientName = invoiceRecipientName(desa, type);
  const recipientAddress = invoiceRecipientAddress(desa, input.kecamatan, type);
  return {
    nama_desa: desa,
    jenis_wilayah: type,
    kecamatan: input.kecamatan,
    kabupaten: "Cianjur",
    nama_project: "Pembangunan Gedung KDKMP",
    wilayah: "KODIM 0608/CIANJUR",
    kodim: "KODIM 0608/CIANJUR",
    tanggal_laporan: input.projectDate,
    project_date: input.projectDate,
    status: "draft",
    metadata_json: {
      template_id: "master-template-kdkmp-v1",
      jenis_wilayah: type,
      wilayah_type: type,
      babinsa_responsible_name: input.babinsa,
      responsible_name: input.babinsa,
      coordinates: "",
      invoice_recipient_name: recipientName,
      invoice_recipient_address: recipientAddress,
      target_grand_total_resume: input.budget,
      requested_input_no: input.no,
      requested_input_note: input.keterangan,
      requested_input_batch: RUN_DATE,
    },
  };
}

function makeItem(project, source, index) {
  const qty = num(source.volume);
  const unitPrice = num(source.unitPrice);
  const templateComputedAmount = money(qty * unitPrice);
  const isManualAmount = templateComputedAmount !== money(source.amount);
  const amount = isManualAmount ? money(source.amount) : templateComputedAmount;
  const category = `${source.categoryCode} ${source.categoryName}`;
  return {
    id: uuidFor(project.id, source.excelRow),
    project_id: project.id,
    tahap: source.stageCode,
    stage_id: source.stageCode,
    stage_name: STAGE_LABELS[source.stageCode],
    category_code: source.categoryCode,
    category_name: source.categoryName,
    item_no: source.categoryCode,
    kategori: category,
    tanggal: shiftDate(source.date, project.project_date),
    uraian: source.itemName,
    qty,
    satuan: source.unit,
    harga_satuan: unitPrice,
    jumlah: amount,
    jumlah_override: isManualAmount ? amount : null,
    is_jumlah_manual: isManualAmount,
    vendor: source.vendorName,
    vendor_id: vendorId(source.vendorName),
    source_file: "G.xlsx",
    source_page: null,
    source_row: source.excelRow,
    is_manual_added: false,
    is_included_in_resume_total: true,
    is_generated_to_note: false,
    note_id: null,
    category_total: null,
    stage_total: null,
    source_type: "excel",
    validation_status: isManualAmount ? "warning" : "valid",
    notes: "",
    urutan: index + 1,
  };
}

function setComputed(item) {
  item.jumlah = money(num(item.qty) * num(item.harga_satuan));
  item.jumlah_override = null;
  item.is_jumlah_manual = false;
}

function buildBaseItems(project) {
  return EXCEL_BASE_ROWS.map((source, index) => makeItem(project, source, index));
}

function adjustItemsToTarget(project, items, targetTotal) {
  const currentTotal = projectTotal(items);
  let remaining = targetTotal - currentTotal;
  const adjustments = [];
  if (remaining === 0) return { items, currentTotal, targetTotal, adjustments, errors: [] };

  const adjusters = items
    .filter(isFlexAdjuster)
    .sort((left, right) => adjusterRankForIncrease(left) - adjusterRankForIncrease(right) || num(right.harga_satuan) - num(left.harga_satuan));

  const errors = [];
  if (!adjusters.length) {
    return { items, currentTotal, targetTotal, adjustments, errors: [`${project.nama_desa}/${project.kecamatan} tidak punya item CBB/Nota Kosong untuk penyesuaian`] };
  }

  const addChange = (before, after, role) => {
    const amountDelta = amountOf(after) - amountOf(before);
    if (amountDelta === 0) return;
    adjustments.push({
      project_id: project.id,
      desa: project.nama_desa,
      kecamatan: project.kecamatan,
      role,
      item_id: after.id,
      source_row: after.source_row,
      vendor: after.vendor,
      vendor_id: after.vendor_id,
      item_name: after.uraian,
      qty_before: before.qty,
      qty_after: after.qty,
      unit: after.satuan,
      price: after.harga_satuan,
      amount_before: amountOf(before),
      amount_after: amountOf(after),
      amount_delta: amountDelta,
    });
  };

  if (remaining > 0) {
    const steel = adjusters
      .filter(isCbbSteelAdjuster)
      .sort((a, b) => adjusterRankForIncrease(a) - adjusterRankForIncrease(b) || num(b.harga_satuan) - num(a.harga_satuan));
    for (const item of steel) {
      if (remaining <= 0) break;
      const price = money(item.harga_satuan);
      const units = Math.floor(remaining / price);
      if (units <= 0) continue;
      const before = { ...item };
      item.qty = round2(num(item.qty) + units);
      setComputed(item);
      remaining -= units * price;
      addChange(before, item, "TARGET_INCREASE_CBB_STEEL");
    }

    if (remaining > 0) {
      const fine = adjusters
        .filter(isInternalFineAdjuster)
        .sort((a, b) => (normalizeText(a.uraian).includes("air kerja") ? -1 : 1) - (normalizeText(b.uraian).includes("air kerja") ? -1 : 1) || num(a.harga_satuan) - num(b.harga_satuan))[0];
      if (!fine) {
        errors.push(`${project.nama_desa}/${project.kecamatan} sisa ${remaining} tidak punya item Nota Kosong penyerap`);
      } else {
        const before = { ...fine };
        fine.qty = round2(num(fine.qty) + remaining / num(fine.harga_satuan));
        setComputed(fine);
        remaining += amountOf(before) - amountOf(fine);
        addChange(before, fine, "TARGET_INCREASE_INTERNAL_FINE");
      }
    }
  } else {
    let decrease = Math.abs(remaining);
    const reducers = adjusters
      .slice()
      .sort((a, b) => adjusterRankForDecrease(a) - adjusterRankForDecrease(b) || num(b.harga_satuan) - num(a.harga_satuan));
    for (const item of reducers) {
      if (decrease <= 0) break;
      const price = money(item.harga_satuan);
      const minQty = isBesi13(item) ? Math.max(MIN_QTY, 1) : MIN_QTY;
      const maxWholeUnits = Math.max(0, Math.floor(num(item.qty) - minQty));
      const units = Math.min(maxWholeUnits, Math.floor(decrease / price));
      if (units <= 0) continue;
      const before = { ...item };
      item.qty = round2(num(item.qty) - units);
      setComputed(item);
      decrease += amountOf(item) - amountOf(before);
      addChange(before, item, isCbbSteelAdjuster(item) ? "TARGET_DECREASE_CBB_STEEL" : "TARGET_DECREASE_INTERNAL_FINE");
    }

    if (decrease > 0) {
      const fine = reducers.find((item) => isInternalFineAdjuster(item) && num(item.qty) > MIN_QTY);
      if (fine) {
        const before = { ...fine };
        const qtyDelta = decrease / num(fine.harga_satuan);
        if (qtyDelta > 0 && num(fine.qty) - qtyDelta >= MIN_QTY) {
          fine.qty = round2(num(fine.qty) - qtyDelta);
          setComputed(fine);
          decrease += amountOf(fine) - amountOf(before);
          addChange(before, fine, "TARGET_DECREASE_INTERNAL_DECIMAL");
        }
      }
    }
    remaining = -decrease;
  }

  const finalTotal = projectTotal(items);
  if (finalTotal !== targetTotal) errors.push(`${project.nama_desa}/${project.kecamatan} final ${finalTotal} != target ${targetTotal}`);
  for (const item of items) {
    if (isBesi13(item) && num(item.qty) <= 0) errors.push(`${project.nama_desa}/${project.kecamatan} Besi 13 qty nol`);
    if (isFlexAdjuster(item) && num(item.qty) < MIN_QTY) errors.push(`${project.nama_desa}/${project.kecamatan} flex qty di bawah minimum`);
  }

  return { items, currentTotal, targetTotal, adjustments, errors };
}

function makeStructure(project, items) {
  const stages = STAGE_ORDER.map((stageCode, index) => ({
    project_id: project.id,
    stage_id: stageCode,
    stage_name: STAGE_LABELS[stageCode],
    sort_order: index + 1,
    source_total: items.filter((item) => item.stage_id === stageCode && included(item)).reduce((total, item) => total + amountOf(item), 0),
  }));
  const categoryMap = new Map();
  for (const item of items.filter(included)) {
    const key = `${item.stage_id}:${item.category_code}`;
    const current = categoryMap.get(key) ?? {
      project_id: project.id,
      stage_id: item.stage_id,
      category_code: item.category_code,
      category_name: item.category_name,
      sort_order: categoryMap.size + 1,
      source_total: 0,
    };
    current.source_total += amountOf(item);
    categoryMap.set(key, current);
  }
  return { stages, categories: [...categoryMap.values()] };
}

function makeSummary(projectId, items) {
  const totalFor = (stageCode) => items.filter((item) => included(item) && item.stage_id === stageCode).reduce((total, item) => total + amountOf(item), 0);
  const totalTahap1 = totalFor("TAHAP_I");
  const totalTahap2 = totalFor("TAHAP_II");
  const totalTahap3 = totalFor("TAHAP_III");
  const totalTahap4 = totalFor("TAHAP_IV");
  const totalDiluar = totalFor("TAHAP_VI") + totalFor("TAHAP_VII") + totalFor("RESUME_ALL");
  const totalKeseluruhan = items.filter(included).reduce((total, item) => total + amountOf(item), 0);
  return {
    project_id: projectId,
    total_tahap_1: totalTahap1,
    total_tahap_2: totalTahap2,
    total_tahap_3: totalTahap3,
    total_tahap_4: totalTahap4,
    total_diluar_konstruksi: totalDiluar,
    total_keseluruhan: totalKeseluruhan,
    terbilang: terbilangRupiah(totalKeseluruhan),
  };
}

async function supabaseRequest(table, { method = "GET", query = {}, body, prefer = "return=representation" } = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: prefer,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${table} ${response.status}: ${responseText.slice(0, 1500)}`);
  }
  return responseText ? JSON.parse(responseText) : [];
}

async function fetchAll(table, select = "*", order = "") {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await supabaseRequest(table, {
      query: {
        select,
        limit: String(PAGE_SIZE),
        offset: String(offset),
        ...(order ? { order } : {}),
      },
    });
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function insertRows(table, rows, chunkSize = 500) {
  let total = 0;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const batch = rows.slice(index, index + chunkSize);
    await supabaseRequest(table, {
      method: "POST",
      body: batch,
      prefer: "return=minimal",
    });
    total += batch.length;
  }
  return total;
}

async function cleanupProject(projectId) {
  await supabaseRequest("projects", {
    method: "DELETE",
    query: { id: `eq.${projectId}` },
    prefer: "return=minimal",
  });
}

function csvEscape(value) {
  const textValue = value == null ? "" : String(value);
  return /[",\r\n]/.test(textValue) ? `"${textValue.replaceAll('"', '""')}"` : textValue;
}

function writeCsv(fileName, rows, columns = null) {
  const headers = columns ?? (rows.length ? Object.keys(rows[0]) : []);
  const lines = [headers.join(","), ...rows.map((row) => headers.map((column) => csvEscape(row[column])).join(","))];
  fs.writeFileSync(path.join(OUTPUT_DIR, fileName), `${lines.join("\n")}\n`, "utf8");
}

function addToMap(map, key, value) {
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

function planRowsFor(existingProjects) {
  const existingByKey = new Map();
  for (const project of existingProjects) addToMap(existingByKey, projectKey(project), project);

  return REQUESTED_PROJECTS.map((input) => {
    const key = requestKey(input);
    const existing = existingByKey.get(key) ?? [];
    const projectRow = makeProjectRow(input);
    return {
      no: input.no,
      action: existing.length ? "SKIP_EXISTING" : "CREATE",
      existing_count: existing.length,
      existing_project_ids: existing.map((project) => project.id).join(";"),
      desa_input: input.desa,
      desa_database: projectRow.nama_desa,
      jenis_wilayah: projectRow.jenis_wilayah,
      kecamatan: input.kecamatan,
      target_budget: input.budget,
      babinsa: input.babinsa,
      project_date: input.projectDate,
      keterangan: input.keterangan,
      match_key: key,
    };
  });
}

function validateRequestedRows() {
  const errors = [];
  const keys = new Map();
  for (const input of REQUESTED_PROJECTS) {
    if (!dateToUtc(input.projectDate)) errors.push(`Tanggal invalid no ${input.no}: ${input.projectDate}`);
    if (!input.budget || input.budget <= 0) errors.push(`Budget invalid no ${input.no}: ${input.budget}`);
    const key = requestKey(input);
    if (keys.has(key)) errors.push(`Duplikat input ${key}: no ${keys.get(key)} dan ${input.no}`);
    keys.set(key, input.no);
  }
  return errors;
}

async function createProjectBundle(input) {
  const projectRow = makeProjectRow(input);
  const insertedProjects = await supabaseRequest("projects", {
    method: "POST",
    body: projectRow,
    prefer: "return=representation",
  });
  const project = Array.isArray(insertedProjects) ? insertedProjects[0] : insertedProjects;
  if (!project?.id) throw new Error(`Insert project gagal untuk ${projectRow.nama_desa}/${projectRow.kecamatan}`);

  try {
    const items = buildBaseItems(project);
    const adjusted = adjustItemsToTarget(project, items, input.budget);
    if (adjusted.errors.length) throw new Error(adjusted.errors.join("; "));
    const { stages, categories } = makeStructure(project, adjusted.items);
    const summary = makeSummary(project.id, adjusted.items);

    await insertRows("resume_items", adjusted.items, 500);
    await insertRows("resume_stages", stages, 100);
    await insertRows("resume_categories", categories, 100);
    await supabaseRequest("resume_summaries", {
      method: "POST",
      query: { on_conflict: "project_id" },
      body: summary,
      prefer: "resolution=merge-duplicates,return=minimal",
    });
    await supabaseRequest("note_history", {
      method: "POST",
      body: {
        project_id: project.id,
        action: "project_created",
        description: `Project ${invoiceRecipientName(project.nama_desa, project.jenis_wilayah)} dibuat dari batch input ${RUN_DATE}.`,
      },
      prefer: "return=minimal",
    });

    return { project, items: adjusted.items, stages, categories, summary, adjustments: adjusted.adjustments, currentTotal: adjusted.currentTotal };
  } catch (error) {
    await cleanupProject(project.id);
    throw error;
  }
}

async function verifyRequestedProjects() {
  const [projects, items, summaries] = await Promise.all([
    fetchAll("projects", "id,nama_desa,jenis_wilayah,kecamatan,kabupaten,nama_project,wilayah,kodim,tanggal_laporan,project_date,metadata_json,status,created_at,updated_at", "kecamatan.asc,nama_desa.asc"),
    fetchAll("resume_items", "id,project_id,tahap,stage_id,uraian,qty,satuan,harga_satuan,jumlah,jumlah_override,is_jumlah_manual,vendor,vendor_id,source_row,is_included_in_resume_total", "project_id.asc,urutan.asc"),
    fetchAll("resume_summaries", "*"),
  ]);
  const projectsByKey = new Map();
  for (const project of projects) addToMap(projectsByKey, projectKey(project), project);
  const itemsByProject = new Map();
  for (const item of items) addToMap(itemsByProject, item.project_id, item);
  const summaryByProject = new Map(summaries.map((summary) => [summary.project_id, summary]));

  const verifyRows = [];
  const errors = [];
  for (const input of REQUESTED_PROJECTS) {
    const key = requestKey(input);
    const matched = projectsByKey.get(key) ?? [];
    if (matched.length !== 1) {
      errors.push(`${input.desa}/${input.kecamatan} project match ${matched.length}/1`);
      verifyRows.push({
        no: input.no,
        desa: displayVillageName(input.desa),
        kecamatan: input.kecamatan,
        status: "ERROR",
        reason: `project match ${matched.length}/1`,
      });
      continue;
    }
    const project = matched[0];
    const projectItems = itemsByProject.get(project.id) ?? [];
    const summary = summaryByProject.get(project.id);
    const calculated = projectTotal(projectItems);
    const rowErrors = [];
    const expectedType = wilayahType(input.desa);
    if (project.nama_desa !== displayVillageName(input.desa)) rowErrors.push("nama_desa");
    if (project.jenis_wilayah !== expectedType) rowErrors.push("jenis_wilayah");
    if (project.kecamatan !== input.kecamatan) rowErrors.push("kecamatan");
    if (project.project_date !== input.projectDate) rowErrors.push("project_date");
    if (project.tanggal_laporan !== input.projectDate) rowErrors.push("tanggal_laporan");
    if (cleanText(project.metadata_json?.babinsa_responsible_name) !== input.babinsa) rowErrors.push("babinsa");
    if (money(project.metadata_json?.target_grand_total_resume) !== input.budget) rowErrors.push("metadata_target");
    if (projectItems.length !== EXCEL_BASE_ROWS.length) rowErrors.push(`item_count_${projectItems.length}`);
    if (calculated !== input.budget) rowErrors.push(`calculated_${calculated}`);
    if (!summary || money(summary.total_keseluruhan) !== input.budget) rowErrors.push("summary_target");
    const zeroBesi13 = projectItems.filter((item) => isBesi13(item) && num(item.qty) <= 0).length;
    if (zeroBesi13) rowErrors.push(`besi13_zero_${zeroBesi13}`);
    if (rowErrors.length) errors.push(`${input.desa}/${input.kecamatan}: ${rowErrors.join(", ")}`);
    verifyRows.push({
      no: input.no,
      project_id: project.id,
      desa: project.nama_desa,
      jenis_wilayah: project.jenis_wilayah,
      kecamatan: project.kecamatan,
      project_date: project.project_date,
      babinsa: project.metadata_json?.babinsa_responsible_name ?? "",
      target_budget: input.budget,
      calculated_total: calculated,
      summary_total: summary?.total_keseluruhan ?? "",
      item_count: projectItems.length,
      status: rowErrors.length ? "ERROR" : "VERIFIED",
      reason: rowErrors.join("; "),
    });
  }

  return { verifyRows, errors };
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const validationErrors = validateRequestedRows();
  const [projects, summaries, notes] = await Promise.all([
    fetchAll("projects", "id,nama_desa,jenis_wilayah,kecamatan,metadata_json,project_date,tanggal_laporan,status"),
    fetchAll("resume_summaries", "*"),
    fetchAll("generated_notes", "id,project_id,total"),
  ]);

  if (VERIFY_ONLY) {
    const { verifyRows, errors: verifyErrors } = await verifyRequestedProjects();
    const allErrors = [...validationErrors, ...verifyErrors];
    writeCsv(`new_villages_verify_${RUN_DATE}.csv`, verifyRows);
    const reportPath = path.join(OUTPUT_DIR, `new_villages_add_report_${STAMP}.json`);
    const verifyReport = {
      generated_at: new Date().toISOString(),
      mode: "VERIFY_ONLY",
      requested_rows: REQUESTED_PROJECTS.length,
      existing_live_projects: projects.length,
      existing_resume_summaries: summaries.length,
      existing_generated_notes: notes.length,
      verified_rows: verifyRows.length,
      verified_count: verifyRows.filter((row) => row.status === "VERIFIED").length,
      verify_errors: allErrors,
      output_files: {
        verify: `new_villages_verify_${RUN_DATE}.csv`,
      },
      status: allErrors.length ? "VERIFY_ERRORS" : "VERIFIED",
    };
    fs.writeFileSync(reportPath, `${JSON.stringify(verifyReport, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ status: verifyReport.status, report_path: reportPath, ...verifyReport }, null, 2));
    if (allErrors.length) process.exitCode = 2;
    return;
  }

  const planRows = planRowsFor(projects);
  const createRows = planRows.filter((row) => row.action === "CREATE");
  const skippedRows = planRows.filter((row) => row.action !== "CREATE");
  const dryRunAdjustments = [];
  const dryRunErrors = [...validationErrors];

  for (const row of createRows) {
    const input = REQUESTED_PROJECTS.find((candidate) => candidate.no === row.no);
    const dryProject = { id: `dry-run-${row.match_key}`, ...makeProjectRow(input) };
    const items = buildBaseItems(dryProject);
    const adjusted = adjustItemsToTarget(dryProject, items, input.budget);
    dryRunAdjustments.push(...adjusted.adjustments.map((adjustment) => ({
      ...adjustment,
      project_id: "",
      no: input.no,
      desa: row.desa_database,
      kecamatan: row.kecamatan,
    })));
    dryRunErrors.push(...adjusted.errors);
    row.base_total = adjusted.currentTotal;
    row.planned_total = projectTotal(adjusted.items);
    row.planned_delta = input.budget - adjusted.currentTotal;
    row.planned_adjustment_count = adjusted.adjustments.length;
  }

  writeCsv(`new_villages_requested_${RUN_DATE}.csv`, REQUESTED_PROJECTS.map((row) => ({
    ...row,
    desa_database: displayVillageName(row.desa),
    jenis_wilayah: wilayahType(row.desa),
    match_key: requestKey(row),
  })));
  writeCsv(`new_villages_plan_${RUN_DATE}.csv`, planRows);
  writeCsv(`new_villages_adjustments_${RUN_DATE}.csv`, dryRunAdjustments);

  const baseReport = {
    generated_at: new Date().toISOString(),
    mode: EXECUTE ? "EXECUTE" : "DRY_RUN",
    requested_rows: REQUESTED_PROJECTS.length,
    existing_live_projects_before: projects.length,
    existing_resume_summaries_before: summaries.length,
    existing_generated_notes_before: notes.length,
    create_count: createRows.length,
    skipped_existing_count: skippedRows.length,
    skipped_existing_rows: skippedRows,
    planned_adjustment_rows: dryRunAdjustments.length,
    plan_errors: dryRunErrors,
    output_files: {
      requested: `new_villages_requested_${RUN_DATE}.csv`,
      plan: `new_villages_plan_${RUN_DATE}.csv`,
      adjustments: `new_villages_adjustments_${RUN_DATE}.csv`,
      verify: `new_villages_verify_${RUN_DATE}.csv`,
    },
  };

  const reportPath = path.join(OUTPUT_DIR, `new_villages_add_report_${STAMP}.json`);
  if (dryRunErrors.length) {
    fs.writeFileSync(reportPath, `${JSON.stringify({ ...baseReport, status: "BLOCKED_PREVERIFY" }, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ status: "BLOCKED_PREVERIFY", report_path: reportPath, ...baseReport }, null, 2));
    process.exitCode = 2;
    return;
  }

  if (!EXECUTE) {
    fs.writeFileSync(reportPath, `${JSON.stringify({ ...baseReport, status: "DRY_RUN_READY" }, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ status: "DRY_RUN_READY", report_path: reportPath, ...baseReport }, null, 2));
    return;
  }

  const backup = {
    created_at: new Date().toISOString(),
    purpose: "before_new_requested_villages_insert",
    requested_projects: REQUESTED_PROJECTS,
    matching_existing_projects: projects.filter((project) => new Set(REQUESTED_PROJECTS.map(requestKey)).has(projectKey(project))),
    existing_project_count: projects.length,
    existing_resume_summary_count: summaries.length,
    existing_generated_note_count: notes.length,
    plan: baseReport,
  };
  const backupPath = path.join(OUTPUT_DIR, `new_villages_add_backup_${STAMP}.json`);
  const backupText = `${JSON.stringify(backup, null, 2)}\n`;
  fs.writeFileSync(backupPath, backupText, "utf8");
  fs.writeFileSync(`${backupPath}.sha256`, `${crypto.createHash("sha256").update(backupText).digest("hex")}  ${path.basename(backupPath)}\n`, "utf8");

  const createdRows = [];
  const executedAdjustments = [];
  for (const row of createRows) {
    const input = REQUESTED_PROJECTS.find((candidate) => candidate.no === row.no);
    const created = await createProjectBundle(input);
    createdRows.push({
      no: input.no,
      project_id: created.project.id,
      desa: created.project.nama_desa,
      jenis_wilayah: created.project.jenis_wilayah,
      kecamatan: created.project.kecamatan,
      target_budget: input.budget,
      base_total: created.currentTotal,
      final_total: created.summary.total_keseluruhan,
      items_inserted: created.items.length,
      stages_inserted: created.stages.length,
      categories_inserted: created.categories.length,
      adjustment_count: created.adjustments.length,
    });
    executedAdjustments.push(...created.adjustments.map((adjustment) => ({
      ...adjustment,
      no: input.no,
    })));
  }
  writeCsv(`new_villages_created_${RUN_DATE}.csv`, createdRows);
  writeCsv(`new_villages_adjustments_${RUN_DATE}.csv`, executedAdjustments);

  const { verifyRows, errors: verifyErrors } = await verifyRequestedProjects();
  writeCsv(`new_villages_verify_${RUN_DATE}.csv`, verifyRows);

  const finalReport = {
    ...baseReport,
    mode: "EXECUTED",
    backup_path: backupPath,
    created_projects: createdRows.length,
    created_project_rows: createdRows,
    executed_adjustment_rows: executedAdjustments.length,
    verify_errors: verifyErrors,
    status: verifyErrors.length ? "EXECUTED_WITH_VERIFY_ERRORS" : "EXECUTED_VERIFIED",
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(finalReport, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ status: finalReport.status, report_path: reportPath, ...finalReport }, null, 2));
  if (verifyErrors.length) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
