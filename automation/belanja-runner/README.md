# Belanja Runner

Runner ini berjalan lokal di PC Windows yang terhubung VPN. WEB-NOTA-KMP tetap menjadi UI, queue, dan monitoring; Playwright tidak berjalan dari Vercel Serverless Function.

## Env lokal runner

Isi `.env.belanja.local` dari contoh `.env.belanja.example`. Runner membaca file `.env.belanja.local` / `.env.belanja`, membutuhkan `RUNNER_TOKEN`, dan tidak membutuhkan `SUPABASE_SERVICE_ROLE_KEY`.

Token runner dibuat dari halaman `Settings -> Playwright Runners`. Server WEB-NOTA-KMP membutuhkan `SUPABASE_SERVICE_ROLE_KEY`, tetapi tidak membutuhkan token runner global lagi. Plaintext token hanya muncul satu kali saat dibuat; database hanya menyimpan SHA-256 token.

```env
WEB_NOTA_API_URL=https://web-nota-kmp-woad.vercel.app
RUNNER_TOKEN=kmp_runner_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TARGET_BASE_URL=http://10.21.21.10:9023
TARGET_HEALTH_PATH=/login
TARGET_CHECK_TIMEOUT_MS=3000
BELANJA_TARGET_NAVIGATION_TIMEOUT_MS=60000
TARGET_DASHBOARD_PATH=/home
TARGET_BELANJA_URL_PATH=/belanja
TARGET_BELANJA_CREATE_URL_PATH=/belanja/create
BELANJA_RUNNER_POLL_MS=1000
BELANJA_TARGET_CHECK_INTERVAL_MS=45000
BELANJA_TARGET_DISCONNECT_AFTER_FAILURES=8
BELANJA_RUNNER_HEARTBEAT_MS=15000
BELANJA_RUNNER_STATUS_LOG_MS=15000
BELANJA_API_REQUEST_TIMEOUT_MS=15000
BELANJA_API_REQUEST_RETRIES=4
BELANJA_SUBMIT_SUCCESS_WAIT_MS=2000
BELANJA_COPY_SUCCESS_WAIT_MS=5000
BELANJA_BASE_TRANSACTION_COUNT=43
BELANJA_FAST_UI_TIMEOUT_MS=1200
BELANJA_CHOICE_SEARCH_TIMEOUT_MS=2000
BELANJA_CHOICE_SETTLE_MS=50
```

`BELANJA_RUNNER_TOKEN` dan `NOTA_KMP_BASE_URL` masih dibaca sebagai alias lama untuk transisi, tetapi runner baru sebaiknya memakai `RUNNER_TOKEN` dan `WEB_NOTA_API_URL`.

Runner default login fresh memakai `TARGET_EMAIL/TARGET_PASSWORD`. Ini mencegah PC lain memakai session cache lama dari akun/role berbeda. Jika benar-benar ingin memakai cache login lama, set `BELANJA_REUSE_AUTH_STATE=true`.

## Flow copy/reconcile

Fitur `Resume Editor -> Kirim ke Web Belanja` sekarang memakai operasi `copy_reconcile_v1`.

1. WEB NOTA membuat job berisi 43 transaksi logical dari Resume tujuan.
2. Runner membuka `/belanja`, memilih source template `Maleber / Karangtengah / Cianjur / Jawa Barat`, lalu mengubah entries menjadi `100`.
3. Runner menghitung transaksi source. Jika bukan `BELANJA_BASE_TRANSACTION_COUNT` (default 43), copy dibatalkan.
4. Runner memilih semua checkbox transaksi source, membuka modal `Salin ke KDKMP Lain`, memilih KDKMP tujuan berdasarkan hierarchy project, dan mencentang dua konfirmasi.
5. Dalam dry-run, runner berhenti sebelum klik `Salin Transaksi` dan menulis `DRY_RUN_OK`.
6. Dalam live mode, runner klik `Salin Transaksi`, menunggu bukti sukses, lalu checkpoint `DESTINATION_COPIED`.
7. Setelah copy, runner membuka transaksi KDKMP tujuan, mencocokkan 43 transaksi secara deterministic memakai tahapan, kode item, kategori belanja, jenis transaksi, dan occurrence.
8. Material, honorarium, dan sewa alat direkonsiliasi pada tanggal, qty/jumlah hari, harga satuan/tarif, subtotal, tanggal bayar, dan penyedia/penerima jika ada.
9. Jika detail target lebih banyak dari Resume, runner menghapus detail ekstra yang tidak cocok. Jika detail target kurang, runner menambah baris dari lookup target dan memilih item yang cocok dengan Resume.
10. Untuk honorarium agregat seperti biaya operasional lapangan, runner mempertahankan breakdown template jika totalnya sama dengan Resume, lalu menyamakan tanggal dan subtotal.
11. Status sukses hanya dicatat setelah transaksi tersebut disimpan dan diverifikasi ulang.

Source template tetap:

```text
Jawa Barat / Cianjur / Karangtengah / Maleber
```

Destination selalu berasal dari metadata project WEB NOTA yang sedang dikirim. Jika destination sama dengan Maleber, tidak ditemukan, atau ambigu, proses berhenti sebelum copy.

## Checkpoint dan anti-duplikasi

Stage job disimpan di `belanja_sync_jobs.metadata_json.stage`:

```text
PRE_FLIGHT
SOURCE_OPENED
SOURCE_SELECTED
COPY_STARTED
COPY_CONFIRMED
DESTINATION_COPIED
RECONCILING
VERIFYING
COMPLETED
FAILED
```

Jika runner crash setelah `DESTINATION_COPIED`, claim berikutnya melanjutkan ke `RECONCILING` dan tidak mengulang copy Maleber. Idempotency job memakai `projectId`, destination KDKMP, hash resume, dan operation type. Jalankan migration `supabase/migrations/20260905_belanja_copy_reconcile.sql` agar active job dengan idempotency sama tidak bisa dibuat dobel.

Satu project hanya boleh punya satu job copy/reconcile aktif. Jika job aktif masih ada, UI akan menampilkan job tersebut alih-alih membuat copy baru.

## Target disconnected

Status target `disconnected` berarti PC runner belum bisa membuka aplikasi target dari nilai `TARGET_BASE_URL`, bukan berarti token runner ditolak. Jalankan:

```bash
npm run belanja:check
```

Output `targetCheck` akan menampilkan URL yang dicek, HTTP status jika server merespons, atau alasan gagal seperti `timeout` / `network_error`. Di PC lain, pastikan:

1. VPN atau jaringan kantor yang bisa membuka `TARGET_BASE_URL` sudah aktif.
2. `TARGET_BASE_URL` bisa dibuka manual dari browser PC itu.
3. Port target, misalnya `9023`, tidak diblokir firewall.
4. Jika halaman health/login berbeda, ubah `TARGET_HEALTH_PATH`, misalnya `/`, `/login`, atau path yang selalu merespons.
5. Jika runner membuka 404 seperti `/belanja`, cek path Belanja yang benar dari menu target lalu isi `TARGET_BELANJA_URL_PATH` atau `TARGET_BELANJA_CREATE_URL_PATH`.
6. Jika nama user/role di Chrome bukan akun yang diisi di `.env.belanja.local`, hapus `automation/belanja-runner/.auth/belanja.json` atau pastikan `BELANJA_REUSE_AUTH_STATE=false`.
7. Setiap PC memakai token sendiri dari `Settings -> Playwright Runners`.

Runner tidak lagi menjalankan health-check sebelum setiap item. Setelah target pernah reachable, runner mengecek ulang target secara periodik lewat `BELANJA_TARGET_CHECK_INTERVAL_MS` dan baru menampilkan `disconnected` setelah `BELANJA_TARGET_DISCONNECT_AFTER_FAILURES` kegagalan beruntun. Default sekarang memberi toleransi sekitar 6 menit untuk putus sesaat, dan request runner ke WEB NOTA otomatis retry lewat `BELANJA_API_REQUEST_RETRIES`. Ini mengurangi putus-nyambung singkat yang sebelumnya memotong waktu pengiriman item.

Saat runner sedang memproses copy/reconcile yang lama, runner tetap mengirim busy heartbeat di background tiap `BELANJA_RUNNER_HEARTBEAT_MS` supaya Web Nota tidak menampilkan runner offline hanya karena Playwright sedang scan/edit halaman target. Web Nota menganggap heartbeat masih online selama 120 detik; jika lebih lama dari itu tidak ada heartbeat, biasanya proses runner mati, laptop sleep, koneksi internet/VPN putus, atau API Vercel/Supabase tidak bisa diakses dari PC runner.

Pada final verification, Playwright membaca ulang tabel destination, menolak transaksi exact duplicate, menghitung total target, lalu membandingkannya dengan total Web Nota. Jika masih selisih dan baris target bisa dicocokkan 1:1, runner otomatis membuka transaksi kandidat pada tahap selisih, mengisi ulang qty, satuan, harga satuan/tarif, subtotal, tanggal bayar, dan penerima dari Web Nota, submit, refresh daftar, lalu verify ulang. Material diprioritaskan karena paling sering berubah antar desa. Jika selisih disebabkan jumlah baris kurang/lebih, duplicate exact, atau mapping transaksi ambigu, runner berhenti dengan laporan dan screenshot karena kasus itu tidak aman diselesaikan dengan edit field biasa.

`BELANJA_TARGET_NAVIGATION_TIMEOUT_MS` mengatur batas tunggu buka halaman login/list/edit target. Default 60000 ms agar runner lebih tahan saat Web Belanja atau VPN sedang lambat. `BELANJA_SUBMIT_SUCCESS_WAIT_MS` mengatur batas tunggu teks sukses setelah klik simpan. Runner tidak lagi menunggu `networkidle` panjang; begitu teks sukses terlihat, runner langsung menutup modal OK/Oke jika ada dan lanjut ke item berikutnya. Untuk mode cepat, `BELANJA_FAST_UI_TIMEOUT_MS`, `BELANJA_CHOICE_SEARCH_TIMEOUT_MS`, dan `BELANJA_CHOICE_SETTLE_MS` memang dibuat pendek agar proses input sampai modal sukses terasa responsif.

`BELANJA_COPY_SUCCESS_WAIT_MS` mengatur batas tunggu bukti sukses setelah klik `Salin Transaksi`. Runner tidak melakukan retry otomatis pada copy jika bukti sukses tidak terlihat, karena operasi copy tidak aman untuk diulang tanpa pemeriksaan manual.

## Membuat atau revoke runner

1. Buka `Settings -> Playwright Runners`.
2. Klik `Create Runner Token`.
3. Isi nama laptop/device dan expiry jika diperlukan.
4. Copy token yang muncul sekali.
5. Simpan token ke `.env.belanja.local` di komputer runner.
6. Jalankan ulang runner.

Untuk mencabut akses laptop lama, klik `Revoke` pada runner tersebut. Request berikutnya dari token itu akan mendapat `401 Unauthorized`.

## Perintah

```bash
npm run belanja:check
npm run belanja:inspect
npm run belanja:runner
```

`BELANJA_DRY_RUN=true` adalah default aman untuk heartbeat runner dan job lama yang tidak membawa flag mode. Job yang dibuat dari UI tetap menentukan mode sendiri: checkbox Dry Run aktif berarti simulasi, checkbox dimatikan berarti LIVE. Mapping `/belanja` diverifikasi sekali melalui dry run yang berhasil dan buktinya disimpan di antrean Supabase, sehingga runner di PC lain tidak perlu mengisi flag verifikasi ulang. `BELANJA_FIELD_MAP_VERIFIED=true` tetap dapat dipakai sebagai override lokal setelah mapping diperiksa manual.

`BELANJA_FIELD_MAP_VERIFIED` adalah env runner lokal, bukan env Vercel. Jangan menaruh username/password target atau token runner di repository maupun env client/browser. Vercel hanya menyediakan API queue; Playwright tetap berjalan pada PC runner yang terhubung ke VPN.

## Setup PC runner baru

1. Clone/pull repo.
2. Jalankan `npm install`.
3. Jalankan `npx playwright install chromium` jika browser Playwright belum ada.
4. Buat token di `Settings -> Playwright Runners`.
5. Copy `.env.belanja.example` menjadi `.env.belanja.local`, lalu isi `WEB_NOTA_API_URL`, `RUNNER_TOKEN`, `TARGET_EMAIL`, `TARGET_PASSWORD`, dan `TARGET_BASE_URL`.
6. Sambungkan VPN/private network target.
7. Jalankan `npm run belanja:check`.
8. Jalankan `npm run belanja:runner`.

Untuk local development, pakai `WEB_NOTA_API_URL=http://localhost:3000` dan jalankan `npm run dev` di terminal WEB NOTA. Untuk production, pakai URL Vercel production.

## Troubleshooting copy/reconcile

### Pemeriksaan Transaksi Existing

```bash
npm run belanja:compare -- --job=<UUID-job>
```

Perintah ini hanya membaca destination job yang sudah ada. Tidak melakukan copy,
save, atau mengubah resume. Laporan tersimpan di folder `artifacts/compare-*.json`.
Runner membaca ringkasan tabel dan detail tersimpan lewat sesi Playwright, lalu
membandingkan qty, harga, subtotal, tanggal, penerima, jumlah baris, dan signature
per tahap. Form hanya dibuka jika field atau total transaksi berbeda. Total tahap
yang sama belum cukup untuk melewati pemeriksaan signature.

Sebelum save, runner menghitung ulang `grand_total` form target. Setelah save,
runner membaca kembali data dari server. Penerima upah/lembur mengikuti jabatan
Mandor, Kepala Tukang, Tukang, atau Kuli/Kenek. Setiap tahap yang diedit diperiksa
ulang. Job baru berstatus selesai setelah total tabel dan semua detail cocok,
termasuk selisih satu rupiah. Retry edit dibatasi dua kali.

Gunakan Retry Failed untuk melanjutkan job terputus. Transaksi existing dicek ulang
dan yang sudah sesuai dilewati. Jangan mengosongkan destination atau membuat copy
baru untuk memperbaiki selisih. Untuk production, isi `WEB_NOTA_API_URL` dengan URL
deployment; PC runner hanya memerlukan akses API tersebut dan VPN target.

- `Runner lokal belum online`: runner belum mengirim heartbeat valid; jalankan `npm run belanja:runner`.
- `Runner tidak dapat mengakses Web Belanja`: VPN, `TARGET_BASE_URL`, atau login target bermasalah; cek `npm run belanja:check`.
- `Expected transaksi Maleber: 43`: source template tidak sesuai expected count; jangan lanjut live sebelum target/template dikonfirmasi.
- `KDKMP tujuan ... tidak ditemukan`: metadata project tidak cocok dengan opsi target. Periksa desa, kecamatan, kabupaten, dan provinsi.
- `KDKMP tujuan ... ambigu`: target punya lebih dari satu opsi exact match; periksa data target sebelum live.
- `Mapping Web Belanja belum diverifikasi`: jalankan dry-run sampai `DRY_RUN_OK` atau set `BELANJA_FIELD_MAP_VERIFIED=true` hanya pada runner yang sudah dicek.
- `Bukti copy berhasil tidak ditemukan`: jangan langsung retry live; cek target manual apakah copy sudah terjadi.
