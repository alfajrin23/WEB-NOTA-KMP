import assert from "node:assert/strict";
import test from "node:test";

import {
  buildJasaElectricNotaGroups,
  paginateJasaElectricNotaGroups,
} from "../src/lib/jasa-electric-groups.ts";
import { layoutKwitansiPurposeLines } from "../src/lib/kwitansi-purpose-layout.ts";
import {
  getTwoUpVendorDocumentGroup,
  getTwoUpVendorBatchKey,
  isTwoUpVendorNota,
  paginateNotasByVendor,
} from "../src/lib/nota-pagination.ts";

function nota(id, vendorKey = "vendor-a") {
  return { id, vendorKey };
}

function pageIds(pages) {
  return pages.map((page) => page.notas.map((entry) => entry.id));
}

for (const [count, expected] of [
  [1, [["A1"]]],
  [2, [["A1", "A2"]]],
  [3, [["A1", "A2"], ["A3"]]],
  [5, [["A1", "A2"], ["A3", "A4"], ["A5"]]],
]) {
  test(`pagination ${count} generated nota tidak menambah unused slot`, () => {
    const source = Array.from({ length: count }, (_, index) => nota(`A${index + 1}`));
    const pages = paginateNotasByVendor(source, (entry) => entry.vendorKey, 2);

    assert.deepEqual(pageIds(pages), expected);
    assert.equal(pages.flatMap((page) => page.notas).length, count);
  });
}

test("vendor dikelompokkan sebelum pagination dan urutan tiap vendor tetap stabil", () => {
  const source = [
    nota("A1"),
    nota("B1", "vendor-b"),
    nota("A2"),
    nota("B2", "vendor-b"),
    nota("A3"),
  ];
  const pages = paginateNotasByVendor(source, (entry) => entry.vendorKey, 2);

  assert.deepEqual(pageIds(pages), [["A1", "A2"], ["A3"], ["B1", "B2"]]);
  assert.deepEqual(pages.map((page) => page.vendorKey), ["vendor-a", "vendor-a", "vendor-b"]);
});

test("Template Nota Kosong yang sengaja diminta tetap dirender satu kali", () => {
  const intentionalTemplate = nota("intentional-template", "vendor-internal");
  const pages = paginateNotasByVendor([intentionalTemplate], (entry) => entry.vendorKey, 2);

  assert.deepEqual(pageIds(pages), [["intentional-template"]]);
});

test("dokumen produksi vendor dan template dua-up yang sama memakai batch key yang sama", () => {
  const makeDoc = (id, vendorId, templateId, stageCode = "TAHAP_I", items = [{ id: `${id}-item` }]) => ({
    id,
    projectId: "project-a",
    documentType: "nota",
    vendorId,
    stageCode,
    templateId,
    items,
  });
  const first = makeDoc("A1", "vendor-a", "template-nota-kosong");
  const second = makeDoc("A2", "vendor-a", "template-nota-kosong");
  const otherVendor = makeDoc("B1", "vendor-b", "template-nota-kosong");
  const otherStage = makeDoc("A3", "vendor-a", "template-nota-kosong", "TAHAP_II");
  const cbs = makeDoc("CBS1", "vendor-cbs", "template-cbs", "TAHAP_II");
  const intentionalBlank = makeDoc("blank", "vendor-a", "template-nota-kosong", "TAHAP_I", []);

  assert.equal(getTwoUpVendorBatchKey(first), getTwoUpVendorBatchKey(second));
  assert.notEqual(getTwoUpVendorBatchKey(first), getTwoUpVendorBatchKey(otherVendor));
  assert.notEqual(getTwoUpVendorBatchKey(first), getTwoUpVendorBatchKey(otherStage));
  assert.equal(isTwoUpVendorNota(cbs), true);
  assert.equal(getTwoUpVendorBatchKey(intentionalBlank), null);
  assert.equal(isTwoUpVendorNota(intentionalBlank), false);
});

function jasaItem(transaction, index, amount = index + 1, options = {}) {
  return {
    id: `${transaction}-${index}`,
    stageCode: "TAHAP_V",
    expenseDate: options.expenseDate ?? "2026-03-06",
    categoryCode: transaction,
    categoryName: `Transaction ${transaction}`,
    category: `Transaction ${transaction}`,
    sortOrder: index,
    amount,
  };
}

function jasaGroups(items, maxRows = 14) {
  return buildJasaElectricNotaGroups(items, maxRows, (item) => item.amount);
}

test("Jasa Elektrik dua nota mempertahankan item, subtotal, dan grand total hanya di split terakhir", () => {
  const items = Array.from({ length: 28 }, (_, index) => jasaItem("TX-A", index + 1, 1000 + index));
  const groups = jasaGroups(items);
  const expectedTotal = items.reduce((sum, item) => sum + item.amount, 0);

  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.items.length), [14, 14]);
  assert.deepEqual(groups.flatMap((group) => group.items.map((item) => item.id)), items.map((item) => item.id));
  assert.equal(groups[0].chunkSubtotal, items.slice(0, 14).reduce((sum, item) => sum + item.amount, 0));
  assert.equal(groups[1].chunkSubtotal, items.slice(14).reduce((sum, item) => sum + item.amount, 0));
  assert.ok(groups.every((group) => group.transactionTotal === expectedTotal));
  assert.deepEqual(groups.map((group) => group.isLastSplitNota), [false, true]);
});

test("Jasa Elektrik tiga nota menampilkan penanda grand total hanya di nota ketiga", () => {
  const items = Array.from({ length: 29 }, (_, index) => jasaItem("TX-A", index + 1, 500));
  const groups = jasaGroups(items);

  assert.deepEqual(groups.map((group) => group.items.length), [14, 14, 1]);
  assert.deepEqual(groups.map((group) => group.isLastSplitNota), [false, false, true]);
  assert.equal(groups.filter((group) => group.isLastSplitNota).length, 1);
  assert.equal(groups[2].transactionTotal, 14_500);
});

test("dua transaksi Jasa Elektrik pada vendor sama tidak saling menjumlahkan", () => {
  const transactionA = [jasaItem("TX-A", 1, 1_000), jasaItem("TX-A", 2, 2_000)];
  const transactionB = [
    jasaItem("TX-B", 3, 10_000, { expenseDate: "2026-03-07" }),
    jasaItem("TX-B", 4, 20_000, { expenseDate: "2026-03-07" }),
  ];
  const groups = jasaGroups([...transactionA, ...transactionB], 1);
  const totals = new Map(groups.map((group) => [group.transactionKey, group.transactionTotal]));

  assert.deepEqual([...totals.values()], [3_000, 30_000]);
  assert.equal(groups.filter((group) => group.isLastSplitNota).length, 2);
});

test("satu transaksi Jasa Elektrik lintas kategori memakai grand total tanggal belanja", () => {
  const categoryOne = Array.from({ length: 5 }, (_, index) => jasaItem("V.01", index + 1, 1_000));
  const categoryTwo = Array.from({ length: 15 }, (_, index) => jasaItem("V.02", index + 6, 2_000));
  const items = [...categoryOne, ...categoryTwo];
  const groups = jasaGroups(items);

  assert.deepEqual(groups.map((group) => group.items.length), [14, 6]);
  assert.ok(groups.every((group) => group.transactionTotal === 35_000));
  assert.deepEqual(groups.map((group) => group.isLastSplitNota), [false, true]);
});

test("Jasa Elektrik satu nota memakai total normal tanpa duplikasi grand total", () => {
  const groups = jasaGroups([jasaItem("TX-A", 1, 3_000), jasaItem("TX-A", 2, 2_000)]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].splitCount, 1);
  assert.equal(groups[0].chunkSubtotal, 5_000);
  assert.equal(groups[0].transactionTotal, 5_000);
});

test("Jasa Elektrik nota tunggal tetap dipasangkan walau ada transaksi gabungan di tengah", () => {
  const singleBefore = jasaItem("SINGLE-A", 1, 1_000, { expenseDate: "2026-03-01" });
  const splitItems = Array.from({ length: 28 }, (_, index) => jasaItem("SPLIT", index + 2, 2_000, { expenseDate: "2026-03-02" }));
  const singleAfter = jasaItem("SINGLE-B", 30, 3_000, { expenseDate: "2026-03-03" });
  const pages = paginateJasaElectricNotaGroups(jasaGroups([singleBefore, ...splitItems, singleAfter]), "vendor-jasa-elektrik", 2);

  assert.equal(pages.length, 2);
  assert.deepEqual(pages.map((page) => page.notas.length), [2, 2]);
  assert.deepEqual(
    pages.map((page) => page.notas.map((group) => group.transactionKey)),
    [
      ["TAHAP_V|2026-03-01", "TAHAP_V|2026-03-03"],
      ["TAHAP_V|2026-03-02", "TAHAP_V|2026-03-02"],
    ],
  );
});

test("kwitansi pendek tetap satu baris semantik", () => {
  assert.deepEqual(layoutKwitansiPurposeLines(["Pembayaran ATK"]), ["Pembayaran ATK"]);
});

test("kwitansi honor diprioritaskan menjadi dua baris yang sejajar", () => {
  assert.deepEqual(
    layoutKwitansiPurposeLines([
      "Pembayaran Honor lembur Kepala Tukang Tanggal 13/02/2026 s.d 09/03/2026",
      "Pembangunan KDKMP Ds. Sukasari Pekerjaan Tahap I",
    ]),
    [
      "Pembayaran Honor lembur Kepala Tukang",
      "Tanggal 13/02/2026 s.d 09/03/2026 - Pembangunan KDKMP Ds. Sukasari Pekerjaan Tahap I",
    ],
  );
});

test("kwitansi tiga baris input dirapikan tanpa membuang teks", () => {
  const lines = layoutKwitansiPurposeLines([
    "Pembayaran Honor Kepala Tukang",
    "Tanggal 13/02/2026 s.d 09/03/2026",
    "Pembangunan KDKMP Kel. Karangtengah Pekerjaan Tahap VII",
  ]);

  assert.equal(lines.length, 2);
  assert.ok(lines.join(" ").includes("Karangtengah"));
  assert.ok(lines.join(" ").includes("Tahap VII"));
});

test("kwitansi luar inti panjang dipaksa menjadi dua baris garis", () => {
  assert.deepEqual(
    layoutKwitansiPurposeLines([
      "Pembayaran Uang Jalan / Pengawalan Lapangan Pembangunan KDKMP Ds. Sukasari pada tanggal 17/01/2026",
    ]),
    [
      "Pembayaran Uang Jalan / Pengawalan Lapangan",
      "Pembangunan KDKMP Ds. Sukasari pada tanggal 17/01/2026",
    ],
  );
});

test("deskripsi luar inti dengan frasa pada tanggal tidak dipotong secara janggal", () => {
  const source = "Pembayaran Pencarian dan Survei Kelayakan Lahan pada tanggal 13/02/2026";
  assert.deepEqual(layoutKwitansiPurposeLines([source]), [source]);
});

test("preview terpilih mengambil semua nota dua-up untuk vendor yang sama", () => {
  const makeDoc = (id, vendorId, notaDate) => ({
    id,
    projectId: "project-a",
    documentType: "nota",
    vendorId,
    templateId: "template-amanah",
    notaDate,
    items: [{ id: `${id}-item`, expenseDate: notaDate }],
  });
  const firstDate = makeDoc("vendor-a-date-1", "vendor-a", "2026-01-01");
  const secondDate = makeDoc("vendor-a-date-2", "vendor-a", "2026-01-02");
  const otherVendor = makeDoc("vendor-b-date-1", "vendor-b", "2026-01-01");

  assert.deepEqual(
    getTwoUpVendorDocumentGroup([firstDate, secondDate, otherVendor], firstDate).map((doc) => doc.id),
    ["vendor-a-date-1", "vendor-a-date-2"],
  );
  assert.deepEqual(
    paginateNotasByVendor([firstDate, secondDate], (doc) => doc.vendorId, 2).map((page) => page.notas.map((doc) => doc.notaDate)),
    [["2026-01-01", "2026-01-02"]],
  );
});
