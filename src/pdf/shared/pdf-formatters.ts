import { formatDateIndonesia } from "@/utils/format";

/**
 * Shared PDF formatter utilities.
 * Centralised here so all templates use an identical number format and
 * date format — no drift between documents.
 */

/** Indonesian number formatter (no decimals).  e.g. 1500000 → "1.500.000" */
export const nf = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

/**
 * Format an ISO date string to DD/MM/YYYY (Indonesian locale).
 * @example dateSlash("2025-11-03") → "03/11/2025"
 */
export function dateSlash(date: string): string {
  return formatDateIndonesia(date);
}
