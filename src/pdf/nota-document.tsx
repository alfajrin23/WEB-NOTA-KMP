/* eslint-disable jsx-a11y/alt-text */
/**
 * nota-document.tsx — Production-ready PDF template for Nota / Faktur
 *
 * Supports four vendor-specific layouts:
 *  • "murah"   → Toko Murah Maju  (4-col, landscape 2-up, grey header)
 *  • "amanah"  → Toko Amanah      (5-col, landscape 2-up, grey header + watermark)
 *  • "mandau"  → Mandau           (4-col, landscape 2-up, red borders)
 *  • "kosong"  → generic plain    (5-col name-first, landscape 2-up, plain header)
 *  • "cbb"     → CBB Faktur       (5-col, A4 portrait, one group per page)
 *
 * Layout engine: Yoga (via @react-pdf/renderer).
 * All widths are absolute pt values — see pdf-constants.ts for the sums.
 * Row heights are FIXED (not min-height) to prevent inconsistency across pages.
 */

import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import { Project, ResumeItem, Vendor } from "@/types/domain";
import { getResumeItemAmount } from "@/lib/resume-calculations";
import { terbilangRupiah } from "@/utils/format";
import {
  A4L_W,
  A4L_H,
  NOTA_HALF_W,
  NOTA_INNER_PAD,
  COL_STD,
  COL_MURAH,
  COL_KOSONG,
  CBB_PAGE_PAD_H,
  COL_CBB,
  ROW_H_DATA,
  ROW_H_HEAD,
  ROW_H_TOT,
  MIN_ROWS_STD,
  MIN_ROWS_MURAH,
  MIN_ROWS_CBB,
} from "./shared/pdf-constants";
import { nf, dateSlash } from "./shared/pdf-formatters";

// ─── Types ────────────────────────────────────────────────────────────────────

type NotaGroup = {
  key:      string;
  date:     string;
  category: string;
  items:    ResumeItem[];
};

type Variant = "murah" | "amanah" | "cbb" | "mandau" | "kosong";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getVariant(vendorName: string): Variant {
  const n = vendorName.toUpperCase();
  if (n.includes("MURAH"))  return "murah";
  if (n.includes("AMANAH")) return "amanah";
  if (n.includes("CBB"))    return "cbb";
  if (n.includes("MANDAU")) return "mandau";
  return "kosong";
}

function groupItems(items: ResumeItem[]): NotaGroup[] {
  const map = new Map<string, NotaGroup>();
  for (const item of items) {
    const key = `${item.expenseDate}-${item.category}`;
    const g   = map.get(key);
    if (g) g.items.push(item);
    else map.set(key, { key, date: item.expenseDate, category: item.category, items: [item] });
  }
  return [...map.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.category.localeCompare(b.category),
  );
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/**
 * Fill a group's item list with blank placeholder rows up to `minRows`.
 * Blank rows render as empty cells so the table always has a fixed number of lines.
 */
function padRows(g: NotaGroup, minRows: number): ResumeItem[] {
  const blanks = Math.max(0, minRows - g.items.length);
  return [
    ...g.items,
    ...Array.from({ length: blanks }, (_, i) => ({
      id:          `${g.key}-blank-${i}`,
      stageCode:   "TAHAP_I" as const,
      stageName:   "",
      category:    "",
      expenseDate: g.date,
      itemName:    "",
      volume:      0,
      unit:        "",
      unitPrice:   0,
      vendorId:    "",
      sortOrder:   0,
    })),
  ];
}

function sumGroup(g: NotaGroup): number {
  return g.items.reduce((t, item) => t + getResumeItemAmount(item), 0);
}

// ─── StyleSheet ───────────────────────────────────────────────────────────────

const S = StyleSheet.create({

  // ── Page / pair layout ────────────────────────────────────────────────────
  pageLS: {
    width:      A4L_W,
    height:     A4L_H,
    padding:    0,
    fontFamily: "Times-Roman",
    fontSize:   9,
    color:      "#000",
  },
  pair: {
    flexDirection: "row",
    width:         A4L_W,
    height:        A4L_H,
  },

  // ── Nota slot ─────────────────────────────────────────────────────────────
  nota: {
    width:             NOTA_HALF_W,
    height:            A4L_H,
    paddingTop:        10,
    paddingBottom:     12,
    paddingHorizontal: 0,
  },
  inner: {
    paddingHorizontal: NOTA_INNER_PAD,
  },

  // ── Headers ───────────────────────────────────────────────────────────────
  topHeader: {
    flexDirection: "row",
    height:        120,
  },
  plainHeader: {
    flexDirection: "row",
    height:        84,
  },
  brandArea: {
    width:           "50%",
    alignItems:      "center",
    justifyContent:  "flex-start",
  },
  recipientArea: {
    flex:        1,
    paddingTop:  14,
    paddingLeft: 16,
    lineHeight:  1.3,
  },

  // Brand image sizes
  murahLogo:  { width: 218, height: 75, objectFit: "contain" },
  amanahLogo: { width: 222, height: 84, objectFit: "contain" },

  // Brand text styles
  murahAddr: {
    textAlign:  "center",
    fontSize:   9,
    fontFamily: "Helvetica-Bold",
    lineHeight: 1.4,
  },
  amanahAddr: {
    marginTop:  -2,
    textAlign:  "center",
    fontSize:   9,
    fontFamily: "Helvetica-Bold",
    lineHeight: 1.1,
    color:      "#b91c1c",
  },
  amanahSm: {
    textAlign:  "center",
    fontSize:   8.5,
    lineHeight: 1.15,
  },
  underline: {
    borderBottomWidth: 0.75,
    borderColor:       "#000",
    paddingLeft:       4,
  },

  // NOTA NO. label
  notaLabel: {
    fontFamily:   "Times-Bold",
    fontSize:     11,
    marginBottom: 1,
  },

  // ── Table shell ───────────────────────────────────────────────────────────
  // The shell only has top + left borders; cells supply right + bottom.
  table: {
    borderTopWidth:  0.75,
    borderLeftWidth: 0.75,
    borderColor:     "#000",
  },
  redTable: {
    borderTopWidth:  0.75,
    borderLeftWidth: 0.75,
    borderColor:     "#dc2626",
  },

  // ── Table rows ────────────────────────────────────────────────────────────
  // FIXED height (not minHeight) — guarantees identical row size on every page.
  tRow: {
    flexDirection: "row",
    height:        ROW_H_DATA,
  },
  tHead: {
    flexDirection:   "row",
    height:          ROW_H_HEAD,
    backgroundColor: "#d1d5db",
  },
  tHeadPlain: {
    flexDirection: "row",
    height:        ROW_H_HEAD,
  },

  // ── Table cells ───────────────────────────────────────────────────────────
  // Black border variant (default)
  cell: {
    borderRightWidth:  0.75,
    borderBottomWidth: 0.75,
    borderColor:       "#000",
    paddingHorizontal: 3,
    paddingVertical:   2,
    justifyContent:    "center",
    overflow:          "hidden",
  },
  // Red border variant (Mandau)
  redCell: {
    borderRightWidth:  0.75,
    borderBottomWidth: 0.75,
    borderColor:       "#dc2626",
    paddingHorizontal: 3,
    paddingVertical:   2,
    justifyContent:    "center",
    overflow:          "hidden",
  },

  // Text alignment helpers
  headText: { fontFamily: "Helvetica-Bold", textAlign: "center", fontSize: 9 },
  tr: { textAlign: "right" },
  tc: { textAlign: "center" },

  // ── Column widths — Standard / Amanah (5 cols, sum = 417 pt) ─────────────
  colQty:   { width: COL_STD.qty   },
  colUnit:  { width: COL_STD.unit  },
  colName:  { width: COL_STD.name  },
  colPrice: { width: COL_STD.price },
  colAmt:   { width: COL_STD.amount },

  // ── Column widths — Murah / Mandau (4 cols, sum = 417 pt) ────────────────
  mColQty:   { width: COL_MURAH.qty   },
  mColName:  { width: COL_MURAH.name  },
  mColPrice: { width: COL_MURAH.price },
  mColAmt:   { width: COL_MURAH.amount },

  // ── Column widths — Kosong (5 cols name-first, sum = 417 pt) ─────────────
  kColName:  { width: COL_KOSONG.name  },
  kColQty:   { width: COL_KOSONG.qty   },
  kColUnit:  { width: COL_KOSONG.unit  },
  kColPrice: { width: COL_KOSONG.price },
  kColAmt:   { width: COL_KOSONG.amount },

  // ── Totals row ────────────────────────────────────────────────────────────
  totalsRow: {
    flexDirection:  "row",
    justifyContent: "flex-end",
  },
  totLabel: {
    width:         82,
    height:        ROW_H_TOT,
    paddingTop:    7,
    paddingRight:  6,
    textAlign:     "right",
    fontFamily:    "Helvetica-Bold",
    fontSize:      9,
  },
  totValue: {
    width:             118,
    height:            ROW_H_TOT,
    borderRightWidth:  0.75,
    borderBottomWidth: 0.75,
    borderLeftWidth:   0.75,
    borderColor:       "#000",
    paddingTop:        7,
    paddingRight:      5,
    textAlign:         "right",
    fontFamily:        "Helvetica-Bold",
    fontSize:          9,
  },

  // ── Signature section ─────────────────────────────────────────────────────
  sigRow: {
    flexDirection:    "row",
    justifyContent:   "space-between",
    paddingHorizontal: 2,
    marginTop:         10,
    fontSize:          9,
  },
  sigName: { marginTop: 60 },
  noteText: {
    marginTop:  18,
    width:      170,
    textAlign:  "center",
    fontSize:   9,
  },
  warnBox: {
    marginTop:   8,
    borderWidth: 0.75,
    borderColor: "#b91c1c",
    padding:     4,
    width:       108,
    textAlign:   "center",
    fontSize:    6,
  },

  // ── Watermark (Amanah) ────────────────────────────────────────────────────
  watermark: {
    position:    "absolute",
    top:         290,
    left:        128,
    width:       218,
    height:      108,
    opacity:     0.25,
    objectFit:   "contain",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // CBB Faktur — A4 Portrait
  // ══════════════════════════════════════════════════════════════════════════
  cbbPage: {
    padding:    0,
    fontFamily: "Helvetica",
    fontSize:   7.5,
    color:      "#000",
  },
  cbbContent: {
    paddingHorizontal: CBB_PAGE_PAD_H,
    paddingTop:        4,
  },

  // Header
  cbbHeader: {
    flexDirection:  "row",
    justifyContent: "space-between",
    height:         106,
  },
  cbbLogoZone: { width: 360 },
  cbbLogo:     { width: 112, height: 38, objectFit: "contain" },
  cbbCoName:   { fontFamily: "Helvetica-Bold", fontSize: 12, marginTop: 3 },
  cbbAddr:     { fontSize: 7.5, lineHeight: 1.35 },

  cbbDateZone: {
    width:      195,
    paddingTop: 52,
  },
  cbbDateRow: {
    flexDirection: "row",
    gap:           8,
    fontFamily:    "Helvetica-Bold",
  },

  // Title
  cbbTitle: {
    textAlign:     "center",
    fontSize:      13,
    fontFamily:    "Helvetica-Bold",
    paddingVertical: 10,
  },

  // Customer block
  cbbCustZone: {
    borderBottomWidth: 1,
    borderColor:       "#000",
    paddingTop:        2,
    paddingLeft:       2,
    paddingBottom:     6,
    marginBottom:      3,
  },
  cbbCustTitle:  { fontFamily: "Helvetica-Bold", fontSize: 8, marginBottom: 5 },
  cbbCustRow:    { flexDirection: "row", marginBottom: 2 },
  cbbCustLabel:  { width: 56, fontFamily: "Helvetica-Bold" },
  cbbCustSep:    { width: 12 },
  cbbCustVal:    { flex: 1 },

  // Table shell
  cbbTable: {
    borderTopWidth:  0.75,
    borderLeftWidth: 0.75,
    borderColor:     "#000",
  },

  // Table rows
  cbbTRow: {
    flexDirection: "row",
    height:        18,
  },
  cbbTHead: {
    flexDirection:   "row",
    height:          28,
    backgroundColor: "#f1f5f9",
  },

  // Table cells
  cbbCell: {
    borderRightWidth:  0.75,
    borderBottomWidth: 0.75,
    borderColor:       "#000",
    paddingHorizontal: 3,
    paddingVertical:   2,
    justifyContent:    "center",
    overflow:          "hidden",
  },
  cbbHeadText: { fontFamily: "Helvetica-Bold", textAlign: "center", fontSize: 8 },

  // CBB column widths (sum = CBB_CONTENT_W = 555 pt)
  ccNo:    { width: COL_CBB.no   },
  ccName:  { width: COL_CBB.name },
  ccQty:   { width: COL_CBB.qty,    textAlign: "right" },
  ccPrice: { width: COL_CBB.price,  textAlign: "right" },
  ccAmt:   { width: COL_CBB.amount, textAlign: "right" },

  // CBB total rows
  cbbTotRow: {
    flexDirection:  "row",
    justifyContent: "flex-end",
  },
  cbbTotLabel: {
    width:             COL_CBB.price,
    borderLeftWidth:   0.75,
    borderBottomWidth: 0.75,
    borderColor:       "#000",
    paddingHorizontal: 4,
    paddingVertical:   3,
    textAlign:         "right",
  },
  cbbTotValue: {
    width:             COL_CBB.amount,
    borderLeftWidth:   0.75,
    borderRightWidth:  0.75,
    borderBottomWidth: 0.75,
    borderColor:       "#000",
    paddingHorizontal: 4,
    paddingVertical:   3,
    textAlign:         "right",
  },

  // CBB footer
  cbbFooter: {
    flexDirection: "row",
    marginTop:     6,
    gap:           0,
  },
  cbbBankBox: {
    width:            300,
    borderTopWidth:   1,
    borderBottomWidth: 1,
    borderColor:      "#000",
    minHeight:        64,
    padding:          5,
  },
  cbbBankTitle: { fontFamily: "Helvetica-Bold", fontSize: 8, marginBottom: 4 },
  cbbBankRow:   { flexDirection: "row", marginBottom: 2 },
  cbbBankLabel: { width: 100, fontFamily: "Helvetica-Bold" },
  cbbBankVal:   { flex: 1 },

  cbbSign: {
    flex:       1,
    textAlign:  "center",
    paddingTop: 10,
    lineHeight: 1.5,
  },

  // Terbilang
  cbbTerbBox: {
    width:             300,
    borderBottomWidth: 1,
    borderColor:       "#000",
    minHeight:         50,
    padding:           5,
    marginTop:         4,
  },
  cbbTerbTitle: { fontFamily: "Helvetica-Bold", fontSize: 8, marginBottom: 3 },
});

// ─── Header Components ────────────────────────────────────────────────────────

function HeaderMurah({ project, group }: { project: Project; group: NotaGroup }) {
  return (
    <View style={S.topHeader}>
      <View style={S.brandArea}>
        <Image src="/template-assets/tahap-1/murah-maju-1.png" style={S.murahLogo} />
        <Text style={S.murahAddr}>
          {"TERSEDIA BAHAN BANGUNAN,\nBESI, KAYU, KACA DLL.\nJl. Raya Hanyawar No.50\n(0263) 515261, 518114\nCibadak, Puncak - Cipanas\nJawa Barat"}
        </Text>
      </View>
      <View style={S.recipientArea}>
        <Text>
          {"Cibadak,        "}
          <Text style={S.underline}>{dateSlash(group.date)}</Text>
        </Text>
        <Text style={{ marginTop: 10, fontFamily: "Helvetica-Bold" }}>Kepada Yth. :</Text>
        <Text>KDKMP Desa {project.villageName}</Text>
        <Text>Kecamatan {project.districtName}</Text>
      </View>
    </View>
  );
}

function HeaderAmanah({ project, group }: { project: Project; group: NotaGroup }) {
  return (
    <View style={S.topHeader}>
      <View style={S.brandArea}>
        <Image src="/template-assets/tahap-1/amanah-1.png" style={S.amanahLogo} />
        <Text style={S.amanahAddr}>
          {"Menerima Pesanan :\nPasir Pasang, Cor, Split Giling, Brangkal Urug,\nTanah, Batu Pecah DLL"}
        </Text>
        <Text style={S.amanahSm}>
          {"Jl. Perintis Kemerdekaan (Jebrod) Cianjur\nHP. 0877 2128 8867 - 0857 2333 1903"}
        </Text>
      </View>
      <View style={S.recipientArea}>
        <Text>
          {"Cianjur        : "}
          <Text style={S.underline}>{dateSlash(group.date)}</Text>
        </Text>
        <Text style={{ marginTop: 8, fontFamily: "Helvetica-Bold" }}>Kepada Yth. :</Text>
        <Text style={{ marginTop: 28, borderBottomWidth: 0.75, borderColor: "#000" }}>
          KDKMP Desa {project.villageName}
        </Text>
        <Text style={{ borderBottomWidth: 0.75, borderColor: "#000" }}>
          Kecamatan {project.districtName}
        </Text>
      </View>
    </View>
  );
}

function HeaderPlain({ project, group }: { project: Project; group: NotaGroup }) {
  return (
    <View style={S.plainHeader}>
      <View style={{ width: "46%" }} />
      <View style={{ width: "54%", paddingTop: 4, fontSize: 13, lineHeight: 1.35 }}>
        <Text>{"Cianjur        : "}{dateSlash(group.date)}</Text>
        <Text style={{ fontFamily: "Times-Bold" }}>Kepada Yth.  :</Text>
        <Text>KDKMP Desa {project.villageName}</Text>
        <Text>Kecamatan {project.districtName}</Text>
      </View>
    </View>
  );
}

// ─── NotaBox (landscape half-page) ───────────────────────────────────────────

function NotaBox({
  project,
  vendor,
  group,
}: {
  project: Project;
  vendor:  Vendor;
  group?:  NotaGroup;
}) {
  // Empty right-hand slot when an odd number of groups exists
  if (!group) return <View style={S.nota} />;

  const variant  = getVariant(vendor.name);
  const isMurah  = variant === "murah";
  const isAmanah = variant === "amanah";
  const isMandau = variant === "mandau";
  const isKosong = variant === "kosong";

  const minRows  = isMurah ? MIN_ROWS_MURAH : MIN_ROWS_STD;
  const rows     = padRows(group, minRows);
  const total    = sumGroup(group);

  // Table shell / cell style based on variant
  const tableStyle = isMandau ? S.redTable : S.table;
  const cellStyle  = isMandau ? S.redCell  : S.cell;

  // Header row style
  const headRowStyle = isAmanah || isMurah ? S.tHead : S.tHeadPlain;

  return (
    <View style={S.nota}>
      <View style={S.inner}>
        {/* ── Header ──────────────────────────────────────────────────── */}
        {isMurah  && <HeaderMurah  project={project} group={group} />}
        {isAmanah && <HeaderAmanah project={project} group={group} />}
        {(isMandau || isKosong) && <HeaderPlain project={project} group={group} />}

        {/* ── NOTA NO. label ───────────────────────────────────────────── */}
        <Text style={S.notaLabel}>NOTA NO.</Text>

        {/* ── Watermark (Amanah only) ───────────────────────────────────── */}
        {isAmanah && (
          <Image
            src="/template-assets/tahap-1/amanah-2.png"
            style={S.watermark}
          />
        )}

        {/* ── Table ────────────────────────────────────────────────────── */}
        <View style={tableStyle}>

          {/* Header row */}
          <View style={headRowStyle}>
            {isMurah || isMandau ? (
              <>
                <Text style={[cellStyle, S.headText, S.mColQty]}>BANYAKNYA</Text>
                <Text style={[cellStyle, S.headText, S.mColName]}>NAMA BARANG</Text>
                <Text style={[cellStyle, S.headText, S.mColPrice]}>{"HARGA\nSATUAN"}</Text>
                <Text style={[cellStyle, S.headText, S.mColAmt]}>JUMLAH</Text>
              </>
            ) : isKosong ? (
              <>
                <Text style={[cellStyle, S.headText, S.kColName]}>NAMA BARANG</Text>
                <Text style={[cellStyle, S.headText, S.kColQty]}>QTY</Text>
                <Text style={[cellStyle, S.headText, S.kColUnit]}>SATUAN</Text>
                <Text style={[cellStyle, S.headText, S.kColPrice]}>HARGA</Text>
                <Text style={[cellStyle, S.headText, S.kColAmt]}>JUMLAH</Text>
              </>
            ) : (
              /* Amanah / standard */
              <>
                <Text style={[cellStyle, S.headText, S.colQty]}>BANYAKNYA</Text>
                <Text style={[cellStyle, S.headText, S.colUnit]}>SATUAN</Text>
                <Text style={[cellStyle, S.headText, S.colName]}>NAMA BARANG</Text>
                <Text style={[cellStyle, S.headText, S.colPrice]}>{"HARGA\nSATUAN"}</Text>
                <Text style={[cellStyle, S.headText, S.colAmt]}>JUMLAH</Text>
              </>
            )}
          </View>

          {/* Data rows */}
          {rows.map((item, idx) => {
            const has = Boolean(item.itemName);
            return (
              <View
                style={S.tRow}
                key={`${group.key}-${item.id}-${idx}`}
                wrap={false}
              >
                {isMurah || isMandau ? (
                  <>
                    <Text style={[cellStyle, S.tc, S.mColQty]}>
                      {has
                        ? `${nf.format(item.volume)}${isMandau ? ` ${item.unit}` : ""}`
                        : ""}
                    </Text>
                    <Text style={[cellStyle, S.mColName]}>{item.itemName}</Text>
                    <Text style={[cellStyle, S.tr, S.mColPrice]}>
                      {has ? nf.format(item.unitPrice) : ""}
                    </Text>
                    <Text style={[cellStyle, S.tr, S.mColAmt]}>
                      {has ? nf.format(getResumeItemAmount(item)) : ""}
                    </Text>
                  </>
                ) : isKosong ? (
                  <>
                    <Text style={[cellStyle, S.kColName]}>{item.itemName}</Text>
                    <Text style={[cellStyle, S.tc, S.kColQty]}>
                      {has ? nf.format(item.volume) : ""}
                    </Text>
                    <Text style={[cellStyle, S.tc, S.kColUnit]}>{has ? item.unit : ""}</Text>
                    <Text style={[cellStyle, S.tr, S.kColPrice]}>
                      {has ? nf.format(item.unitPrice) : ""}
                    </Text>
                    <Text style={[cellStyle, S.tr, S.kColAmt]}>
                      {has ? nf.format(getResumeItemAmount(item)) : ""}
                    </Text>
                  </>
                ) : (
                  /* Amanah / standard */
                  <>
                    <Text style={[cellStyle, S.tc, S.colQty]}>
                      {has ? nf.format(item.volume) : ""}
                    </Text>
                    <Text style={[cellStyle, S.tc, S.colUnit]}>{has ? item.unit : ""}</Text>
                    <Text style={[cellStyle, S.colName]}>{item.itemName}</Text>
                    <Text style={[cellStyle, S.tr, S.colPrice]}>
                      {has ? nf.format(item.unitPrice) : ""}
                    </Text>
                    <Text style={[cellStyle, S.tr, S.colAmt]}>
                      {has ? nf.format(getResumeItemAmount(item)) : ""}
                    </Text>
                  </>
                )}
              </View>
            );
          })}
        </View>

        {/* ── Totals ───────────────────────────────────────────────────── */}
        <View style={S.totalsRow}>
          <Text style={S.totLabel}>Jumlah RP.</Text>
          <Text style={S.totValue}>{nf.format(total)}</Text>
        </View>

        {/* Extra rows for Amanah: Bayar + Sisa */}
        {isAmanah && (
          <>
            <View style={S.totalsRow}>
              <Text style={S.totLabel}>Bayar RP.</Text>
              <Text style={S.totValue}>{nf.format(total)}</Text>
            </View>
            <View style={S.totalsRow}>
              <Text style={S.totLabel}>Sisa RP.</Text>
              <Text style={S.totValue}>-</Text>
            </View>
          </>
        )}

        {/* ── Signature ────────────────────────────────────────────────── */}
        <View style={S.sigRow}>
          <Text>
            {"Tanda terima,\n"}
            <Text style={S.sigName}>{"(...........................)"}</Text>
          </Text>

          {/* Centre note (Murah / Mandau) */}
          {isMurah && (
            <Text style={S.noteText}>
              {"NB : Barang2 yang telah dibeli\ntidak dapat dikembalikan"}
            </Text>
          )}
          {isMandau && (
            <Text style={S.warnBox}>
              {"Perhatian\nBarang Yang Sudah Dibeli\nTidak Dapat Dikembalikan"}
            </Text>
          )}

          <Text>
            {"Hormat Kami,\n"}
            <Text style={S.sigName}>{"(...........................)"}</Text>
          </Text>
        </View>
      </View>
    </View>
  );
}

// ─── CBB Faktur Page ──────────────────────────────────────────────────────────

function CbbPage({ project, group }: { project: Project; group: NotaGroup }) {
  const total = sumGroup(group);
  const rows  = padRows(group, MIN_ROWS_CBB);

  return (
    <Page size="A4" style={S.cbbPage}>
      <View style={S.cbbContent}>

        {/* Header */}
        <View style={S.cbbHeader}>
          <View style={S.cbbLogoZone}>
            <Image src="/template-assets/tahap-1/cbb-1.png" style={S.cbbLogo} />
            <Text style={S.cbbCoName}>CAHAYA BAJA BANGUNAN</Text>
            <Text style={S.cbbAddr}>
              {"Jl. TB Simatupang No.5, RT.5/RW.7, Ragunan, Ps. Minggu,\nKota Jakarta Selatan, Daerah Khusus Ibukota Jakarta 12550,\nJAKARTA SELATAN, DKI JAKARTA, 12550\nTelp: 0818130883\nEmail: henry.gouw13@gmail.com"}
            </Text>
          </View>
          <View style={S.cbbDateZone}>
            <View style={S.cbbDateRow}>
              <Text>TANGGAL</Text>
              <Text>:</Text>
              <Text>{dateSlash(group.date)}</Text>
            </View>
          </View>
        </View>

        {/* Title */}
        <Text style={S.cbbTitle}>FAKTUR</Text>

        {/* Customer */}
        <View style={S.cbbCustZone}>
          <Text style={S.cbbCustTitle}>PELANGGAN</Text>
          <View style={S.cbbCustRow}>
            <Text style={S.cbbCustLabel}>NAMA</Text>
            <Text style={S.cbbCustSep}>:</Text>
            <Text style={S.cbbCustVal}>PROJECT KDKMP CIANJUR</Text>
          </View>
          <View style={S.cbbCustRow}>
            <Text style={S.cbbCustLabel}>ALAMAT</Text>
            <Text style={S.cbbCustSep}>:</Text>
            <Text style={S.cbbCustVal}>Desa {project.villageName} Kec. {project.districtName}</Text>
          </View>
          <View style={S.cbbCustRow}>
            <Text style={S.cbbCustLabel}>TELP</Text>
            <Text style={S.cbbCustSep}>:</Text>
            <Text style={S.cbbCustVal} />
          </View>
        </View>

        {/* Table */}
        <View style={S.cbbTable}>

          {/* Header row */}
          <View style={S.cbbTHead}>
            <Text style={[S.cbbCell, S.cbbHeadText, S.ccNo]}>NO.</Text>
            <Text style={[S.cbbCell, S.cbbHeadText, S.ccName]}>KETERANGAN</Text>
            <Text style={[S.cbbCell, S.cbbHeadText, S.ccQty]}>QTY</Text>
            <Text style={[S.cbbCell, S.cbbHeadText, S.ccPrice]}>{"HARGA\nSATUAN (Rp.)"}</Text>
            <Text style={[S.cbbCell, S.cbbHeadText, S.ccAmt]}>JUMLAH (Rp.)</Text>
          </View>

          {/* Data rows */}
          {rows.map((item, idx) => {
            const has = Boolean(item.itemName);
            return (
              <View style={S.cbbTRow} key={`${group.key}-${item.id}-${idx}`} wrap={false}>
                <Text style={[S.cbbCell, S.ccNo]}>{has ? idx + 1 : ""}</Text>
                <Text style={[S.cbbCell, S.ccName]}>{item.itemName}</Text>
                <Text style={[S.cbbCell, S.ccQty]}>{has ? nf.format(item.volume) : ""}</Text>
                <Text style={[S.cbbCell, S.ccPrice]}>{has ? nf.format(item.unitPrice) : ""}</Text>
                <Text style={[S.cbbCell, S.ccAmt]}>
                  {has ? nf.format(getResumeItemAmount(item)) : ""}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Totals */}
        <View style={S.cbbTotRow}>
          <Text style={S.cbbTotLabel}>Subtotal</Text>
          <Text style={S.cbbTotValue}>{nf.format(total)},00</Text>
        </View>
        <View style={S.cbbTotRow}>
          <Text style={[S.cbbTotLabel, { fontFamily: "Helvetica-Bold" }]}>TOTAL</Text>
          <Text
            style={[
              S.cbbTotValue,
              { fontFamily: "Helvetica-Bold", backgroundColor: "#e2e8f0" },
            ]}
          >
            {nf.format(total)},00
          </Text>
        </View>
        <View style={S.cbbTotRow}>
          <Text style={S.cbbTotLabel}>SisaTagihan</Text>
          <Text style={S.cbbTotValue}>-</Text>
        </View>

        {/* Footer: Bank info + Signature */}
        <View style={S.cbbFooter}>
          <View style={S.cbbBankBox}>
            <Text style={S.cbbBankTitle}>DETAIL PEMBAYARAN</Text>
            <View style={S.cbbBankRow}>
              <Text style={S.cbbBankLabel}>NAMA BANK</Text>
              <Text style={S.cbbBankVal}>:  BANK RAKYAT INDONESIA</Text>
            </View>
            <View style={S.cbbBankRow}>
              <Text style={S.cbbBankLabel}>CABANG BANK</Text>
              <Text style={S.cbbBankVal}>:  JAKARTA</Text>
            </View>
            <View style={S.cbbBankRow}>
              <Text style={S.cbbBankLabel}>NOMOR AKUN BANK</Text>
              <Text style={S.cbbBankVal}>:  0428 0103 4860 509</Text>
            </View>
            <View style={S.cbbBankRow}>
              <Text style={S.cbbBankLabel}>ATAS NAMA</Text>
              <Text style={S.cbbBankVal}>:  HENRY</Text>
            </View>
          </View>
          <Text style={S.cbbSign}>
            {"Salam Sejahtera,\nPT Cahaya Baja Bangunan\n\n\n\nHENRY"}
          </Text>
        </View>

        {/* Terbilang */}
        <View style={S.cbbTerbBox}>
          <Text style={S.cbbTerbTitle}>TERBILANG</Text>
          <Text>
            {terbilangRupiah(total).replace(" Rupiah", " RUPIAH").toUpperCase()}
          </Text>
        </View>
      </View>
    </Page>
  );
}

// ─── Exported Document ────────────────────────────────────────────────────────

export function NotaDocument({
  project,
  vendor,
  items,
}: {
  project: Project;
  vendor:  Vendor;
  items:   ResumeItem[];
}) {
  const groups  = groupItems(items);
  const variant = getVariant(vendor.name);

  // CBB: each group → own A4 portrait page
  if (variant === "cbb") {
    return (
      <Document title={`Faktur ${vendor.name} - ${project.villageName}`}>
        {groups.map((g) => (
          <CbbPage key={g.key} project={project} group={g} />
        ))}
      </Document>
    );
  }

  // All other variants: 2 nota per landscape A4 page
  return (
    <Document title={`Nota ${vendor.name} - ${project.villageName}`}>
      {chunk(groups, 2).map((pair, pageIdx) => (
        <Page
          key={pageIdx}
          size="A4"
          orientation="landscape"
          style={S.pageLS}
        >
          <View style={S.pair}>
            <NotaBox project={project} vendor={vendor} group={pair[0]} />
            <NotaBox project={project} vendor={vendor} group={pair[1]} />
          </View>
        </Page>
      ))}
    </Document>
  );
}
