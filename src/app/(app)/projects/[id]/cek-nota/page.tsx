"use client";

import dynamic from "next/dynamic";

const CekNotaView = dynamic(
  () => import("@/features/documents/cek-nota-view").then((mod) => mod.CekNotaView),
  { ssr: false },
);

export default function ProjectCekNotaPage() {
  return <CekNotaView />;
}
