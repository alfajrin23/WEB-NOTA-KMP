import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const RUN_DATE = "20260831";
const OUTPUT_DIR = path.resolve("reconstruction-output");
const EXECUTE = process.argv.includes("--execute");
const PATTERN_SOURCE_FILE = path.resolve("src/constants/excel-base-data.ts");
const PATTERN_START_DATE = "2025-11-03";
const PATTERN_LABEL = "Sirnagalih Cilaku / Haurwangi reference";
const PAGE_SIZE = 1000;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const PROJECT_START_OVERRIDES = [
  { village: "haurwangi", district: "haurwangi", projectDate: "2025-11-03" },
];

function envFile(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, "utf8").split(/\r?\n/).flatMap((line) => {
    const value = line.trim();
    if (!value || value.startsWith("#") || !value.includes("=")) return [];
    const index = value.indexOf("=");
    return [[value.slice(0, index), value.slice(index + 1).trim().replace(/^["']|["']$/g, "")]];
  }));
}

function normalizeName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^(desa|ds|kel|kelurahan)\.?\s+/, "")
    .replace(/[^a-z0-9]+/g, "");
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function clone(value) {
  return structuredClone(value ?? {});
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeCsv(file, rows, columns = rows.length ? Object.keys(rows[0]) : []) {
  const lines = [columns.join(","), ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","))];
  fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
}

function parseIsoDate(value) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
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

function toIsoDate(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_IN_MS);
}

function daysBetweenIsoDates(fromDate, toDate) {
  const from = parseIsoDate(fromDate);
  const to = parseIsoDate(toDate);
  if (!from || !to) return 0;
  return Math.round((to.getTime() - from.getTime()) / DAY_IN_MS);
}

function shiftIsoDateByDays(value, days) {
  const parsed = parseIsoDate(value);
  if (!parsed || days === 0) return value ?? "";
  return toIsoDate(addDays(parsed, days));
}

function normalizeTwoDigitYear(value) {
  return value.length === 2 ? `20${value}` : value;
}

function parseSeparatedDate(dayText, monthText, yearText) {
  const year = Number(normalizeTwoDigitYear(yearText));
  const monthIndex = Number(monthText) - 1;
  const day = Number(dayText);
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

function shiftSeparatedDate(match, dayText, monthText, yearText, separator, days) {
  const parsed = parseSeparatedDate(dayText, monthText, yearText);
  if (!parsed || days === 0) return match;
  const shifted = addDays(parsed, days);
  const nextDay = String(shifted.getUTCDate()).padStart(Math.max(2, dayText.length), "0");
  const nextMonth = String(shifted.getUTCMonth() + 1).padStart(Math.max(2, monthText.length), "0");
  const nextYear = String(shifted.getUTCFullYear());
  return [nextDay, nextMonth, nextYear].join(separator);
}

function shiftDateLikeStringByDays(value, days) {
  if (!value || days === 0) return value ?? "";
  const iso = parseIsoDate(value);
  if (iso) return toIsoDate(addDays(iso, days));
  const slashMatch = String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (slashMatch) return shiftSeparatedDate(value, slashMatch[1], slashMatch[2], slashMatch[3], "/", days);
  const dashMatch = String(value).match(/^(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})$/);
  if (dashMatch) return shiftSeparatedDate(value, dashMatch[1], dashMatch[2], dashMatch[3], "-", days);
  return value;
}

function shiftTextDatesByDays(value, days) {
  if (!value || days === 0) return value ?? "";
  return String(value)
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (match) => shiftDateLikeStringByDays(match, days))
    .replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/g, (match, day, month, year) =>
      shiftSeparatedDate(match, day, month, year, "/", days),
    )
    .replace(/\b(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})\b/g, (match, day, month, year) =>
      shiftSeparatedDate(match, day, month, year, "-", days),
    );
}

function firstIsoDateInText(value) {
  const text = String(value ?? "");
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) return parseIsoDate(iso[0]) ? iso[0] : null;

  const separated = /\b(\d{1,2})([/-])(\d{1,2})\2(\d{2}|\d{4})\b/.exec(text);
  if (!separated) return null;
  const date = parseSeparatedDate(separated[1], separated[3], separated[4]);
  return date ? toIsoDate(date) : null;
}

function shiftTextFieldToDesiredStart(value, desiredStartDate, fallbackDelta) {
  if (typeof value !== "string" || !value || !desiredStartDate) return value;
  const firstDate = firstIsoDateInText(value);
  const delta = firstDate ? daysBetweenIsoDates(firstDate, desiredStartDate) : fallbackDelta;
  return shiftTextDatesByDays(value, delta);
}

function readPatternDateBySourceRow() {
  const text = fs.readFileSync(PATTERN_SOURCE_FILE, "utf8");
  const result = new Map();
  const regex = /\{ excelRow: (\d+),[^\n]*? date: "(\d{4}-\d{2}-\d{2})"/g;
  let match = regex.exec(text);
  while (match) {
    result.set(Number(match[1]), match[2]);
    match = regex.exec(text);
  }
  return result;
}

function projectStartOverride(project) {
  const village = normalizeName(project?.nama_desa);
  const district = normalizeName(project?.kecamatan);
  return PROJECT_START_OVERRIDES.find((override) =>
    village === normalizeName(override.village) && district === normalizeName(override.district),
  ) ?? null;
}

function storedProjectDate(project) {
  return project?.project_date || project?.tanggal_laporan || "";
}

function projectDate(project) {
  return projectStartOverride(project)?.projectDate ?? storedProjectDate(project);
}

function sameJson(left, right) {
  return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});
}

function minIsoDate(values) {
  const dates = values.filter((value) => parseIsoDate(value)).sort();
  return dates[0] ?? null;
}

function env() {
  const values = { ...envFile(".env.local"), ...process.env };
  const supabaseUrl = values.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const supabaseKey = values.SUPABASE_SERVICE_ROLE_KEY || values.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error("Supabase URL/key tidak ditemukan.");
  return { supabaseUrl, supabaseKey };
}

const { supabaseUrl, supabaseKey } = env();
const headers = {
  apikey: supabaseKey,
  Authorization: `Bearer ${supabaseKey}`,
  "Content-Type": "application/json",
};

async function request(table, { method = "GET", query = {}, body, prefer = "return=representation" } = {}) {
  const url = new URL(`/rest/v1/${table}`, supabaseUrl);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const payload = body === undefined ? undefined : JSON.stringify(body);
  let lastError = null;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      const response = await fetch(url, {
        method,
        headers: { ...headers, Prefer: prefer },
        body: payload,
      });
      const text = await response.text();
      if (response.ok) return text ? JSON.parse(text) : [];
      const error = new Error(`${method} ${table} ${response.status}: ${text.slice(0, 1000)}`);
      if (![408, 425, 429, 500, 502, 503, 504].includes(response.status) || attempt === 6) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
      if (attempt === 6) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
  }
  throw lastError ?? new Error(`${method} ${table} request failed`);
}

async function fetchAll(table, select = "*", order) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await request(table, {
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

async function upsertRows(table, rows, conflict) {
  let total = 0;
  for (let index = 0; index < rows.length; index += 250) {
    const batch = rows.slice(index, index + 250);
    const updated = await request(table, {
      method: "POST",
      query: { on_conflict: conflict },
      body: batch,
      prefer: "resolution=merge-duplicates,return=representation",
    });
    if (updated.length !== batch.length) throw new Error(`${table} batch ${index} updated ${updated.length}/${batch.length}`);
    total += updated.length;
  }
  return total;
}

function noteSourceIds(note) {
  const data = asRecord(note.data_json);
  const dataItems = Array.isArray(data.items) ? data.items : [];
  return [
    ...(Array.isArray(note.source_resume_item_ids) ? note.source_resume_item_ids : []),
    ...dataItems.map((item) => item?.id),
  ].filter(Boolean).map(String);
}

function noteRowWithData(note, data) {
  return {
    id: note.id,
    project_id: note.project_id,
    tahap: note.tahap,
    vendor: note.vendor,
    vendor_id: note.vendor_id,
    template_id: note.template_id,
    document_type: note.document_type,
    source_resume_item_ids: note.source_resume_item_ids,
    data_json: data,
    total: note.total,
    status: note.status,
    auto_key: note.auto_key,
  };
}

function customNoteRowWithData(note, data) {
  return {
    id: note.id,
    project_id: note.project_id,
    tahap: note.tahap,
    vendor: note.vendor,
    vendor_id: note.vendor_id,
    template_id: note.template_id,
    document_type: note.document_type,
    data_json: data,
    total: note.total,
    alasan: note.alasan,
  };
}

function updateGeneratedDocData(note, project, desiredItemsById) {
  const data = clone(note.data_json);
  const itemIds = noteSourceIds(note);
  const desiredDates = itemIds.map((id) => desiredItemsById.get(id)?.tanggal).filter(Boolean);
  const desiredTopDate = minIsoDate(desiredDates) || projectDate(project);
  if (!desiredTopDate) return null;

  const originalData = asRecord(note.data_json);
  const dataItems = Array.isArray(data.items) ? data.items : [];
  const currentTopDate = firstIsoDateInText(data.tanggal)
    || firstIsoDateInText(data.notaDate)
    || minIsoDate(dataItems.map((item) => item?.expenseDate).filter(Boolean))
    || desiredTopDate;
  const topDelta = daysBetweenIsoDates(currentTopDate, desiredTopDate);

  data.tanggal = desiredTopDate;
  data.notaDate = desiredTopDate;
  if (typeof data.kwitansiDate === "string" && data.kwitansiDate.trim()) {
    data.kwitansiDate = shiftTextFieldToDesiredStart(data.kwitansiDate, desiredTopDate, topDelta);
  }

  for (const field of ["kwitansiPaymentDescription", "kwitansiNote", "keterangan", "catatan"]) {
    if (typeof data[field] === "string") {
      data[field] = shiftTextFieldToDesiredStart(data[field], desiredTopDate, topDelta);
    }
  }

  data.items = dataItems.map((item) => {
    const desired = desiredItemsById.get(String(item?.id ?? ""));
    if (!desired) return item;
    const currentItemDate = firstIsoDateInText(item.expenseDate) || desired.tanggal;
    const itemDelta = daysBetweenIsoDates(currentItemDate, desired.tanggal);
    const next = { ...item, expenseDate: desired.tanggal };
    for (const key of ["itemName", "name", "notes", "tanggalSelesai", "tanggalPekerjaan", "tanggalPembayaran", "tanggalPembelian", "expenseEndDate", "endDate", "dateEnd", "workDate", "paymentDate", "purchaseDate"]) {
      if (typeof next[key] === "string") next[key] = key.includes("Date") || key.startsWith("tanggal")
        ? shiftDateLikeStringByDays(next[key], itemDelta)
        : shiftTextDatesByDays(next[key], itemDelta);
    }
    return next;
  });

  if (data.projectMeta && typeof data.projectMeta === "object" && !Array.isArray(data.projectMeta)) {
    data.projectMeta = {
      ...data.projectMeta,
      projectDate: project?.project_date ?? data.projectMeta.projectDate,
      reportDate: project?.tanggal_laporan ?? data.projectMeta.reportDate,
    };
  }

  return sameJson(originalData, data)
    ? null
    : {
      row: noteRowWithData(note, data),
      desiredTopDate,
      currentTopDate,
    };
}

function updateCustomDocData(note, project) {
  const data = clone(note.data_json);
  const desiredTopDate = projectDate(project);
  if (!desiredTopDate) return null;
  const originalData = asRecord(note.data_json);
  const currentTopDate = firstIsoDateInText(data.tanggal) || firstIsoDateInText(data.notaDate) || desiredTopDate;
  const delta = daysBetweenIsoDates(currentTopDate, desiredTopDate);

  data.tanggal = desiredTopDate;
  data.notaDate = desiredTopDate;
  if (Array.isArray(data.items)) {
    data.items = data.items.map((item) => ({
      ...item,
      expenseDate: shiftDateLikeStringByDays(item?.expenseDate, delta),
    }));
  }
  for (const field of ["kwitansiDate", "kwitansiPaymentDescription", "kwitansiNote", "keterangan", "catatan"]) {
    if (typeof data[field] === "string") data[field] = shiftTextFieldToDesiredStart(data[field], desiredTopDate, delta);
  }
  if (data.projectMeta && typeof data.projectMeta === "object" && !Array.isArray(data.projectMeta)) {
    data.projectMeta = {
      ...data.projectMeta,
      projectDate: project?.project_date ?? data.projectMeta.projectDate,
      reportDate: project?.tanggal_laporan ?? data.projectMeta.reportDate,
    };
  }

  return sameJson(originalData, data) ? null : { row: customNoteRowWithData(note, data), desiredTopDate, currentTopDate };
}

function updateKwitansiEdit(edit, note, desiredTopDate) {
  const custom = clone(edit.custom_data_json);
  const originalCustom = asRecord(edit.custom_data_json);
  let changed = false;
  for (const key of ["tanggal_kwitansi", "keterangan", "catatan"]) {
    if (typeof custom[key] !== "string" || !custom[key].trim()) continue;
    const next = shiftTextFieldToDesiredStart(custom[key], desiredTopDate, 0);
    if (next !== custom[key]) {
      custom[key] = next;
      changed = true;
    }
  }
  if (!changed || sameJson(originalCustom, custom)) return null;
  return {
    id: edit.id,
    project_id: edit.project_id,
    note_id: edit.note_id,
    nama_penerima: edit.nama_penerima,
    warna_template: edit.warna_template,
    custom_data_json: custom,
    _note_id: note.id,
    _desiredTopDate: desiredTopDate,
  };
}

const [projects, resumeItems, generatedNotes, customNotes, kwitansiEdits] = await Promise.all([
  fetchAll("projects", "id,nama_desa,kecamatan,project_date,tanggal_laporan,metadata_json,status,created_at,updated_at", "kecamatan.asc,nama_desa.asc"),
  fetchAll("resume_items", "id,project_id,tahap,stage_id,stage_name,category_code,category_name,item_no,kategori,tanggal,uraian,qty,satuan,harga_satuan,jumlah,jumlah_override,is_jumlah_manual,vendor,vendor_id,source_file,source_page,source_row,is_manual_added,is_included_in_resume_total,is_generated_to_note,note_id,category_total,stage_total,source_type,validation_status,notes,urutan,created_at,updated_at", "project_id.asc,urutan.asc"),
  fetchAll("generated_notes", "id,project_id,tahap,vendor,vendor_id,template_id,document_type,source_resume_item_ids,data_json,total,status,auto_key,created_at,updated_at", "project_id.asc,created_at.asc"),
  fetchAll("custom_notes", "id,project_id,tahap,vendor,vendor_id,template_id,document_type,data_json,total,alasan,created_at,updated_at", "project_id.asc,created_at.asc"),
  fetchAll("kwitansi_edits", "id,project_id,note_id,nama_penerima,warna_template,custom_data_json,created_at,updated_at", "project_id.asc,created_at.asc"),
]);

const projectById = new Map(projects.map((project) => [project.id, project]));
const itemsByProject = new Map();
for (const item of resumeItems) {
  itemsByProject.set(item.project_id, [...(itemsByProject.get(item.project_id) ?? []), item]);
}

const patternDateBySourceRow = readPatternDateBySourceRow();
if (patternDateBySourceRow.size < 273) throw new Error(`Pola tanggal source row tidak lengkap: ${patternDateBySourceRow.size}/273`);

const desiredItemsById = new Map();
const projectSummary = [];
const projectUpdates = [];
const resumeItemUpdates = [];
const datePlanRows = [];
const missingPatternRows = new Set();
const invalidProjectDates = new Set();

for (const project of projects) {
  const targetDate = projectDate(project);
  const projectItems = itemsByProject.get(project.id) ?? [];
  const shiftDays = daysBetweenIsoDates(PATTERN_START_DATE, targetDate);
  let mismatches = 0;
  const override = projectStartOverride(project);

  if (!parseIsoDate(targetDate)) invalidProjectDates.add(project.id);
  if (override && (project.project_date !== override.projectDate || project.tanggal_laporan !== override.projectDate)) {
    projectUpdates.push({
      ...project,
      project_date: override.projectDate,
      tanggal_laporan: override.projectDate,
    });
    datePlanRows.push({
      change_type: "PROJECT_START_DATE",
      desa: project.nama_desa,
      kecamatan: project.kecamatan,
      project_id: project.id,
      row_id: project.id,
      source_row: "",
      tahap: "",
      uraian: "tanggal awal proyek",
      reference_project_date: PATTERN_START_DATE,
      reference_item_date: "",
      project_start_date: override.projectDate,
      shift_days: shiftDays,
      before: [project.project_date, project.tanggal_laporan].filter(Boolean).join(" | "),
      after: override.projectDate,
    });
  }

  for (const item of projectItems) {
    const sourceRow = Number(item.source_row);
    const patternDate = patternDateBySourceRow.get(sourceRow);
    if (!patternDate) {
      missingPatternRows.add(sourceRow);
      continue;
    }

    const desiredDate = shiftIsoDateByDays(patternDate, shiftDays);
    desiredItemsById.set(item.id, { ...item, tanggal: desiredDate, reference_date: patternDate, shift_days: shiftDays });
    if (item.tanggal === desiredDate) continue;
    mismatches += 1;
    const itemDelta = daysBetweenIsoDates(item.tanggal, desiredDate);
    const next = {
      ...item,
      tanggal: desiredDate,
      uraian: shiftTextDatesByDays(item.uraian, itemDelta),
      notes: item.notes ? shiftTextDatesByDays(item.notes, itemDelta) : item.notes,
    };
    resumeItemUpdates.push(next);
    datePlanRows.push({
      change_type: "RESUME_ITEM_DATE",
      desa: project.nama_desa,
      kecamatan: project.kecamatan,
      project_id: project.id,
      row_id: item.id,
      source_row: sourceRow,
      tahap: item.tahap,
      uraian: item.uraian,
      reference_project_date: PATTERN_START_DATE,
      reference_item_date: patternDate,
      project_start_date: targetDate,
      shift_days: shiftDays,
      before: item.tanggal,
      after: desiredDate,
    });
  }

  projectSummary.push({
    desa: project.nama_desa,
    kecamatan: project.kecamatan,
    project_id: project.id,
    project_start_date: targetDate,
    reference_project_date: PATTERN_START_DATE,
    shift_days: shiftDays,
    resume_items: projectItems.length,
    resume_item_date_mismatches: mismatches,
    project_start_override: override ? override.projectDate : "",
  });
}

const generatedNoteUpdates = [];
const noteDesiredDateById = new Map();
for (const note of generatedNotes) {
  const project = projectById.get(note.project_id);
  const update = updateGeneratedDocData(note, project, desiredItemsById);
  const desiredDates = noteSourceIds(note).map((id) => desiredItemsById.get(id)?.tanggal).filter(Boolean);
  const desiredTopDate = minIsoDate(desiredDates) || projectDate(project);
  if (desiredTopDate) noteDesiredDateById.set(note.id, desiredTopDate);
  if (!update) continue;
  generatedNoteUpdates.push(update.row);
  const originalData = asRecord(note.data_json);
  datePlanRows.push({
    change_type: "GENERATED_NOTE_DATE",
    desa: project?.nama_desa ?? "",
    kecamatan: project?.kecamatan ?? "",
    project_id: note.project_id,
    row_id: note.id,
    source_row: "",
    tahap: note.tahap,
    uraian: `${note.document_type}:${note.vendor}`,
    reference_project_date: PATTERN_START_DATE,
    reference_item_date: "",
    project_start_date: projectDate(project),
    shift_days: "",
    before: [originalData.tanggal, originalData.notaDate, originalData.kwitansiDate].filter(Boolean).join(" | "),
    after: [update.row.data_json.tanggal, update.row.data_json.notaDate, update.row.data_json.kwitansiDate].filter(Boolean).join(" | "),
  });
}

const customNoteUpdates = [];
for (const note of customNotes) {
  const project = projectById.get(note.project_id);
  const update = updateCustomDocData(note, project);
  if (!update) continue;
  customNoteUpdates.push(update.row);
  const originalData = asRecord(note.data_json);
  datePlanRows.push({
    change_type: "CUSTOM_NOTE_DATE",
    desa: project?.nama_desa ?? "",
    kecamatan: project?.kecamatan ?? "",
    project_id: note.project_id,
    row_id: note.id,
    source_row: "",
    tahap: note.tahap,
    uraian: `${note.document_type}:${note.vendor}`,
    reference_project_date: PATTERN_START_DATE,
    reference_item_date: "",
    project_start_date: projectDate(project),
    shift_days: "",
    before: [originalData.tanggal, originalData.notaDate, originalData.kwitansiDate].filter(Boolean).join(" | "),
    after: [update.row.data_json.tanggal, update.row.data_json.notaDate, update.row.data_json.kwitansiDate].filter(Boolean).join(" | "),
  });
}

const kwitansiEditUpdates = [];
const generatedNoteById = new Map(generatedNotes.map((note) => [note.id, note]));
for (const edit of kwitansiEdits) {
  const note = generatedNoteById.get(edit.note_id);
  const desiredTopDate = noteDesiredDateById.get(edit.note_id);
  if (!note || !desiredTopDate) continue;
  const update = updateKwitansiEdit(edit, note, desiredTopDate);
  if (!update) continue;
  const row = { ...update };
  delete row._note_id;
  delete row._desiredTopDate;
  kwitansiEditUpdates.push(row);
  const project = projectById.get(edit.project_id);
  datePlanRows.push({
    change_type: "KWITANSI_EDIT_DATE_TEXT",
    desa: project?.nama_desa ?? "",
    kecamatan: project?.kecamatan ?? "",
    project_id: edit.project_id,
    row_id: edit.id,
    source_row: "",
    tahap: note.tahap,
    uraian: `kwitansi_edit:${note.id}`,
    reference_project_date: PATTERN_START_DATE,
    reference_item_date: "",
    project_start_date: projectDate(project),
    shift_days: "",
    before: JSON.stringify(asRecord(edit.custom_data_json)),
    after: JSON.stringify(row.custom_data_json),
  });
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const backup = {
  created_at: new Date().toISOString(),
  purpose: "before_resume_start_date_pattern_alignment",
  execute: EXECUTE,
  pattern_start_date: PATTERN_START_DATE,
  pattern_label: PATTERN_LABEL,
  pattern_source_file: PATTERN_SOURCE_FILE,
  project_start_overrides: PROJECT_START_OVERRIDES,
  projects: projects.filter((project) => projectUpdates.some((update) => update.id === project.id)),
  generated_notes: generatedNotes.filter((note) => generatedNoteUpdates.some((update) => update.id === note.id)),
  custom_notes: customNotes.filter((note) => customNoteUpdates.some((update) => update.id === note.id)),
  kwitansi_edits: kwitansiEdits.filter((edit) => kwitansiEditUpdates.some((update) => update.id === edit.id)),
  resume_items: resumeItems.filter((item) => resumeItemUpdates.some((update) => update.id === item.id)),
};
const backupFile = path.join(OUTPUT_DIR, `sirnagalih_date_pattern_backup_${timestamp}.json`);
const backupText = `${JSON.stringify(backup, null, 2)}\n`;
fs.writeFileSync(backupFile, backupText, "utf8");
const backupSha256 = crypto.createHash("sha256").update(backupText).digest("hex");
fs.writeFileSync(`${backupFile}.sha256`, `${backupSha256}  ${path.basename(backupFile)}\n`, "utf8");

const planColumns = [
  "change_type",
  "desa",
  "kecamatan",
  "project_id",
  "row_id",
  "source_row",
  "tahap",
  "uraian",
  "reference_project_date",
  "reference_item_date",
  "project_start_date",
  "shift_days",
  "before",
  "after",
];
writeCsv(path.join(OUTPUT_DIR, `sirnagalih_date_pattern_plan_${RUN_DATE}.csv`), datePlanRows, planColumns);
writeCsv(path.join(OUTPUT_DIR, `sirnagalih_date_pattern_project_summary_${RUN_DATE}.csv`), projectSummary);

const report = {
  generated_at: new Date().toISOString(),
  mode: EXECUTE ? "EXECUTE_REST" : "DRY_RUN",
  status: EXECUTE ? "PENDING_EXECUTION" : "DRY_RUN_READY",
  pattern: {
    label: PATTERN_LABEL,
    start_date: PATTERN_START_DATE,
    source_file: path.relative(process.cwd(), PATTERN_SOURCE_FILE),
    source_rows: patternDateBySourceRow.size,
  },
  project_start_overrides: PROJECT_START_OVERRIDES,
  projects_checked: projects.length,
  resume_items_checked: resumeItems.length,
  generated_notes_checked: generatedNotes.length,
  custom_notes_checked: customNotes.length,
  kwitansi_edits_checked: kwitansiEdits.length,
  missing_pattern_source_rows: [...missingPatternRows].sort((a, b) => a - b),
  invalid_project_date_count: invalidProjectDates.size,
  projects_to_update: projectUpdates.length,
  resume_items_to_update: resumeItemUpdates.length,
  generated_notes_to_update: generatedNoteUpdates.length,
  custom_notes_to_update: customNoteUpdates.length,
  kwitansi_edits_to_update: kwitansiEditUpdates.length,
  backup_file: path.basename(backupFile),
  backup_sha256: backupSha256,
  plan_file: `sirnagalih_date_pattern_plan_${RUN_DATE}.csv`,
  project_summary_file: `sirnagalih_date_pattern_project_summary_${RUN_DATE}.csv`,
};

async function verifyLive() {
  const [freshProjects, freshItems, freshNotes, freshCustomNotes, freshEdits] = await Promise.all([
    fetchAll("projects", "id,nama_desa,kecamatan,project_date,tanggal_laporan", "kecamatan.asc,nama_desa.asc"),
    fetchAll("resume_items", "id,project_id,tanggal,source_row,uraian,notes", "project_id.asc,urutan.asc"),
    fetchAll("generated_notes", "id,project_id,document_type,tahap,vendor,data_json,source_resume_item_ids", "project_id.asc,created_at.asc"),
    fetchAll("custom_notes", "id,project_id,document_type,tahap,vendor,data_json", "project_id.asc,created_at.asc"),
    fetchAll("kwitansi_edits", "id,project_id,note_id,custom_data_json", "project_id.asc,created_at.asc"),
  ]);

  const freshProjectById = new Map(freshProjects.map((project) => [project.id, project]));
  const freshDesiredById = new Map();
  const errors = [];

  for (const project of freshProjects) {
    const override = projectStartOverride(project);
    if (!override) continue;
    if (project.project_date !== override.projectDate) {
      errors.push(`project ${project.id} project_date ${project.project_date} != ${override.projectDate}`);
    }
    if (project.tanggal_laporan !== override.projectDate) {
      errors.push(`project ${project.id} tanggal_laporan ${project.tanggal_laporan} != ${override.projectDate}`);
    }
  }

  for (const item of freshItems) {
    const project = freshProjectById.get(item.project_id);
    const patternDate = patternDateBySourceRow.get(Number(item.source_row));
    if (!project || !patternDate) continue;
    const desired = shiftIsoDateByDays(patternDate, daysBetweenIsoDates(PATTERN_START_DATE, projectDate(project)));
    freshDesiredById.set(item.id, { tanggal: desired });
    if (item.tanggal !== desired) errors.push(`resume_item ${item.id}: ${item.tanggal} != ${desired}`);
  }

  const verifyNote = (note, table) => {
    const project = freshProjectById.get(note.project_id);
    const desiredDates = noteSourceIds(note).map((id) => freshDesiredById.get(id)?.tanggal).filter(Boolean);
    const desiredTopDate = minIsoDate(desiredDates) || projectDate(project);
    if (!desiredTopDate) return;
    const data = asRecord(note.data_json);
    if (data.tanggal !== desiredTopDate) errors.push(`${table} ${note.id} tanggal ${data.tanggal} != ${desiredTopDate}`);
    if (data.notaDate !== desiredTopDate) errors.push(`${table} ${note.id} notaDate ${data.notaDate} != ${desiredTopDate}`);
    if (typeof data.kwitansiDate === "string" && data.kwitansiDate && parseIsoDate(data.kwitansiDate) && data.kwitansiDate !== desiredTopDate) {
      errors.push(`${table} ${note.id} kwitansiDate ${data.kwitansiDate} != ${desiredTopDate}`);
    }
    const items = Array.isArray(data.items) ? data.items : [];
    for (const item of items) {
      const desired = freshDesiredById.get(String(item?.id ?? ""));
      if (desired && item.expenseDate !== desired.tanggal) {
        errors.push(`${table} item ${note.id}/${item.id}: ${item.expenseDate} != ${desired.tanggal}`);
      }
    }
  };

  for (const note of freshNotes) verifyNote(note, "generated_notes");
  for (const note of freshCustomNotes) verifyNote(note, "custom_notes");

  const freshNoteById = new Map(freshNotes.map((note) => [note.id, note]));
  for (const edit of freshEdits) {
    const note = freshNoteById.get(edit.note_id);
    if (!note) continue;
    const desiredDates = noteSourceIds(note).map((id) => freshDesiredById.get(id)?.tanggal).filter(Boolean);
    const desiredTopDate = minIsoDate(desiredDates);
    if (!desiredTopDate) continue;
    const custom = asRecord(edit.custom_data_json);
    for (const key of ["tanggal_kwitansi", "keterangan"]) {
      const firstDate = firstIsoDateInText(custom[key]);
      if (firstDate && firstDate !== desiredTopDate) errors.push(`kwitansi_edit ${edit.id}.${key}: first date ${firstDate} != ${desiredTopDate}`);
    }
  }

  return {
    errors,
    fresh_items_checked: freshItems.length,
    fresh_generated_notes_checked: freshNotes.length,
    fresh_custom_notes_checked: freshCustomNotes.length,
    fresh_kwitansi_edits_checked: freshEdits.length,
  };
}

if (!EXECUTE) {
  fs.writeFileSync(path.join(OUTPUT_DIR, `sirnagalih_date_pattern_report_${RUN_DATE}.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
} else {
  const updatedProjects = projectUpdates.length
    ? await upsertRows("projects", projectUpdates, "id")
    : 0;
  const updatedItems = resumeItemUpdates.length
    ? await upsertRows("resume_items", resumeItemUpdates, "id")
    : 0;
  const updatedNotes = generatedNoteUpdates.length
    ? await upsertRows("generated_notes", generatedNoteUpdates, "id")
    : 0;
  const updatedCustomNotes = customNoteUpdates.length
    ? await upsertRows("custom_notes", customNoteUpdates, "id")
    : 0;
  const updatedEdits = kwitansiEditUpdates.length
    ? await upsertRows("kwitansi_edits", kwitansiEditUpdates, "id")
    : 0;

  const verification = await verifyLive();
  report.status = verification.errors.length ? "EXECUTED_WITH_VERIFY_ERRORS" : "EXECUTED_VERIFIED";
  report.execution = {
    projects_updated: updatedProjects,
    resume_items_updated: updatedItems,
    generated_notes_updated: updatedNotes,
    custom_notes_updated: updatedCustomNotes,
    kwitansi_edits_updated: updatedEdits,
    verify_errors: verification.errors.length,
    first_verify_errors: verification.errors.slice(0, 100),
    fresh_items_checked: verification.fresh_items_checked,
    fresh_generated_notes_checked: verification.fresh_generated_notes_checked,
    fresh_custom_notes_checked: verification.fresh_custom_notes_checked,
    fresh_kwitansi_edits_checked: verification.fresh_kwitansi_edits_checked,
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, `sirnagalih_date_pattern_report_${RUN_DATE}.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (verification.errors.length) process.exitCode = 2;
}
