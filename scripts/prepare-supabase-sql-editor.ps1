[CmdletBinding()]
param(
  [string]$OutputPath = "supabase/sql-editor-new-account.sql",
  [switch]$OpenAfterCreate
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$schemaPath = Join-Path $repoRoot "supabase/schema.sql"
$migrationsDir = Join-Path $repoRoot "supabase/migrations"
$targetPath = Join-Path $repoRoot $OutputPath
$targetDir = Split-Path -Parent $targetPath

if (!(Test-Path -LiteralPath $schemaPath)) {
  throw "Tidak menemukan supabase/schema.sql."
}

if (!(Test-Path -LiteralPath $migrationsDir)) {
  throw "Tidak menemukan folder supabase/migrations."
}

New-Item -ItemType Directory -Force -Path $targetDir | Out-Null

$migrationFiles = Get-ChildItem -LiteralPath $migrationsDir -Filter "*.sql" |
  Sort-Object Name

$sections = New-Object System.Collections.Generic.List[string]
$sections.Add(@"
-- WEB NOTA KMP / KDKMP Nota Generator
-- SQL Editor bootstrap for a new Supabase project.
-- Generated at: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz")
--
-- How to use:
-- 1. Open the NEW Supabase project.
-- 2. Go to SQL Editor.
-- 3. Paste this whole file and run it once.
-- 4. Move data with scripts/migrate-supabase-database.ps1.
--
-- This file creates app schema, indexes, triggers, RLS state, and Belanja Sync tables.

begin;

"@)

$sections.Add("-- Source: supabase/schema.sql`r`n")
$sections.Add((Get-Content -LiteralPath $schemaPath -Raw))

foreach ($file in $migrationFiles) {
  $relativePath = "supabase/migrations/$($file.Name)"
  $sections.Add(@"

-- =====================================================================
-- Source: $relativePath
-- =====================================================================

"@)
  $sections.Add((Get-Content -LiteralPath $file.FullName -Raw))
}

$sections.Add(@"

commit;

-- Quick verification after running this file:
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_type = 'BASE TABLE'
  and table_name in (
    'projects',
    'resume_stages',
    'resume_categories',
    'resume_items',
    'resume_summaries',
    'generated_notes',
    'kwitansi_edits',
    'custom_notes',
    'note_history',
    'runner_tokens',
    'belanja_sync_jobs',
    'belanja_sync_items',
    'belanja_runner_heartbeats'
  )
order by table_name;

notify pgrst, 'reload schema';
"@)

$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($targetPath, ($sections -join "`r`n"), $utf8NoBom)

Write-Host "SQL Editor file dibuat: $targetPath"
Write-Host "Jalankan file itu di Supabase SQL Editor project baru sebelum restore data."

if ($OpenAfterCreate) {
  Invoke-Item -LiteralPath $targetPath
}
