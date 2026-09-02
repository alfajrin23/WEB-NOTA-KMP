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
TARGET_CHECK_TIMEOUT_MS=10000
```

`BELANJA_RUNNER_TOKEN` dan `NOTA_KMP_BASE_URL` masih dibaca sebagai alias lama untuk transisi, tetapi runner baru sebaiknya memakai `RUNNER_TOKEN` dan `WEB_NOTA_API_URL`.

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
5. Setiap PC memakai token sendiri dari `Settings -> Playwright Runners`.

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

`BELANJA_DRY_RUN=true` adalah default aman. Live mode hanya boleh dipakai setelah mapping `/belanja` sudah diverifikasi dan `BELANJA_FIELD_MAP_VERIFIED=true`.
