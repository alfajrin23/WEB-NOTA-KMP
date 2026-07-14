"use client";

import { CSSProperties, ReactNode } from "react";
import { PrintPage } from "@/components/print/print-page";
import { chunk, NotaGroup } from "./stage1-shared";
import { Stage1DebugBox } from "./Stage1Debug";
import { stage1TemplateLayouts, Stage1LayoutKey } from "./stage1-layout";

export function LandscapeNotaPages({
  groups,
  zoom,
  layoutKey,
  debug = false,
  children,
}: {
  groups: NotaGroup[];
  zoom: number;
  layoutKey: Extract<Stage1LayoutKey, "amanah" | "murahMaju" | "notaKosong" | "tbMandau">;
  debug?: boolean;
  children: (group: NotaGroup | null, slotIndex: number) => ReactNode;
}) {
  const layout = stage1TemplateLayouts[layoutKey];
  const tableLayout = layout.table;
  const pages = chunk(groups.length > 0 ? groups : [{ key: "blank", date: "", category: "", items: [] }], layout.notesPerPage);

  return (
    <>
      {pages.map((pageGroups, pageIndex) => (
        <PrintPage key={pageIndex} zoom={zoom} orientation="landscape" className={`stage1-landscape-page stage1-${layoutKey}-page`} debug={debug}>
          <div className="stage1-absolute-sheet">
            {layout.slots.map((slot, slotIndex) => (
              <div
                key={slotIndex}
                className="stage1-slot-position"
                data-overlap-container
                data-overlap-label={`${layout.label} slot ${slotIndex + 1}`}
                style={
                  {
                    left: slot.x,
                    top: slot.y,
                    width: slot.width,
                    height: slot.height,
                  } as CSSProperties
                }
              >
                {children(pageGroups[slotIndex] ?? null, slotIndex)}
              </div>
            ))}
            {debug && (
              <>
                {layout.slots.map((slot, slotIndex) => (
                  <Stage1DebugBox key={`debug-slot-${slotIndex}`} box={slot} label={`${layout.label} ${slot.width} x ${slot.height}`} />
                ))}
                {tableLayout && layout.slots.map((slot, slotIndex) => (
                  <Stage1DebugBox
                    key={`debug-table-${slotIndex}`}
                    box={{
                      ...tableLayout,
                      x: `calc(${slot.x} + ${tableLayout.x})`,
                      y: `calc(${slot.y} + ${tableLayout.y})`,
                    }}
                    label={`Tabel ${tableLayout.width} / ${tableLayout.rows} baris`}
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
