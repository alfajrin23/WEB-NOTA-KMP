import { notaLeftPosition } from "@/constants/document-layout";

export type Stage1LayoutKey = "kwitansi" | "amanah" | "cbb" | "murahMaju" | "notaKosong" | "tbMandau";

export type Stage1Box = {
  x: string;
  y: string;
  width: string;
  height: string;
};

export type Stage1TableLayout = Stage1Box & {
  columns: string[];
  headerHeight: string;
  rowHeight: string;
  rows: number;
};

export type Stage1TemplateLayout = {
  label: string;
  orientation: "portrait" | "landscape";
  page: { width: string; height: string };
  notesPerPage: number;
  slots: Stage1Box[];
  table?: Stage1TableLayout;
};

export type KwitansiTemplateColor = "blue" | "green" | "pink";

/**
 * Koordinat template kwitansi dipusatkan di sini agar penggantian scan dasar
 * atau penyetelan posisi satu field tidak tersebar ke JSX/CSS.
 */
export const kwitansiTemplateLayout = {
  backgrounds: {
    blue: "/template-assets/tahap-1/kwitansi-1.jpeg",
    green: "/template-assets/tahap-1/kwitansi-2.jpeg",
    pink: "/template-assets/tahap-1/kwitansi-3.jpeg",
  } satisfies Record<KwitansiTemplateColor, string>,
  automaticColorOrder: ["blue", "green", "pink"] as const,
  fields: {
    number: { x: "42.8mm", y: "6.6mm", width: "25mm", height: "5mm" },
    payer: { x: "67.7mm", y: "12.7mm", width: "94mm", height: "5mm" },
    amountWords: { x: "67.7mm", y: "20.1mm", width: "94mm", height: "5.5mm" },
    payment: { x: "67.7mm", y: "25.6mm", width: "101.5mm", height: "10.5mm" },
    note: { x: "67.7mm", y: "36.1mm", width: "39.5mm", height: "9mm" },
    project: { x: "108.2mm", y: "36.1mm", width: "54mm", height: "4.9mm" },
    role: { x: "108.2mm", y: "41mm", width: "54mm", height: "5mm" },
    amount: { x: "47.8mm", y: "56.1mm", width: "36mm", height: "6mm" },
    receiver: { x: "112.5mm", y: "63.1mm", width: "50mm", height: "5mm" },
  } satisfies Record<string, Stage1Box>,
} as const;

export const stage1TemplateLayouts: Record<Stage1LayoutKey, Stage1TemplateLayout> = {
  kwitansi: {
    label: "KWITANSI TAHAP 1",
    orientation: "portrait",
    page: { width: "210mm", height: "297mm" },
    notesPerPage: 4,
    slots: [
      { x: "20mm", y: "4.8mm", width: "170mm", height: "69.5mm" },
      { x: "20mm", y: "76.6mm", width: "170mm", height: "69.5mm" },
      { x: "20mm", y: "148.4mm", width: "170mm", height: "69.5mm" },
      { x: "20mm", y: "220.2mm", width: "170mm", height: "69.5mm" },
    ],
  },
  amanah: {
    label: "Template Amanah",
    orientation: "landscape",
    page: { width: "297mm", height: "210mm" },
    notesPerPage: 2,
    slots: [
      { x: notaLeftPosition(0), y: "6.8mm", width: "93.8mm", height: "160.8mm" },
      { x: notaLeftPosition(106.2), y: "6.8mm", width: "93.8mm", height: "160.8mm" },
    ],
    table: {
      x: "0mm",
      y: "33.9mm",
      width: "93.8mm",
      height: "101mm",
      columns: ["16.3mm", "11.1mm", "22.5mm", "14.8mm", "29.1mm"],
      headerHeight: "6.8mm",
      rowHeight: "6.72mm",
      rows: 14,
    },
  },
  cbb: {
    label: "Template Invoice CBB",
    orientation: "portrait",
    page: { width: "210mm", height: "297mm" },
    notesPerPage: 1,
    slots: [{ x: "17.1mm", y: "19mm", width: "171mm", height: "234mm" }],
    table: {
      x: "17.1mm",
      y: "108mm",
      width: "171mm",
      height: "85.8mm",
      columns: ["10.3mm", "90.2mm", "20.2mm", "22.2mm", "28.1mm"],
      headerHeight: "10.4mm",
      rowHeight: "5.38mm",
      rows: 14,
    },
  },
  murahMaju: {
    label: "Template Murah Maju",
    orientation: "landscape",
    page: { width: "297mm", height: "210mm" },
    notesPerPage: 2,
    slots: [
      { x: notaLeftPosition(0), y: "3mm", width: "96.8mm", height: "172.8mm" },
      { x: notaLeftPosition(110.6), y: "3mm", width: "96.8mm", height: "172.8mm" },
    ],
    table: {
      x: "0mm",
      y: "34.6mm",
      width: "96.8mm",
      height: "110.2mm",
      columns: ["22.4mm", "29.7mm", "15.9mm", "28.8mm"],
      headerHeight: "8.2mm",
      rowHeight: "7.29mm",
      rows: 14,
    },
  },
  notaKosong: {
    label: "Template Nota Kosong",
    orientation: "landscape",
    page: { width: "297mm", height: "210mm" },
    notesPerPage: 2,
    slots: [
      { x: notaLeftPosition(0), y: "1mm", width: "98.8mm", height: "132.2mm" },
      { x: notaLeftPosition(109.2), y: "1mm", width: "98.8mm", height: "132.2mm" },
    ],
    table: {
      x: "0mm",
      y: "13.9mm",
      width: "98.8mm",
      height: "90.8mm",
      columns: ["21.7mm", "18.7mm", "18.7mm", "16mm", "23.7mm"],
      headerHeight: "6.9mm",
      rowHeight: "5.99mm",
      rows: 14,
    },
  },
  tbMandau: {
    label: "Template TB Mandau",
    orientation: "landscape",
    page: { width: "297mm", height: "210mm" },
    notesPerPage: 2,
    slots: [
      { x: notaLeftPosition(0), y: "4.8mm", width: "95.1mm", height: "164mm" },
      { x: notaLeftPosition(108), y: "4.8mm", width: "98.6mm", height: "164mm" },
    ],
    table: {
      x: "0mm",
      y: "24.7mm",
      width: "95.1mm",
      height: "102.72mm",
      columns: ["19.9mm", "27.5mm", "19.5mm", "28.2mm"],
      headerHeight: "7.8mm",
      rowHeight: "6.78mm",
      rows: 14,
    },
  },
};
