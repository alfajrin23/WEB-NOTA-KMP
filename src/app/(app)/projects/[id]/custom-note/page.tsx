"use client";

import dynamic from "next/dynamic";

const CustomNoteView = dynamic(
  () => import("@/features/documents/custom-note-view").then((mod) => mod.CustomNoteView),
  { ssr: false },
);

export default function ProjectCustomNotePage() {
  return <CustomNoteView />;
}
