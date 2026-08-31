import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const RUN_DATE = "20260831";
const OUTPUT_DIR = path.resolve("reconstruction-output");
const execute = process.argv.includes("--execute");
const CORE_WORKER_STAGES = new Set(["TAHAP_I", "TAHAP_II", "TAHAP_III", "TAHAP_IV", "TAHAP_V"]);

function envFile(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, "utf8").split(/\r?\n/).flatMap((line) => {
    const value = line.trim();
    if (!value || value.startsWith("#") || !value.includes("=")) return [];
    const index = value.indexOf("=");
    return [[value.slice(0, index), value.slice(index + 1).trim().replace(/^["']|["']$/g, "")]];
  }));
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringValue(value) {
  return typeof value === "string" ? value : "";
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\btrampil\b/gi, "terampil")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function compactText(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "");
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeCsv(file, rows, columns) {
  const lines = [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")),
  ];
  fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
}

const env = { ...envFile(".env.local"), ...process.env };
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) throw new Error("Supabase URL/key tidak ditemukan");

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
  for (let offset = 0; ; offset += 1000) {
    const page = await request(table, {
      query: {
        select,
        limit: "1000",
        offset: String(offset),
        ...(order ? { order } : {}),
      },
    });
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

async function upsertRows(table, rows, conflict) {
  let total = 0;
  for (let index = 0; index < rows.length; index += 200) {
    const batch = rows.slice(index, index + 200);
    const updated = await request(table, {
      method: "POST",
      query: { on_conflict: conflict },
      body: batch,
      prefer: "resolution=merge-duplicates,return=representation",
    });
    if (updated.length !== batch.length) {
      throw new Error(`${table} batch ${index} updated ${updated.length}/${batch.length}`);
    }
    total += updated.length;
  }
  return total;
}

function validStage(value) {
  return ["TAHAP_I", "TAHAP_II", "TAHAP_III", "TAHAP_IV", "TAHAP_V", "TAHAP_VI", "TAHAP_VII", "RESUME_ALL"].includes(value)
    ? value
    : null;
}

function noteStage(note) {
  const data = asRecord(note.data_json);
  const dataStage = validStage(data.stageCode) || validStage(data.stageId);
  if (note.tahap === "LUAR_INTI") return dataStage || "RESUME_ALL";
  return validStage(note.tahap) || dataStage || note.tahap;
}

function dynamicStringFields(value, keys) {
  const record = asRecord(value);
  return keys.map((key) => record[key]).filter((entry) => typeof entry === "string");
}

function noteText(note) {
  const data = asRecord(note.data_json);
  const items = Array.isArray(data.items) ? data.items : [];
  const categories = Array.isArray(data.categoryNames) ? data.categoryNames : [];
  const dataFields = dynamicStringFields(data, [
    "kwitansiRoleName",
    "kwitansiPaymentDescription",
    "kwitansiPayerName",
    "templateName",
    "stageName",
    "jobType",
    "job_type",
    "position",
    "role",
    "description",
    "payment_description",
    "jenis_pekerjaan",
    "jabatan",
    "item_name",
    "nama_item",
    "uraian",
    "keterangan",
    "vendor",
  ]);
  const itemFields = items.flatMap((item) => dynamicStringFields(item, [
    "itemName",
    "name",
    "vendorName",
    "vendorId",
    "category",
    "categoryName",
    "notes",
    "jobType",
    "job_type",
    "position",
    "role",
    "description",
    "payment_description",
    "jabatan",
    "item_name",
    "nama_item",
    "uraian",
    "vendor",
  ]));

  return normalizeText([
    note.tahap,
    note.vendor,
    note.vendor_id,
    note.template_id,
    note.auto_key,
    ...dataFields,
    ...categories,
    ...itemFields,
  ].filter(Boolean).join(" "));
}

function noteRoleText(note) {
  const data = asRecord(note.data_json);
  const items = Array.isArray(data.items) ? data.items : [];
  return stringValue(data.kwitansiRoleName)
    || stringValue(data.jabatan)
    || stringValue(items[0]?.itemName)
    || stringValue(items[0]?.name)
    || "";
}

function syncGroupFromText(value) {
  const text = normalizeText(value);
  if (!text) return null;
  if (text.includes("kepala tukang")) return "kepala_tukang";
  if (text.includes("tukang borongan") || text.includes("jasa borong")) return null;
  if (text.includes("mandor")) return "mandor";
  if (text.includes("pekerja terampil") || /\btukang\b/.test(text)) return "tukang";
  if (text.includes("pekerja buruh") || text.includes("kenek") || /\bkuli\b/.test(text) || /\bladen\b/.test(text)) return "kenek";
  return null;
}

function asWorkerSlot(value) {
  const slot = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return slot === 1 || slot === 2 || slot === 3 || slot === 4 ? slot : null;
}

function workerSlotFromText(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const role = "(?:(?:pekerja\\s+)?(?:terampil|buruh)|tukang|kenek|kuli|laden)";
  const patterns = [
    new RegExp(`\\b${role}\\s+(?:slot|ke)\\s*[-:]?\\s*([1-4])\\b`),
    new RegExp(`\\b${role}\\s*[-#]\\s*([1-4])\\b`),
    new RegExp(`\\b${role}\\s+([1-4])\\s*$`),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const slot = asWorkerSlot(match?.[1]);
    if (slot) return slot;
  }
  return null;
}

function workerSlotFromId(value) {
  const match = /(?:__kwitansi_worker_|[-_]worker[-_])([1-4])(?:\D|$)/i.exec(value ?? "");
  return asWorkerSlot(match?.[1]);
}

function getWorkerSlot(note, roleText) {
  const data = asRecord(note.data_json);
  const items = Array.isArray(data.items) ? data.items : [];
  const explicit = [
    data.kwitansiWorkerSlot,
    data.workerSlot,
    data.worker_slot,
    data.person_slot,
    data.slot_pekerja,
  ].map(asWorkerSlot).find(Boolean);
  if (explicit) return explicit;

  const idSlot = workerSlotFromId(note.id)
    || items.map((item) => workerSlotFromId(item?.id)).find(Boolean);
  if (idSlot) return idSlot;

  return workerSlotFromText(roleText)
    || items.map((item) => workerSlotFromText(item?.itemName || item?.name)).find(Boolean)
    || null;
}

function syncKeyForNote(note, group, roleText) {
  if (group === "mandor" || group === "kepala_tukang") return group;
  const slot = getWorkerSlot(note, roleText);
  return slot ? `${group}_${slot}` : `${group}_unresolved`;
}

function dataReceiver(data) {
  return stringValue(data.kwitansiReceiverName).trim()
    || stringValue(data.namaPenerima).trim()
    || stringValue(data.nama_penerima).trim()
    || stringValue(data.receiverName).trim();
}

function effectiveReceiver(note, edit) {
  return stringValue(edit?.nama_penerima).trim() || dataReceiver(asRecord(note.data_json));
}

function hasDikaReceiver(note, edit) {
  const values = [
    effectiveReceiver(note, edit),
    stringValue(edit?.nama_penerima),
    JSON.stringify(asRecord(note.data_json)),
    JSON.stringify(asRecord(edit?.custom_data_json)),
  ];
  return values.some((value) => normalizeText(value).includes("dika nurdiansyah"));
}

function clearReceiverInData(data) {
  let changed = false;
  for (const key of ["kwitansiReceiverName", "namaPenerima", "nama_penerima", "receiverName"]) {
    if (Object.prototype.hasOwnProperty.call(data, key) && String(data[key] ?? "").trim() !== "") {
      data[key] = "";
      changed = true;
    }
  }
  if (!Object.prototype.hasOwnProperty.call(data, "kwitansiReceiverName")) {
    data.kwitansiReceiverName = "";
  }
  return changed;
}

function clearReceiverInCustom(custom) {
  let changed = false;
  for (const key of ["kwitansiReceiverName", "namaPenerima", "nama_penerima", "receiverName"]) {
    if (Object.prototype.hasOwnProperty.call(custom, key) && String(custom[key] ?? "").trim() !== "") {
      custom[key] = "";
      changed = true;
    }
  }
  return changed;
}

function isOperationalSupportNote(note) {
  const text = noteText(note);
  const compact = compactText(text);
  return (
    compact.includes("dukunganoperasionalgerai") ||
    compact.includes("dukunganoperasionalbabinsa") ||
    text.includes("operasional gerai") ||
    text.includes("operasional babinsa")
  );
}

function projectResponsibleName(project) {
  const meta = asRecord(project?.metadata_json);
  return stringValue(meta.babinsa_responsible_name).trim()
    || stringValue(meta.responsible_name).trim()
    || stringValue(meta.nama_babinsa).trim()
    || stringValue(meta.penanggung_jawab).trim()
    || "";
}

function setPayerInData(data, payer) {
  let changed = false;
  for (const key of ["kwitansiPayerName", "namaPemberi", "nama_pemberi"]) {
    if ((key === "kwitansiPayerName" || Object.prototype.hasOwnProperty.call(data, key)) && stringValue(data[key]).trim() !== payer) {
      data[key] = payer;
      changed = true;
    }
  }
  return changed;
}

function setReceiverInDataIfBlank(data, receiver) {
  if (!receiver) return false;
  if (dataReceiver(data)) return false;
  data.kwitansiReceiverName = receiver;
  return true;
}

function sameJson(left, right) {
  return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});
}

function noteUpdateRow(note, data) {
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

function editUpsertRow(note, edit, namaPenerima, warnaTemplate, customData) {
  return {
    id: edit?.id || crypto.randomUUID(),
    project_id: note.project_id,
    note_id: note.id,
    nama_penerima: namaPenerima,
    warna_template: warnaTemplate || "default",
    custom_data_json: customData,
  };
}

const [projects, notes, edits] = await Promise.all([
  fetchAll("projects", "id,nama_desa,kecamatan,metadata_json", "kecamatan.asc,nama_desa.asc"),
  fetchAll("generated_notes", "*", "project_id.asc,created_at.asc"),
  fetchAll("kwitansi_edits", "*", "project_id.asc,created_at.asc"),
]);

const projectById = new Map(projects.map((project) => [project.id, project]));
const editsByNoteId = new Map(edits.map((edit) => [edit.note_id, edit]));
const noteUpdatesById = new Map();
const editUpdatesByNoteId = new Map();
const targets = [];
const operationalMissingResponsibleNames = [];

for (const note of notes) {
  if (note.document_type !== "kwitansi") continue;
  const edit = editsByNoteId.get(note.id);
  const data = structuredClone(asRecord(note.data_json));
  const originalData = asRecord(note.data_json);
  const stage = noteStage(note);
  const project = projectById.get(note.project_id);
  const roleText = noteRoleText(note);
  const text = noteText(note);
  const group = syncGroupFromText(roleText) || syncGroupFromText(text);
  const dikaReceiver = hasDikaReceiver(note, edit);
  const isWorkerResetTarget = (CORE_WORKER_STAGES.has(stage) && Boolean(group)) || dikaReceiver;

  if (isWorkerResetTarget) {
    const beforeDataReceiver = dataReceiver(originalData);
    const beforeEditReceiver = stringValue(edit?.nama_penerima).trim();
    clearReceiverInData(data);

    if (!sameJson(originalData, data)) {
      noteUpdatesById.set(note.id, noteUpdateRow(note, data));
    }

    if (edit) {
      const custom = structuredClone(asRecord(edit.custom_data_json));
      const customChanged = clearReceiverInCustom(custom);
      if (beforeEditReceiver || customChanged) {
        editUpdatesByNoteId.set(note.id, editUpsertRow(
          note,
          edit,
          "",
          edit.warna_template || stringValue(data.warnaTemplate) || "default",
          custom,
        ));
      }
    }

    targets.push({
      change_type: "RESET_WORKER_RECEIVER",
      desa: project?.nama_desa ?? "",
      kecamatan: project?.kecamatan ?? "",
      project_id: note.project_id,
      note_id: note.id,
      tahap: stage,
      role: roleText,
      sync_key: group ? syncKeyForNote(note, group, roleText) : "",
      item: text.slice(0, 180),
      receiver_data_before: beforeDataReceiver,
      receiver_edit_before: beforeEditReceiver,
      receiver_after: "",
      payer_data_before: "",
      payer_edit_before: "",
      payer_after: "",
      responsible_name: projectResponsibleName(project),
      reason: dikaReceiver && !group ? "dika_receiver_cleanup" : "core_worker_class",
    });
    continue;
  }

  if (isOperationalSupportNote(note)) {
    const responsibleName = projectResponsibleName(project);
    const receiverAfter = effectiveReceiver(note, edit) || responsibleName || "Babinsa";
    const payerBeforeData = stringValue(data.kwitansiPayerName).trim();
    const payerBeforeEdit = stringValue(asRecord(edit?.custom_data_json).nama_pemberi).trim();
    const receiverBeforeData = dataReceiver(data);
    const receiverBeforeEdit = stringValue(edit?.nama_penerima).trim();

    setPayerInData(data, "Babinsa");
    setReceiverInDataIfBlank(data, receiverAfter);

    if (!sameJson(originalData, data)) {
      noteUpdatesById.set(note.id, noteUpdateRow(note, data));
    }

    const custom = {
      ...structuredClone(asRecord(edit?.custom_data_json)),
      prepared_for_template_variants: true,
      nama_pemberi: "Babinsa",
    };
    if (!effectiveReceiver(note, edit)) custom.receiver_source = "auto";
    editUpdatesByNoteId.set(note.id, editUpsertRow(
      note,
      edit,
      receiverAfter,
      edit?.warna_template || stringValue(data.warnaTemplate) || "default",
      custom,
    ));

    if (!responsibleName) operationalMissingResponsibleNames.push(note.id);
    targets.push({
      change_type: "OPERASIONAL_BABINSA",
      desa: project?.nama_desa ?? "",
      kecamatan: project?.kecamatan ?? "",
      project_id: note.project_id,
      note_id: note.id,
      tahap: stage,
      role: roleText,
      sync_key: "",
      item: text.slice(0, 180),
      receiver_data_before: receiverBeforeData,
      receiver_edit_before: receiverBeforeEdit,
      receiver_after: receiverAfter,
      payer_data_before: payerBeforeData,
      payer_edit_before: payerBeforeEdit,
      payer_after: "Babinsa",
      responsible_name: responsibleName,
      reason: "dukungan_operasional_gerai_babinsa",
    });
  }
}

const noteUpdates = [...noteUpdatesById.values()];
const editUpdates = [...editUpdatesByNoteId.values()].filter((update) => {
  const before = editsByNoteId.get(update.note_id);
  if (!before) return true;
  return before.nama_penerima !== update.nama_penerima
    || before.warna_template !== update.warna_template
    || !sameJson(before.custom_data_json, update.custom_data_json);
});

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const backup = {
  created_at: new Date().toISOString(),
  purpose: "before_kwitansi_worker_reset_operasional_babinsa",
  execute,
  generated_notes: notes.filter((note) => noteUpdatesById.has(note.id)),
  kwitansi_edits: edits.filter((edit) => editUpdatesByNoteId.has(edit.note_id)),
  new_kwitansi_edit_note_ids: editUpdates.filter((edit) => !editsByNoteId.has(edit.note_id)).map((edit) => edit.note_id),
};
const backupFile = path.join(OUTPUT_DIR, `kwitansi_worker_reset_operasional_babinsa_backup_${timestamp}.json`);
const backupText = `${JSON.stringify(backup, null, 2)}\n`;
fs.writeFileSync(backupFile, backupText, "utf8");
const backupSha256 = crypto.createHash("sha256").update(backupText).digest("hex");
fs.writeFileSync(`${backupFile}.sha256`, `${backupSha256}  ${path.basename(backupFile)}\n`, "utf8");

const planColumns = [
  "change_type",
  "desa",
  "kecamatan",
  "project_id",
  "note_id",
  "tahap",
  "role",
  "sync_key",
  "item",
  "receiver_data_before",
  "receiver_edit_before",
  "receiver_after",
  "payer_data_before",
  "payer_edit_before",
  "payer_after",
  "responsible_name",
  "reason",
];
writeCsv(path.join(OUTPUT_DIR, `kwitansi_worker_reset_operasional_babinsa_plan_${RUN_DATE}.csv`), targets, planColumns);

const report = {
  generated_at: new Date().toISOString(),
  mode: execute ? "EXECUTE_REST" : "DRY_RUN",
  status: execute ? "PENDING_EXECUTION" : "DRY_RUN_READY",
  targets: targets.length,
  worker_receiver_reset_targets: targets.filter((row) => row.change_type === "RESET_WORKER_RECEIVER").length,
  operasional_babinsa_targets: targets.filter((row) => row.change_type === "OPERASIONAL_BABINSA").length,
  generated_notes_to_update: noteUpdates.length,
  kwitansi_edits_to_upsert: editUpdates.length,
  new_kwitansi_edits_to_insert: editUpdates.filter((edit) => !editsByNoteId.has(edit.note_id)).length,
  operasional_missing_responsible_names: operationalMissingResponsibleNames.length,
  backup_file: path.basename(backupFile),
  backup_sha256: backupSha256,
  plan_file: `kwitansi_worker_reset_operasional_babinsa_plan_${RUN_DATE}.csv`,
};

if (!execute) {
  fs.writeFileSync(path.join(OUTPUT_DIR, `kwitansi_worker_reset_operasional_babinsa_report_${RUN_DATE}.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
} else {
  const updatedNotes = noteUpdates.length ? await upsertRows("generated_notes", noteUpdates, "id") : 0;
  const updatedEdits = editUpdates.length ? await upsertRows("kwitansi_edits", editUpdates, "note_id") : 0;

  const [freshNotes, freshEdits] = await Promise.all([
    fetchAll("generated_notes", "*", "project_id.asc,created_at.asc"),
    fetchAll("kwitansi_edits", "*", "project_id.asc,created_at.asc"),
  ]);
  const freshEditByNoteId = new Map(freshEdits.map((edit) => [edit.note_id, edit]));
  const verifyErrors = [];
  let workerRowsVerified = 0;
  let operasionalRowsVerified = 0;

  for (const note of freshNotes) {
    if (note.document_type !== "kwitansi") continue;
    const edit = freshEditByNoteId.get(note.id);
    const stage = noteStage(note);
    const roleText = noteRoleText(note);
    const text = noteText(note);
    const group = syncGroupFromText(roleText) || syncGroupFromText(text);
    const workerTarget = (CORE_WORKER_STAGES.has(stage) && Boolean(group)) || hasDikaReceiver(note, edit);
    if (workerTarget) {
      workerRowsVerified += 1;
      const receiver = effectiveReceiver(note, edit);
      if (receiver) verifyErrors.push(`worker receiver not empty ${note.id}: ${receiver}`);
    }

    if (isOperationalSupportNote(note)) {
      operasionalRowsVerified += 1;
      const data = asRecord(note.data_json);
      const custom = asRecord(edit?.custom_data_json);
      if (stringValue(data.kwitansiPayerName).trim() !== "Babinsa") verifyErrors.push(`operasional data payer mismatch ${note.id}`);
      if (stringValue(custom.nama_pemberi).trim() !== "Babinsa") verifyErrors.push(`operasional edit payer mismatch ${note.id}`);
      if (!effectiveReceiver(note, edit)) verifyErrors.push(`operasional receiver empty ${note.id}`);
    }
  }

  const dikaNotes = freshNotes.filter((note) => note.document_type === "kwitansi" && normalizeText(JSON.stringify(note.data_json)).includes("dika nurdiansyah"));
  const dikaEdits = freshEdits.filter((edit) => normalizeText(JSON.stringify(edit)).includes("dika nurdiansyah"));
  if (dikaNotes.length) verifyErrors.push(`Dika Nurdiansyah remains in generated_notes: ${dikaNotes.length}`);
  if (dikaEdits.length) verifyErrors.push(`Dika Nurdiansyah remains in kwitansi_edits: ${dikaEdits.length}`);

  report.status = verifyErrors.length ? "EXECUTED_WITH_VERIFY_ERRORS" : "EXECUTED_VERIFIED";
  report.execution = {
    generated_notes_updated: updatedNotes,
    kwitansi_edits_upserted: updatedEdits,
    worker_rows_verified: workerRowsVerified,
    operasional_rows_verified: operasionalRowsVerified,
    dika_generated_notes_remaining: dikaNotes.length,
    dika_kwitansi_edits_remaining: dikaEdits.length,
    verify_errors: verifyErrors.length,
    first_verify_errors: verifyErrors.slice(0, 100),
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, `kwitansi_worker_reset_operasional_babinsa_report_${RUN_DATE}.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (verifyErrors.length) process.exitCode = 2;
}
