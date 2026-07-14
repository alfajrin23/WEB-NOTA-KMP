import { CSSProperties } from "react";
import { Stage1Box, Stage1TableLayout } from "./stage1-layout";

function boxStyle(box: Stage1Box): CSSProperties {
  return {
    left: box.x,
    top: box.y,
    width: box.width,
    height: box.height,
  };
}

export function Stage1DebugBox({
  box,
  label,
  tone = "note",
}: {
  box: Stage1Box | Stage1TableLayout;
  label: string;
  tone?: "note" | "table" | "page";
}) {
  return (
    <div className={`stage1-debug-box stage1-debug-${tone}`} style={boxStyle(box)}>
      <span>{label}</span>
    </div>
  );
}
