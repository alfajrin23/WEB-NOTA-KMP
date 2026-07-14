"use client";

import dynamic from "next/dynamic";

const EditKwitansiView = dynamic(
  () => import("@/features/documents/edit-kwitansi-view").then((mod) => mod.EditKwitansiView),
  { ssr: false },
);

export default function ProjectEditKwitansiPage() {
  return <EditKwitansiView />;
}
