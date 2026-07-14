import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { vendors } from "@/constants/seed-data";
import { parseResumeText } from "@/lib/resume-import/parser";

export const runtime = "nodejs";

async function extractPdfText(buffer: Buffer) {
  const { PDFParse } = await import("pdf-parse");
  const workerPath = path.join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs");
  PDFParse.setWorker(pathToFileURL(workerPath).toString());
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "File resume tidak ditemukan." }, { status: 400 });
    }

    const fileName = file.name || "resume-upload";
    const lowerName = fileName.toLowerCase();
    const buffer = Buffer.from(await file.arrayBuffer());
    let text = "";

    if (file.type === "application/pdf" || lowerName.endsWith(".pdf")) {
      text = await extractPdfText(buffer);
    } else if (file.type.startsWith("text/") || lowerName.endsWith(".txt")) {
      text = buffer.toString("utf8");
    } else {
      return NextResponse.json(
        { error: "Format belum didukung. Untuk saat ini upload PDF resume atau hasil export teks." },
        { status: 400 },
      );
    }

    const parsed = parseResumeText(text, { sourceFile: fileName, vendors });
    return NextResponse.json(parsed);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Gagal parsing resume." },
      { status: 500 },
    );
  }
}
