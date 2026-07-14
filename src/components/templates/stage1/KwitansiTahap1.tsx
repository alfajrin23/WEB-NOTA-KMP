"use client";

import { KwitansiBatchTemplate } from "@/components/templates/kwitansi/KwitansiBatchTemplate";
import { Stage1TemplateProps } from "./stage1-shared";

export function KwitansiTahap1({ doc, project, zoom, debug = false }: Stage1TemplateProps) {
  return <KwitansiBatchTemplate docs={[doc]} project={project} zoom={zoom} debug={debug} />;
}
