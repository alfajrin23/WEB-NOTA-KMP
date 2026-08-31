import type { GeneratedNota, KwitansiWorkerSlot, StageCode } from "@/types/domain";

type KwitansiSyncGroup = "mandor" | "kepala_tukang" | "tukang" | "kenek";

export type KwitansiSyncKey =
  | "mandor"
  | "kepala_tukang"
  | `tukang_${KwitansiWorkerSlot}`
  | `kenek_${KwitansiWorkerSlot}`
  | `terampil_${KwitansiWorkerSlot}`
  | `buruh_${KwitansiWorkerSlot}`;

const WORKER_SLOTS: KwitansiWorkerSlot[] = [1, 2, 3, 4];

function normalized(value: string | undefined | null) {
  return (value ?? "")
    .replace(/\btrampil\b/gi, "terampil")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function dynamicStringFields(value: unknown, keys: string[]) {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return keys
    .map((key) => record[key])
    .filter((entry): entry is string => typeof entry === "string");
}

function joinedDocText(doc: GeneratedNota) {
  const dynamicFields = dynamicStringFields(doc, [
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
  const itemFields = doc.items.flatMap((item) => [
    item.itemName,
    item.vendorName,
    item.category,
    item.categoryName,
    item.notes,
    ...dynamicStringFields(item, [
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
    ]),
  ]);

  return [
    doc.kwitansiRoleName,
    doc.kwitansiPaymentDescription,
    doc.stageName,
    doc.vendorName,
    doc.vendor?.name,
    ...(doc.vendor?.aliases ?? []),
    doc.templateName,
    ...dynamicFields,
    ...doc.categoryNames,
    ...itemFields,
  ].filter(Boolean).join(" ");
}

function syncGroupFromText(value: string | undefined | null): KwitansiSyncGroup | null {
  const text = normalized(value);
  if (!text) return null;
  if (text.includes("kepala tukang")) return "kepala_tukang";
  if (text.includes("tukang borongan") || text.includes("jasa borong")) return null;
  if (text.includes("mandor")) return "mandor";
  if (text.includes("pekerja terampil") || /\btukang\b/.test(text)) return "tukang";
  if (text.includes("pekerja buruh") || text.includes("kenek") || /\bkuli\b/.test(text) || /\bladen\b/.test(text)) return "kenek";
  return null;
}

function asWorkerSlot(value: unknown): KwitansiWorkerSlot | null {
  const slot = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return slot === 1 || slot === 2 || slot === 3 || slot === 4 ? slot : null;
}

function workerSlotFromText(value: string | undefined | null): KwitansiWorkerSlot | null {
  const text = normalized(value);
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

function workerSlotFromId(value: string | undefined | null): KwitansiWorkerSlot | null {
  const match = /(?:__kwitansi_worker_|[-_]worker[-_])([1-4])(?:\D|$)/i.exec(value ?? "");
  return asWorkerSlot(match?.[1]);
}

export function getKwitansiWorkerSlot(doc: GeneratedNota, roleText?: string): KwitansiWorkerSlot | null {
  const docRecord = doc as unknown as Record<string, unknown>;
  const explicitDocSlot = [
    doc.kwitansiWorkerSlot,
    docRecord.workerSlot,
    docRecord.worker_slot,
    docRecord.person_slot,
    docRecord.slot_pekerja,
  ].map(asWorkerSlot).find((slot): slot is KwitansiWorkerSlot => Boolean(slot));
  if (explicitDocSlot) return explicitDocSlot;

  const idSlot = workerSlotFromId(doc.id)
    ?? doc.items.map((item) => workerSlotFromId(item.id)).find((slot): slot is KwitansiWorkerSlot => Boolean(slot));
  if (idSlot) return idSlot;

  const textSlot = workerSlotFromText(roleText)
    ?? doc.items.map((item) => workerSlotFromText(item.itemName)).find((slot): slot is KwitansiWorkerSlot => Boolean(slot));
  return textSlot ?? null;
}

function syncKey(group: KwitansiSyncGroup, slot: KwitansiWorkerSlot | null): KwitansiSyncKey | null {
  if (group === "mandor" || group === "kepala_tukang") return group;
  return slot ? `${group}_${slot}` : null;
}

function workerModeForDoc(doc: GeneratedNota, roleText: string | undefined) {
  const text = normalized([roleText, joinedDocText(doc)].filter(Boolean).join(" "));
  return text.includes("lembur") ? "lembur" : "pokok";
}

export function kwitansiSyncKeyFromText(value: string | undefined | null): KwitansiSyncKey | null {
  const group = syncGroupFromText(value);
  return group ? syncKey(group, workerSlotFromText(value)) : null;
}

export function kwitansiSyncKeyForDoc(doc: GeneratedNota, roleText?: string): KwitansiSyncKey | null {
  const group = syncGroupFromText(roleText) ?? syncGroupFromText(joinedDocText(doc));
  return group ? syncKey(group, getKwitansiWorkerSlot(doc, roleText)) : null;
}

export function buildKwitansiSyncKeyMap(
  docs: GeneratedNota[],
  roleForDoc: (doc: GeneratedNota) => string | undefined = (doc) => doc.kwitansiRoleName,
) {
  const result = new Map<string, KwitansiSyncKey>();
  const workerGroups = new Map<string, Array<{
    doc: GeneratedNota;
    group: "tukang" | "kenek";
    slot: KwitansiWorkerSlot | null;
  }>>();

  for (const doc of docs) {
    const roleText = roleForDoc(doc);
    const group = syncGroupFromText(roleText) ?? syncGroupFromText(joinedDocText(doc));
    if (!group) continue;
    if (group === "mandor" || group === "kepala_tukang") {
      result.set(doc.id, group);
      continue;
    }

    const groupKey = `${doc.projectId}|${doc.stageCode}|${group}|${workerModeForDoc(doc, roleText)}`;
    const entries = workerGroups.get(groupKey) ?? [];
    entries.push({ doc, group, slot: getKwitansiWorkerSlot(doc, roleText) });
    workerGroups.set(groupKey, entries);
  }

  for (const entries of workerGroups.values()) {
    entries.sort((left, right) => (
      (left.doc.printOrder ?? Number.MAX_SAFE_INTEGER) - (right.doc.printOrder ?? Number.MAX_SAFE_INTEGER)
      || (left.doc.items[0]?.sortOrder ?? Number.MAX_SAFE_INTEGER) - (right.doc.items[0]?.sortOrder ?? Number.MAX_SAFE_INTEGER)
      || left.doc.id.localeCompare(right.doc.id)
    ));

    const usedSlots = new Set<KwitansiWorkerSlot>();
    const unresolved: typeof entries = [];
    for (const entry of entries) {
      if (entry.slot && !usedSlots.has(entry.slot)) {
        result.set(entry.doc.id, `${entry.group}_${entry.slot}`);
        usedSlots.add(entry.slot);
      } else {
        unresolved.push(entry);
      }
    }

    const availableSlots = WORKER_SLOTS.filter((slot) => !usedSlots.has(slot));
    unresolved.slice(0, availableSlots.length).forEach((entry, index) => {
      result.set(entry.doc.id, `${entry.group}_${availableSlots[index]}`);
    });
  }

  return result;
}

export function getKwitansiReceiverSyncPlan(
  docs: GeneratedNota[],
  sourceDoc: GeneratedNota,
  syncKeysByDocId: Map<string, KwitansiSyncKey>,
  options: {
    roleText?: string;
    targetStages?: ReadonlySet<StageCode>;
  } = {},
) {
  const syncKey = kwitansiSyncKeyForDoc(sourceDoc, options.roleText)
    ?? syncKeysByDocId.get(sourceDoc.id)
    ?? null;
  const targets = syncKey
    ? docs.filter((doc) => (
      doc.id !== sourceDoc.id &&
      (!options.targetStages || options.targetStages.has(doc.stageCode)) &&
      syncKeysByDocId.get(doc.id) === syncKey
    ))
    : [];

  return { syncKey, targets };
}

export function kwitansiSyncLabel(key: KwitansiSyncKey) {
  if (key === "mandor") return "Mandor";
  if (key === "kepala_tukang") return "Kepala Tukang";
  if (key.startsWith("tukang_")) return `Tukang ${key.slice(-1)}`;
  if (key.startsWith("kenek_")) return `Kenek ${key.slice(-1)}`;
  if (key.startsWith("terampil_")) return `Pekerja Terampil ${key.slice(-1)}`;
  return `Pekerja Buruh / Laden ${key.slice(-1)}`;
}

export function isOperationalSupportKwitansiDoc(doc: GeneratedNota) {
  const text = normalized(joinedDocText(doc));
  const compact = text.replace(/[^a-z0-9]+/g, "");
  return (
    compact.includes("dukunganoperasionalgerai") ||
    compact.includes("dukunganoperasionalbabinsa") ||
    text.includes("operasional gerai") ||
    text.includes("operasional babinsa")
  );
}

export function getAutofillKwitansiReceiver(doc: GeneratedNota) {
  const text = normalized(joinedDocText(doc));
  if (!text) return "";

  const responsibleName = doc.projectMeta.responsibleName?.trim() || "Babinsa";
  const isStageSix = doc.stageCode === "TAHAP_VI" || text.includes("tahap_vi") || text.includes("tahap vi");
  const isSnackboxMeeting = isStageSix && text.replace(/[^a-z0-9]+/g, "").includes("snackboxrapat");
  const isSurveyFeasibility = isStageSix
    && (text.includes("pencarian") || text.includes("survei") || text.includes("survey"))
    && text.includes("kelayakan lahan");
  const isEscortTravel = isStageSix
    && !isSurveyFeasibility
    && text.includes("uang jalan")
    && text.includes("pengawalan lapangan");

  if (isOperationalSupportKwitansiDoc(doc)) return responsibleName;
  if (isSnackboxMeeting || isEscortTravel) return responsibleName;
  if (isSurveyFeasibility) return "Mandor";
  if (text.includes("pratama project mandiri") || text.includes("sumur bor") || text.includes("cut n fill")) return "H. Nana";
  if (text.includes("baja ringan")) return "Dadang Bahtiar";
  if (text.includes("pintu kaca frameless")) return "Sarwoto";
  if (text.includes("pintu besi")) return "Sarwoto";
  if (text.includes("partisi kaca")) return "Sarwoto";
  if (text.includes("signage")) return "Nuryadi Mulyawan";
  if (text.includes("folding door")) return "Jamal";
  if (text.includes("folding gate")) return "Riki Subagja";
  if (text.includes("listrik") || text.includes("sumuran grounding") || text.includes("sumur grounding")) return "Dian";
  if (text.includes("sopir") || text.includes("supir")) return "Renaldy Prayoga";

  return "";
}
