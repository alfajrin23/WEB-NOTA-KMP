import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PageSizes, StandardFonts, rgb } from "pdf-lib";
import { getResumeItemAmount } from "@/lib/resume-calculations";
import { formatDateIndonesia, formatProjectKdkmpWilayah, formatProjectWilayah, terbilangRupiah } from "@/utils/format";
import { ExcelTemplateRequest, RenderedExcelPdf } from "./types";

const A4 = PageSizes.A4;
const PAGE_MARGIN = 18;
const SLOT_GAP = 6;
const SLOT_COUNT = 4;

function safeFileName(value: string) {
  return value.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function formatDateRange(dateValue: string) {
  return formatDateIndonesia(dateValue);
}

function chunk<T>(items: T[], size: number) {
  const pages: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    pages.push(items.slice(index, index + size));
  }
  return pages;
}

async function embedTemplateImage(pdf: PDFDocument, imagePath: string) {
  const imageBytes = await readFile(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  if (ext === ".png") return pdf.embedPng(imageBytes);
  if (ext === ".jpg" || ext === ".jpeg") return pdf.embedJpg(imageBytes);
  throw new Error("Template gambar kwitansi harus berformat .png, .jpg, atau .jpeg.");
}

export async function renderKwitansiImageToPdf(request: ExcelTemplateRequest): Promise<RenderedExcelPdf> {
  const imagePath = process.env.KDKMP_KWITANSI_TEMPLATE_IMAGE?.trim();
  if (!imagePath) {
    throw new Error("Set KDKMP_KWITANSI_TEMPLATE_IMAGE ke file gambar template 1 kwitansi.");
  }

  if (!existsSync(imagePath)) {
    throw new Error(`Template gambar kwitansi tidak ditemukan: ${imagePath}`);
  }

  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const templateImage = await embedTemplateImage(pdf, imagePath);

  const pageWidth = A4[0];
  const pageHeight = A4[1];
  const slotWidth = pageWidth - PAGE_MARGIN * 2;
  const slotHeight = (pageHeight - PAGE_MARGIN * 2 - SLOT_GAP * (SLOT_COUNT - 1)) / SLOT_COUNT;
  const sortedItems = [...request.items].sort((a, b) => a.sortOrder - b.sortOrder);
  const pages = chunk(sortedItems, SLOT_COUNT);

  for (const pageItems of pages.length > 0 ? pages : [[]]) {
    const page = pdf.addPage(A4);

    for (let index = 0; index < SLOT_COUNT; index += 1) {
      const item = pageItems[index];
      const x = PAGE_MARGIN;
      const y = pageHeight - PAGE_MARGIN - slotHeight - index * (slotHeight + SLOT_GAP);

      page.drawImage(templateImage, { x, y, width: slotWidth, height: slotHeight });

      if (!item) continue;

      const amount = getResumeItemAmount(item);
      const top = y + slotHeight;
      const left = x;
      const color = rgb(0, 0, 0);

      page.drawText(formatProjectKdkmpWilayah(request.project), {
        x: left + slotWidth * 0.44,
        y: top - slotHeight * 0.2,
        size: 12,
        font: regular,
        color,
      });
      page.drawText(terbilangRupiah(amount), {
        x: left + slotWidth * 0.44,
        y: top - slotHeight * 0.31,
        size: 11,
        font: italic,
        color,
      });
      page.drawText(`${item.itemName} Tanggal ${formatDateRange(item.expenseDate)}`, {
        x: left + slotWidth * 0.44,
        y: top - slotHeight * 0.43,
        size: 10,
        font: regular,
        color,
      });
      page.drawText(`${request.project.projectName} ${formatProjectWilayah(request.project, "short")} ${item.stageName}`, {
        x: left + slotWidth * 0.44,
        y: top - slotHeight * 0.53,
        size: 9,
        font: regular,
        color,
      });
      page.drawText(`Rp. ${new Intl.NumberFormat("id-ID").format(amount)},-`, {
        x: left + slotWidth * 0.1,
        y: y + slotHeight * 0.13,
        size: 13,
        font: bold,
        color,
      });
    }
  }

  return {
    fileName: `${safeFileName(`Kwitansi-${request.items[0]?.stageName ?? request.project.villageName}`)}.pdf`,
    pdf: Buffer.from(await pdf.save()),
  };
}
