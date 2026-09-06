import type { Page } from "playwright";
import { normalizeBelanjaIsoDate, normalizeBelanjaNumber } from "../../src/lib/belanja-sync/payload";
import type { BelanjaTransactionKind } from "../../src/lib/belanja-sync/types";
import type { RunnerConfig } from "./config";
import { targetUrl } from "./config";

export type DetailLine = {
  index: number;
  name: string;
  qty?: number;
  unit?: string;
  unitPrice?: number;
  subtotal?: number;
  paymentDate?: string;
  recipient?: string;
};

export type TransactionSnapshot = {
  destination: string;
  stage: string;
  category: string;
  kind: string;
  date: string;
  lines: DetailLine[];
};

// Persisted HTML avoids loading assets and edit-page scripts for correct rows.
export async function readTransactionSnapshot(page: Page, config: RunnerConfig, href: string, kind: BelanjaTransactionKind) {
  const url = new URL(targetUrl(config, href));
  if (url.origin !== new URL(config.targetBaseUrl).origin || !/^\/belanja\/[^/]+\/edit$/.test(url.pathname)) {
    throw new Error("URL transaksi target tidak valid.");
  }
  const response = await page.context().request.get(url.toString(), {
    timeout: config.targetNavigationTimeoutMs,
    headers: { "Cache-Control": "no-cache" },
  });
  try {
    if ([401, 403, 419].includes(response.status()) || new URL(response.url()).pathname.includes("/login")) {
      throw new Error("Web Target session expired. Runner requires authentication.");
    }
    if (!response.ok()) throw new Error(`Pembacaan transaksi gagal: HTTP ${response.status()}.`);
    const html = await response.text();
    const raw = await page.evaluate<{
      destination: string; stage: string; category: string; kind: string; date: string;
      lines: Array<{ index: number; name: string; qty: string; people: string; unit: string; unitPrice: string; subtotal: string; paymentDate: string; recipient: string }>;
    }>(`(() => {
      const doc = new DOMParser().parseFromString(${JSON.stringify(html)}, 'text/html');
      if (doc.querySelector('input[type="password"]')) throw new Error('Web Target session expired. Runner requires authentication.');
      const selected = (id) => doc.querySelector('#' + id)?.selectedOptions?.[0]?.textContent?.trim() || '';
      const kind = ${JSON.stringify(kind)};
      const lines = Array.from(doc.querySelectorAll('#item-container .item-row')).map((row, index) => {
        const value = (name) => row.querySelector('[name="' + name + '"]')?.value ?? '';
        const nameKey = kind === 'honorarium' ? 'jenis_tukang[]' : kind === 'equipment' ? 'nama_alat[]' : 'nama_material[]';
        return { index,
          name: row.querySelector('[name="' + nameKey + '"]')?.selectedOptions?.[0]?.textContent?.trim() || '',
          qty: value(kind === 'honorarium' ? 'jumlah_hari[]' : kind === 'equipment' ? 'jumlah_durasi[]' : 'jumlah_material[]'),
          people: kind === 'honorarium' ? value('jumlah_orang[]') : '1',
          unit: value(kind === 'equipment' ? 'durasi[]' : 'satuan_material[]'),
          unitPrice: value(kind === 'honorarium' ? 'tarif_harian[]' : kind === 'equipment' ? 'tarif_sewa[]' : 'harga_material[]'),
          subtotal: value('subtotal[]'), paymentDate: value('tanggal_bayar[]'), recipient: value('nama_penyedia[]')
        };
      });
      return { destination: selected('gerai'), stage: selected('tahapan'), category: selected('item_pekerjaan'), kind: selected('kategori_belanja'), date: doc.querySelector('[name="tanggal"]')?.value || '', lines };
    })()`);
    if (!raw.destination || !raw.stage || !raw.category || !raw.kind || !raw.date || !raw.lines.length) {
      throw new Error("Snapshot transaksi target tidak lengkap; verifikasi dibatalkan.");
    }
    const decimal = (value: string) => {
      const parsed = Number(value.replace(",", "."));
      if (!value.trim() || !Number.isFinite(parsed)) throw new Error(`Qty target tidak valid: ${value}`);
      return parsed;
    };
    const money = (value: string) => {
      if (!/\d/.test(value)) throw new Error("Nominal target kosong/tidak valid.");
      return normalizeBelanjaNumber(value);
    };
    return { ...raw, date: normalizeBelanjaIsoDate(raw.date), lines: raw.lines.map((line): DetailLine => ({
      ...line, qty: decimal(line.qty) * decimal(line.people), unitPrice: money(line.unitPrice), subtotal: money(line.subtotal),
      paymentDate: normalizeBelanjaIsoDate(line.paymentDate),
    })) } satisfies TransactionSnapshot;
  } finally {
    await response.dispose();
  }
}
