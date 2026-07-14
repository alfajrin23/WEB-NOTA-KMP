"use client";

import { CSSProperties, ReactNode, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { warnLayoutOverlap } from "@/utils/detectOverlap";

export function PrintPage({
  children,
  orientation = "portrait",
  zoom,
  className,
  debug = false,
}: {
  children: ReactNode;
  orientation?: "portrait" | "landscape";
  zoom: number;
  className?: string;
  debug?: boolean;
}) {
  const pageRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!debug || !pageRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      if (pageRef.current) warnLayoutOverlap(pageRef.current, className ?? orientation);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [className, debug, orientation]);

  return (
    <section
      className={cn("print-page-shell", orientation === "landscape" ? "print-page-shell-landscape" : "print-page-shell-portrait")}
      style={{ "--preview-zoom": zoom } as CSSProperties}
    >
      <article
        ref={pageRef}
        className={cn(
          "print-page",
          orientation === "landscape" ? "print-page-landscape" : "print-page-portrait",
          debug && "stage1-debug-active",
          className,
        )}
        data-layout-debug={debug ? "true" : undefined}
        data-overlap-label={className ?? orientation}
      >
        {children}
      </article>
    </section>
  );
}
