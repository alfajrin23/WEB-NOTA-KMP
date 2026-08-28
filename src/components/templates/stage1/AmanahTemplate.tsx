"use client";

/* eslint-disable @next/next/no-img-element */

import { LandscapeNotaPages } from "./LandscapeNotaPage";
import {
  formatDateSlash,
  formatPlainNumber,
  groupNotaItems,
  groupTotal,
  itemAmount,
  NotaGroup,
  padRows,
  projectKdkmpRecipient,
  Stage1TemplateProps,
} from "./stage1-shared";

function AmanahSlot({ group, project }: { group: NotaGroup | null; project: Stage1TemplateProps["project"] }) {
  const rows = padRows(group?.items ?? []);
  const total = group ? groupTotal(group) : 0;

  return (
    <section className="stage1-note-slot amanah-slot">
      <div className="amanah-watermark" aria-hidden="true">
        <img src="/template-assets/tahap-1/amanah-2.png" alt="" />
      </div>
      <header className="amanah-header">
        <div className="amanah-brand">
          <img src="/template-assets/tahap-1/amanah-2.png" alt="Amanah" className="amanah-logo" />
        </div>
        <div className="amanah-recipient">
          <div>Cianjur&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: <span>{group ? formatDateSlash(group.date) : ""}</span></div>
          <div className="font-bold">Kepada Yth. :</div>
          <div className="recipient-underline">{projectKdkmpRecipient(project)}</div>
          <div className="recipient-underline">Kecamatan {project.districtName}</div>
        </div>
      </header>

      <div className="nota-number">NOTA NO.</div>
      <table className="stage1-table amanah-table" data-overlap-role="table" data-overlap-table>
        <colgroup>
          <col className="amanah-col-qty" />
          <col className="amanah-col-unit" />
          <col className="amanah-col-name" />
          <col className="amanah-col-price" />
          <col className="amanah-col-amount" />
        </colgroup>
        <thead>
          <tr>
            <th>BANYAKNYA</th>
            <th>SATUAN</th>
            <th>NAMA BARANG</th>
            <th>HARGA SATUAN</th>
            <th>JUMLAH</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item, index) => (
            <tr key={item?.id ?? `blank-${index}`}>
              <td className="center">{item ? formatPlainNumber(item.volume) : ""}</td>
              <td className="center">{item?.unit ?? ""}</td>
              <td>{item?.itemName ?? ""}</td>
              <td className="right">{item ? formatPlainNumber(item.unitPrice) : ""}</td>
              <td className="right">{item ? formatPlainNumber(itemAmount(item)) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="amanah-total-grid" data-overlap-role="total">
        <span>Jumlah RP.</span><strong>{total ? formatPlainNumber(total) : ""}</strong>
        <span>Bayar RP.</span><strong>{total ? formatPlainNumber(total) : ""}</strong>
        <span>Sisa RP.</span><strong>-</strong>
      </div>

      <footer className="stage1-note-footer amanah-footer" data-overlap-role="signature">
        <div>
          <div>Tanda terima,</div>
          <div className="signature-line">(...........................)</div>
        </div>
        <div>
          <div>Hormat Kami,</div>
          <div className="signature-line">(...........................)</div>
        </div>
      </footer>
    </section>
  );
}

export function AmanahTemplate(props: Stage1TemplateProps) {
  const groups = groupNotaItems(props.doc.items);
  return (
    <LandscapeNotaPages groups={groups} vendorKey={props.doc.vendorId} zoom={props.zoom} layoutKey="amanah" debug={props.debug}>
      {(group) => <AmanahSlot group={group} project={props.project} />}
    </LandscapeNotaPages>
  );
}
