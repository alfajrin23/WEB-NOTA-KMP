import { PageSizes, PDFDocument, PDFPage } from "pdf-lib";

const NOTES_PER_PAGE = 2;
const PAGE_MARGIN = 14;
const SLOT_GAP = 10;

type SourceCrop = {
  page: PDFPage;
  left: number;
  bottom: number;
  right: number;
  top: number;
};

/**
 * Excel/LibreOffice mengabaikan page break manual pada template Cahaya Timur
 * dan dapat memadatkan seluruh blok nota ke satu lembar Letter. Pecah kembali
 * blok vertikal itu, lalu tempatkan maksimal dua nota pada A4 portrait.
 */
function buildSourceCrops(source: PDFDocument, noteCount: number): SourceCrop[] {
  const pages = source.getPages();
  if (pages.length === 0 || noteCount <= 0) return [];

  // Output Office yang dipakai aplikasi saat ini selalu menyimpan semua blok
  // aktif di halaman pertama. Satu nota tetap hanya menggunakan separuh atas.
  if (pages.length === 1) {
    const page = pages[0];
    const { width, height } = page.getSize();

    // Tinggi row ketiga di workbook sumber sedikit berbeda dari dua blok
    // sebelumnya. Batas ini mengikuti sela putih antarnota yang nyata, bukan
    // membagi halaman secara matematis; hasilnya header nota berikut tidak
    // bocor ke slot sebelumnya dan tidak terpotong di halaman terakhir.
    const topRatios = noteCount === 1
      ? [0, 0.55]
      : noteCount === 2
        ? [0, 0.486, 1]
        : noteCount === 3
          ? [0, 0.332, 0.657, 1]
          : Array.from({ length: noteCount + 1 }, (_, index) => index / noteCount);

    // Makin banyak blok yang dipadatkan Office, makin besar whitespace kiri
    // dan kanan. Crop rasio ini mengembalikan proporsi nota sebelum diimposisi.
    const horizontalInsetRatio = noteCount === 1 ? 0.06 : noteCount === 2 ? 0.1 : 0.22;
    const left = width * horizontalInsetRatio;
    const right = width * (1 - horizontalInsetRatio);

    return Array.from({ length: noteCount }, (_, index) => ({
      page,
      left,
      right,
      bottom: height * (1 - topRatios[index + 1]),
      top: height * (1 - topRatios[index]),
    }));
  }

  // Fallback untuk converter Office yang sudah menaati page break: setiap
  // halaman berisi maksimal dua blok, dengan blok pertama berada di atas.
  const crops: SourceCrop[] = [];
  for (const page of pages) {
    const remaining = noteCount - crops.length;
    if (remaining <= 0) break;

    const notesOnPage = Math.min(NOTES_PER_PAGE, remaining);
    const { width, height } = page.getSize();
    const sectionHeight = height / NOTES_PER_PAGE;
    const insetRatio = notesOnPage === 1 ? 0.06 : 0.1;

    for (let index = 0; index < notesOnPage; index += 1) {
      crops.push({
        page,
        left: width * insetRatio,
        right: width * (1 - insetRatio),
        bottom: height - (index + 1) * sectionHeight,
        top: height - index * sectionHeight,
      });
    }
  }

  return crops;
}

export async function imposeCahayaTimurPdf(pdf: Buffer, noteCount: number): Promise<Buffer> {
  if (noteCount <= 0) return pdf;

  const source = await PDFDocument.load(pdf);
  const crops = buildSourceCrops(source, noteCount);
  if (crops.length === 0) return pdf;

  const output = await PDFDocument.create();
  const [pageWidth, pageHeight] = PageSizes.A4;
  const slotHeight = (pageHeight - PAGE_MARGIN * 2 - SLOT_GAP) / NOTES_PER_PAGE;
  const slotWidth = pageWidth - PAGE_MARGIN * 2;

  for (let noteIndex = 0; noteIndex < crops.length; noteIndex += 1) {
    const slotIndex = noteIndex % NOTES_PER_PAGE;
    const page = slotIndex === 0 ? output.addPage(PageSizes.A4) : output.getPages().at(-1)!;
    const crop = crops[noteIndex];
    const embedded = await output.embedPage(crop.page, {
      left: crop.left,
      bottom: crop.bottom,
      right: crop.right,
      top: crop.top,
    });

    const sourceWidth = crop.right - crop.left;
    const sourceHeight = crop.top - crop.bottom;
    const scale = Math.min(slotWidth / sourceWidth, slotHeight / sourceHeight);
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    const slotBottom = slotIndex === 0
      ? PAGE_MARGIN + slotHeight + SLOT_GAP
      : PAGE_MARGIN;

    page.drawPage(embedded, {
      x: (pageWidth - width) / 2,
      y: slotBottom + (slotHeight - height) / 2,
      width,
      height,
    });
  }

  return Buffer.from(await output.save());
}
