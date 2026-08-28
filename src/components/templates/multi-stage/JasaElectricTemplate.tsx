"use client";

/* eslint-disable @next/next/no-img-element */

import { CSSProperties } from "react";
import { PrintPage } from "@/components/print/print-page";
import { Stage1DebugBox } from "@/components/templates/stage1/Stage1Debug";
import { buildJasaElectricNotaGroups, JasaElectricNotaGroup } from "@/lib/jasa-electric-groups";
import { paginateNotasByVendor } from "@/lib/nota-pagination";
import { ResumeItem } from "@/types/domain";
import {
  formatDateLong,
  formatPlainNumber,
  itemAmount,
  MultiStageTemplateProps,
  padRows,
  projectKdkmpRecipient,
} from "./shared";

const JASA_ROWS = 14;

const jasaSlots = [
  { x: "3mm", y: "3mm", width: "100mm", height: "160mm" },
  { x: "113mm", y: "3mm", width: "100mm", height: "160mm" },
];
const jasaTableBox = { x: "0mm", y: "32.5mm", width: "100mm", height: "87mm" };

function JasaSlot({
  group,
  project,
}: {
  group: JasaElectricNotaGroup<ResumeItem>;
  project: MultiStageTemplateProps["project"];
}) {
  const rows = padRows(group.items, JASA_ROWS);
  const isSplitTransaction = group.splitCount > 1;
  const showGrandTotal = isSplitTransaction && group.isLastSplitNota;

  return (
    <section
      className={`multi-note jasa-slot${showGrandTotal ? " jasa-slot-with-grand-total" : ""}`}
      data-jasa-transaction={group.transactionKey}
      data-jasa-split={group.splitNumber}
      data-jasa-split-count={group.splitCount}
      data-overlap-container
      data-overlap-label="Jasa Electric nota"
    >
      <header className="jasa-header">
        <img src="/template-assets/multi-stage/jasa-electric-header.png" alt="Jasa Electric" className="jasa-logo" />
        <div className="jasa-recipient">
          <div><span>Tgl</span><b>:</b><strong>{formatDateLong(group.date)}</strong></div>
          <div><span>Tuan Toko</span><b>:</b></div>
          <div>{projectKdkmpRecipient(project)}</div>
          <div>Kecamatan {project.districtName}</div>
        </div>
      </header>

      <div className="jasa-nota-number">NOTA NO.</div>
      <img src="/template-assets/multi-stage/jasa-electric-header.png" alt="" className="jasa-watermark" />

      <table className="multi-table jasa-table" data-overlap-role="table" data-overlap-table>
        <colgroup>
          <col className="jasa-col-qty" />
          <col className="jasa-col-name" />
          <col className="jasa-col-price" />
          <col className="jasa-col-total" />
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
              <td className="center">{item ? `${formatPlainNumber(item.volume)} ${item.unit}`.trim() : ""}</td>
              <td>{item?.itemName ?? ""}</td>
              <td className="right">{item ? formatPlainNumber(item.unitPrice) : ""}</td>
              <td className="right">{item ? formatPlainNumber(itemAmount(item)) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="jasa-total" data-overlap-role="total">
        <span>{isSplitTransaction ? "Subtotal" : "Jumlah RP."}</span>
        <strong>{group.chunkSubtotal ? formatPlainNumber(group.chunkSubtotal) : ""}</strong>
        {showGrandTotal ? (
          <>
            <span className="jasa-grand-total-label">TOTAL KESELURUHAN</span>
            <strong>{group.transactionTotal ? formatPlainNumber(group.transactionTotal) : ""}</strong>
          </>
        ) : null}
      </div>

      <footer className="jasa-footer" data-overlap-role="signature">
        <div>
          <span>Tanda terima,</span>
          <i />
        </div>
        <div className="jasa-warning">Perhatian<br />Barang Yang Sudah Dibeli<br />Tidak Dapat Ditukar/Dikembalikan</div>
        <div>
          <span>Hormat Kami,</span>
          <i />
        </div>
      </footer>
    </section>
  );
}

export function JasaElectricTemplate({ doc, project, zoom, debug = false }: MultiStageTemplateProps) {
  const groups = buildJasaElectricNotaGroups(doc.items, JASA_ROWS, itemAmount);
  const printableGroups: JasaElectricNotaGroup<ResumeItem>[] = groups.length > 0
    ? groups
    : [{
      key: "blank",
      transactionKey: "intentional-blank-template",
      date: project.projectDate,
      category: "",
      items: [],
      chunkSubtotal: 0,
      transactionTotal: 0,
      splitNumber: 1,
      splitCount: 1,
      isLastSplitNota: true,
    }];
  const pages = paginateNotasByVendor(printableGroups, () => doc.vendorId, 2);

  return (
    <>
      {pages.map((page, pageIndex) => (
        <PrintPage key={`${page.vendorKey}-${pageIndex}`} zoom={zoom} orientation="landscape" className="multi-jasa-page" debug={debug}>
          <div className="multi-absolute-sheet" data-nota-vendor={page.vendorKey} data-nota-count={page.notas.length}>
            {page.notas.map((group, slotIndex) => {
              const slot = jasaSlots[slotIndex];
              return (
                <div
                  key={group.key}
                  className="multi-slot-position"
                  style={{ left: slot.x, top: slot.y, width: slot.width, height: slot.height } as CSSProperties}
                >
                  <JasaSlot group={group} project={project} />
                </div>
              );
            })}
            {debug && (
              <>
                {page.notas.map((group, slotIndex) => {
                  const slot = jasaSlots[slotIndex];
                  return <Stage1DebugBox key={`jasa-slot-${group.key}`} box={slot} label={`Jasa ${slot.width} x ${slot.height}`} />;
                })}
                {page.notas.map((group, slotIndex) => {
                  const slot = jasaSlots[slotIndex];
                  return (
                    <Stage1DebugBox
                      key={`jasa-table-${group.key}`}
                      box={{ ...jasaTableBox, x: `calc(${slot.x} + ${jasaTableBox.x})`, y: `calc(${slot.y} + ${jasaTableBox.y})` }}
                      label={`Tabel Jasa ${JASA_ROWS} baris`}
                      tone="table"
                    />
                  );
                })}
              </>
            )}
          </div>
        </PrintPage>
      ))}
    </>
  );
}
