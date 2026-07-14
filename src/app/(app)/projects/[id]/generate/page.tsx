"use client";

import dynamic from "next/dynamic";

const GenerateDocumentsView = dynamic(
  () => import("@/features/documents/generate-nota-view").then((mod) => mod.GenerateNotaView),
  { ssr: false },
);

export default function ProjectGeneratePage() {
  return <GenerateDocumentsView />;
}
