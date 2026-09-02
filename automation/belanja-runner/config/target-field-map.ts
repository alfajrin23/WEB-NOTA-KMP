import type { BelanjaPayload } from "../../../src/lib/belanja-sync/types";

export type BelanjaFieldKey = keyof Pick<
  BelanjaPayload,
  "tanggal" | "namaItem" | "qty" | "satuan" | "hargaSatuan" | "jumlah" | "desa" | "kecamatan" | "kabupaten" | "kategori" | "keterangan"
>;

export type FieldCandidate = {
  labels?: string[];
  placeholders?: string[];
  names?: string[];
  ids?: string[];
  required?: boolean;
  valueType: "date" | "number" | "text";
};

export type TargetFieldMap = {
  login: {
    email: FieldCandidate;
    password: FieldCandidate;
    remember: FieldCandidate;
    submitTexts: string[];
  };
  belanjaUrlPath: string;
  belanjaCreateUrlPath: string;
  addButtonTexts: string[];
  submitButtonTexts: string[];
  successTexts: string[];
  categoryTexts: Record<"material" | "labor" | "equipment", string[]>;
  fields: Record<BelanjaFieldKey, FieldCandidate>;
};

// Login selectors were verified against http://10.21.21.10:9023/login on this PC.
// Belanja selectors were inspected against /belanja and /belanja/create.
// The target uses Choices.js around hidden <select> controls, so the runner has
// additional form helpers in target.ts for gerai/tahapan/item/kategori choices.
export const targetFieldMap: TargetFieldMap = {
  login: {
    email: {
      labels: ["email"],
      placeholders: ["Masukan email", "email"],
      names: ["email"],
      ids: ["email"],
      required: true,
      valueType: "text",
    },
    password: {
      labels: ["password"],
      placeholders: ["Masukan password", "password"],
      names: ["password"],
      ids: ["password-input", "password"],
      required: true,
      valueType: "text",
    },
    remember: {
      labels: ["remember me", "ingat saya"],
      names: ["remember"],
      ids: ["remember"],
      required: false,
      valueType: "text",
    },
    submitTexts: ["Login", "Masuk"],
  },
  belanjaUrlPath: "/belanja",
  belanjaCreateUrlPath: "/belanja/create",
  addButtonTexts: [
    "Tambah Belanja",
    "Tambah Pengeluaran",
    "Tambah Transaksi",
    "Tambah Data",
    "Input Belanja",
    "Input",
    "Tambah",
    "Buat Belanja",
    "Buat",
    "Create",
    "Add",
  ],
  submitButtonTexts: ["Simpan", "Submit", "Kirim", "Save"],
  successTexts: ["berhasil", "tersimpan", "success", "sukses"],
  categoryTexts: {
    material: ["Bahan / Material", "Material"],
    labor: ["Upah / Honorarium", "Upah"],
    equipment: ["Sewa Alat / Fasilitas", "Sewa"],
  },
  fields: {
    tanggal: {
      labels: ["tanggal", "tgl belanja", "tanggal belanja", "date"],
      placeholders: ["tanggal", "yyyy-mm-dd", "dd/mm/yyyy"],
      names: ["tanggal", "tgl_belanja", "tanggal_belanja", "date"],
      ids: ["tanggal", "tgl_belanja", "tanggal_belanja"],
      required: true,
      valueType: "date",
    },
    namaItem: {
      labels: ["nama barang", "nama item", "uraian", "material", "barang/jasa", "barang", "jenis upah", "nama alat"],
      placeholders: ["nama barang", "nama item", "uraian", "material"],
      names: ["nama_material[]", "jenis_tukang[]", "nama_alat[]", "nama_barang", "nama_item", "uraian", "item_name", "material"],
      ids: ["nama_material", "jenis_tukang", "nama_alat", "nama_barang", "nama_item", "uraian", "item_name", "material"],
      required: true,
      valueType: "text",
    },
    qty: {
      labels: ["qty", "volume", "jumlah barang", "kuantitas", "jumlah orang", "jumlah alat", "jumlah durasi"],
      placeholders: ["qty", "volume"],
      names: ["jumlah_material[]", "jumlah_orang[]", "jumlah_alat[]", "jumlah_durasi[]", "qty", "volume", "kuantitas"],
      ids: ["qty", "volume", "kuantitas"],
      required: true,
      valueType: "number",
    },
    satuan: {
      labels: ["satuan", "unit", "durasi"],
      placeholders: ["satuan", "unit"],
      names: ["satuan_material[]", "durasi[]", "satuan", "unit"],
      ids: ["satuan", "unit"],
      required: true,
      valueType: "text",
    },
    hargaSatuan: {
      labels: ["harga satuan", "harga", "harga/unit", "unit price", "tarif harian", "tarif sewa"],
      placeholders: ["harga satuan", "harga"],
      names: ["harga_material[]", "tarif_harian[]", "tarif_sewa[]", "harga_satuan", "harga", "unit_price"],
      ids: ["harga_satuan", "harga", "unit_price"],
      required: true,
      valueType: "number",
    },
    jumlah: {
      labels: ["jumlah", "subtotal", "total"],
      placeholders: ["jumlah", "subtotal", "total"],
      names: ["subtotal[]", "jumlah", "subtotal", "total", "grand_total"],
      ids: ["grand-total", "jumlah", "subtotal", "total"],
      required: true,
      valueType: "number",
    },
    desa: {
      labels: ["desa", "kelurahan", "wilayah"],
      placeholders: ["desa", "kelurahan"],
      names: ["desa", "nama_desa", "village"],
      ids: ["desa", "nama_desa", "village"],
      required: false,
      valueType: "text",
    },
    kecamatan: {
      labels: ["kecamatan"],
      placeholders: ["kecamatan"],
      names: ["kecamatan", "district"],
      ids: ["kecamatan", "district"],
      required: false,
      valueType: "text",
    },
    kabupaten: {
      labels: ["kabupaten", "kota"],
      placeholders: ["kabupaten", "kota"],
      names: ["kabupaten", "regency"],
      ids: ["kabupaten", "regency"],
      required: false,
      valueType: "text",
    },
    kategori: {
      labels: ["kategori", "jenis belanja", "jenis"],
      placeholders: ["kategori", "jenis"],
      names: ["kategori", "category", "jenis"],
      ids: ["kategori", "category", "jenis"],
      required: false,
      valueType: "text",
    },
    keterangan: {
      labels: ["keterangan", "catatan", "notes"],
      placeholders: ["keterangan", "catatan"],
      names: ["keterangan", "catatan", "notes"],
      ids: ["keterangan", "catatan", "notes"],
      required: false,
      valueType: "text",
    },
  },
};
