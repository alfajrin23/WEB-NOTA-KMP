"use client";

import { LandscapeNotaPages } from "./LandscapeNotaPage";
import {
  formatDateSlash,
  formatPlainNumber,
  groupNotaItems,
  groupTotal,
  itemAmount,
  NotaGroup,
  padRows,
  Stage1TemplateProps,
} from "./stage1-shared";

function NotaKosongSlot({ group, project }: { group: NotaGroup | null; project: Stage1TemplateProps["project"] }) {
  const rows = padRows(group?.items ?? []);
  const total = group ? groupTotal(group) : 0;

  return (
    <section className="stage1-note-slot nota-kosong-slot">
      <header className="kosong-header">
        <div className="kosong-recipient">
          <div className="recipient-blank">Kepada Yth. :</div>
          <div>KDKMP Desa {project.villageName}</div>
          <div>Kecamatan {project.districtName}</div>
        </div>
        <div className="kosong-date">Cianjur&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: <span>{group ? formatDateSlash(group.date) : ""}</span></div>
      </header>
      <div className="nota-number">NOTA NO.</div>

      <table className="stage1-table kosong-table" data-overlap-role="table" data-overlap-table>
        <colgroup>
          <col className="kosong-col-name" />
          <col className="kosong-col-qty" />
          <col className="kosong-col-unit" />
          <col className="kosong-col-price" />
          <col className="kosong-col-amount" />
        </colgroup>
        <thead>
          <tr>
            <th>NAMA BARANG</th>
            <th>QTY</th>
            <th>SATUAN</th>
            <th>HARGA</th>
            <th>JUMLAH</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item, index) => (
            <tr key={item?.id ?? `blank-${index}`}>
              <td>{item?.itemName ?? ""}</td>
              <td className="center">{item ? formatPlainNumber(item.volume) : ""}</td>
              <td className="center">{item?.unit ?? ""}</td>
              <td className="right">{item ? formatPlainNumber(item.unitPrice) : ""}</td>
              <td className="right">{item ? formatPlainNumber(itemAmount(item)) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="stage1-total-row kosong-total" data-overlap-role="total">
        <span>Jumlah RP.</span>
        <strong>{total ? formatPlainNumber(total) : ""}</strong>
      </div>

      <footer className="stage1-note-footer kosong-footer" data-overlap-role="signature">
        <div>
          <div>Tanda terima,</div>
          <div className="signature-line kosong-signature-line">(..................................)</div>
        </div>
        <div>
          <div>Hormat Kami,</div>
          <div className="signature-line kosong-signature-line">(..................................)</div>
        </div>
      </footer>
    </section>
  );
}

export function NotaKosongTemplate(props: Stage1TemplateProps) {
  const groups = groupNotaItems(props.doc.items);
  return (
    <LandscapeNotaPages groups={groups} zoom={props.zoom} layoutKey="notaKosong" debug={props.debug}>
      {(group) => <NotaKosongSlot group={group} project={props.project} />}
    </LandscapeNotaPages>
  );
}
