type RectLike = Pick<DOMRect, "left" | "right" | "top" | "bottom">;

export type LayoutOverlapWarning = {
  message: string;
};

function labelFor(element: Element) {
  return (
    element.getAttribute("data-overlap-label") ||
    element.getAttribute("data-overlap-role") ||
    element.className.toString() ||
    element.tagName.toLowerCase()
  );
}

function rectOutside(inner: RectLike, outer: RectLike, tolerance = 3) {
  return (
    inner.left < outer.left - tolerance ||
    inner.top < outer.top - tolerance ||
    inner.right > outer.right + tolerance ||
    inner.bottom > outer.bottom + tolerance
  );
}

export function rectsOverlap(first: RectLike, second: RectLike, tolerance = 3) {
  return !(
    first.right <= second.left + tolerance ||
    first.left >= second.right - tolerance ||
    first.bottom <= second.top + tolerance ||
    first.top >= second.bottom - tolerance
  );
}

export function detectLayoutOverlap(root: HTMLElement): LayoutOverlapWarning[] {
  const warnings: LayoutOverlapWarning[] = [];
  const pageRect = root.getBoundingClientRect();
  const containers = [...root.querySelectorAll<HTMLElement>("[data-overlap-container]")];

  for (const container of containers) {
    const containerRect = container.getBoundingClientRect();
    const containerLabel = labelFor(container);

    if (rectOutside(containerRect, pageRect)) {
      warnings.push({ message: `${containerLabel} keluar dari halaman A4.` });
    }

    const watched = [...container.querySelectorAll<HTMLElement>("[data-overlap-watch], [data-overlap-role]")];
    for (const element of watched) {
      if (element === container) continue;
      const rect = element.getBoundingClientRect();
      if (rectOutside(rect, containerRect)) {
        warnings.push({ message: `${labelFor(element)} keluar dari ${containerLabel}.` });
      }
    }

    const tables = watched.filter((element) => {
      const role = element.getAttribute("data-overlap-role");
      return role === "table" || element.hasAttribute("data-overlap-table");
    });
    const fixedAreas = watched.filter((element) => {
      const role = element.getAttribute("data-overlap-role");
      return role === "total" || role === "signature" || role === "footer" || role === "stamp";
    });

    for (const table of tables) {
      const tableRect = table.getBoundingClientRect();
      for (const fixedArea of fixedAreas) {
        if (table === fixedArea) continue;
        if (rectsOverlap(tableRect, fixedArea.getBoundingClientRect())) {
          warnings.push({
            message: `${labelFor(table)} overlap dengan ${labelFor(fixedArea)} di ${containerLabel}.`,
          });
        }
      }
    }
  }

  return warnings;
}

export function warnLayoutOverlap(root: HTMLElement, context: string) {
  const warnings = detectLayoutOverlap(root);
  for (const warning of warnings) {
    console.warn(`[KDKMP layout debug] ${context}: ${warning.message}`);
  }
  return warnings;
}
