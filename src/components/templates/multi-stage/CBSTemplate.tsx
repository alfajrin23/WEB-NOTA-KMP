"use client";

/* eslint-disable @next/next/no-img-element */

import { CSSProperties } from "react";
import { PrintPage } from "@/components/print/print-page";
import { Stage1DebugBox } from "@/components/templates/stage1/Stage1Debug";
import { CBS_DOCUMENT_LAYOUT } from "@/constants/document-layout";
import {
  chunk,
  formatDateLong,
  formatPlainNumber,
  groupNotaItems,
  groupTotal,
  itemAmount,
  MultiStageTemplateProps,
  NotaGroup,
  padRows,
  projectRecipient,
} from "./shared";

const CBS_ROWS = 14;
const cbsRenderedWidth = CBS_DOCUMENT_LAYOUT.sourceNoteWidthMm * CBS_DOCUMENT_LAYOUT.htmlContentScale;
const cbsRenderedHeight = CBS_DOCUMENT_LAYOUT.sourceNoteHeightMm * CBS_DOCUMENT_LAYOUT.htmlContentScale;
const cbsHorizontalInset = (CBS_DOCUMENT_LAYOUT.pageWidthMm - cbsRenderedWidth) / 2;
const cbsSlots = [
  { x: `${cbsHorizontalInset}mm`, y: `${CBS_DOCUMENT_LAYOUT.verticalInsetMm}mm` },
  {
    x: `${cbsHorizontalInset}mm`,
    y: `${CBS_DOCUMENT_LAYOUT.verticalInsetMm + cbsRenderedHeight + CBS_DOCUMENT_LAYOUT.verticalGapMm}mm`,
  },
];
const cbsTableBox = { x: "0mm", y: "57mm", width: "297mm", height: "90mm" };

const cbsNoteFrameSize: CSSProperties = {
  width: `${cbsRenderedWidth}mm`,
  height: `${cbsRenderedHeight}mm`,
};

const cbsNoteContentScale: CSSProperties = {
  "--cbs-content-scale": CBS_DOCUMENT_LAYOUT.htmlContentScale,
  width: `${CBS_DOCUMENT_LAYOUT.sourceNoteWidthMm}mm`,
  height: `${CBS_DOCUMENT_LAYOUT.sourceNoteHeightMm}mm`,
  transform: `scale(${CBS_DOCUMENT_LAYOUT.htmlContentScale})`,
  transformOrigin: "top left",
} as CSSProperties;

function CBSSlot({
  group,
  project,
}: {
  group: NotaGroup | null;
  project: MultiStageTemplateProps["project"];
}) {
  const rows = padRows(group?.items ?? [], CBS_ROWS);
  const total = group ? groupTotal(group) : 0;
  const recipient = projectRecipient(project).toUpperCase();
  const villageLine = recipient.includes(project.villageName.toUpperCase()) ? recipient : `KDKMP DESA ${project.villageName}`.toUpperCase();
  const districtLine = `KECAMATAN ${project.districtName}`.toUpperCase();

  return (
    <section className="multi-note cbs-slot" style={cbsNoteContentScale} data-overlap-container data-overlap-label="CBS invoice">
      <header className="cbs-header">
        <img src="/template-assets/multi-stage/cbs-logo.png" alt="" className="cbs-logo" />
        <div className="cbs-company">
          <strong>CITRA BAJA SEJAHTERA</strong>
          <span>JL. RAYA BANDUNG KM. 11</span>
          <span>CIKIJING, CIANJUR</span>
        </div>
        <div className="cbs-invoice-meta">
          <strong>FAKTUR PENJUALAN</strong>
          <div><span>Invoice Date</span><b>Invoice No</b></div>
          <div><span>{group ? formatDateLong(group.date) : ""}</span><b></b></div>
          <div><span>Term</span><b>FOB</b></div>
          <div><span></span><b></b></div>
          <div><span>Ship Via</span><b>Ship Date</b></div>
          <div><span></span><b>{group ? formatDateLong(group.date) : ""}</b></div>
          <div><span>PO. No.</span><b>Currency</b></div>
          <div><span></span><b>IDR</b></div>
        </div>
      </header>

      <section className="cbs-recipient">
        <div>Bill To</div>
        <div className="cbs-recipient-box cbs-recipient-bill">
          <span>: {villageLine}</span>
          <span>{districtLine}</span>
        </div>
        <div>Ship To</div>
        <div className="cbs-recipient-box cbs-recipient-ship">
          <span>: {villageLine}</span>
          <span>{districtLine}</span>
        </div>
      </section>

      <table className="multi-table cbs-table" data-overlap-role="table" data-overlap-table>
        <colgroup>
          <col className="cbs-col-item" />
          <col className="cbs-col-desc" />
          <col className="cbs-col-qty" />
          <col className="cbs-col-price" />
          <col className="cbs-col-disc" />
          <col className="cbs-col-tax" />
          <col className="cbs-col-amount" />
          <col className="cbs-col-serial" />
        </colgroup>
        <thead>
          <tr>
            <th>Item</th>
            <th>Item Description</th>
            <th>Qty</th>
            <th>Unit Price</th>
            <th>Disc</th>
            <th>Tax</th>
            <th>Amount</th>
            <th>Serial Number</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item, index) => (
            <tr key={item?.id ?? `blank-${index}`}>
              <td></td>
              <td>{item?.itemName ?? ""}</td>
              <td className="center">{item ? formatPlainNumber(item.volume) : ""}</td>
              <td className="right">{item ? formatPlainNumber(item.unitPrice) : ""}</td>
              <td></td>
              <td></td>
              <td className="right">{item ? formatPlainNumber(itemAmount(item)) : ""}</td>
              <td></td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="cbs-description" data-overlap-role="footer">
        <div><span>Say:</span></div>
        <div><span>Description:</span></div>
      </div>

      <div className="cbs-total" data-overlap-role="total">
        <span>SubTotal</span><b>{total ? formatPlainNumber(total) : ""}</b>
        <span>Discount</span><b>-</b>
        <span>Freight</span><b>-</b>
        <span>Total Invoice</span><b>{total ? formatPlainNumber(total) : ""}</b>
      </div>

      <footer className="cbs-signatures" data-overlap-role="signature">
        <div>
          <span>Prepared By</span>
          <i />
        </div>
        <div>
          <span>Received By</span>
          <i />
        </div>
      </footer>
    </section>
  );
}

export function CBSTemplate({ doc, project, zoom, debug = false }: MultiStageTemplateProps) {
  const groups = groupNotaItems(doc.items, CBS_ROWS)
    .sort((a, b) => (a.items[0]?.sortOrder ?? 0) - (b.items[0]?.sortOrder ?? 0));
  const printableGroups = groups.length > 0
    ? groups
    : [{ key: "blank", date: project.projectDate, category: "", items: [] }];
  const pages = chunk(printableGroups, CBS_DOCUMENT_LAYOUT.notesPerPage);

  return (
    <>
      {pages.map((pageGroups, pageIndex) => (
        <PrintPage key={pageIndex} zoom={zoom} orientation="portrait" className="multi-cbs-page" debug={debug}>
          <div className="multi-absolute-sheet cbs-content-frame">
            {pageGroups.map((group, slotIndex) => {
              const slot = cbsSlots[slotIndex];
              return (
              <div
                key={group.key}
                className="multi-slot-position cbs-note-frame"
                style={{ left: slot.x, top: slot.y, ...cbsNoteFrameSize } as CSSProperties}
              >
                <CBSSlot group={group} project={project} />
              </div>
              );
            })}
            {debug && (
              <>
                {pageGroups.map((group, slotIndex) => (
                  <Stage1DebugBox
                    key={`cbs-slot-${group.key}`}
                    box={{
                      x: cbsSlots[slotIndex].x,
                      y: cbsSlots[slotIndex].y,
                      width: `${cbsRenderedWidth}mm`,
                      height: `${cbsRenderedHeight}mm`,
                    }}
                    label={`CBS ${cbsRenderedWidth} x ${cbsRenderedHeight} mm`}
                  />
                ))}
                {pageGroups.map((group, slotIndex) => (
                  <Stage1DebugBox
                    key={`cbs-table-${group.key}`}
                    box={{
                      ...cbsTableBox,
                      x: `calc(${cbsSlots[slotIndex].x} + ${cbsTableBox.x})`,
                      y: `calc(${cbsSlots[slotIndex].y} + ${cbsTableBox.y})`,
                    }}
                    label={`Tabel CBS ${CBS_ROWS} baris`}
                    tone="table"
                  />
                ))}
              </>
            )}
          </div>
        </PrintPage>
      ))}
    </>
  );
}
