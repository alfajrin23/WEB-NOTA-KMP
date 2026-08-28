"use client";

import { GeneratedNota, Project } from "@/types/domain";
import { AmanahTemplate } from "./stage1/AmanahTemplate";
import { CBBInvoiceTemplate } from "./stage1/CBBInvoiceTemplate";
import { KwitansiTahap1 } from "./stage1/KwitansiTahap1";
import { MurahMajuTemplate } from "./stage1/MurahMajuTemplate";
import { NotaKosongTemplate } from "./stage1/NotaKosongTemplate";
import { TBMandauTemplate } from "./stage1/TBMandauTemplate";
import { CahayaTimurKeramikTemplate } from "./multi-stage/CahayaTimurKeramikTemplate";
import { CBSTemplate } from "./multi-stage/CBSTemplate";
import { HPMTemplate } from "./multi-stage/HPMTemplate";
import { JasaElectricTemplate } from "./multi-stage/JasaElectricTemplate";
import { KwitansiStageTemplate } from "./multi-stage/KwitansiStageTemplate";
import { isSpecialPLNKwitansi, PLNTemplate } from "./multi-stage/PLNTemplate";

export function canRenderDocumentTemplate() {
  return true;
}

export function DocumentTemplateRenderer({
  doc,
  docs,
  project,
  zoom,
  debug = false,
}: {
  doc: GeneratedNota;
  docs?: GeneratedNota[];
  project: Project;
  zoom: number;
  debug?: boolean;
}) {
  if (isSpecialPLNKwitansi(doc)) {
    return <PLNTemplate doc={doc} project={project} zoom={zoom} debug={debug} />;
  }

  if (doc.documentType === "kwitansi") {
    if (doc.stageCode === "TAHAP_I") return <KwitansiTahap1 doc={doc} project={project} zoom={zoom} debug={debug} />;
    return <KwitansiStageTemplate doc={doc} project={project} zoom={zoom} debug={debug} />;
  }

  if (doc.vendorId === "vendor-internal" || doc.templateId === "template-nota-internal-non-vendor") {
    return <NotaKosongTemplate doc={doc} docs={docs} project={project} zoom={zoom} debug={debug} />;
  }

  if (doc.vendorId === "vendor-cbs" || doc.templateId === "template-cbs") {
    return <CBSTemplate doc={doc} docs={docs} project={project} zoom={zoom} debug={debug} />;
  }

  if (doc.vendorId === "vendor-hpm" || doc.templateId === "template-hpm") {
    return <HPMTemplate doc={doc} project={project} zoom={zoom} debug={debug} />;
  }

  if (doc.vendorId === "vendor-cahaya-timur" || doc.templateId === "template-cahaya-timur-keramik") {
    return <CahayaTimurKeramikTemplate doc={doc} project={project} zoom={zoom} debug={debug} />;
  }

  if (doc.vendorId === "vendor-pln" || doc.templateId === "template-pln") {
    return <PLNTemplate doc={doc} project={project} zoom={zoom} debug={debug} />;
  }

  if (doc.vendorId === "vendor-jasa-elektrik" || doc.templateId === "template-jasa-electric") {
    return <JasaElectricTemplate doc={doc} docs={docs} project={project} zoom={zoom} debug={debug} />;
  }

  if (doc.vendorId === "vendor-amanah" || doc.templateId === "template-amanah") {
    return <AmanahTemplate doc={doc} docs={docs} project={project} zoom={zoom} debug={debug} />;
  }

  if (doc.vendorId === "vendor-cbb" || doc.templateId === "template-invoice-cbb") {
    return <CBBInvoiceTemplate doc={doc} project={project} zoom={zoom} debug={debug} />;
  }

  if (doc.vendorId === "vendor-murah-maju" || doc.templateId === "template-murah-maju") {
    return <MurahMajuTemplate doc={doc} docs={docs} project={project} zoom={zoom} debug={debug} />;
  }

  if (doc.vendorId === "vendor-mandau" || doc.templateId === "template-tb-mandau") {
    return <TBMandauTemplate doc={doc} docs={docs} project={project} zoom={zoom} debug={debug} />;
  }

  return <NotaKosongTemplate doc={doc} docs={docs} project={project} zoom={zoom} debug={debug} />;
}
