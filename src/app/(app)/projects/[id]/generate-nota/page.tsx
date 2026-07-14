"use client";

import dynamic from "next/dynamic";

const GenerateNotaView = dynamic(
  () => import("@/features/documents/generate-nota-view").then((mod) => mod.GenerateNotaView),
  { ssr: false },
);

export default function ProjectGenerateNotaPage() {
  return <GenerateNotaView />;
}
