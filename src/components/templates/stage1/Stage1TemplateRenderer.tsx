"use client";

import { GeneratedNota, Project } from "@/types/domain";
import { AmanahTemplate } from "./AmanahTemplate";
import { CBBInvoiceTemplate } from "./CBBInvoiceTemplate";
import { KwitansiTahap1 } from "./KwitansiTahap1";
import { MurahMajuTemplate } from "./MurahMajuTemplate";
import { NotaKosongTemplate } from "./NotaKosongTemplate";
import { TBMandauTemplate } from "./TBMandauTemplate";

export function canRenderStage1Template(doc: GeneratedNota) {
  return doc.stageCode === "TAHAP_I";
}

export function Stage1TemplateRenderer({
  doc,
  project,
  zoom,
  debug = false,
}: {
  doc: GeneratedNota;
  project: Project;
  zoom: number;
  debug?: boolean;
}) {
  if (doc.documentType === "kwitansi" || doc.vendorId === "vendor-kwitansi") {
    return <KwitansiTahap1 doc={doc} project={project} zoom={zoom} debug={debug} />;
  }

  if (doc.vendorId === "vendor-amanah" || doc.templateId === "template-amanah") {
    return <AmanahTemplate doc={doc} project={project} zoom={zoom} debug={debug} />;
  }

  if (doc.vendorId === "vendor-cbb" || doc.templateId === "template-invoice-cbb") {
    return <CBBInvoiceTemplate doc={doc} project={project} zoom={zoom} debug={debug} />;
  }

  if (doc.vendorId === "vendor-murah-maju" || doc.templateId === "template-murah-maju") {
    return <MurahMajuTemplate doc={doc} project={project} zoom={zoom} debug={debug} />;
  }

  if (doc.vendorId === "vendor-mandau" || doc.templateId === "template-tb-mandau") {
    return <TBMandauTemplate doc={doc} project={project} zoom={zoom} debug={debug} />;
  }

  return <NotaKosongTemplate doc={doc} project={project} zoom={zoom} debug={debug} />;
}
