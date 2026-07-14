import { renderExcelTemplateToPdf } from "./excel-template-engine";
import { renderKwitansiImageToPdf } from "./kwitansi-image-renderer";
import { ExcelTemplateRequest, RenderedExcelPdf } from "./types";

export async function renderTemplateRequest(request: ExcelTemplateRequest): Promise<RenderedExcelPdf> {
  return request.type === "kwitansi" ? renderKwitansiImageToPdf(request) : renderExcelTemplateToPdf(request);
}

export function pdfResponse(rendered: RenderedExcelPdf, disposition: "inline" | "attachment") {
  return new Response(new Uint8Array(rendered.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${rendered.fileName}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function pdfErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Gagal generate PDF dari template.";
  return Response.json({ error: message }, { status: 500 });
}
