"use client";

/* eslint-disable @next/next/no-img-element */

import { PrintPage } from "@/components/print/print-page";
import { Stage1DebugBox } from "@/components/templates/stage1/Stage1Debug";
import {
  addDays,
  formatDateLong,
  formatPlainNumber,
  formatRupiahPlain,
  groupNotaItems,
  groupTotal,
  itemAmount,
  MultiStageTemplateProps,
  NotaGroup,
  padRows,
} from "./shared";

const HPM_ROWS = 8;

function HPMInvoice({
  group,
  project,
  zoom,
  debug,
}: {
  group: NotaGroup;
  project: MultiStageTemplateProps["project"];
  zoom: number;
  debug: boolean;
}) {
  const rows = padRows(group.items, HPM_ROWS);
  const total = groupTotal(group);
  const dueDate = addDays(group.date, 31);

  return (
    <PrintPage zoom={zoom} orientation="portrait" className="multi-hpm-page" debug={debug}>
      <section className="hpm-document" data-overlap-container data-overlap-label="HPM invoice">
        <header className="hpm-header">
          <img src="/template-assets/multi-stage/hpm-logo.png" alt="HPM" className="hpm-logo" />
          <div className="hpm-invoice-title">
            <h1>INVOICE</h1>
            <div><span>TGL INV</span><b>:</b><strong>{formatDateLong(group.date)}</strong></div>
            <div><span>TERM</span><b>:</b><strong>TEMPO 30 HARI</strong></div>
            <div><span>TGL JATUH</span><b>:</b><strong>{formatDateLong(dueDate)}</strong></div>
            <div><span>TEMPO</span></div>
          </div>
        </header>

        <section className="hpm-recipient">
          <div>Kepada</div>
          <b>:</b>
          <strong>KDKMP DESA {project.villageName.toUpperCase()}</strong>
          <span></span>
          <span></span>
          <strong>KECAMATAN {project.districtName.toUpperCase()}</strong>
        </section>

        <table className="multi-table hpm-table" data-overlap-role="table" data-overlap-table>
          <colgroup>
            <col className="hpm-col-no" />
            <col className="hpm-col-name" />
            <col className="hpm-col-qty" />
            <col className="hpm-col-unit" />
            <col className="hpm-col-price" />
            <col className="hpm-col-total" />
          </colgroup>
          <thead>
            <tr>
              <th>No.</th>
              <th>Nama Barang</th>
              <th>Jumlah</th>
              <th>Satuan</th>
              <th>Harga</th>
              <th>Total Harga</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item, index) => (
              <tr key={item?.id ?? `blank-${index}`}>
                <td className="center">{item ? index + 1 : ""}</td>
                <td>{item?.itemName ?? ""}</td>
                <td className="center">{item ? formatPlainNumber(item.volume) : ""}</td>
                <td className="center">{item?.unit ?? ""}</td>
                <td className="right">{item ? formatRupiahPlain(item.unitPrice) : ""}</td>
                <td className="right">{item ? formatRupiahPlain(itemAmount(item)) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="hpm-separator" />

        <div className="hpm-total-box" data-overlap-role="total">
          <span>Harga Jual</span><b>{formatRupiahPlain(total)}</b>
          <span>Biaya Lainnya</span><b>Rp0</b>
          <span>Uang Muka</span><b>Rp0</b>
          <strong>Total Faktur</strong><strong>{formatRupiahPlain(total)}</strong>
        </div>

        <section className="hpm-signature" data-overlap-role="signature">
          <p>Tangerang, {formatDateLong(group.date)}</p>
          <p>Hormat Kami</p>
          <div className="hpm-signature-space" />
          <strong>Andy Hariyanto. S,ST, MM</strong>
          <span>PT. HAGANE PERKASA MAKMUR</span>
        </section>

        <img src="/template-assets/multi-stage/hpm-footer.png" alt="" className="hpm-footer-img" />

        {debug && (
          <>
            <Stage1DebugBox box={{ x: "0mm", y: "58mm", width: "210mm", height: "55mm" }} label="Tabel HPM 8 baris" tone="table" />
            <Stage1DebugBox box={{ x: "134mm", y: "121mm", width: "76mm", height: "29mm" }} label="Total HPM" />
          </>
        )}
      </section>
    </PrintPage>
  );
}

export function HPMTemplate({ doc, project, zoom, debug = false }: MultiStageTemplateProps) {
  const groups = groupNotaItems(doc.items, HPM_ROWS);
  const pages = groups.length > 0 ? groups : [{ key: "blank", date: project.projectDate, category: "", items: [] }];

  return (
    <>
      {pages.map((group) => (
        <HPMInvoice key={group.key} group={group} project={project} zoom={zoom} debug={debug} />
      ))}
    </>
  );
}
