/**
 * kwitansi-document.tsx — Production-ready PDF template for Kwitansi / Slip
 *
 * Layout: 4 coupon slips per A4 portrait page.
 *
 * ╔═══════════════════════════════════════╗
 * ║ [left panel] │ content area          ║  ← coupon #1 (201pt)
 * ╠═══════════════════════════════════════╣
 * ║ [left panel] │ content area          ║  ← coupon #2 (201pt)
 * ╠═══════════════════════════════════════╣
 * ║ [left panel] │ content area          ║  ← coupon #3 (201pt)
 * ╠═══════════════════════════════════════╣
 * ║ [left panel] │ content area          ║  ← coupon #4 (201pt)
 * ╚═══════════════════════════════════════╝
 *
 * Key fix: ALL content uses flex layout — zero position:absolute on text.
 * This eliminates overlapping text at every screen/print size.
 */

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { Project, ResumeItem } from "@/types/domain";
import { getResumeItemAmount } from "@/lib/resume-calculations";
import { formatProjectKdkmpWilayah, terbilangRupiah } from "@/utils/format";
import {
  KWIT_PAGE_PAD_V,
  KWIT_PAGE_PAD_H,
  KWIT_GAP,
  KWIT_COUPON_H,
  KWIT_LEFT_W,
} from "./shared/pdf-constants";
import { nf, dateSlash } from "./shared/pdf-formatters";

// ─── Layout measurements ─────────────────────────────────────────────────────
const LABEL_W     = 108;  // left label column width inside coupon content
const AMOUNT_BOX_W = 210; // width of the Rp. amount box

// ─── StyleSheet ───────────────────────────────────────────────────────────────

const S = StyleSheet.create({

  // Page
  page: {
    paddingTop:        KWIT_PAGE_PAD_V,
    paddingBottom:     KWIT_PAGE_PAD_V,
    paddingHorizontal: KWIT_PAGE_PAD_H,
    backgroundColor:   "#fff",
    fontFamily:        "Times-Roman",
    color:             "#000",
  },

  // ── Coupon outer container ────────────────────────────────────────────────
  coupon: {
    height:          KWIT_COUPON_H,
    marginBottom:    KWIT_GAP,
    flexDirection:   "row",
    borderWidth:     1,
    borderColor:     "#38bdf8",
    backgroundColor: "#e0f7ff",
    overflow:        "hidden",
  },
  couponBorder: {
    position:    "absolute",
    inset:       0,
    borderWidth: 4,
    borderColor: "#7dd3fc",
    opacity:     0.7,
  },

  // ── Decorative left panel ─────────────────────────────────────────────────
  leftPanel: {
    width:           KWIT_LEFT_W,
    borderRightWidth: 2,
    borderColor:     "#0369a1",
    backgroundColor: "#bae6fd",
    alignItems:      "center",
    justifyContent:  "center",
    flexShrink:      0,
  },
  rosette: {
    width:        60,
    height:       60,
    borderRadius: 30,
    borderWidth:  3,
    borderColor:  "#0284c7",
    marginBottom: 8,
  },
  rosetteInner: {
    width:        40,
    height:       40,
    borderRadius: 20,
    borderWidth:  2,
    borderColor:  "#7dd3fc",
    position:     "absolute",
    top:          10,
    left:         10,
  },
  leftText: {
    fontSize:    7,
    color:       "#0369a1",
    textAlign:   "center",
    fontFamily:  "Helvetica-Bold",
    marginTop:   6,
  },

  // ── Centre decorative ellipse ─────────────────────────────────────────────
  centreEllipse: {
    position:     "absolute",
    top:          18,
    left:         KWIT_LEFT_W + 140,
    width:        250,
    height:       KWIT_COUPON_H - 36,
    borderRadius: 80,
    borderWidth:  1,
    borderColor:  "#38bdf8",
    opacity:      0.45,
  },

  // ── Main content area ─────────────────────────────────────────────────────
  mainContent: {
    flex:          1,
    paddingLeft:   16,
    paddingRight:  10,
    paddingTop:    12,
    paddingBottom: 8,
    flexDirection: "column",
  },

  // Fields area (takes all available vertical space)
  fieldsArea: {
    flex: 1,
  },

  // Single field row (label + underlined value)
  fieldRow: {
    flexDirection:  "row",
    alignItems:     "flex-start",
    marginBottom:   3,
  },
  fieldLabel: {
    width:    LABEL_W,
    fontSize: 12,
    flexShrink: 0,
  },
  fieldColon: {
    width:    10,
    fontSize: 12,
    flexShrink: 0,
  },
  fieldValue: {
    flex:              1,
    fontSize:          12,
    borderBottomWidth: 0.75,
    borderColor:       "#000",
    paddingLeft:       4,
    lineHeight:        1.3,
  },
  fieldValueItalic: {
    flex:              1,
    fontSize:          12,
    fontFamily:        "Times-Italic",
    borderBottomWidth: 0.75,
    borderColor:       "#000",
    paddingLeft:       4,
    lineHeight:        1.3,
  },

  // Info row: KDKMP + person name (right-aligned, no border)
  infoRow: {
    flexDirection:  "row",
    justifyContent: "flex-end",
    marginTop:      3,
    marginBottom:   2,
  },
  infoText: {
    textAlign: "right",
    fontSize:  12,
    lineHeight: 1.3,
  },

  // Bottom strip: amount box + receiver
  bottomStrip: {
    flexDirection:  "row",
    alignItems:     "center",
    justifyContent: "space-between",
    marginTop:      4,
  },

  // Rp. amount ribbon
  amountBox: {
    width:           AMOUNT_BOX_W,
    height:          34,
    backgroundColor: "#dbeafe",
    borderTopWidth:  1,
    borderBottomWidth: 1,
    borderColor:     "#000",
    flexDirection:   "row",
    alignItems:      "center",
    paddingHorizontal: 12,
    gap:             8,
  },
  amountCurrency: {
    fontSize:   14,
    fontFamily: "Helvetica-Bold",
  },
  amountValue: {
    fontSize:         15,
    textDecoration:   "underline",
    fontFamily:       "Times-Roman",
  },

  // Receiver name
  receiverText: {
    textAlign:  "right",
    fontSize:   12,
    fontFamily: "Times-Roman",
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function chunk<T>(arr: T[], n: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < arr.length; i += n) pages.push(arr.slice(i, i + n));
  return pages;
}

/** Strip parenthetical annotations from item names, e.g. "Mandor (Budi)" → "Mandor" */
function personName(itemName: string): string {
  return itemName.replace(/\s*\(.+?\)\s*/g, "").trim();
}

// ─── Coupon Component ─────────────────────────────────────────────────────────

function Coupon({ project, item }: { project: Project; item: ResumeItem }) {
  const amount = getResumeItemAmount(item);
  const person = personName(item.itemName);

  // "Untuk pembayaran" purpose text — two lines so it wraps cleanly
  const purposeLine1 = `Pembayaran Honor ${person}, Tanggal ${dateSlash(item.expenseDate)} s.d ${dateSlash(project.projectDate)}`;
  const purposeLine2 = `Pembangunan ${formatProjectKdkmpWilayah(project)} Pekerjaan Tahap I`;

  return (
    <View style={S.coupon}>
      {/* Outer double-border decoration */}
      <View style={S.couponBorder} />

      {/* Centre ellipse watermark */}
      <View style={S.centreEllipse} />

      {/* ── Left decorative panel ──────────────────────────────────────── */}
      <View style={S.leftPanel}>
        <View style={S.rosette}>
          <View style={S.rosetteInner} />
        </View>
        <Text style={S.leftText}>KWITANSI</Text>
      </View>

      {/* ── Main content (flex column — no absolute positioning) ──────── */}
      <View style={S.mainContent}>

        {/* Fields */}
        <View style={S.fieldsArea}>

          {/* No. */}
          <View style={S.fieldRow}>
            <Text style={S.fieldLabel}>No.</Text>
            <Text style={S.fieldColon} />
            <Text style={S.fieldValue} />
          </View>

          {/* Telah terima dari */}
          <View style={S.fieldRow}>
            <Text style={S.fieldLabel}>Telah terima dari</Text>
            <Text style={S.fieldColon}>:</Text>
            <Text style={S.fieldValue}>Sigit Soegiarto</Text>
          </View>

          {/* Uang sejumlah */}
          <View style={S.fieldRow}>
            <Text style={S.fieldLabel}>Uang sejumlah</Text>
            <Text style={S.fieldColon}>:</Text>
            <Text style={S.fieldValueItalic}>{terbilangRupiah(amount)}</Text>
          </View>

          {/* Untuk pembayaran (line 1) */}
          <View style={S.fieldRow}>
            <Text style={S.fieldLabel}>Untuk pembayaran</Text>
            <Text style={S.fieldColon}>:</Text>
            <Text style={S.fieldValue}>{purposeLine1}</Text>
          </View>

          {/* Untuk pembayaran (line 2 — Pembangunan KDKMP) */}
          <View style={S.fieldRow}>
            <Text style={{ width: LABEL_W, flexShrink: 0 }} />
            <Text style={{ width: 10, flexShrink: 0 }} />
            <Text style={S.fieldValue}>{purposeLine2}</Text>
          </View>

          {/* KDKMP info — right-aligned within field area */}
          <View style={S.infoRow}>
            <Text style={S.infoText}>
              {formatProjectKdkmpWilayah(project)}{"\n"}{person}
            </Text>
          </View>
        </View>

        {/* ── Bottom strip ──────────────────────────────────────────────── */}
        <View style={S.bottomStrip}>

          {/* Rp. amount box */}
          <View style={S.amountBox}>
            <Text style={S.amountCurrency}>Rp.</Text>
            <Text style={S.amountValue}>{nf.format(amount)},-</Text>
          </View>

          {/* Receiver */}
          <Text style={S.receiverText}>Bpk. {person}</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Exported Document ────────────────────────────────────────────────────────

export function KwitansiDocument({
  project,
  items,
}: {
  project: Project;
  items:   ResumeItem[];
}) {
  if (!items.length) {
    return (
      <Document title="Kwitansi">
        <Page size="A4" style={S.page} />
      </Document>
    );
  }

  return (
    <Document title={`Kwitansi - ${project.villageName}`}>
      {chunk(items, 4).map((pageItems, pageIdx) => (
        <Page key={pageIdx} size="A4" style={S.page}>
          {pageItems.map((item) => (
            <Coupon key={item.id} project={project} item={item} />
          ))}
        </Page>
      ))}
    </Document>
  );
}
