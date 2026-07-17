import { NextRequest } from "next/server";
import { STAGES } from "@/constants/stages";
import { buildResumeWorkbook, safeResumeExcelFileName } from "@/server/resume-excel/resume-workbook";
import { Project, ResumeItem, Vendor } from "@/types/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const STAGE_CODES = new Set(STAGES.map((stage) => stage.code));

type ResumeExcelRequest = {
  project: Project;
  vendors: Vendor[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasString(record: Record<string, unknown>, key: string) {
  return typeof record[key] === "string";
}

function isFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

function isResumeItem(value: unknown): value is ResumeItem {
  if (!isRecord(value)) return false;
  if (!hasString(value, "id") || !hasString(value, "stageCode") || !STAGE_CODES.has(value.stageCode as ResumeItem["stageCode"])) return false;
  if (!hasString(value, "stageName") || !hasString(value, "category") || !hasString(value, "expenseDate")) return false;
  if (!hasString(value, "itemName") || !hasString(value, "unit") || !hasString(value, "vendorId")) return false;
  if (!isFiniteNumber(value.volume) || !isFiniteNumber(value.unitPrice) || !isFiniteNumber(value.sortOrder)) return false;
  if (value.amountOverride != null && !isFiniteNumber(value.amountOverride)) return false;
  return true;
}

function isProject(value: unknown): value is Project {
  if (!isRecord(value) || !Array.isArray(value.items) || !value.items.every(isResumeItem)) return false;
  return [
    "id",
    "templateId",
    "projectName",
    "villageName",
    "districtName",
    "regencyName",
    "regionName",
    "projectDate",
    "responsibleName",
  ].every((key) => hasString(value, key));
}

function isVendor(value: unknown): value is Vendor {
  return isRecord(value) && hasString(value, "id") && hasString(value, "name") && hasString(value, "type");
}

function parseRequest(value: unknown): ResumeExcelRequest | null {
  if (!isRecord(value) || !isProject(value.project) || !Array.isArray(value.vendors) || !value.vendors.every(isVendor)) return null;
  return { project: value.project, vendors: value.vendors };
}

export async function POST(request: NextRequest) {
  try {
    const requestBody = await request.json().catch(() => null);
    const payload = parseRequest(requestBody);
    if (!payload) {
      return Response.json({ error: "Data project atau resume untuk Export Excel tidak valid." }, { status: 400 });
    }

    const workbook = await buildResumeWorkbook(payload.project, payload.vendors);
    const fileName = safeResumeExcelFileName(payload.project);
    return new Response(new Uint8Array(workbook), {
      headers: {
        "Content-Type": XLSX_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store, max-age=0",
        Pragma: "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal membuat file Excel resume.";
    return Response.json({ error: message }, { status: 500 });
  }
}
