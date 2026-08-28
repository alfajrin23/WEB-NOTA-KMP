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
  projectKdkmpRecipient,
  Stage1TemplateProps,
} from "./stage1-shared";

function TBMandauSlot({ group, project }: { group: NotaGroup | null; project: Stage1TemplateProps["project"] }) {
  const rows = padRows(group?.items ?? []);
  const total = group ? groupTotal(group) : 0;

  return (
    <section className="stage1-note-slot mandau-slot">
      <header className="mandau-header">
        <div className="mandau-date">
          <span>Cianjur</span>
          <span>:</span>
          <span>{group ? formatDateSlash(group.date) : ""}</span>
        </div>
        <div className="mandauRecipientBlock">
          <div className="font-bold">Kepada Yth. :</div>
          <div>{projectKdkmpRecipient(project)}</div>
          <div>Kecamatan {project.districtName}</div>
        </div>
      </header>
      <div className="nota-number">NOTA NO.</div>

      <table className="stage1-table mandau-table" data-overlap-role="table" data-overlap-table>
        <colgroup>
          <col className="mandau-col-qty" />
          <col className="mandau-col-name" />
          <col className="mandau-col-price" />
          <col className="mandau-col-amount" />
        </colgroup>
        <thead>
          <tr>
            <th>BANYAKNYA</th>
            <th>NAMA BARANG</th>
            <th>HARGA</th>
            <th>JUMLAH</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item, index) => (
            <tr key={item?.id ?? `blank-${index}`}>
              <td className="center">{item ? `${formatPlainNumber(item.volume)} ${item.unit}` : ""}</td>
              <td>{item?.itemName ?? ""}</td>
              <td className="right">{item ? formatPlainNumber(item.unitPrice) : ""}</td>
              <td className="right">{item ? formatPlainNumber(itemAmount(item)) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="stage1-total-row mandau-total" data-overlap-role="total">
        <span>Jumlah RP.</span>
        <strong>{total ? formatPlainNumber(total) : ""}</strong>
      </div>

      <footer className="stage1-note-footer mandau-footer" data-overlap-role="signature">
        <div>
          <div>Tanda terima,</div>
          <div className="signature-line">(........................)</div>
        </div>
        <div className="mandau-warning">Perhatian<br />Barang Yang Sudah Dibeli<br />Tidak Dapat Dikembalikan</div>
        <div>
          <div>Hormat Kami,</div>
          <div className="signature-line">(........................)</div>
        </div>
      </footer>
    </section>
  );
}

export function TBMandauTemplate(props: Stage1TemplateProps) {
  const groups = groupNotaItems(props.doc.items);
  return (
    <LandscapeNotaPages groups={groups} vendorKey={props.doc.vendorId} zoom={props.zoom} layoutKey="tbMandau" debug={props.debug}>
      {(group) => <TBMandauSlot group={group} project={props.project} />}
    </LandscapeNotaPages>
  );
}
