"use client";

import { CSSProperties, ReactNode } from "react";
import { PrintPage } from "@/components/print/print-page";
import { paginateNotasByVendor } from "@/lib/nota-pagination";
import { NotaGroup } from "./stage1-shared";
import { Stage1DebugBox } from "./Stage1Debug";
import { stage1TemplateLayouts, Stage1LayoutKey } from "./stage1-layout";

export function LandscapeNotaPages({
  groups,
  vendorKey,
  zoom,
  layoutKey,
  debug = false,
  children,
}: {
  groups: NotaGroup[];
  vendorKey: string;
  zoom: number;
  layoutKey: Extract<Stage1LayoutKey, "amanah" | "murahMaju" | "notaKosong" | "tbMandau">;
  debug?: boolean;
  children: (group: NotaGroup | null, slotIndex: number) => ReactNode;
}) {
  const layout = stage1TemplateLayouts[layoutKey];
  const tableLayout = layout.table;
  const sourceGroups = groups.length > 0 ? groups : [{ key: "blank", date: "", category: "", items: [] }];
  const pages = paginateNotasByVendor(sourceGroups, () => vendorKey, layout.notesPerPage);

  return (
    <>
      {pages.map((page, pageIndex) => (
        <PrintPage key={`${page.vendorKey}-${pageIndex}`} zoom={zoom} orientation="landscape" className={`stage1-landscape-page stage1-${layoutKey}-page`} debug={debug}>
          <div className="stage1-absolute-sheet" data-nota-vendor={page.vendorKey} data-nota-count={page.notas.length}>
            {page.notas.map((group, slotIndex) => {
              const slot = layout.slots[slotIndex];
              return (
                <div
                  key={group.key}
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
                  {children(group, slotIndex)}
                </div>
              );
            })}
            {debug && (
              <>
                {page.notas.map((group, slotIndex) => {
                  const slot = layout.slots[slotIndex];
                  return (
                    <Stage1DebugBox key={`debug-slot-${group.key}`} box={slot} label={`${layout.label} ${slot.width} x ${slot.height}`} />
                  );
                })}
                {tableLayout && page.notas.map((group, slotIndex) => {
                  const slot = layout.slots[slotIndex];
                  return (
                    <Stage1DebugBox
                      key={`debug-table-${group.key}`}
                      box={{
                        ...tableLayout,
                        x: `calc(${slot.x} + ${tableLayout.x})`,
                        y: `calc(${slot.y} + ${tableLayout.y})`,
                      }}
                      label={`Tabel ${tableLayout.width} / ${tableLayout.rows} baris`}
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
