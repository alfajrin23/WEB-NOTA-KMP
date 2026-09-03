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
BELANJA_FAST_UI_TIMEOUT_MS=1200
BELANJA_CHOICE_SEARCH_TIMEOUT_MS=2000
BELANJA_CHOICE_SETTLE_MS=50
```

`BELANJA_RUNNER_TOKEN` dan `NOTA_KMP_BASE_URL` masih dibaca sebagai alias lama untuk transisi, tetapi runner baru sebaiknya memakai `RUNNER_TOKEN` dan `WEB_NOTA_API_URL`.

Runner default login fresh memakai `TARGET_EMAIL/TARGET_PASSWORD`. Ini mencegah PC lain memakai session cache lama dari akun/role berbeda. Jika benar-benar ingin memakai cache login lama, set `BELANJA_REUSE_AUTH_STATE=true`.

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

`BELANJA_SUBMIT_SUCCESS_WAIT_MS` mengatur batas tunggu teks sukses setelah klik simpan. Runner tidak lagi menunggu `networkidle` panjang; begitu teks sukses terlihat, runner langsung menutup modal OK/Oke jika ada dan lanjut ke item berikutnya. Untuk mode cepat, `BELANJA_FAST_UI_TIMEOUT_MS`, `BELANJA_CHOICE_SEARCH_TIMEOUT_MS`, dan `BELANJA_CHOICE_SETTLE_MS` memang dibuat pendek agar proses input sampai modal sukses terasa responsif.

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
