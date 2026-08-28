import type { GeneratedNota } from "@/types/domain";

export type VendorNotaPage<T> = {
  vendorKey: string;
  notas: T[];
};

const TWO_UP_TEMPLATE_IDS = new Set([
  "template-amanah",
  "template-cbs",
  "template-jasa-electric",
  "template-murah-maju",
  "template-nota-internal-non-vendor",
  "template-nota-kosong",
  "template-tb-mandau",
]);

export function isTwoUpVendorNota(doc: Pick<GeneratedNota, "documentType" | "templateId" | "items">) {
  return doc.documentType === "nota" && doc.items.length > 0 && TWO_UP_TEMPLATE_IDS.has(doc.templateId);
}

export function getTwoUpVendorBatchKey(
  doc: Pick<GeneratedNota, "documentType" | "items" | "projectId" | "stageCode" | "templateId" | "vendorId">,
) {
  if (!isTwoUpVendorNota(doc)) return null;
  return `${doc.projectId}|${doc.stageCode}|${doc.vendorId}|${doc.templateId}`;
}

export function getTwoUpVendorDocumentGroup<T extends Pick<GeneratedNota, "documentType" | "items" | "projectId" | "stageCode" | "templateId" | "vendorId">>(
  docs: readonly T[],
  selected: T,
) {
  const batchKey = getTwoUpVendorBatchKey(selected);
  if (!batchKey) return [selected];
  return docs.filter((doc) => getTwoUpVendorBatchKey(doc) === batchKey);
}

function assertPageSize(pageSize: number) {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error("Jumlah nota per halaman harus berupa bilangan bulat lebih dari 0.");
  }
}

/**
 * Group before pagination so a partially filled page is never completed with a
 * note from another vendor. Array#slice deliberately leaves the final page
 * short; no placeholder/generated note is ever appended.
 */
export function paginateNotasByVendor<T>(
  notas: readonly T[],
  vendorKeyForNota: (nota: T) => string,
  pageSize = 2,
): VendorNotaPage<T>[] {
  assertPageSize(pageSize);

  const vendorGroups = new Map<string, T[]>();
  for (const nota of notas) {
    const vendorKey = vendorKeyForNota(nota);
    const current = vendorGroups.get(vendorKey);
    if (current) current.push(nota);
    else vendorGroups.set(vendorKey, [nota]);
  }

  return [...vendorGroups.entries()].flatMap(([vendorKey, vendorNotas]) => {
    const pages: VendorNotaPage<T>[] = [];
    for (let index = 0; index < vendorNotas.length; index += pageSize) {
      pages.push({ vendorKey, notas: vendorNotas.slice(index, index + pageSize) });
    }
    return pages;
  });
}
