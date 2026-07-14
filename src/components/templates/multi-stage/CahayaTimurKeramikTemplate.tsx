"use client";

/* eslint-disable @next/next/no-img-element */

import { PrintPage } from "@/components/print/print-page";
import { Stage1DebugBox } from "@/components/templates/stage1/Stage1Debug";
import {
  formatDateLong,
  formatPlainNumber,
  chunk,
  groupNotaItems,
  groupTotal,
  itemAmount,
  MultiStageTemplateProps,
  NotaGroup,
  padRows,
} from "./shared";

const CTK_ROWS = 8;
const CTK_NOTES_PER_PAGE = 2;

function CahayaTimurNote({
  group,
  project,
  debug,
}: {
  group: NotaGroup;
  project: MultiStageTemplateProps["project"];
  debug: boolean;
}) {
  const rows = padRows(group.items, CTK_ROWS);
  const total = groupTotal(group);

  return (
    <section className="ctk-note" data-overlap-container data-overlap-label="Cahaya Timur Keramik">
      <div className="ctk-header-frame">
        <img src="/template-assets/multi-stage/cahaya-timur-header.png" alt="Cahaya Timur Keramik" className="ctk-header-img" />
      </div>
      <div className="ctk-date">Bekasi, {formatDateLong(group.date)}</div>

      <section className="ctk-recipient">
        <div>Kepada Yth :</div>
        <div>KDKMP Desa {project.villageName}</div>
        <div>Kecamatan {project.districtName}</div>
      </section>

      <table className="multi-table ctk-table" data-overlap-role="table" data-overlap-table>
        <colgroup>
          <col className="ctk-col-qty" />
          <col className="ctk-col-name" />
          <col className="ctk-col-price" />
          <col className="ctk-col-total" />
        </colgroup>
        <thead>
          <tr>
            <th>BANYAKNYA</th>
            <th>NAMA BARANG</th>
            <th>HARGA<br />SATUAN</th>
            <th>JUMLAH</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item, index) => (
            <tr key={item?.id ?? `blank-${index}`}>
              <td className="center">{item ? formatPlainNumber(item.volume) : ""}</td>
              <td>{item?.itemName ?? ""}</td>
              <td className="right">{item ? formatPlainNumber(item.unitPrice) : ""}</td>
              <td className="right">{item ? formatPlainNumber(itemAmount(item)) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="ctk-total" data-overlap-role="total">
        <span>JUMLAH Rp.</span>
        <strong>{total ? formatPlainNumber(total) : ""}</strong>
      </div>

      <footer className="ctk-signature" data-overlap-role="signature">
        <div>
          <span>TANDA TERIMA</span>
          <i>.....................</i>
        </div>
        <div>
          <span>HORMAT KAMI</span>
          <img src="/template-assets/multi-stage/cahaya-timur-stamp.svg" alt="" data-overlap-role="stamp" />
          <i>.....................</i>
        </div>
      </footer>

      {debug && (
        <>
          <Stage1DebugBox box={{ x: "18mm", y: "44mm", width: "176mm", height: "56mm" }} label="Tabel CTK 8 baris" tone="table" />
          <Stage1DebugBox box={{ x: "22mm", y: "108mm", width: "162mm", height: "29mm" }} label="Tanda tangan CTK" />
        </>
      )}
    </section>
  );
}

export function CahayaTimurKeramikTemplate({ doc, project, zoom, debug = false }: MultiStageTemplateProps) {
  const groups = groupNotaItems(doc.items, CTK_ROWS);
  const notes = groups.length > 0 ? groups : [{ key: "blank", date: project.projectDate, category: "", items: [] }];
  const pages = chunk(notes, CTK_NOTES_PER_PAGE);

  return (
    <>
      {pages.map((pageGroups, pageIndex) => (
        <PrintPage key={pageGroups[0].key} zoom={zoom} orientation="portrait" className="multi-ctk-page" debug={debug}>
          <div className="ctk-page-sheet" data-ctk-page={pageIndex + 1} data-ctk-count={pageGroups.length}>
            {pageGroups.map((group, slotIndex) => (
              <div key={group.key} className="ctk-note-slot" data-ctk-slot={slotIndex + 1}>
                <CahayaTimurNote group={group} project={project} debug={debug} />
              </div>
            ))}
          </div>
        </PrintPage>
      ))}
    </>
  );
}
