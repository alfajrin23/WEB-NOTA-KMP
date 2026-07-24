"use client";

/* eslint-disable @next/next/no-img-element */

import { PrintPage } from "@/components/print/print-page";
import { Stage1DebugBox } from "./Stage1Debug";
import { stage1TemplateLayouts } from "./stage1-layout";
import {
  amountWords,
  formatDateSlash,
  formatPlainNumber,
  groupNotaItems,
  groupTotal,
  itemAmount,
  NotaGroup,
  padRows,
  projectInvoiceAddress,
  projectInvoiceRecipient,
  Stage1TemplateProps,
} from "./stage1-shared";

function CBBInvoicePage({
  group,
  project,
  zoom,
  debug = false,
}: {
  group: NotaGroup;
  project: Stage1TemplateProps["project"];
  zoom: number;
  debug?: boolean;
}) {
  const rows = padRows(group.items);
  const total = groupTotal(group);
  const layout = stage1TemplateLayouts.cbb;

  return (
    <PrintPage zoom={zoom} orientation="portrait" className="stage1-cbb-page" debug={debug}>
      <section className="cbb-document" data-overlap-container data-overlap-label="CBB invoice">
      <header className="cbb-header">
        <div className="cbb-company">
          <img src="/template-assets/tahap-1/cbb-1.png" alt="CBB Cahaya Baja Bangunan" className="cbb-logo" />
          <h1>CAHAYA BAJA BANGUNAN</h1>
          <p>
            Jl. TB Simatupang No.5, RT.5/RW.7, Ragunan, Ps. Minggu, Kota Jakarta<br />
            Selatan, Daerah Khusus Ibukota Jakarta 12550, JAKARTA SELATAN, DKI<br />
            JAKARTA, 12550<br />
            Telp: 0818130883<br />
            Email: henry.gouw13@gmail.com
          </p>
        </div>
        <div className="cbb-date"><strong>TANGGAL&nbsp;&nbsp;:</strong> {formatDateSlash(group.date)}</div>
      </header>

      <h2 className="cbb-title">FAKTUR</h2>

      <section className="cbb-customer">
        <h3>PELANGGAN</h3>
        <p><span>NAMA</span><b>:</b> {projectInvoiceRecipient(project)}</p>
        <p><span>ALAMAT</span><b>:</b> {projectInvoiceAddress(project)}</p>
        <p><span>TELP</span><b>:</b></p>
      </section>

      <table className="stage1-table cbb-table" data-overlap-role="table" data-overlap-table>
        <colgroup>
          <col className="cbb-col-no" />
          <col className="cbb-col-name" />
          <col className="cbb-col-qty" />
          <col className="cbb-col-price" />
          <col className="cbb-col-amount" />
        </colgroup>
        <thead>
          <tr>
            <th>NO.</th>
            <th>KETERANGAN</th>
            <th>QTY</th>
            <th>HARGA<br />SATUAN (Rp.)</th>
            <th>JUMLAH (Rp.)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item, index) => (
            <tr key={item?.id ?? `blank-${index}`}>
              <td>{item ? index + 1 : ""}</td>
              <td>{item?.itemName ?? ""}</td>
              <td className="right">{item ? formatPlainNumber(item.volume) : ""}</td>
              <td className="right">{item ? formatPlainNumber(item.unitPrice) : ""}</td>
              <td className="right">{item ? formatPlainNumber(itemAmount(item)) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="cbb-total-grid" data-overlap-role="total">
        <span>Subtotal</span><b>{formatPlainNumber(total)},00</b>
        <strong>TOTAL</strong><strong>{formatPlainNumber(total)},00</strong>
        <span>SisaTagihan</span><b>-</b>
      </div>

      <section className="cbb-footer-row" data-overlap-role="signature">
        <div className="cbb-payment">
          <h3>DETAIL PEMBAYARAN</h3>
          <p><span>NAMA BANK:</span> BANK RAKYAT INDONESIA</p>
          <p><span>CABANG BANK:</span> JAKARTA</p>
          <p><span>NOMORAKUN BANK:</span> 0428 0103 4860 509</p>
          <p><span>ATAS NAMA:</span> HENRY</p>
        </div>
        <div className="cbb-sign">
          <p>Salam Sejahtera,</p>
          <p>PT Cahaya Baja Bangunan</p>
          <p className="cbb-sign-name">HENRY</p>
        </div>
      </section>

      <section className="cbb-terbilang">
        <h3>TERBILANG</h3>
        <p>{amountWords(total)}</p>
      </section>
      {debug && (
        <>
          <Stage1DebugBox box={layout.slots[0]} label={`${layout.label} ${layout.slots[0].width} x ${layout.slots[0].height}`} />
          {layout.table && <Stage1DebugBox box={layout.table} label={`Tabel ${layout.table.width} / ${layout.table.rows} baris`} tone="table" />}
        </>
      )}
      </section>
    </PrintPage>
  );
}

export function CBBInvoiceTemplate(props: Stage1TemplateProps) {
  const groups = groupNotaItems(props.doc.items);
  const pages = groups.length > 0 ? groups : [{ key: "blank", date: props.project.projectDate, category: "", items: [] }];

  return (
    <>
      {pages.map((group) => (
        <CBBInvoicePage key={group.key} group={group} project={props.project} zoom={props.zoom} debug={props.debug} />
      ))}
    </>
  );
}
