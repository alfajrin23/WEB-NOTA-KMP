import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function commandExists(command: string) {
  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-Command", `Get-Command ${command} -ErrorAction Stop | Out-Null`], {
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

async function exportWithLibreOffice(inputPath: string, outputDir: string) {
  const command = (await commandExists("soffice")) ? "soffice" : (await commandExists("libreoffice")) ? "libreoffice" : null;
  if (!command) return null;

  await execFileAsync(
    command,
    ["--headless", "--convert-to", "pdf", "--outdir", outputDir, inputPath],
    { windowsHide: true, timeout: 120_000 },
  );

  const pdfPath = path.join(outputDir, `${path.basename(inputPath, path.extname(inputPath))}.pdf`);
  return existsSync(pdfPath) ? pdfPath : null;
}

async function exportWithExcelCom(inputPath: string, outputDir: string) {
  const excelPath =
    process.env.KDKMP_EXCEL_EXE?.trim() ||
    "C:\\Program Files\\Microsoft Office\\root\\Office16\\EXCEL.EXE";

  if (!existsSync(excelPath)) return null;

  const pdfPath = path.join(outputDir, `${path.basename(inputPath, path.extname(inputPath))}.pdf`);
  const script = `
$ErrorActionPreference = "Stop"
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
try {
  $workbook = $excel.Workbooks.Open(${JSON.stringify(inputPath)}, 3, $false)
  $workbook.ExportAsFixedFormat(0, ${JSON.stringify(pdfPath)}, 0, $true, $false)
  $workbook.Close($false)
} finally {
  $excel.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
}
`;

  await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    windowsHide: true,
    timeout: 120_000,
  });

  return existsSync(pdfPath) ? pdfPath : null;
}

export async function exportWorkbookBufferToPdf(workbook: Buffer) {
  const workDir = path.join(os.tmpdir(), `kdkmp-excel-pdf-${randomUUID()}`);
  const xlsxPath = path.join(workDir, "render.xlsx");

  try {
    await mkdir(workDir, { recursive: true });
    await writeFile(xlsxPath, workbook);

    const pdfPath = (await exportWithLibreOffice(xlsxPath, workDir)) ?? (await exportWithExcelCom(xlsxPath, workDir));
    if (!pdfPath) {
      throw new Error("Tidak menemukan LibreOffice atau Microsoft Excel COM untuk export PDF.");
    }

    return await readFile(pdfPath);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
