"use client";

/* eslint-disable @next/next/no-img-element */

import { CSSProperties } from "react";
import { PrintPage } from "@/components/print/print-page";
import { GeneratedNota, Project } from "@/types/domain";
import { Stage1DebugBox } from "@/components/templates/stage1/Stage1Debug";
import { isSpecialPLNKwitansi } from "@/lib/pln-document-groups";
import {
  amountWordsItalic,
  chunk,
  formatDateLong,
  formatRupiahWithDot,
  itemAmount,
  MultiStageTemplateProps,
  projectRecipient,
  splitLongText,
} from "./shared";

const plnSlots = [
  { x: "22mm", y: "9mm", width: "166mm", height: "130mm" },
  { x: "22mm", y: "150mm", width: "166mm", height: "130mm" },
];

function findResumeSourceItem(doc: GeneratedNota, project: Project) {
  const ids = [...doc.itemIds, ...doc.items.map((item) => item.id)].filter(Boolean);
  return ids.map((id) => project.items.find((item) => item.id === id)).find(Boolean);
}

function PLNSlip({
  doc,
  project,
}: {
  doc: GeneratedNota | null;
  project: Project;
}) {
  if (!doc) return null;

  const itemsAmount = doc.items.reduce((sum, item) => sum + itemAmount(item), 0);
  const sourceItem = findResumeSourceItem(doc, project);
  const amount = sourceItem ? itemAmount(sourceItem) : (itemsAmount || doc.kwitansiAmount || doc.totalAmount);
  const amountWords = amountWordsItalic(amount);
  const paymentDescription = doc.kwitansiPaymentDescription?.trim()
    || doc.items.map((item) => item.itemName.trim()).filter(Boolean).join(" Dan ")
    || doc.templateName;
  const purposeLines = splitLongText(paymentDescription, 48);
  const number = doc.kwitansiNumber?.trim() ?? "";
  const payer = doc.kwitansiPayerName?.trim() || projectRecipient(project).toUpperCase();
  const receiptDate = doc.kwitansiDate?.trim() || doc.notaDate || doc.tanggal || doc.items[0]?.expenseDate || project.projectDate;
  const city = doc.kwitansiCity?.trim() || project.regencyName || project.districtName;
  const role = doc.kwitansiRoleName?.trim() || "Penerima";
  const receiver = isSpecialPLNKwitansi(doc) ? "" : doc.kwitansiReceiverName?.trim() || "";
  const note = doc.kwitansiNote?.trim() ?? "";

  return (
    <section className="pln-slip" data-overlap-container data-overlap-label="PLN kwitansi">
      <img src="/template-assets/multi-stage/pln-logo.png" alt="PLN" className="pln-logo" />
      <h2>NOTA PEMBAYARAN PLN</h2>

      <div className="pln-row pln-number"><span>No.</span><b>:</b><strong>{number || "-"}</strong></div>
      <div className="pln-row"><span>Telah Terima Dari</span><b>:</b><strong>{payer}</strong></div>
      <div className="pln-row"><span>Uang Sejumlah</span><b>:</b></div>
      <div className="pln-words" data-overlap-role="total"><span>{amountWords}</span></div>

      <div className="pln-row pln-purpose-label"><span>Untuk Pembayaran</span><b>:</b></div>
      <div className="pln-purpose">
        {purposeLines.map((line, index) => <div key={`${index}-${line}`}>{line}</div>)}
      </div>

      <div className="pln-amount" data-overlap-role="total"><span>{formatRupiahWithDot(amount)}</span></div>

      <footer className="pln-signature" data-overlap-role="signature">
        <p>{city},&nbsp;&nbsp; {formatDateLong(receiptDate)}</p>
        <p>{role}</p>
        <i />
        <p>{receiver}</p>
        {note ? <p className="text-[7.5pt]">{note}</p> : null}
      </footer>
    </section>
  );
}

export { isSpecialPLNKwitansi };

export function PLNKwitansiBatchTemplate({
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
  const sortedDocs = docs
    .map((doc, sourceIndex) => ({ doc, sourceIndex }))
    .sort((left, right) => {
      const groupComparison = (left.doc.printGroupKey ?? "").localeCompare(right.doc.printGroupKey ?? "");
      if (groupComparison !== 0) return groupComparison;
      return (left.doc.printOrder ?? left.sourceIndex) - (right.doc.printOrder ?? right.sourceIndex);
    })
    .map(({ doc }) => doc);
  const pages = chunk(sortedDocs, 2);
  const pageRows = pages.length > 0 ? pages : [[]];

  return (
    <>
      {pageRows.map((pageDocs, pageIndex) => (
        <PrintPage key={pageIndex} zoom={zoom} orientation="portrait" className="multi-pln-page" debug={debug}>
          <div className="multi-absolute-sheet">
            {plnSlots.map((slot, index) => (
              <div
                key={index}
                className="multi-slot-position"
                style={{ left: slot.x, top: slot.y, width: slot.width, height: slot.height } as CSSProperties}
              >
                <PLNSlip doc={pageDocs[index] ?? null} project={project} />
              </div>
            ))}
            {debug && plnSlots.map((slot, index) => (
              <Stage1DebugBox key={`pln-debug-${index}`} box={slot} label={`PLN ${slot.width} x ${slot.height}`} />
            ))}
          </div>
        </PrintPage>
      ))}
    </>
  );
}

export function PLNTemplate({ doc, project, zoom, debug = false }: MultiStageTemplateProps) {
  return <PLNKwitansiBatchTemplate docs={[doc]} project={project} zoom={zoom} debug={debug} />;
}
