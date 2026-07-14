import type { GeneratedNota } from "@/types/domain";

export const DEFAULT_PLN_PRINT_GROUP_KEY = "pln-electricity";

export function isSpecialPLNKwitansi(doc: GeneratedNota) {
  return doc.isSpecialKwitansi === true
    && (doc.vendorId === "vendor-pln" || doc.templateId === "template-pln");
}

export function getPLNPrintGroupKey(doc: GeneratedNota) {
  return doc.printGroupKey?.trim() || DEFAULT_PLN_PRINT_GROUP_KEY;
}

function getPLNPresentationKey(doc: GeneratedNota) {
  return `pln:${doc.projectId}:${getPLNPrintGroupKey(doc)}`;
}

export type DocumentPresentationEntry = {
  key: string;
  primaryDoc: GeneratedNota;
  docs: GeneratedNota[];
  itemCount: number;
  totalAmount: number;
};

/**
 * Menggabungkan record internal PLN yang masing-masing menyimpan edit satu slip
 * menjadi satu entri dokumen di daftar UI. Record asli sengaja tetap terpisah
 * agar edit per slip dan persistensi lama tidak berubah.
 */
export function groupDocumentsForPresentation(source: GeneratedNota[]): DocumentPresentationEntry[] {
  const grouped: Array<{ key: string; docs: GeneratedNota[] }> = [];
  const plnGroupIndexes = new Map<string, number>();

  for (const doc of source) {
    if (!isSpecialPLNKwitansi(doc)) {
      grouped.push({ key: `document:${doc.id}`, docs: [doc] });
      continue;
    }

    const key = getPLNPresentationKey(doc);
    const existingIndex = plnGroupIndexes.get(key);
    if (existingIndex === undefined) {
      plnGroupIndexes.set(key, grouped.length);
      grouped.push({ key, docs: [doc] });
    } else {
      grouped[existingIndex].docs.push(doc);
    }
  }

  return grouped.map((group) => {
    const docs = group.docs
      .map((doc, sourceIndex) => ({ doc, sourceIndex }))
      .sort((left, right) => (left.doc.printOrder ?? left.sourceIndex) - (right.doc.printOrder ?? right.sourceIndex))
      .map(({ doc }) => doc);

    return {
      key: group.key,
      primaryDoc: docs[0],
      docs,
      itemCount: docs.reduce((sum, doc) => sum + doc.items.length, 0),
      totalAmount: docs.reduce((sum, doc) => sum + doc.totalAmount, 0),
    };
  });
}

export function getPLNDocumentGroup(source: GeneratedNota[], selected: GeneratedNota) {
  if (!isSpecialPLNKwitansi(selected)) return [selected];

  const selectedKey = getPLNPresentationKey(selected);
  return source
    .filter((doc) => isSpecialPLNKwitansi(doc) && getPLNPresentationKey(doc) === selectedKey)
    .map((doc, sourceIndex) => ({ doc, sourceIndex }))
    .sort((left, right) => (left.doc.printOrder ?? left.sourceIndex) - (right.doc.printOrder ?? right.sourceIndex))
    .map(({ doc }) => doc);
}
