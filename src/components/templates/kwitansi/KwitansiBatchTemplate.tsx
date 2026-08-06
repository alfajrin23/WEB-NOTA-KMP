"use client";

/* eslint-disable @next/next/no-img-element */

import { CSSProperties } from "react";
import { PrintPage } from "@/components/print/print-page";
import { Stage1DebugBox } from "@/components/templates/stage1/Stage1Debug";
import {
  KwitansiTemplateColor,
  kwitansiTemplateLayout,
  Stage1Box,
  stage1TemplateLayouts,
} from "@/components/templates/stage1/stage1-layout";
import {
  getKwitansiAmount,
  getKwitansiAmountWords,
  getKwitansiPayerName,
  getKwitansiPaymentLines,
  getKwitansiProjectLines,
} from "@/lib/kwitansi-fields";
import { GeneratedNota, Project } from "@/types/domain";
import { chunk, formatPlainNumber } from "../stage1/stage1-shared";

export const KWITANSI_PER_PAGE = 4;

/** Return the complete four-slip print page containing the selected receipt. */
export function getKwitansiPageChunk(docs: GeneratedNota[], selectedId: string) {
  const selected = docs.find((doc) => doc.id === selectedId);
  if (!selected) return [];
  const stageDocs = docs.filter((doc) => doc.stageCode === selected.stageCode);
  const selectedIndex = stageDocs.findIndex((doc) => doc.id === selectedId);
  if (selectedIndex < 0) return [];
  const pageStart = Math.floor(selectedIndex / KWITANSI_PER_PAGE) * KWITANSI_PER_PAGE;
  return stageDocs.slice(pageStart, pageStart + KWITANSI_PER_PAGE);
}

/**
 * Tahap tidak boleh berbagi lembar. Map menjaga urutan tahap berdasarkan
 * kemunculan pertama dan urutan dokumen di dalam setiap tahap tetap sama.
 */
export function paginateKwitansiByStage<T extends Pick<GeneratedNota, "stageCode">>(docs: T[], pageSize = KWITANSI_PER_PAGE) {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error("Jumlah kwitansi per halaman harus lebih dari 0.");

  const stageGroups = new Map<T["stageCode"], T[]>();
  for (const doc of docs) {
    const current = stageGroups.get(doc.stageCode);
    if (current) current.push(doc);
    else stageGroups.set(doc.stageCode, [doc]);
  }

  return [...stageGroups.values()].flatMap((stageDocs) => chunk(stageDocs, pageSize));
}

function requestedTemplateColor(value: string | undefined): KwitansiTemplateColor | null {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "blue" || normalized === "biru") return "blue";
  if (normalized === "green" || normalized === "hijau") return "green";
  if (normalized === "pink" || normalized === "merah muda" || normalized === "merah") return "pink";
  return null;
}

function templateColor(doc: GeneratedNota, index: number): KwitansiTemplateColor {
  const requested = requestedTemplateColor(doc.warnaTemplate);
  return requested ?? kwitansiTemplateLayout.automaticColorOrder[index % kwitansiTemplateLayout.automaticColorOrder.length];
}

function fieldStyle(box: Stage1Box): CSSProperties {
  return { left: box.x, top: box.y, width: box.width, height: box.height };
}

function KwitansiSlip({
  doc,
  project,
  index,
}: {
  doc: GeneratedNota;
  project: Project;
  index: number;
}) {
  const amount = getKwitansiAmount(doc);
  const purpose = getKwitansiPaymentLines(doc, project);
  const note = doc.kwitansiNote?.trim();
  const purposeLines = note ? [...purpose, note] : purpose;
  const projectLines = getKwitansiProjectLines(doc, project);
  const receiver = doc.kwitansiReceiverName?.trim() || "";
  const payer = getKwitansiPayerName(doc, project);
  const number = doc.kwitansiNumber?.trim() ?? "";
  const color = templateColor(doc, index);
  const fields = kwitansiTemplateLayout.fields;

  return (
    <div className="stage1-kwitansi-slip" data-kwitansi-id={doc.id} data-stage-code={doc.stageCode} data-template-color={color} data-overlap-container data-overlap-label="Kwitansi">
      <img src={kwitansiTemplateLayout.backgrounds[color]} alt="" className="stage1-kwitansi-bg" />
      {number ? <div className="kwitansi-text kwitansi-number-value" style={fieldStyle(fields.number)}>{number}</div> : null}
      <div className="kwitansi-text kwitansi-from" style={fieldStyle(fields.payer)}>{payer}</div>
      <div className="kwitansi-text kwitansi-words" style={fieldStyle(fields.amountWords)}>{getKwitansiAmountWords(doc)}</div>
      <div className="kwitansi-text kwitansi-purpose" style={fieldStyle(fields.payment)} data-overlap-role="table">
        {purposeLines.slice(0, 3).map((line, lineIndex) => <div key={lineIndex}>{line}</div>)}
      </div>
      <div className="kwitansi-text kwitansi-project" style={fieldStyle(fields.project)}>{projectLines[0] ?? ""}</div>
      <div className="kwitansi-text kwitansi-role" style={fieldStyle(fields.role)}>{projectLines[1] ?? ""}</div>
      <div className="kwitansi-text kwitansi-amount" style={fieldStyle(fields.amount)} data-overlap-role="total">{formatPlainNumber(amount)},-</div>
      <div className="kwitansi-text kwitansi-receiver" style={fieldStyle(fields.receiver)} data-overlap-role="signature">{receiver}</div>
    </div>
  );
}

export function KwitansiBatchTemplate({
  docs,
  project,
  zoom,
  debug = false,
}: {
  docs: GeneratedNota[];
  project: Project;
  zoom: number;
  debug?: boolean;
}) {
  const layout = stage1TemplateLayouts.kwitansi;
  const pageSize = Math.min(KWITANSI_PER_PAGE, layout.notesPerPage, layout.slots.length);
  const pageRows = paginateKwitansiByStage(docs, pageSize);

  if (pageRows.length === 0) return null;

  return (
    <>
      {pageRows.map((pageDocs, pageIndex) => (
        <PrintPage key={`${pageDocs[0].stageCode}-${pageDocs[0].id}`} zoom={zoom} orientation="portrait" className="stage1-kwitansi-page multi-kwitansi-page" debug={debug}>
          <div
            className="stage1-absolute-sheet"
            data-kwitansi-page={pageIndex + 1}
            data-kwitansi-stage={pageDocs[0].stageCode}
            data-kwitansi-count={pageDocs.length}
          >
            {pageDocs.map((doc, slotIndex) => {
              const slot = layout.slots[slotIndex];
              return (
                <div
                  key={doc.id}
                  className="stage1-slot-position kwitansi-slot-position"
                  data-kwitansi-slot={slotIndex + 1}
                  style={{ left: slot.x, top: slot.y, width: slot.width, height: slot.height } as CSSProperties}
                >
                  <KwitansiSlip doc={doc} project={project} index={pageIndex * pageSize + slotIndex} />
                </div>
              );
            })}
            {debug && pageDocs.map((doc, index) => (
              <Stage1DebugBox
                key={`debug-kwitansi-${doc.id}`}
                box={layout.slots[index]}
                label={`Kwitansi ${layout.slots[index].width} x ${layout.slots[index].height}`}
              />
            ))}
          </div>
        </PrintPage>
      ))}
    </>
  );
}
