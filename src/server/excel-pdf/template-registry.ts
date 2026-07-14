import { existsSync } from "node:fs";
import path from "node:path";
import {
  ALL_TEMPLATE_ASSIGNMENTS,
  STAGE_TEMPLATE_FOLDERS,
  TEMPLATE_ROOT_DEFAULT,
  findTemplateDefinition,
  resolveTemplateAssignment,
} from "@/constants/template-mapping";
import { ExcelTemplateRequest, TemplateMatch } from "./types";

function templateRoot() {
  return process.env.KDKMP_TEMPLATE_ROOT?.trim() || TEMPLATE_ROOT_DEFAULT;
}

function buildTemplatePath(stageCode: string, fileName: string) {
  const folder = STAGE_TEMPLATE_FOLDERS[stageCode as keyof typeof STAGE_TEMPLATE_FOLDERS];
  if (!folder) return null;
  return path.join(templateRoot(), folder, fileName);
}

function findExistingTemplatePath(stageCode: string, fileNames: string[]) {
  for (const fileName of fileNames) {
    const sourcePath = buildTemplatePath(stageCode, fileName);
    if (sourcePath && existsSync(sourcePath)) return sourcePath;
  }

  const firstPath = fileNames[0] ? buildTemplatePath(stageCode, fileNames[0]) : null;
  return firstPath;
}

export function resolveExcelTemplate(request: ExcelTemplateRequest): TemplateMatch {
  const firstItem = request.items[0];
  const stageCode = request.templateAssignment?.stageCode ?? firstItem?.stageCode;

  if (!firstItem || !stageCode) {
    throw new Error("Dokumen tidak memiliki item untuk menentukan template.");
  }

  if (request.type === "kwitansi") {
    const override = process.env.KDKMP_KWITANSI_TEMPLATE_XLSX?.trim();
    if (!override) {
      throw new Error(
        "Template kwitansi Excel belum tersedia. Set KDKMP_KWITANSI_TEMPLATE_XLSX ke file .xlsx hasil konversi kwitansi.",
      );
    }

    const assignment = request.templateAssignment ?? resolveTemplateAssignment(stageCode, request.vendor?.id, ALL_TEMPLATE_ASSIGNMENTS);
    const template = assignment ? findTemplateDefinition(assignment.templateId) : undefined;

    return {
      id: assignment?.templateId ?? `kwitansi-${stageCode}`,
      label: template?.label ?? `Kwitansi ${firstItem.stageName}`,
      sourcePath: override,
    };
  }

  const assignment = request.templateAssignment ?? resolveTemplateAssignment(stageCode, request.vendor?.id, ALL_TEMPLATE_ASSIGNMENTS);
  const template = assignment ? findTemplateDefinition(assignment.templateId) : undefined;
  const fileNames = [
    assignment?.preferredFileName,
    ...(assignment?.aliases ?? []),
    template?.canonicalFileName,
    ...(template?.aliases ?? []),
  ].filter((value, index, array): value is string => Boolean(value) && array.indexOf(value) === index);

  const sourcePath = findExistingTemplatePath(stageCode, fileNames);
  if (!assignment || !sourcePath) {
    throw new Error(`Template Excel belum terdaftar untuk vendor ${request.vendor?.name ?? "-"} ${stageCode}.`);
  }

  return {
    id: assignment.templateId,
    label: template?.label ?? `${request.vendor?.name ?? "Nota"} ${firstItem.stageName}`,
    sourcePath,
  };
}
