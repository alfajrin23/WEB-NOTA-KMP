import { findTemplateDefinition, resolveExplicitTemplateAssignment } from "@/constants/template-mapping";
import { STAGES } from "@/constants/stages";
import { GeneratedNota, Project, ProjectMeta, ResumeItem, StageCode, TemplateAssignment, Vendor } from "@/types/domain";
import { terbilangRupiah } from "@/utils/format";
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
  TAHAP_IV: 18,
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
  if (stageCode === "TAHAP_I") return "kwitansi-tahap-1";
  if (stageCode === "TAHAP_II") return "kwitansi-tahap-2";
  if (stageCode === "TAHAP_III") return "kwitansi-tahap-3";
  return "kwitansi-tahap-4";
}

function kwitansiTemplateName(stageCode: StageCode) {
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

function makeKwitansiDoc(project: Project, input: KwitansiReceiptInput): GeneratedNota {
  const sortedItems = [...input.items].sort((a, b) => a.sortOrder - b.sortOrder);
  const total = sortedItems.reduce((sum, item) => sum + getResumeItemAmount(item), 0);
  const tanggal = firstDate(sortedItems, project.projectDate);

  return {
    id: `kwitansi-${project.id}-${input.stageCode.toLowerCase()}-${input.key}`,
    projectId: project.id,
    stageId: input.stageCode,
    stageCode: input.stageCode,
    stageName: `Kwitansi Tahap ${stageRoman(input.stageCode)}`,
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
}

function buildKwitansiReceiptsForStage(project: Project, vendors: Vendor[], stageCode: StageCode): KwitansiReceiptInput[] {
  const kwitansiVendor = fallbackKwitansiVendor(vendors);
  const ppmVendor = ppmKwitansiVendor(vendors);
  const stageItems = project.items.filter((item) => item.stageCode === stageCode && item.isIncludedInResumeTotal !== false);
  const outsideItems = stageCode === "TAHAP_IV"
    ? project.items.filter((item) => item.stageCode === "RESUME_ALL" && isKwitansiVendorItem(item) && item.isIncludedInResumeTotal !== false)
    : [];
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

  const lemburItems = stageCode !== "TAHAP_IV"
    ? stageItems.filter((item) => isKwitansiVendorItem(item) && isLemburItem(item))
    : [];
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
    .filter((item) => !(stageCode !== "TAHAP_IV" && isKwitansiVendorItem(item) && isLemburItem(item)));

  for (const item of regularItems) {
    if (stageCode !== "TAHAP_IV" && shouldSplitFourWorkers(item)) {
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

  for (const item of outsideItems) {
    receipts.push({
      key: `luar-inti-${item.id}`,
      stageCode,
      vendor: kwitansiVendor,
      items: [item],
      sourceItemIds: [item.id],
      categoryNames: [item.category],
    });
  }

  return receipts;
}

function makeSpecialPlnNotaDoc({
  project,
  vendor,
  sourceItem,
  printOrder,
  paymentDescription,
  amount,
}: {
  project: Project;
  vendor: Vendor;
  sourceItem: ResumeItem;
  printOrder: 1 | 2;
  paymentDescription: string;
  amount: number;
}): GeneratedNota {
  const kwitansiItem: ResumeItem = {
    ...sourceItem,
    stageCode: "TAHAP_IV",
    stageName: "Tahap IV - Kwitansi Pembayaran PLN",
    itemName: paymentDescription,
    amountOverride: amount,
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
    terbilang: terbilangRupiah(amount),
    kwitansiPayerName: `KDKMP DESA ${project.villageName.toUpperCase()}`,
    kwitansiPaymentDescription: paymentDescription,
    kwitansiAmount: amount,
    kwitansiAmountWords: terbilangRupiah(amount),
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
      amount: 7_200_000,
    }));
  }

  if (powerUpgrade) {
    docs.push(makeSpecialPlnNotaDoc({
      project,
      vendor,
      sourceItem: powerUpgrade,
      printOrder: 2,
      paymentDescription: "Tambah Daya 5500 VA ke 16.500 VA Dan Pemasangan Panel Listrik 3 Phase",
      amount: 15_500_000,
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
  const regularDocs = stages
    .flatMap((stageCode) => buildKwitansiReceiptsForStage(project, vendors, stageCode))
    .map((receipt) => makeKwitansiDoc(project, receipt));
  return regularDocs
    .sort((a, b) => {
      const rankA = documentSortRank(a);
      const rankB = documentSortRank(b);
      if (rankA !== rankB) return rankA - rankB;
      return a.id.localeCompare(b.id);
    });
}

export function getKwitansiGenerationDiagnostics(
  project: Project,
  vendors: Vendor[],
  templateAssignments: TemplateAssignment[] = [],
): KwitansiGenerationDiagnostics {
  const docs = generateKwitansiDocuments(project, vendors, templateAssignments);
  const regularDocs = docs;
  const issues: KwitansiGenerationIssue[] = [];
  const stageCodes: StageCode[] = ["TAHAP_I", "TAHAP_II", "TAHAP_III", "TAHAP_IV"];
  const stages = stageCodes.map((stageCode) => {
    const expected = KWITANSI_TARGET_COUNTS[stageCode] ?? 0;
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
