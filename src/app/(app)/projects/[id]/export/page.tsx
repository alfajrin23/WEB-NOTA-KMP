"use client";

import dynamic from "next/dynamic";

const ExportView = dynamic(
  () => import("@/features/documents/export-view").then((mod) => mod.ExportView),
  { ssr: false },
);

export default function ProjectExportPage() {
  return <ExportView />;
}
