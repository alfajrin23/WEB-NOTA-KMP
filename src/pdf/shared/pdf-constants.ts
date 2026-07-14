/**
 * PDF Measurement Constants (unit: pt — points)
 *
 * 1 inch = 72 pt  |  1 mm = 2.8346 pt
 * A4 Portrait  : 595 × 842 pt
 * A4 Landscape : 842 × 595 pt
 *
 * @react-pdf/renderer uses Yoga layout engine (React Native style).
 * All table column widths are absolute pt numbers so they always sum
 * to the exact container width — no percentage drift, no layout shift.
 */

// ─── Page sizes ───────────────────────────────────────────────────────────────
export const A4_W  = 595;   // A4 portrait width  (pt)
export const A4_H  = 842;   // A4 portrait height (pt)
export const A4L_W = 842;   // A4 landscape width (pt)
export const A4L_H = 595;   // A4 landscape height (pt)

// ─── Nota landscape layout ────────────────────────────────────────────────────
// Two nota boxes sit side-by-side on one landscape A4 page.
export const NOTA_HALF_W   = A4L_W / 2;                       // 421 pt — each nota slot
export const NOTA_INNER_PAD = 2;                               // notaInner paddingHorizontal
export const NOTA_CONTENT_W = NOTA_HALF_W - NOTA_INNER_PAD * 2; // 417 pt — exact table width

// ── Column widths (all must sum to NOTA_CONTENT_W = 417 pt) ──────────────────

/**
 * Standard / Amanah layout — 5 columns
 * BANYAKNYA | SATUAN | NAMA BARANG | HARGA SATUAN | JUMLAH
 * 58 + 36 + 144 + 76 + 103 = 417 ✓
 */
export const COL_STD = {
  qty:    58,
  unit:   36,
  name:  144,
  price:  76,
  amount: 103,
} as const;

/**
 * Murah Maju / Mandau layout — 4 columns (unit merged into qty cell)
 * BANYAKNYA | NAMA BARANG | HARGA SATUAN | JUMLAH
 * 74 + 183 + 72 + 88 = 417 ✓
 */
export const COL_MURAH = {
  qty:    74,
  name:  183,
  price:  72,
  amount: 88,
} as const;

/**
 * Kosong / generic layout — 5 columns, nama first
 * NAMA BARANG | QTY | SATUAN | HARGA | JUMLAH
 * 145 + 58 + 38 + 76 + 100 = 417 ✓
 */
export const COL_KOSONG = {
  name:  145,
  qty:    58,
  unit:   38,
  price:  76,
  amount: 100,
} as const;

// ─── CBB (Faktur) A4 Portrait layout ─────────────────────────────────────────
export const CBB_PAGE_PAD_H = 20;                              // horizontal page padding
export const CBB_CONTENT_W  = A4_W - CBB_PAGE_PAD_H * 2;     // 555 pt

/**
 * CBB Faktur layout — 5 columns
 * NO. | KETERANGAN | QTY | HARGA SATUAN (Rp.) | JUMLAH (Rp.)
 * 28 + 254 + 56 + 80 + 137 = 555 ✓
 */
export const COL_CBB = {
  no:     28,
  name:  254,
  qty:    56,
  price:  80,
  amount: 137,
} as const;

// ─── Table row heights ────────────────────────────────────────────────────────
// Fixed heights (not min-height) ensure consistent row rendering across pages.
export const ROW_H_DATA = 22;   // data rows
export const ROW_H_HEAD = 34;   // header row
export const ROW_H_TOT  = 26;   // total / summary rows

// ─── Minimum blank rows per nota ─────────────────────────────────────────────
export const MIN_ROWS_STD   = 13; // Amanah, Kosong, Mandau
export const MIN_ROWS_MURAH = 12; // Murah Maju
export const MIN_ROWS_CBB   = 15; // CBB Faktur

// ─── Kwitansi layout ─────────────────────────────────────────────────────────
// 4 coupon slips per A4 portrait page.
export const KWIT_PAGE_PAD_V  = 8;   // top + bottom page padding
export const KWIT_PAGE_PAD_H  = 5;   // left + right page padding
export const KWIT_GAP         = 6;   // vertical gap between coupons (marginBottom)
// Coupon height: (842 − 2×8 − 3×6) / 4 = (826 − 18) / 4 = 202 pt  → use 201 for safety
export const KWIT_COUPON_H    = 201;
export const KWIT_LEFT_W      = 90;  // decorative left panel width
