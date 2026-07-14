"use client";

import { KwitansiBatchTemplate } from "@/components/templates/kwitansi/KwitansiBatchTemplate";
import { MultiStageTemplateProps } from "./shared";

export function KwitansiStageTemplate({ doc, project, zoom, debug = false }: MultiStageTemplateProps) {
  return <KwitansiBatchTemplate docs={[doc]} project={project} zoom={zoom} debug={debug} />;
}
