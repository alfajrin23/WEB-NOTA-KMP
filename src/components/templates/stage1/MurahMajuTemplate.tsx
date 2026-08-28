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

function MurahMajuSlot({ group, project }: { group: NotaGroup | null; project: Stage1TemplateProps["project"] }) {
  const rows = padRows(group?.items ?? []);
  const total = group ? groupTotal(group) : 0;

  return (
    <section className="stage1-note-slot murah-maju-slot">
      <header className="murah-header">
        <div className="murah-brand">
          <div className="murah-logo-frame">
            <img src="/template-assets/tahap-1/murah-maju-1.png" alt="Toko Murah Maju" className="murah-logo" />
          </div>
          <div className="murah-address">
            <div>TERSEDIA BAHAN BANGUNAN,</div>
            <div>BESI, KAYU, KACA DLL.</div>
            <div>Jl. Raya Hanyawar No.50</div>
            <div>(0263) 515261, 518114</div>
            <div>Cibadak, Puncak - Cipanas</div>
            <div>Jawa Barat</div>
          </div>
        </div>
        <div className="murah-recipient">
          <div className="murah-date">Cibadak, <span>{group ? formatDateSlash(group.date) : ""}</span></div>
          <div className="murahMajuRecipientBlock">
            <div className="font-bold">Kepada Yth. :</div>
            <div className="recipient-name">{projectKdkmpRecipient(project)}</div>
            <div className="recipient-name">Kecamatan {project.districtName}</div>
          </div>
        </div>
      </header>

      <div className="nota-number">NOTA NO.</div>
      <table className="stage1-table murah-table" data-overlap-role="table" data-overlap-table>
        <colgroup>
          <col className="murah-col-qty" />
          <col className="murah-col-name" />
          <col className="murah-col-price" />
          <col className="murah-col-amount" />
        </colgroup>
        <thead>
          <tr>
            <th>BANYAKNYA</th>
            <th>NAMA BARANG</th>
            <th>HARGA SATUAN</th>
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

      <div className="stage1-total-row" data-overlap-role="total">
        <span>Jumlah RP.</span>
        <strong>{total ? formatPlainNumber(total) : ""}</strong>
      </div>

      <footer className="stage1-note-footer murah-footer" data-overlap-role="signature">
        <div>
          <div>Tanda terima,</div>
          <div className="signature-line">(...........................)</div>
        </div>
        <div className="murah-note">NB : Barang2 yang telah dibeli<br />tidak dapat dikembalikan</div>
        <div>
          <div>Hormat Kami,</div>
          <div className="signature-line">(...........................)</div>
        </div>
      </footer>
    </section>
  );
}

export function MurahMajuTemplate(props: Stage1TemplateProps) {
  const groups = groupNotaItems(props.doc.items);
  return (
    <LandscapeNotaPages groups={groups} vendorKey={props.doc.vendorId} zoom={props.zoom} layoutKey="murahMaju" debug={props.debug}>
      {(group) => <MurahMajuSlot group={group} project={props.project} />}
    </LandscapeNotaPages>
  );
}
