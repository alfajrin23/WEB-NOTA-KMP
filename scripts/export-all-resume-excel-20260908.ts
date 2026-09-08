import fs from "node:fs/promises";
import path from "node:path";
import { fetchProjectBundle } from "../src/lib/supabase/project-data";
import { vendors } from "../src/constants/seed-data";
import { buildResumeWorkbook, safeResumeExcelFileName } from "../src/server/resume-excel/resume-workbook";

function safeFolderSegment(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:\"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 80) || "Tanpa_Kecamatan";
}

const outputDir = path.resolve("resume-export-all");
await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(outputDir, { recursive: true });

const bundle = await fetchProjectBundle();
const projects = [...bundle.projects].sort((left, right) =>
  left.districtName.localeCompare(right.districtName, "id-ID", { sensitivity: "base" }) ||
  left.villageName.localeCompare(right.villageName, "id-ID", { sensitivity: "base" }) ||
  left.id.localeCompare(right.id),
);

if (projects.length !== 119) {
  throw new Error(`Jumlah project live tidak sesuai ekspektasi: ${projects.length}, seharusnya 119.`);
}

const manifest: string[] = [];
for (const project of projects) {
  if (!project.items.length) throw new Error(`Resume kosong: ${project.villageName} / ${project.districtName}`);
  const workbook = await buildResumeWorkbook(project, vendors);
  const districtDir = path.join(outputDir, `Kecamatan_${safeFolderSegment(project.districtName)}`);
  await fs.mkdir(districtDir, { recursive: true });
  const fileName = safeResumeExcelFileName(project);
  const filePath = path.join(districtDir, fileName);
  await fs.writeFile(filePath, Buffer.from(workbook));
  manifest.push(`${project.districtName}\t${project.villageName}\t${project.items.length}\t${path.relative(outputDir, filePath)}`);
  console.log(`[${manifest.length}/${projects.length}] ${project.districtName} / ${project.villageName} -> ${fileName}`);
}

await fs.writeFile(
  path.join(outputDir, "DAFTAR_EXPORT.txt"),
  `Export Excel Resume Web Nota KMP\nTanggal: 2026-09-08\nJumlah project: ${projects.length}\n\nKecamatan\tDesa/Kelurahan\tJumlah Item\tFile\n${manifest.join("\n")}\n`,
  "utf8",
);

console.log(`EXPORT_OK project_count=${projects.length} output=${outputDir}`);
