import crypto from "node:crypto";
import { EXCEL_BASE_ROWS } from "../src/constants/excel-base-data.ts";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const APPLY = process.argv.includes("--apply");
const OVERWRITE_FINANCIALS = process.argv.includes("--overwrite-financials");
const DELETE_STALE_ITEMS = process.argv.includes("--delete-stale-items");
const PROJECT_FILTER = process.argv.find((arg) => arg.startsWith("--project-id="))?.slice("--project-id=".length) ?? null;
const TEMPLATE_SOURCE_START_DATE = "2025-11-03";
const SIRNAGALIH_PATTERN_START_DATE = "2026-03-01";
const PAGE_SIZE = 1000;

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

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL dan NEXT_PUBLIC_SUPABASE_ANON_KEY wajib tersedia.");
}

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};

function endpoint(table, params = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

async function request(table, { method = "GET", params, body, extraHeaders = {} } = {}) {
  const response = await fetch(endpoint(table, params), {
    method,
    headers: { ...headers, ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok) {
    const detail = typeof payload === "string" ? payload : JSON.stringify(payload);
    throw new Error(`${method} ${table} gagal (${response.status}): ${detail}`);
  }
  return payload;
}

async function fetchAll(table, select, extraParams = {}) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await request(table, {
      params: {
        select,
        limit: String(PAGE_SIZE),
        offset: String(offset),
        ...extraParams,
      },
      extraHeaders: { Prefer: "count=exact" },
    });
    rows.push(...(Array.isArray(page) ? page : []));
    if (!Array.isArray(page) || page.length < PAGE_SIZE) return rows;
  }
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

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeKey(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function stableItemKey({ stageCode, categoryCode, vendorName, itemName, unit }) {
  return [
    normalizeKey(stageCode),
    normalizeKey(categoryCode),
    normalizeKey(vendorId(vendorName) ?? vendorName),
    normalizeKey(itemName),
    normalizeKey(unit),
  ].join("::");
}

function existingItemStableKey(item) {
  return [
    normalizeKey(item.stage_id || item.tahap),
    normalizeKey(item.category_code || item.kategori),
    normalizeKey(item.vendor_id || item.vendor),
    normalizeKey(item.uraian),
    normalizeKey(item.satuan),
  ].join("::");
}

function pushMap(map, key, item) {
  if (!key.trim()) return;
  map.set(key, [...(map.get(key) ?? []), item]);
}

function takeMap(map, key) {
  const queue = map.get(key);
  if (!queue?.length) return null;
  return queue.shift() ?? null;
}

function buildExistingItemMatchers(oldItems) {
  const byExcelRow = new Map();
  const byStableKey = new Map();

  for (const item of [...oldItems].sort((a, b) => Number(a.urutan ?? 0) - Number(b.urutan ?? 0))) {
    if (item.source_file === "G.xlsx" && item.source_row != null) {
      pushMap(byExcelRow, String(item.source_row), item);
    }
    pushMap(byStableKey, existingItemStableKey(item), item);
  }

  return { byExcelRow, byStableKey };
}

function takeExistingItemForSource(source, matchers) {
  return (
    takeMap(matchers.byExcelRow, String(source.excelRow)) ??
    takeMap(matchers.byStableKey, stableItemKey(source))
  );
}

const NUMBER_WORDS = ["", "Satu", "Dua", "Tiga", "Empat", "Lima", "Enam", "Tujuh", "Delapan", "Sembilan", "Sepuluh", "Sebelas"];

function spellUnderThousand(value) {
  if (value < 12) return NUMBER_WORDS[value];
  if (value < 20) return `${spellUnderThousand(value - 10)} Belas`;
  if (value < 100) return `${spellUnderThousand(Math.floor(value / 10))} Puluh ${spellUnderThousand(value % 10)}`.trim();
  if (value < 200) return `Seratus ${spellUnderThousand(value - 100)}`.trim();
  return `${spellUnderThousand(Math.floor(value / 100))} Ratus ${spellUnderThousand(value % 100)}`.trim();
}

function terbilangRupiah(value) {
  const integer = Math.floor(Math.abs(value));
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
    if (count > 0) {
      if (group.value === 1_000 && count === 1) parts.push("Seribu");
      else parts.push(`${spellUnderThousand(count)} ${group.label}`);
      rest %= group.value;
    }
  }
  if (rest > 0) parts.push(spellUnderThousand(rest));
  return `${parts.join(" ").replace(/\s+/g, " ").trim()} Rupiah`;
}

function makeItem(project, source, index, existingItem = null) {
  const shouldPreserveFinancials = Boolean(existingItem) && !OVERWRITE_FINANCIALS;
  const qty = shouldPreserveFinancials ? toFiniteNumber(existingItem.qty, source.volume) : source.volume;
  const unitPrice = shouldPreserveFinancials ? toFiniteNumber(existingItem.harga_satuan, source.unitPrice) : source.unitPrice;
  const computedAmount = Math.round(qty * unitPrice);
  const templateComputedAmount = Math.round(source.volume * source.unitPrice);
  const existingManualOverride = shouldPreserveFinancials ? toNullableNumber(existingItem.jumlah_override) : null;
  const isManualAmount = shouldPreserveFinancials
    ? Boolean(existingItem.is_jumlah_manual && existingManualOverride !== null)
    : templateComputedAmount !== source.amount;
  const amount = isManualAmount ? existingManualOverride ?? source.amount : shouldPreserveFinancials ? computedAmount : source.amount;
  const amountOverride = isManualAmount ? amount : null;
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
    jumlah_override: amountOverride,
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

function makeStructure(project, items) {
  const stages = STAGE_ORDER.map((stageCode, index) => ({
    project_id: project.id,
    stage_id: stageCode,
    stage_name: STAGE_LABELS[stageCode],
    sort_order: index + 1,
    source_total: items.filter((item) => item.stage_id === stageCode).reduce((total, item) => total + Number(item.jumlah), 0),
  }));
  const categoryMap = new Map();
  for (const item of items) {
    const key = `${item.stage_id}:${item.category_code}`;
    const current = categoryMap.get(key) ?? {
      project_id: project.id,
      stage_id: item.stage_id,
      category_code: item.category_code,
      category_name: item.category_name,
      sort_order: categoryMap.size + 1,
      source_total: 0,
    };
    current.source_total += Number(item.jumlah);
    categoryMap.set(key, current);
  }
  return { stages, categories: [...categoryMap.values()] };
}

function makeSummary(project, items) {
  const totalFor = (stageCode) => items.filter((item) => item.stage_id === stageCode).reduce((total, item) => total + Number(item.jumlah), 0);
  const totalTahap1 = totalFor("TAHAP_I");
  const totalTahap2 = totalFor("TAHAP_II");
  const totalTahap3 = totalFor("TAHAP_III");
  const totalTahap4 = totalFor("TAHAP_IV");
  const totalDiluar = totalFor("TAHAP_VI") + totalFor("TAHAP_VII");
  const totalKeseluruhan = items.reduce((total, item) => total + Number(item.jumlah), 0);
  return {
    project_id: project.id,
    total_tahap_1: totalTahap1,
    total_tahap_2: totalTahap2,
    total_tahap_3: totalTahap3,
    total_tahap_4: totalTahap4,
    total_diluar_konstruksi: totalDiluar,
    total_keseluruhan: totalKeseluruhan,
    terbilang: terbilangRupiah(totalKeseluruhan),
  };
}

async function deleteByIds(table, ids) {
  for (let index = 0; index < ids.length; index += 100) {
    const values = ids.slice(index, index + 100).join(",");
    await request(table, { method: "DELETE", params: { id: `in.(${values})` } });
  }
}

async function migrateProject(project, oldItems) {
  const matchers = buildExistingItemMatchers(oldItems);
  let preservedFinancials = 0;
  const newItems = EXCEL_BASE_ROWS.map((source, index) => {
    const existingItem = OVERWRITE_FINANCIALS ? null : takeExistingItemForSource(source, matchers);
    if (existingItem) preservedFinancials += 1;
    return makeItem(project, source, index, existingItem);
  });
  const newIds = new Set(newItems.map((item) => item.id));
  const staleItemIds = oldItems.filter((item) => !newIds.has(item.id)).map((item) => item.id);
  const { stages, categories } = makeStructure(project, newItems);

  if (!APPLY) {
    return { village: project.nama_desa, oldItems: oldItems.length, newItems: newItems.length, staleItems: staleItemIds.length, preservedFinancials };
  }

  // Insert/upsert new deterministic IDs before removing legacy rows so a
  // transient failure never leaves a project without its resume items.
  await request("resume_items", {
    method: "POST",
    params: { on_conflict: "id" },
    body: newItems,
    extraHeaders: { Prefer: "resolution=merge-duplicates,return=minimal" },
  });
  if (DELETE_STALE_ITEMS) {
    await deleteByIds("resume_items", staleItemIds);
  }

  // Nota otomatis lama menunjuk ke ID item resume lama. Hapus hanya dokumen
  // otomatis; nota manual/custom tetap dipertahankan untuk pemeriksaan user.
  await request("generated_notes", {
    method: "DELETE",
    params: { project_id: `eq.${project.id}`, auto_key: "not.is.null" },
  });

  await request("resume_stages", { method: "DELETE", params: { project_id: `eq.${project.id}` } });
  await request("resume_categories", { method: "DELETE", params: { project_id: `eq.${project.id}` } });
  await request("resume_stages", { method: "POST", body: stages, extraHeaders: { Prefer: "return=minimal" } });
  await request("resume_categories", { method: "POST", body: categories, extraHeaders: { Prefer: "return=minimal" } });

  await request("resume_summaries", {
    method: "POST",
    params: { on_conflict: "project_id" },
    body: makeSummary(project, newItems),
    extraHeaders: { Prefer: "resolution=merge-duplicates,return=minimal" },
  });
  await request("projects", {
    method: "PATCH",
    params: { id: `eq.${project.id}` },
    body: { status: "draft" },
    extraHeaders: { Prefer: "return=minimal" },
  });
  await request("note_history", {
    method: "POST",
    body: {
      project_id: project.id,
      action: "resume_reimported",
      description: "Resume project dimigrasikan ke template Excel G.xlsx (kategori I.01 sampai VII.01).",
    },
    extraHeaders: { Prefer: "return=minimal" },
  });

  return { village: project.nama_desa, oldItems: oldItems.length, newItems: newItems.length, staleItems: staleItemIds.length, preservedFinancials };
}

const projects = await fetchAll(
  "projects",
  "id,nama_desa,nama_project,project_date,created_at",
  PROJECT_FILTER ? { id: `eq.${PROJECT_FILTER}`, order: "id.asc" } : { order: "id.asc" },
);
const projectIds = projects.map((project) => project.id);
const allItems = projectIds.length === 0
  ? []
  : await fetchAll(
    "resume_items",
    "id,project_id,tahap,stage_id,category_code,category_name,kategori,uraian,qty,satuan,harga_satuan,jumlah,jumlah_override,is_jumlah_manual,vendor,vendor_id,source_file,source_row,urutan",
    { project_id: `in.(${projectIds.join(",")})`, order: "project_id.asc,urutan.asc,id.asc" },
  );
const itemsByProject = new Map(projectIds.map((id) => [id, []]));
for (const item of allItems) itemsByProject.get(item.project_id)?.push(item);

console.log(`${APPLY ? "MENJALANKAN" : "DRY-RUN"} migrasi ${projects.length} project ke ${EXCEL_BASE_ROWS.length} baris G.xlsx.`);
if (!APPLY) console.log("Tidak ada perubahan database. Jalankan ulang dengan --apply untuk menerapkan migrasi.");
if (!OVERWRITE_FINANCIALS) console.log("Mode aman aktif: qty, harga_satuan, dan jumlah lama dipertahankan untuk item yang bisa dicocokkan. Gunakan --overwrite-financials hanya jika user eksplisit meminta angka template menimpa data desa.");
if (!DELETE_STALE_ITEMS) console.log("Mode aman aktif: item lama yang tidak ada di template baru tidak dihapus. Gunakan --delete-stale-items hanya setelah preview stale item disetujui.");

const results = [];
for (const project of projects) {
  results.push(await migrateProject(project, itemsByProject.get(project.id) ?? []));
}

for (const result of results) {
  console.log(`${result.village}: ${result.oldItems} -> ${result.newItems} item template, ${result.staleItems} item lama di luar template, ${result.preservedFinancials} item mempertahankan qty/harga.`);
}
console.log(`Selesai: ${results.length} project diproses.`);
