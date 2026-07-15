import { GeneratedNota } from "@/types/domain";

export type KwitansiSyncKey = "mandor" | "pekerja-terampil" | "pekerja-buruh";

function normalized(value: string | undefined | null) {
  return (value ?? "")
    .replace(/\btrampil\b/gi, "terampil")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function joinedDocText(doc: GeneratedNota) {
  return [
    doc.kwitansiRoleName,
    doc.kwitansiPaymentDescription,
    doc.vendorName,
    doc.templateName,
    ...doc.categoryNames,
    ...doc.items.flatMap((item) => [item.itemName, item.vendorName, item.category, item.categoryName]),
  ].filter(Boolean).join(" ");
}

export function kwitansiSyncKeyFromText(value: string | undefined | null): KwitansiSyncKey | null {
  const text = normalized(value);
  if (!text) return null;
  if (text.includes("pekerja terampil")) return "pekerja-terampil";
  if (text.includes("pekerja buruh")) return "pekerja-buruh";
  if (text.includes("mandor")) return "mandor";
  return null;
}

export function kwitansiSyncKeyForDoc(doc: GeneratedNota, roleText?: string): KwitansiSyncKey | null {
  return kwitansiSyncKeyFromText(roleText) ?? kwitansiSyncKeyFromText(joinedDocText(doc));
}

export function kwitansiSyncLabel(key: KwitansiSyncKey) {
  if (key === "pekerja-terampil") return "Pekerja Terampil";
  if (key === "pekerja-buruh") return "Pekerja Buruh";
  return "Mandor";
}

export function getAutofillKwitansiReceiver(doc: GeneratedNota) {
  const text = normalized(joinedDocText(doc));
  if (!text) return "";

  if (text.includes("kenek") || /pembantu\s+(sopir|supir)/.test(text)) return "Dika Nurdiansyah";
  if (text.includes("pratama project mandiri") || text.includes("sumur bor") || text.includes("cut n fill")) return "H. Nana";
  if (text.includes("baja ringan")) return "Dadang Bahtiar";
  if (text.includes("pintu kaca frameless")) return "Sarwoto";
  if (text.includes("pintu besi")) return "Sarwoto";
  if (text.includes("partisi kaca")) return "Sarwoto";
  if (text.includes("signage")) return "Nuryadi Mulyawan";
  if (text.includes("folding door")) return "Jamal";
  if (text.includes("folding gate")) return "Riki Subagja";
  if (text.includes("listrik")) return "Dian";
  if (text.includes("sopir") || text.includes("supir")) return "Renaldy Prayoga";

  return "";
}
