import { findTemplateDefinition, resolveExplicitTemplateAssignment } from "@/constants/template-mapping";
import { STAGES } from "@/constants/stages";
import { GeneratedNota, Project, ProjectMeta, ResumeItem, StageCode, TemplateAssignment, Vendor } from "@/types/domain";
import { terbilangRupiah } from "@/utils/format";
import { getAutofillKwitansiReceiver } from "./kwitansi-rules";
import { getResumeItemAmount } from "./resume-calculations";

const INTERNAL_VENDOR_ID = "vendor-internal";
const INTERNAL_TEMPLATE_ID = "template-nota-internal-non-vendor";
const KWITANSI_VENDOR_ID = "vendor-kwitansi";
const PPM_VENDOR_ID = "vendor-ppm";
const PLN_VENDOR_ID = "vendor-pln";
const PLN_PRINT_GROUP_KEY = "pln-electricity";

export const KWITANSI_TARGET_COUNTS: Partial<Record<StageCode, number>> = {
  TAHAP_I: 14,
  TAHAP_II: 15,
  TAHAP_III: 21,
  TAHAP_IV: 14,
  RESUME_ALL: 8,
};

export type KwitansiGenerationIssue = {
  code: "target-count-mismatch" | "missing-source-item" | "invalid-amount" | "missing-date" | "missing-description";
  stageCode: StageCode;
  message: string;
  itemId?: string;
  itemName?: string;
};

export type KwitansiGenerationDiagnostics = {
  stages: Array<{
    stageCode: StageCode;
    expected: number;
    actual: number;
    missingCount: number;
    excessCount: number;
  }>;
  specialPln: {
    expected: 0;
    actual: number;
    missingCount: number;
  };
  issues: KwitansiGenerationIssue[];
};

function firstDate(items: ResumeItem[], fallback: string) {
  const dates = items
    .map((item) => item.expenseDate)
    .filter(Boolean)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  return dates[0] ?? fallback;
}

function projectMeta(project: Project): ProjectMeta {
  return {
    projectName: project.projectName,
    villageName: project.villageName,
    districtName: project.districtName,
    regencyName: project.regencyName,
    regionName: project.regionName,
    projectDate: project.projectDate,
    reportDate: project.reportDate,
    responsibleName: project.responsibleName,
    coordinates: project.coordinates,
    invoiceRecipientName: project.invoiceRecipientName,
    invoiceRecipientAddress: project.invoiceRecipientAddress,
  };
}

function stageIndex(stageCode: string) {
  const index = STAGES.findIndex((stage) => stage.code === stageCode);
  return index === -1 ? 99 : index;
}

function normalizedText(value: string | undefined | null) {
  return (value ?? "").trim().toLowerCase();
}

function isPpmItem(item: ResumeItem, vendor: Vendor | undefined) {
  const raw = `${item.vendorName ?? ""} ${vendor?.name ?? ""} ${(vendor?.aliases ?? []).join(" ")}`.toLowerCase();
  return item.vendorId === PPM_VENDOR_ID || raw.includes("ppm") || raw.includes("pratama project mandiri");
}

function isStageThreePartisiKwitansiItem(item: ResumeItem) {
  if (item.stageCode !== "TAHAP_III" || item.categoryCode !== "D") return false;
  const name = normalizedText(item.itemName);
  return name === "pek. pintu besi" || name === "pek. dinding partisi kaca" || name === "pek. pintu kaca frameless";
}

function isKwitansiVendorItem(item: ResumeItem) {
  return item.vendorId === KWITANSI_VENDOR_ID || normalizedText(item.vendorName) === "kwitansi";
}

function isKwitansiItem(item: ResumeItem, vendor: Vendor | undefined) {
  return isKwitansiVendorItem(item) || vendor?.type === "labor" || isPpmItem(item, vendor) || isStageThreePartisiKwitansiItem(item);
}

function isInitialPlnInstallationItem(item: ResumeItem) {
  const isPln = item.vendorId === PLN_VENDOR_ID || normalizedText(item.vendorName) === "pln";
  if (!isPln || item.stageCode !== "TAHAP_IV") return false;
  const name = normalizedText(item.itemName);
  return name.includes("daya pln") || name.includes("pemasangan listrik daya 5500 va");
}

function isPlnPowerUpgradeItem(item: ResumeItem) {
  const isPln = item.vendorId === PLN_VENDOR_ID || normalizedText(item.vendorName) === "pln";
  if (!isPln || item.stageCode !== "RESUME_ALL") return false;
  const name = normalizedText(item.itemName);
  return name.includes("penambahan daya listrik") || name.includes("tambah daya 5500 va") || name.includes("16.500 va");
}

function isSpecialPlnKwitansiItem(item: ResumeItem) {
  return isInitialPlnInstallationItem(item) || isPlnPowerUpgradeItem(item);
}

function isInternalNonVendorItem(item: ResumeItem) {
  if (item.vendorId === INTERNAL_VENDOR_ID) return true;
  if (item.vendorId) return false;
  const rawVendor = (item.vendorName ?? "").trim();
  return !item.vendorId || rawVendor === "" || rawVendor === "-" || rawVendor.toLowerCase() === "null";
}

function fallbackInternalVendor(vendors: Vendor[]) {
  return vendors.find((vendor) => vendor.id === INTERNAL_VENDOR_ID) ?? {
    id: INTERNAL_VENDOR_ID,
    name: "Internal / Non Vendor",
    type: "internal" as const,
  };
}

function fallbackKwitansiVendor(vendors: Vendor[]) {
  return vendors.find((vendor) => vendor.id === KWITANSI_VENDOR_ID) ?? {
    id: KWITANSI_VENDOR_ID,
    name: "KWITANSI",
    type: "labor" as const,
  };
}

function ppmKwitansiVendor(vendors: Vendor[]) {
  const vendor = vendors.find((entry) => entry.id === PPM_VENDOR_ID);
  return {
    ...(vendor ?? { id: PPM_VENDOR_ID, type: "equipment" as const }),
    id: PPM_VENDOR_ID,
    name: "CV. PRATAMA PROJECT MANDIRI",
  } satisfies Vendor;
}

function documentSortRank(doc: Pick<GeneratedNota, "stageCode" | "vendorId">) {
  if (doc.vendorId === "vendor-pln" && doc.stageCode === "TAHAP_IV") return stageIndex("TAHAP_IV") * 100 + 90;
  return stageIndex(doc.stageCode) * 100;
}

function kwitansiTemplateId(stageCode: StageCode) {
  if (stageCode === "RESUME_ALL") return "kwitansi-luar-inti";
  if (stageCode === "TAHAP_I") return "kwitansi-tahap-1";
  if (stageCode === "TAHAP_II") return "kwitansi-tahap-2";
  if (stageCode === "TAHAP_III") return "kwitansi-tahap-3";
  return "kwitansi-tahap-4";
}

function kwitansiTemplateName(stageCode: StageCode) {
  if (stageCode === "RESUME_ALL") return "KWITANSI DI LUAR PEKERJAAN INTI";
  if (stageCode === "TAHAP_I") return "KWITANSI TAHAP 1";
  if (stageCode === "TAHAP_II") return "KWITANSI TAHAP 2";
  if (stageCode === "TAHAP_III") return "KWITANSI TAHAP 3";
  return "KWITANSI TAHAP 4";
}

function stageRoman(stageCode: StageCode) {
  if (stageCode === "TAHAP_I") return "I";
  if (stageCode === "TAHAP_II") return "II";
  if (stageCode === "TAHAP_III") return "III";
  if (stageCode === "TAHAP_IV") return "IV";
  return "IV";
}

function isLemburItem(item: ResumeItem) {
  return normalizedText(item.categoryName ?? item.category).includes("tenaga lembur") || item.categoryCode === "E" || item.categoryCode === "I";
}

function shouldSplitFourWorkers(item: ResumeItem) {
  const name = normalizedText(item.itemName);
  return (
    (name.includes("pekerja trampil") || name.includes("pekerja terampil") || name.includes("pekerja buruh")) &&
    /\((4\s*(orang|org))\)/i.test(item.itemName)
  );
}

function isWorkerTerampilItem(item: ResumeItem) {
  const name = normalizedText(item.itemName);
  return name.includes("pekerja trampil") || name.includes("pekerja terampil");
}

function isWorkerBuruhItem(item: ResumeItem) {
  return normalizedText(item.itemName).includes("pekerja buruh");
}

function cloneReceiptItem(item: ResumeItem, amount: number, suffix: string): ResumeItem {
  return {
    ...item,
    id: `${item.id}__kwitansi_${suffix}`,
    amountOverride: amount,
  };
}

type KwitansiReceiptInput = {
  key: string;
  stageCode: StageCode;
  vendor: Vendor;
  items: ResumeItem[];
  sourceItemIds: string[];
  categoryNames: string[];
};

const OUTSIDE_CORE_KWITANSI_ORDER = [
  "pencarian",
  "sosialisasi",
  "rapat koordinasi",
  "pengukuran lahan",
  "pematangan lahan",
  "pembersihan lahan",
  "cut n fill",
  "sumur bor",
] as const;

function outsideCoreKwitansiOrder(item: ResumeItem) {
  const name = normalizedText(item.itemName);
  const index = OUTSIDE_CORE_KWITANSI_ORDER.findIndex((keyword) => name.includes(keyword));
  return index === -1 ? 99 : index;
}

function isOutsideCoreContext(item: ResumeItem) {
  const text = normalizedText([item.stageCode, item.stageName, item.category, item.categoryName].filter(Boolean).join(" "));
  return (
    item.stageCode === "RESUME_ALL" ||
    text.includes("luar konstruksi inti") ||
    text.includes("luar pekerjaan inti") ||
    text.includes("di luar konstruksi inti") ||
    text.includes("di luar pekerjaan inti")
  );
}

function isOutsideCoreKwitansiItem(item: ResumeItem) {
  return (
    isKwitansiVendorItem(item) &&
    item.isIncludedInResumeTotal !== false &&
    outsideCoreKwitansiOrder(item) < 99 &&
    (item.stageCode === "RESUME_ALL" || isOutsideCoreContext(item))
  );
}

function makeKwitansiDoc(project: Project, input: KwitansiReceiptInput): GeneratedNota {
  const sortedItems = [...input.items].sort((a, b) => a.sortOrder - b.sortOrder);
  const total = sortedItems.reduce((sum, item) => sum + getResumeItemAmount(item), 0);
  const tanggal = firstDate(sortedItems, project.projectDate);
  const stageName = input.stageCode === "RESUME_ALL" ? "Kwitansi Di Luar Pekerjaan Inti" : `Kwitansi Tahap ${stageRoman(input.stageCode)}`;
  const doc: GeneratedNota = {
    id: `kwitansi-${project.id}-${input.stageCode.toLowerCase()}-${input.key}`,
    projectId: project.id,
    stageId: input.stageCode,
    stageCode: input.stageCode,
    stageName,
    vendorId: input.vendor.id,
    vendorName: input.vendor.name,
    vendor: input.vendor,
    documentType: "kwitansi",
    templateId: kwitansiTemplateId(input.stageCode),
    templateName: kwitansiTemplateName(input.stageCode),
    categoryNames: input.categoryNames,
    tanggal,
    notaDate: tanggal,
    subtotal: total,
    totalAmount: total,
    terbilang: terbilangRupiah(total),
    items: sortedItems,
    itemIds: input.sourceItemIds,
    projectMeta: projectMeta(project),
  };
  const receiver = getAutofillKwitansiReceiver(doc);
  return receiver ? { ...doc, kwitansiReceiverName: receiver } : doc;
}

function isExcludedStageFourKwitansiItem(item: ResumeItem) {
  if (item.stageCode !== "TAHAP_IV") return false;
  const name = normalizedText(item.itemName);
  return name.includes("sumuran grounding") || isOutsideCoreKwitansiItem(item);
}

function isStageFourMandorItem(item: ResumeItem) {
  return normalizedText(item.itemName) === "mandor";
}

function isStageFourHeadWorkerItem(item: ResumeItem) {
  return normalizedText(item.itemName) === "kepala tukang";
}

function isStageFourDriverItem(item: ResumeItem) {
  const name = normalizedText(item.itemName);
  return (name === "sopir" || name === "supir") && !name.includes("pembantu") && !name.includes("kenek");
}

function isStageFourAssistantDriverItem(item: ResumeItem) {
  const name = normalizedText(item.itemName);
  return name.includes("kenek") || /pembantu\s+(sopir|supir)/.test(name);
}

function isStageFourElectricWorkerItem(item: ResumeItem) {
  const name = normalizedText(item.itemName);
  return name.includes("listrik") && !name.includes("daya pln") && !name.includes("penambahan daya");
}

function isStageFourWhitelistedKwitansiItem(item: ResumeItem, vendor: Vendor | undefined) {
  if (item.stageCode !== "TAHAP_IV" || item.isIncludedInResumeTotal === false || isExcludedStageFourKwitansiItem(item)) return false;
  if (isPpmItem(item, vendor)) return true;
  if (!isKwitansiVendorItem(item)) return false;
  return (
    isStageFourMandorItem(item) ||
    isStageFourHeadWorkerItem(item) ||
    isWorkerTerampilItem(item) ||
    isWorkerBuruhItem(item) ||
    isStageFourDriverItem(item) ||
    isStageFourAssistantDriverItem(item) ||
    isStageFourElectricWorkerItem(item)
  );
}

function buildStageFourKwitansiReceipts(project: Project, vendors: Vendor[]): KwitansiReceiptInput[] {
  const kwitansiVendor = fallbackKwitansiVendor(vendors);
  const ppmVendor = ppmKwitansiVendor(vendors);
  const stageItems = project.items.filter((item) => item.stageCode === "TAHAP_IV" && item.isIncludedInResumeTotal !== false);
  const receipts: KwitansiReceiptInput[] = [];

  const directItems = stageItems
    .filter((item) => isStageFourWhitelistedKwitansiItem(item, vendors.find((vendor) => vendor.id === item.vendorId)))
    .sort((left, right) => left.sortOrder - right.sortOrder);

  const ppmItems = directItems.filter((item) => isPpmItem(item, vendors.find((vendor) => vendor.id === item.vendorId)));
  if (ppmItems.length > 0) {
    receipts.push({
      key: "ppm-sewa",
      stageCode: "TAHAP_IV",
      vendor: ppmVendor,
      items: ppmItems,
      sourceItemIds: ppmItems.map((item) => item.id),
      categoryNames: ["Sewa Kebutuhan Peralatan dan Kendaraan"],
    });
  }

  for (const item of directItems.filter((item) => !isPpmItem(item, vendors.find((vendor) => vendor.id === item.vendorId)))) {
    if (shouldSplitFourWorkers(item)) {
      const total = getResumeItemAmount(item);
      const base = Math.floor(total / 4);
      for (let part = 1; part <= 4; part += 1) {
        const amount = part === 4 ? total - base * 3 : base;
        receipts.push({
          key: `${item.id}-worker-${part}`,
          stageCode: "TAHAP_IV",
          vendor: kwitansiVendor,
          items: [cloneReceiptItem(item, amount, `worker_${part}`)],
          sourceItemIds: [item.id],
          categoryNames: [item.category],
        });
      }
    } else {
      receipts.push({
        key: item.id,
        stageCode: "TAHAP_IV",
        vendor: kwitansiVendor,
        items: [item],
        sourceItemIds: [item.id],
        categoryNames: [item.category],
      });
    }
  }

  return receipts;
}

function buildKwitansiReceiptsForStage(project: Project, vendors: Vendor[], stageCode: StageCode): KwitansiReceiptInput[] {
  if (stageCode === "TAHAP_IV") return buildStageFourKwitansiReceipts(project, vendors);

  const kwitansiVendor = fallbackKwitansiVendor(vendors);
  const ppmVendor = ppmKwitansiVendor(vendors);
  const stageItems = project.items.filter((item) => item.stageCode === stageCode && item.isIncludedInResumeTotal !== false);
  const receipts: KwitansiReceiptInput[] = [];

  const ppmItems = stageItems.filter((item) => isPpmItem(item, vendors.find((vendor) => vendor.id === item.vendorId)));
  if (ppmItems.length > 0) {
    receipts.push({
      key: "ppm-sewa",
      stageCode,
      vendor: ppmVendor,
      items: ppmItems,
      sourceItemIds: ppmItems.map((item) => item.id),
      categoryNames: ["Sewa Kebutuhan Peralatan dan Kendaraan"],
    });
  }

  const lemburItems = stageItems.filter((item) => isKwitansiVendorItem(item) && isLemburItem(item));
  if (lemburItems.length > 0) {
    receipts.push({
      key: "tenaga-lembur",
      stageCode,
      vendor: kwitansiVendor,
      items: lemburItems,
      sourceItemIds: lemburItems.map((item) => item.id),
      categoryNames: ["Tenaga Lembur"],
    });
  }

  const regularItems = stageItems
    .filter((item) => isKwitansiItem(item, vendors.find((vendor) => vendor.id === item.vendorId)))
    .filter((item) => !isPpmItem(item, vendors.find((vendor) => vendor.id === item.vendorId)))
    .filter((item) => !(isKwitansiVendorItem(item) && isLemburItem(item)))
    .filter((item) => !isExcludedStageFourKwitansiItem(item));

  for (const item of regularItems) {
    if (shouldSplitFourWorkers(item)) {
      const total = getResumeItemAmount(item);
      const base = Math.floor(total / 4);
      for (let part = 1; part <= 4; part += 1) {
        const amount = part === 4 ? total - base * 3 : base;
        receipts.push({
          key: `${item.id}-worker-${part}`,
          stageCode,
          vendor: item.vendorId === PPM_VENDOR_ID ? ppmVendor : kwitansiVendor,
          items: [cloneReceiptItem(item, amount, `worker_${part}`)],
          sourceItemIds: [item.id],
          categoryNames: [item.category],
        });
      }
    } else {
      const vendor = isPpmItem(item, vendors.find((entry) => entry.id === item.vendorId)) ? ppmVendor : kwitansiVendor;
      receipts.push({
        key: item.id,
        stageCode,
        vendor,
        items: [item],
        sourceItemIds: [item.id],
        categoryNames: [item.category],
      });
    }
  }

  return receipts;
}

function buildOutsideCoreKwitansiReceipts(project: Project, vendors: Vendor[]): KwitansiReceiptInput[] {
  const kwitansiVendor = fallbackKwitansiVendor(vendors);
  return project.items
    .filter(isOutsideCoreKwitansiItem)
    .sort((left, right) => outsideCoreKwitansiOrder(left) - outsideCoreKwitansiOrder(right) || left.sortOrder - right.sortOrder)
    .slice(0, KWITANSI_TARGET_COUNTS.RESUME_ALL ?? 8)
    .map((item) => ({
      key: `luar-inti-${item.id}`,
      stageCode: "RESUME_ALL" as const,
      vendor: kwitansiVendor,
      items: [item],
      sourceItemIds: [item.id],
      categoryNames: [item.category],
    }));
}

function stageFourKwitansiOrder(doc: GeneratedNota) {
  const text = normalizedText([
    doc.vendorId,
    doc.vendorName,
    ...doc.items.map((item) => item.itemName),
  ].join(" "));

  if (text.includes("mandor")) return 1;
  if (text.includes("kepala tukang")) return 2;
  if (text.includes("pekerja trampil") || text.includes("pekerja terampil")) return 3;
  if (text.includes("pekerja buruh")) return 4;
  if ((text.includes("sopir") || text.includes("supir")) && !text.includes("pembantu") && !text.includes("kenek")) return 5;
  if (text.includes("pembantu") || text.includes("kenek")) return 6;
  if (doc.vendorId === PPM_VENDOR_ID || text.includes("pratama project mandiri") || text.includes("ppm")) return 7;
  if (text.includes("listrik")) return 8;
  return 99;
}

function makeSpecialPlnNotaDoc({
  project,
  vendor,
  sourceItem,
  printOrder,
  paymentDescription,
}: {
  project: Project;
  vendor: Vendor;
  sourceItem: ResumeItem;
  printOrder: 1 | 2;
  paymentDescription: string;
}): GeneratedNota {
  const amount = getResumeItemAmount(sourceItem);
  const amountWords = terbilangRupiah(amount);
  const kwitansiItem: ResumeItem = {
    ...sourceItem,
    stageCode: "TAHAP_IV",
    stageName: "Tahap IV - Kwitansi Pembayaran PLN",
    itemName: paymentDescription,
  };
  const base = makeKwitansiDoc(project, {
    key: `${PLN_PRINT_GROUP_KEY}-${printOrder}`,
    stageCode: "TAHAP_IV",
    vendor,
    items: [kwitansiItem],
    sourceItemIds: [sourceItem.id],
    categoryNames: ["Pembayaran Listrik PLN"],
  });
  const kwitansiDate = sourceItem.expenseDate || project.projectDate;

  return {
    ...base,
    id: `nota-${project.id}-${PLN_PRINT_GROUP_KEY}-${printOrder}`,
    stageId: "TAHAP_IV",
    stageCode: "TAHAP_IV",
    stageName: "Tahap IV - Kwitansi Pembayaran PLN",
    documentType: "nota",
    templateId: "template-pln",
    templateName: "Kwitansi Pembayaran PLN",
    tanggal: kwitansiDate,
    notaDate: kwitansiDate,
    subtotal: amount,
    totalAmount: amount,
    terbilang: amountWords,
    kwitansiPayerName: `KDKMP DESA ${project.villageName.toUpperCase()}`,
    kwitansiPaymentDescription: paymentDescription,
    kwitansiAmount: amount,
    kwitansiAmountWords: amountWords,
    kwitansiDate,
    kwitansiCity: project.regencyName || project.districtName || "Cianjur",
    printGroupKey: PLN_PRINT_GROUP_KEY,
    printOrder,
    isSpecialKwitansi: true,
  };
}

function buildSpecialPlnNotaDocs(project: Project, vendors: Vendor[]) {
  const vendor = vendors.find((entry) => entry.id === PLN_VENDOR_ID) ?? {
    id: PLN_VENDOR_ID,
    name: "PLN",
    type: "utility" as const,
  };
  const includedItems = project.items.filter((item) => item.isIncludedInResumeTotal !== false);
  const initialInstallation = includedItems.find(isInitialPlnInstallationItem);
  const powerUpgrade = includedItems.find(isPlnPowerUpgradeItem);
  const docs: GeneratedNota[] = [];

  if (initialInstallation) {
    docs.push(makeSpecialPlnNotaDoc({
      project,
      vendor,
      sourceItem: initialInstallation,
      printOrder: 1,
      paymentDescription: "Pemasangan Listrik Daya 5500 VA Dan Pemasangan Panel Listrik 3 Phase",
    }));
  }

  if (powerUpgrade) {
    docs.push(makeSpecialPlnNotaDoc({
      project,
      vendor,
      sourceItem: powerUpgrade,
      printOrder: 2,
      paymentDescription: "Tambah Daya 5500 VA ke 16.500 VA Dan Pemasangan Panel Listrik 3 Phase",
    }));
  }

  return docs;
}

type GroupedDocument = {
  key: string;
  vendor: Vendor;
  assignment: TemplateAssignment;
  items: ResumeItem[];
};

function generateDocuments(
  project: Project,
  vendors: Vendor[],
  templateAssignments: TemplateAssignment[],
  documentKind: "nota" | "kwitansi",
): GeneratedNota[] {
  const grouped = new Map<string, GroupedDocument>();

  for (const item of project.items) {
    const sourceVendor = vendors.find((entry) => entry.id === item.vendorId);
    const kwitansiItem = isKwitansiItem(item, sourceVendor);
    const specialPlnKwitansiItem = isSpecialPlnKwitansiItem(item);
    let vendor = sourceVendor;
    let assignment: TemplateAssignment | undefined;

    if (documentKind === "nota") {
      if (kwitansiItem || specialPlnKwitansiItem) continue;

      if (isInternalNonVendorItem(item)) {
        vendor = fallbackInternalVendor(vendors);
        assignment = resolveExplicitTemplateAssignment(item.stageCode, INTERNAL_VENDOR_ID, templateAssignments);
      } else if (vendor && vendor.type !== "internal") {
        assignment = resolveExplicitTemplateAssignment(item.stageCode, vendor.id, templateAssignments);
      }

      if (!vendor || !assignment || assignment.documentType !== "nota") continue;
    } else {
      if (!kwitansiItem || !vendor) continue;
      assignment = resolveExplicitTemplateAssignment(item.stageCode, vendor.id, templateAssignments);
      if (!assignment || assignment.documentType !== "kwitansi") continue;
    }

    const key = `${documentKind}-${item.stageCode}-${vendor.id}-${assignment.templateId}`;
    const current = grouped.get(key);
    if (current) {
      current.items.push(item);
    } else {
      grouped.set(key, {
        key,
        vendor,
        assignment,
        items: [item],
      });
    }
  }

  return [...grouped.values()]
    .map(({ key, items, vendor, assignment }) => {
      const sortedItems = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
      const first = sortedItems[0];
      if (!first) return null;

      const stageCode = first.stageCode;
      const template = findTemplateDefinition(assignment.templateId);
      const subtotal = sortedItems.reduce((sum, item) => sum + getResumeItemAmount(item), 0);
      const tanggal = firstDate(sortedItems, project.projectDate);
      const categoryNames = [...new Set(sortedItems.map((item) => item.category).filter(Boolean))];
      const templateName = template?.label ?? (assignment.templateId === INTERNAL_TEMPLATE_ID ? "Nota Kosong Internal / Non Vendor" : "Template Nota Kosong");

      return {
        id: `${documentKind}-${project.id}-${key}`,
        projectId: project.id,
        stageId: stageCode,
        stageCode,
        stageName: first.stageName,
        vendorId: vendor.id,
        vendorName: vendor.name,
        vendor,
        documentType: documentKind,
        templateId: assignment.templateId,
        templateName,
        categoryNames,
        tanggal,
        notaDate: tanggal,
        subtotal,
        totalAmount: subtotal,
        terbilang: terbilangRupiah(subtotal),
        items: sortedItems,
        itemIds: sortedItems.map((item) => item.id),
        projectMeta: projectMeta(project),
      } satisfies GeneratedNota;
    })
    .filter((doc): doc is GeneratedNota => Boolean(doc))
    .sort((a, b) => {
      const rankA = documentSortRank(a);
      const rankB = documentSortRank(b);
      if (rankA !== rankB) return rankA - rankB;
      return a.vendorName.localeCompare(b.vendorName);
    });
}

export function generateNotaDocuments(
  project: Project,
  vendors: Vendor[],
  templateAssignments: TemplateAssignment[],
): GeneratedNota[] {
  const regularDocs = generateDocuments(project, vendors, templateAssignments, "nota");
  const specialPlnDocs = buildSpecialPlnNotaDocs(project, vendors);

  return [...regularDocs, ...specialPlnDocs].sort((a, b) => {
    const rankA = documentSortRank(a);
    const rankB = documentSortRank(b);
    if (rankA !== rankB) return rankA - rankB;
    if (a.printGroupKey && a.printGroupKey === b.printGroupKey) return (a.printOrder ?? 0) - (b.printOrder ?? 0);
    return a.vendorName.localeCompare(b.vendorName);
  });
}

export function generateKwitansiDocuments(
  project: Project,
  vendors: Vendor[],
  templateAssignments: TemplateAssignment[],
): GeneratedNota[] {
  void templateAssignments;
  const stages: StageCode[] = ["TAHAP_I", "TAHAP_II", "TAHAP_III", "TAHAP_IV"];
  const receipts = [
    ...stages.flatMap((stageCode) => buildKwitansiReceiptsForStage(project, vendors, stageCode)),
    ...buildOutsideCoreKwitansiReceipts(project, vendors),
  ];
  const regularDocs = receipts
    .map((receipt) => makeKwitansiDoc(project, receipt));
  return regularDocs
    .sort((a, b) => {
      const rankA = documentSortRank(a);
      const rankB = documentSortRank(b);
      if (rankA !== rankB) return rankA - rankB;
      if (a.stageCode === "RESUME_ALL" && b.stageCode === "RESUME_ALL") {
        const orderA = a.items[0] ? outsideCoreKwitansiOrder(a.items[0]) : 99;
        const orderB = b.items[0] ? outsideCoreKwitansiOrder(b.items[0]) : 99;
        if (orderA !== orderB) return orderA - orderB;
      }
      if (a.stageCode === "TAHAP_IV" && b.stageCode === "TAHAP_IV") {
        const orderA = stageFourKwitansiOrder(a);
        const orderB = stageFourKwitansiOrder(b);
        if (orderA !== orderB) return orderA - orderB;
      }
      const sourceOrderA = a.items[0]?.sortOrder ?? 0;
      const sourceOrderB = b.items[0]?.sortOrder ?? 0;
      if (sourceOrderA !== sourceOrderB) return sourceOrderA - sourceOrderB;
      return a.id.localeCompare(b.id);
    });
}

export function getKwitansiExpectedCount(
  project: Project,
  vendors: Vendor[],
  stageCode: StageCode,
  templateAssignments: TemplateAssignment[] = [],
) {
  return generateKwitansiDocuments(project, vendors, templateAssignments)
    .filter((doc) => doc.stageCode === stageCode && !doc.isSpecialKwitansi)
    .length;
}

export function getKwitansiGenerationDiagnostics(
  project: Project,
  vendors: Vendor[],
  templateAssignments: TemplateAssignment[] = [],
): KwitansiGenerationDiagnostics {
  const docs = generateKwitansiDocuments(project, vendors, templateAssignments);
  const regularDocs = docs;
  const issues: KwitansiGenerationIssue[] = [];
  const stageCodes: StageCode[] = ["TAHAP_I", "TAHAP_II", "TAHAP_III", "TAHAP_IV", "RESUME_ALL"];
  const stages = stageCodes.map((stageCode) => {
    const generatedCount = regularDocs.filter((doc) => doc.stageCode === stageCode).length;
    const expected = generatedCount || KWITANSI_TARGET_COUNTS[stageCode] || 0;
    const actual = regularDocs.filter((doc) => doc.stageCode === stageCode).length;
    const missingCount = Math.max(0, expected - actual);
    const excessCount = Math.max(0, actual - expected);
    if (actual !== expected) {
      issues.push({
        code: "target-count-mismatch",
        stageCode,
        message: `Jumlah kwitansi reguler ${stageCode} ${actual}/${expected}. ${missingCount > 0 ? `${missingCount} kwitansi belum dapat dibuat.` : `${excessCount} kwitansi melebihi target.`}`,
      });
    }
    return { stageCode, expected, actual, missingCount, excessCount };
  });

  const includedItems = project.items.filter((item) => item.isIncludedInResumeTotal !== false);
  const receiptSourceItems = includedItems.filter((item) => {
    const vendor = vendors.find((entry) => entry.id === item.vendorId);
    return isKwitansiItem(item, vendor);
  });
  for (const item of receiptSourceItems) {
    if (!item.itemName.trim()) {
      issues.push({ code: "missing-description", stageCode: item.stageCode, itemId: item.id, itemName: item.itemName, message: "Uraian sumber kwitansi masih kosong." });
    }
    if (!item.expenseDate) {
      issues.push({ code: "missing-date", stageCode: item.stageCode, itemId: item.id, itemName: item.itemName, message: `Tanggal belum diisi untuk ${item.itemName || item.id}.` });
    }
    if (getResumeItemAmount(item) <= 0) {
      issues.push({ code: "invalid-amount", stageCode: item.stageCode, itemId: item.id, itemName: item.itemName, message: `Nominal belum valid untuk ${item.itemName || item.id}.` });
    }
  }

  return {
    stages,
    specialPln: {
      expected: 0,
      actual: 0,
      missingCount: 0,
    },
    issues,
  };
}
