import { PDFDocument } from "pdf-lib";
import { CBS_DOCUMENT_LAYOUT } from "@/constants/document-layout";

const POINTS_PER_MM = 72 / 25.4;

/**
 * Menormalkan keluaran Office ke A4 portrait tanpa meraster isi nota CBS.
 * Beberapa printer driver Excel tetap menghasilkan MediaBox Letter walaupun
 * worksheet sudah A4; embed ulang menjaga vektor/teks dan ukuran cetak stabil.
 */
export async function imposeCbsPdf(source: Buffer, activeNotes: number) {
  const sourcePdf = await PDFDocument.load(source);
  const expectedPages = Math.ceil(activeNotes / CBS_DOCUMENT_LAYOUT.notesPerPage);
  if (sourcePdf.getPageCount() < expectedPages) {
    throw new Error(
      `Export CBS menghasilkan ${sourcePdf.getPageCount()} halaman; seharusnya minimal ${expectedPages} halaman untuk ${activeNotes} nota.`,
    );
  }

  const result = await PDFDocument.create();
  // Excel kadang menambahkan satu halaman kosong akibat drawing/logo yang
  // sedikit melewati print area. Halaman data selalu berada di depan dan
  // jumlahnya ditentukan langsung dari jumlah nota aktif.
  const dataPageIndices = Array.from({ length: expectedPages }, (_, index) => index);
  const embeddedPages = await result.embedPdf(sourcePdf, dataPageIndices);
  const pageWidth = CBS_DOCUMENT_LAYOUT.pageWidthMm * POINTS_PER_MM;
  const pageHeight = CBS_DOCUMENT_LAYOUT.pageHeightMm * POINTS_PER_MM;

  for (const embedded of embeddedPages) {
    const scale = Math.min(pageWidth / embedded.width, pageHeight / embedded.height);
    const width = embedded.width * scale;
    const height = embedded.height * scale;
    const page = result.addPage([pageWidth, pageHeight]);
    page.drawPage(embedded, {
      x: (pageWidth - width) / 2,
      y: (pageHeight - height) / 2,
      width,
      height,
    });
  }

  return Buffer.from(await result.save());
}
