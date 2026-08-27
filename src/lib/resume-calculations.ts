import { STAGES } from "@/constants/stages";
import { resolveExplicitTemplateAssignment } from "@/constants/template-mapping";
import { GeneratedNota, Project, ResumeItem, StageCode, TemplateAssignment, Vendor } from "@/types/domain";
import { getAmount } from "@/utils/format";

export type StageSummary = {
  stageCode: StageCode;
  label: string;
  total: number;
  itemCount: number;
  vendorCount: number;
};

export type CategorySummary = {
  stageCode: StageCode;
  category: string;
  total: number;
  itemCount: number;
};

export type VendorSummary = {
  stageCode: StageCode;
  vendorId: string;
  vendorName: string;
  total: number;
  itemCount: number;
  notaCount: number;
};

export type ProjectSummary = {
  stages: StageSummary[];
  categories: CategorySummary[];
  vendors: VendorSummary[];
  grandTotal: number;
  coreTotal: number;
  outsideCoreTotal: number;
};

export type ResumeValidationCategoryRow = {
  stageCode: StageCode;
  categoryCode: string;
  category: string;
  total: number;
  itemCount: number;
};

export type ResumeValidationStageRow = {
  stageCode: StageCode;
  label: string;
  total: number;
  itemCount: number;
};

export type ResumeValidationReport = {
  resumeTotal: number;
  generatedTotal: number;
  ungeneratedTotal: number;
  stageRows: ResumeValidationStageRow[];
  categoryRows: ResumeValidationCategoryRow[];
  itemCount: number;
  missingVendorItems: ResumeItem[];
  dashVendorItems: ResumeItem[];
  kwitansiItems: ResumeItem[];
  missingTemplateItems: ResumeItem[];
  notGeneratedItems: ResumeItem[];
  zeroAmountItems: ResumeItem[];
  manualMismatchItems: ResumeItem[];
  hasWarnings: boolean;
};

function isPpmResumeItem(item: ResumeItem, vendors: Vendor[]) {
  const vendor = vendors.find((entry) => entry.id === item.vendorId);
  const raw = `${item.vendorName ?? ""} ${vendor?.name ?? ""} ${(vendor?.aliases ?? []).join(" ")}`.toLowerCase();
  return item.vendorId === "vendor-ppm" || raw.includes("ppm") || raw.includes("pratama project mandiri");
}

function isStageThreePartisiKwitansiItem(item: ResumeItem) {
  if (item.stageCode !== "TAHAP_III" || item.categoryCode !== "D") return false;
  const name = item.itemName.trim().toLowerCase();
  return name === "pek. pintu besi" || name === "pek. dinding partisi kaca" || name === "pek. pintu kaca frameless";
}

function isKwitansiResumeItem(item: ResumeItem, vendors: Vendor[]) {
  const vendor = vendors.find((entry) => entry.id === item.vendorId);
  return item.vendorId === "vendor-kwitansi" || vendor?.type === "labor" || isPpmResumeItem(item, vendors) || isStageThreePartisiKwitansiItem(item);
}

export type ResumeValidationIssue = {
  id: string;
  severity: "error" | "warning";
  field?: keyof ResumeItem | "template" | "total";
  itemId?: string;
  stageCode?: StageCode;
  vendorId?: string;
  message: string;
};

export function getResumeItemAmount(item: Pick<ResumeItem, "volume" | "unitPrice" | "amountOverride">) {
  if (typeof item.amountOverride === "number" && Number.isFinite(item.amountOverride)) {
    return Math.round(item.amountOverride);
  }
  return getAmount(item.volume, item.unitPrice);
}

export function getComputedAmount(item: Pick<ResumeItem, "volume" | "unitPrice">) {
  return getAmount(item.volume, item.unitPrice);
}

export function buildProjectSummary(project: Project, vendors: Vendor[]): ProjectSummary {
  const stageRows = new Map<StageCode, StageSummary>();
  const categoryRows = new Map<string, CategorySummary>();
  const vendorRows = new Map<string, VendorSummary>();

  for (const stage of STAGES) {
    stageRows.set(stage.code, {
      stageCode: stage.code,
      label: stage.label,
      total: 0,
      itemCount: 0,
      vendorCount: 0,
    });
  }

  const stageVendors = new Map<StageCode, Set<string>>();

  for (const item of project.items.filter((entry) => entry.isIncludedInResumeTotal !== false)) {
    const amount = getResumeItemAmount(item);
    const stage = stageRows.get(item.stageCode);
    if (stage) {
      stage.total += amount;
      stage.itemCount += 1;
    }

    const categoryKey = `${item.stageCode}-${item.category}`;
    const category = categoryRows.get(categoryKey) ?? {
      stageCode: item.stageCode,
      category: item.category || "Tanpa kategori",
      total: 0,
      itemCount: 0,
    };
    category.total += amount;
    category.itemCount += 1;
    categoryRows.set(categoryKey, category);

    if (item.vendorId) {
      const vendor = vendors.find((entry) => entry.id === item.vendorId);
      const set = stageVendors.get(item.stageCode) ?? new Set<string>();
      set.add(item.vendorId);
      stageVendors.set(item.stageCode, set);

      const vendorKey = `${item.stageCode}-${item.vendorId}`;
      const row = vendorRows.get(vendorKey) ?? {
        stageCode: item.stageCode,
        vendorId: item.vendorId,
        vendorName: vendor?.name ?? item.vendorId,
        total: 0,
        itemCount: 0,
        notaCount: 1,
      };
      row.total += amount;
      row.itemCount += 1;
      vendorRows.set(vendorKey, row);
    }
  }

  for (const [stageCode, vendorSet] of stageVendors.entries()) {
    const stage = stageRows.get(stageCode);
    if (stage) stage.vendorCount = vendorSet.size;
  }

  const stages = [...stageRows.values()];
  const grandTotal = stages.reduce((sum, stage) => sum + stage.total, 0);
  const outsideCoreTotal = [...stageRows.values()]
    .filter((stage) => stage.stageCode === "TAHAP_VI" || stage.stageCode === "TAHAP_VII" || stage.stageCode === "RESUME_ALL")
    .reduce((sum, stage) => sum + stage.total, 0);

  return {
    stages,
    categories: [...categoryRows.values()],
    vendors: [...vendorRows.values()],
    grandTotal,
    coreTotal: grandTotal - outsideCoreTotal,
    outsideCoreTotal,
  };
}

export function validateProjectResume(
  project: Project,
  vendors: Vendor[],
  templateAssignments: TemplateAssignment[],
): ResumeValidationIssue[] {
  const issues: ResumeValidationIssue[] = [];
  const vendorIds = new Set(vendors.map((vendor) => vendor.id));

  for (const item of project.items) {
    const prefix = `${item.sortOrder || item.id}`;
    const volume = Number(item.volume);
    const unitPrice = Number(item.unitPrice);
    const computedAmount = getComputedAmount(item);

    if (!item.expenseDate) {
      issues.push({
        id: `${item.id}-date`,
        severity: "warning",
        field: "expenseDate",
        itemId: item.id,
        stageCode: item.stageCode,
        message: `Baris ${prefix}: tanggal belanja kosong.`,
      });
    }

    if (!item.itemName?.trim()) {
      issues.push({
        id: `${item.id}-name`,
        severity: "warning",
        field: "itemName",
        itemId: item.id,
        stageCode: item.stageCode,
        message: `Baris ${prefix}: uraian barang/jasa kosong.`,
      });
    }

    const hasManualAmount = typeof item.amountOverride === "number" && Number.isFinite(item.amountOverride);

    if ((!Number.isFinite(volume) || volume <= 0) && !hasManualAmount) {
      issues.push({
        id: `${item.id}-volume`,
        severity: "error",
        field: "volume",
        itemId: item.id,
        stageCode: item.stageCode,
        message: `Baris ${prefix}: qty/volume kosong dan tidak ada jumlah manual.`,
      });
    }

    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      issues.push({
        id: `${item.id}-unit-price`,
        severity: "error",
        field: "unitPrice",
        itemId: item.id,
        stageCode: item.stageCode,
        message: `Baris ${prefix}: harga satuan harus angka valid.`,
      });
    }

    if (!item.unit?.trim() && !hasManualAmount) {
      issues.push({
        id: `${item.id}-unit`,
        severity: "warning",
        field: "unit",
        itemId: item.id,
        stageCode: item.stageCode,
        message: `Baris ${prefix}: satuan kosong.`,
      });
    }

    const rawVendorName = (item.vendorName ?? "").trim();
    const usesInternalNonVendor = !item.vendorId && (rawVendorName === "" || rawVendorName === "-" || rawVendorName.toLowerCase() === "null");

    if ((!item.vendorId || !vendorIds.has(item.vendorId)) && !usesInternalNonVendor) {
      issues.push({
        id: `${item.id}-vendor`,
        severity: "warning",
        field: "vendorId",
        itemId: item.id,
        stageCode: item.stageCode,
        vendorId: item.vendorId,
        message: `Baris ${prefix}: vendor kosong, "-", atau tidak terdaftar.`,
      });
    } else if (!usesInternalNonVendor) {
      const vendor = vendors.find((entry) => entry.id === item.vendorId);
      if (vendor?.type !== "internal" && !resolveExplicitTemplateAssignment(item.stageCode, item.vendorId, templateAssignments)) {
        issues.push({
          id: `${item.id}-template`,
          severity: "warning",
          field: "template",
          itemId: item.id,
          stageCode: item.stageCode,
          vendorId: item.vendorId,
          message: `Baris ${prefix}: vendor ${vendor?.name ?? item.vendorId} belum punya template untuk tahap ini.`,
        });
      }
    }

    if (
      typeof item.amountOverride === "number" &&
      Number.isFinite(item.amountOverride) &&
      item.amountOverride !== computedAmount
    ) {
      issues.push({
        id: `${item.id}-override`,
        severity: "warning",
        field: "amountOverride",
        itemId: item.id,
        stageCode: item.stageCode,
        message: `Baris ${prefix}: jumlah manual berbeda dari qty x harga satuan.`,
      });
    }
  }

  return issues;
}

export function buildResumeValidationReport(
  project: Project,
  generatedNotas: GeneratedNota[] = [],
  vendors: Vendor[] = [],
  templateAssignments: TemplateAssignment[] = [],
): ResumeValidationReport {
  const includedItems = project.items.filter((item) => item.isIncludedInResumeTotal !== false);
  const projectGeneratedNotas = generatedNotas.filter((doc) => doc.projectId === project.id && doc.documentType === "nota");
  const generatedItemIds = new Set(projectGeneratedNotas.flatMap((doc) => doc.itemIds.length > 0 ? doc.itemIds : doc.items.map((item) => item.id)));
  const generatedTotal = projectGeneratedNotas.reduce((sum, doc) => sum + doc.totalAmount, 0);

  const stageRows = STAGES.map((stage) => {
    const rows = includedItems.filter((item) => item.stageCode === stage.code);
    return {
      stageCode: stage.code,
      label: stage.label,
      total: rows.reduce((sum, item) => sum + getResumeItemAmount(item), 0),
      itemCount: rows.length,
    };
  });

  const categories = new Map<string, ResumeValidationCategoryRow>();
  for (const item of includedItems) {
    const categoryCode = item.categoryCode ?? item.category.match(/^([A-Z])\./)?.[1] ?? "-";
    const key = `${item.stageCode}:${categoryCode}`;
    const current = categories.get(key) ?? {
      stageCode: item.stageCode,
      categoryCode,
      category: item.category,
      total: 0,
      itemCount: 0,
    };
    current.total += getResumeItemAmount(item);
    current.itemCount += 1;
    categories.set(key, current);
  }

  const resumeTotal = stageRows.reduce((sum, stage) => sum + stage.total, 0);
  const missingVendorItems = includedItems.filter((item) => !item.vendorId && !["", "-", "nota kosong", "internal / non vendor"].includes((item.vendorName ?? "").trim().toLowerCase()));
  const dashVendorItems = includedItems.filter((item) => (item.vendorName ?? "").trim() === "-");
  const kwitansiItems = includedItems.filter((item) => isKwitansiResumeItem(item, vendors) || (item.vendorName ?? "").trim().toUpperCase() === "KWITANSI");
  const kwitansiItemIds = new Set(kwitansiItems.map((item) => item.id));
  const missingTemplateItems = includedItems.filter((item) => {
    if (!item.vendorId) return false;
    const vendor = vendors.find((entry) => entry.id === item.vendorId);
    if (!vendor || vendor.type === "internal") return false;
    return !resolveExplicitTemplateAssignment(item.stageCode, item.vendorId, templateAssignments);
  });
  const notGeneratedItems = includedItems.filter((item) => !kwitansiItemIds.has(item.id) && !generatedItemIds.has(item.id));
  const ungeneratedTotal = notGeneratedItems.reduce((sum, item) => sum + getResumeItemAmount(item), 0);
  const zeroAmountItems = includedItems.filter((item) => getResumeItemAmount(item) <= 0);
  const manualMismatchItems = includedItems.filter((item) => (
    typeof item.amountOverride === "number" &&
    Number.isFinite(item.amountOverride) &&
    (!Number(item.volume) || !Number(item.unitPrice) || item.amountOverride !== getComputedAmount(item))
  ));

  return {
    resumeTotal,
    generatedTotal,
    ungeneratedTotal,
    stageRows,
    categoryRows: [...categories.values()].sort((a, b) => {
      const stageA = STAGES.findIndex((stage) => stage.code === a.stageCode);
      const stageB = STAGES.findIndex((stage) => stage.code === b.stageCode);
      if (stageA !== stageB) return stageA - stageB;
      return a.categoryCode.localeCompare(b.categoryCode);
    }),
    itemCount: includedItems.length,
    missingVendorItems,
    dashVendorItems,
    kwitansiItems,
    missingTemplateItems,
    notGeneratedItems,
    zeroAmountItems,
    manualMismatchItems,
    hasWarnings: missingTemplateItems.length > 0 || notGeneratedItems.length > 0 || zeroAmountItems.length > 0 || manualMismatchItems.length > 0,
  };
}

export function hashNotaData(value: unknown) {
  const input = JSON.stringify(value);
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
