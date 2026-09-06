# Migrasi Supabase ke Akun Baru

Panduan ini untuk memindahkan database WEB NOTA KMP / KDKMP Nota Generator ke project Supabase baru ketika project lama terkena limit egress.

## Yang Dipindahkan

Script migrasi memindahkan semua tabel app di schema `public`:

- `projects`
- `resume_stages`
- `resume_categories`
- `resume_items`
- `resume_summaries`
- `generated_notes`
- `kwitansi_edits`
- `custom_notes`
- `note_history`
- `runner_tokens`
- `belanja_sync_jobs`
- `belanja_sync_items`
- `belanja_runner_heartbeats`

Project ini tidak memakai Supabase Auth flow di kode saat ini. Jika nanti ada data Auth users atau Storage bucket yang harus dipindah, itu perlu langkah tambahan terpisah.

## Prasyarat

- Buat project Supabase baru di akun baru.
- Ambil connection string database lama dan baru dari Supabase Dashboard, menu Project Settings > Database > Connection string.
- Install PostgreSQL client tools di komputer ini agar `pg_dump`, `pg_restore`, dan `psql` tersedia di PATH.

## 1. Buat SQL Editor File

Jalankan dari root repo:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\prepare-supabase-sql-editor.ps1 -OpenAfterCreate
```

File `supabase/sql-editor-new-account.sql` akan dibuat. Buka project Supabase baru, masuk SQL Editor, paste seluruh isi file itu, lalu Run.

## 2. Isi Connection String Sementara

Di PowerShell yang sama:

```powershell
$env:SOURCE_DATABASE_URL = "postgresql://postgres.SOURCE_PROJECT_REF:PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres"
$env:TARGET_DATABASE_URL = "postgresql://postgres.TARGET_PROJECT_REF:PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres"
```

Jangan simpan password asli ke file repo.

## 3. Restore Semua Data App

Cara paling mudah di project ini adalah migrasi direct via Node. Cara ini tidak butuh `pg_dump`, `pg_restore`, atau `psql`.

Isi connection string Session Pooler di `.env.migration.local`:

```env
SOURCE_DATABASE_URL=postgresql://postgres.SOURCE_PROJECT_REF:PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
TARGET_DATABASE_URL=postgresql://postgres.TARGET_PROJECT_REF:PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
SOURCE_SUPABASE_POOLER_REGION=ap-southeast-1
TARGET_SUPABASE_POOLER_REGION=ap-southeast-1
```

Pakai connection string "Session Pooler" port `5432` dari Supabase Dashboard agar cocok dengan jaringan IPv4. Jangan isi `SOURCE_DATABASE_URL` atau `TARGET_DATABASE_URL` dengan Project URL `https://...supabase.co`; itu hanya untuk API key aplikasi, bukan koneksi database. Jika project dibuat di region selain Singapore, ganti region pooler-nya.

Untuk target baru yang masih kosong setelah schema dibuat:

```powershell
npm run supabase:migrate:direct
```

Script akan:

- menjalankan schema ke database baru,
- menyalin data dari database lama ke database baru per batch,
- membandingkan row count dan checksum semua tabel app,
- reload schema PostgREST Supabase.

Jika target sudah terisi data dan memang ingin dikosongkan dulu:

```powershell
npm run supabase:migrate:direct -- --truncate-target
```

Jika ingin memakai metode PostgreSQL native dump/restore, jalankan ini setelah `pg_dump`, `pg_restore`, dan `psql` tersedia:

```powershell
npm run supabase:migrate:pgdump
```

## 4. Update Env Aplikasi

Setelah row count sama, update `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://TARGET_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_NEW_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_NEW_SERVICE_ROLE_KEY
DATABASE_URL=postgresql://postgres.TARGET_PROJECT_REF:PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
```

Restart dev server setelah `.env.local` diganti.

## 5. Verifikasi Aplikasi

Jalankan:

```powershell
npm run test:acceptance
npm run build
```

Lalu buka app dan cek:

- halaman `/history` memuat daftar project/nota,
- halaman `/belanja-sync` memuat job dan status runner,
- satu project lama dapat dibuka sampai resume dan nota,
- Belanja Sync tetap dapat membaca `runner_tokens` dan tabel sync.

## Catatan Aman

- Jangan hapus project lama sebelum app berhasil jalan dari Supabase baru.
- Jangan taruh file dump ke git. Folder `supabase/backups/` sudah di-ignore.
- Untuk migrasi paling aman, pakai target Supabase yang baru dibuat dan belum ada data.
