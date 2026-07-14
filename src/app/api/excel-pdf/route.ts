import { NextRequest } from "next/server";
import { pdfErrorResponse, pdfResponse, renderTemplateRequest } from "@/server/excel-pdf/render-document";
import { ExcelTemplateRequest } from "@/server/excel-pdf/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as ExcelTemplateRequest;
    const rendered = await renderTemplateRequest(payload);
    return pdfResponse(rendered, "inline");
  } catch (error) {
    return pdfErrorResponse(error);
  }
}
