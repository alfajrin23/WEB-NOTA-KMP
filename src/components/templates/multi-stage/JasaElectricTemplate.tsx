"use client";

/* eslint-disable @next/next/no-img-element */

import { CSSProperties } from "react";
import { PrintPage } from "@/components/print/print-page";
import { Stage1DebugBox } from "@/components/templates/stage1/Stage1Debug";
import { ResumeItem } from "@/types/domain";
import {
  chunk,
  formatDateLong,
  formatPlainNumber,
  itemAmount,
  MultiStageTemplateProps,
  NotaGroup,
  padRows,
  projectKdkmpRecipient,
} from "./shared";

const JASA_ROWS = 14;
type JasaNoteGroup = NotaGroup & {
  isFinalGroupChunk: boolean;
  total: number;
};

const jasaSlots = [
  { x: "3mm", y: "3mm", width: "100mm", height: "160mm" },
  { x: "113mm", y: "3mm", width: "100mm", height: "160mm" },
];
const jasaTableBox = { x: "0mm", y: "32.5mm", width: "100mm", height: "87mm" };

function buildJasaNoteGroups(items: ResumeItem[], maxRows: number): JasaNoteGroup[] {
  const grouped = new Map<string, NotaGroup & { firstSortOrder: number }>();

  for (const item of [...items].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const key = `${item.expenseDate}-${item.category}`;
    const current = grouped.get(key);
    if (current) {
      current.items.push(item);
    } else {
      grouped.set(key, {
        key,
        date: item.expenseDate,
        category: item.category,
        items: [item],
        firstSortOrder: item.sortOrder,
      });
    }
  }

  return [...grouped.values()]
    .sort((a, b) => a.firstSortOrder - b.firstSortOrder)
    .flatMap((group) => {
      const total = group.items.reduce((sum, item) => sum + itemAmount(item), 0);
      const chunks: JasaNoteGroup[] = [];
      for (let index = 0; index < group.items.length; index += maxRows) {
        chunks.push({
          key: `${group.key}-${Math.floor(index / maxRows) + 1}`,
          date: group.date,
          category: group.category,
          items: group.items.slice(index, index + maxRows),
          isFinalGroupChunk: index + maxRows >= group.items.length,
          total,
        });
      }
      return chunks;
    });
}

function JasaSlot({
  group,
  project,
}: {
  group: JasaNoteGroup;
  project: MultiStageTemplateProps["project"];
}) {
  const rows = padRows(group.items, JASA_ROWS);
  const visibleTotal = group.isFinalGroupChunk ? group.total : 0;

  return (
    <section className="multi-note jasa-slot" data-overlap-container data-overlap-label="Jasa Electric nota">
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
        <span>Jumlah RP.</span>
        <strong>{visibleTotal ? formatPlainNumber(visibleTotal) : ""}</strong>
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
  const groups = buildJasaNoteGroups(doc.items, JASA_ROWS);
  const printableGroups = groups.length > 0
    ? groups
    : [{ key: "blank", date: project.projectDate, category: "", items: [], isFinalGroupChunk: true, total: 0 }];
  const pages = chunk(printableGroups, 2);

  return (
    <>
      {pages.map((pageGroups, pageIndex) => (
        <PrintPage key={pageIndex} zoom={zoom} orientation="landscape" className="multi-jasa-page" debug={debug}>
          <div className="multi-absolute-sheet">
            {pageGroups.map((group, slotIndex) => {
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
                {jasaSlots.map((slot, slotIndex) => (
                  <Stage1DebugBox key={`jasa-slot-${slotIndex}`} box={slot} label={`Jasa ${slot.width} x ${slot.height}`} />
                ))}
                {jasaSlots.map((slot, slotIndex) => (
                  <Stage1DebugBox
                    key={`jasa-table-${slotIndex}`}
                    box={{ ...jasaTableBox, x: `calc(${slot.x} + ${jasaTableBox.x})`, y: `calc(${slot.y} + ${jasaTableBox.y})` }}
                    label={`Tabel Jasa ${JASA_ROWS} baris`}
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
