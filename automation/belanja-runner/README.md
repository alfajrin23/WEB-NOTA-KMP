# Belanja Runner

Runner ini berjalan lokal di PC Windows yang terhubung VPN. WEB-NOTA-KMP tetap menjadi UI, queue, dan monitoring; Playwright tidak berjalan dari Vercel Serverless Function.

## Env lokal runner

Isi `.env.belanja.local` dari contoh `.env.belanja.example`. Runner hanya membaca file `.env.belanja.local` / `.env.belanja`, membutuhkan `BELANJA_RUNNER_TOKEN`, dan tidak membutuhkan `SUPABASE_SERVICE_ROLE_KEY`.

Env server WEB-NOTA-KMP tetap perlu `SUPABASE_SERVICE_ROLE_KEY` dan `BELANJA_RUNNER_TOKEN` agar API queue bisa menulis tabel sync dengan aman.

## Perintah

```bash
npm run belanja:check
npm run belanja:inspect
npm run belanja:runner
```

`BELANJA_DRY_RUN=true` adalah default aman. Live mode hanya boleh dipakai setelah mapping `/belanja` sudah diverifikasi dan `BELANJA_FIELD_MAP_VERIFIED=true`.
