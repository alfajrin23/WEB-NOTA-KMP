[CmdletBinding()]
param(
  [string]$SourceDatabaseUrl = $env:SOURCE_DATABASE_URL,
  [string]$TargetDatabaseUrl = $env:TARGET_DATABASE_URL,
  [ValidateSet("DataOnlyToPreparedTarget", "FullPublicSchemaAndData")]
  [string]$Mode = "DataOnlyToPreparedTarget",
  [string]$BackupDir = "supabase/backups",
  [string]$DumpFile,
  [switch]$SkipDump,
  [switch]$SkipRestore,
  [switch]$TruncateTargetPublicTables
)

$ErrorActionPreference = "Stop"

$appTables = @(
  "projects",
  "resume_stages",
  "resume_categories",
  "resume_items",
  "resume_summaries",
  "generated_notes",
  "kwitansi_edits",
  "custom_notes",
  "note_history",
  "runner_tokens",
  "belanja_sync_jobs",
  "belanja_sync_items",
  "belanja_runner_heartbeats"
)

function Assert-NotBlank([string]$Value, [string]$EnvName, [string]$ParameterName) {
  if ([string]::IsNullOrWhiteSpace($Value)) {
    throw "$EnvName belum diisi. Set env $EnvName atau kirim parameter -$ParameterName."
  }
}

function Assert-Command([string]$Name) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (!$command) {
    throw @"
Tool '$Name' belum tersedia di PATH.
Install PostgreSQL client tools, lalu pastikan folder bin masuk PATH.
Contoh Windows: C:\Program Files\PostgreSQL\<versi>\bin
"@
  }
  return $command.Source
}

function Mask-DatabaseUrl([string]$Value) {
  try {
    $uri = [Uri]$Value
    $user = if ($uri.UserInfo) { ($uri.UserInfo -split ":", 2)[0] } else { "" }
    $port = if ($uri.Port -gt 0) { ":$($uri.Port)" } else { "" }
    return "$($uri.Scheme)://$user`:***@$($uri.Host)$port$($uri.AbsolutePath)"
  } catch {
    return "<database-url>"
  }
}

function Invoke-Psql([string]$DatabaseUrl, [string]$Sql, [string]$Label) {
  $tmp = New-TemporaryFile
  try {
    Set-Content -LiteralPath $tmp.FullName -Encoding UTF8 -Value $Sql
    $output = & $script:PsqlPath "--no-password" "--quiet" "--set=ON_ERROR_STOP=1" "--dbname=$DatabaseUrl" "--file=$($tmp.FullName)" 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "$Label gagal.`n$($output | Out-String)"
    }
    return $output
  } finally {
    Remove-Item -LiteralPath $tmp.FullName -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-PsqlCsv([string]$DatabaseUrl, [string]$Sql, [string]$Label) {
  $csvSql = "copy (`r`n$Sql`r`n) to stdout with csv header;"
  $output = Invoke-Psql -DatabaseUrl $DatabaseUrl -Sql $csvSql -Label $Label
  $text = ($output | Out-String).Trim()
  if ([string]::IsNullOrWhiteSpace($text)) {
    return @()
  }
  return $text | ConvertFrom-Csv
}

function Get-TableExistsSql {
  $values = ($script:AppTables | ForEach-Object { "('$_')" }) -join ",`r`n    "
  return @"
select
  table_name,
  (to_regclass('public.' || table_name) is not null) as exists
from (values
    $values
) as v(table_name)
"@
}

function Get-CountSql {
  return ($script:AppTables | ForEach-Object {
    "select '$($_)' as table_name, count(*)::bigint as row_count from public.$_"
  }) -join "`r`nunion all`r`n"
}

function Get-CountMap([string]$DatabaseUrl, [string]$Label) {
  $rows = Invoke-PsqlCsv -DatabaseUrl $DatabaseUrl -Sql (Get-CountSql) -Label $Label
  $map = @{}
  foreach ($row in $rows) {
    $map[$row.table_name] = [int64]$row.row_count
  }
  return $map
}

Assert-NotBlank $SourceDatabaseUrl "SOURCE_DATABASE_URL" "SourceDatabaseUrl"
Assert-NotBlank $TargetDatabaseUrl "TARGET_DATABASE_URL" "TargetDatabaseUrl"

if ($SourceDatabaseUrl -eq $TargetDatabaseUrl) {
  throw "SOURCE_DATABASE_URL dan TARGET_DATABASE_URL sama. Batalkan agar database sumber tidak tertimpa."
}

$script:AppTables = $appTables
$script:PgDumpPath = Assert-Command "pg_dump"
$script:PgRestorePath = Assert-Command "pg_restore"
$script:PsqlPath = Assert-Command "psql"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$backupRoot = Join-Path $repoRoot $BackupDir
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null

if ([string]::IsNullOrWhiteSpace($DumpFile)) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $suffix = if ($Mode -eq "DataOnlyToPreparedTarget") { "data-only" } else { "full-public" }
  $DumpFile = Join-Path $backupRoot "supabase-$suffix-$stamp.dump"
} elseif (!(Split-Path -IsAbsolute $DumpFile)) {
  $DumpFile = Join-Path $repoRoot $DumpFile
}

Write-Host "Source: $(Mask-DatabaseUrl $SourceDatabaseUrl)"
Write-Host "Target: $(Mask-DatabaseUrl $TargetDatabaseUrl)"
Write-Host "Mode  : $Mode"
Write-Host "Dump  : $DumpFile"

if ($Mode -eq "DataOnlyToPreparedTarget") {
  $existsRows = Invoke-PsqlCsv -DatabaseUrl $TargetDatabaseUrl -Sql (Get-TableExistsSql) -Label "Cek schema target"
  $missingTables = @($existsRows | Where-Object { $_.exists -ne "t" -and $_.exists -ne "true" } | ForEach-Object { $_.table_name })
  if ($missingTables.Count -gt 0) {
    throw "Schema target belum lengkap. Jalankan scripts/prepare-supabase-sql-editor.ps1, paste hasilnya ke SQL Editor project baru, lalu ulangi. Tabel hilang: $($missingTables -join ', ')"
  }

  if (!$TruncateTargetPublicTables) {
    $targetBefore = Get-CountMap -DatabaseUrl $TargetDatabaseUrl -Label "Cek isi target"
    $nonEmptyTables = @($appTables | Where-Object { $targetBefore[$_] -gt 0 })
    if ($nonEmptyTables.Count -gt 0) {
      throw "Target sudah berisi data pada tabel: $($nonEmptyTables -join ', '). Pakai target kosong atau ulangi dengan -TruncateTargetPublicTables jika memang ingin mengosongkan data app di target."
    }
  }
}

if ($TruncateTargetPublicTables -and !$SkipRestore) {
  $tableList = ($appTables | ForEach-Object { "public.$_" }) -join ", "
  Invoke-Psql -DatabaseUrl $TargetDatabaseUrl -Sql "truncate table $tableList restart identity cascade;" -Label "Truncate target" | Out-Null
  Write-Host "Target app tables dikosongkan."
}

if (!$SkipDump) {
  $dumpArgs = @(
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    "--file=$DumpFile"
  )

  if ($Mode -eq "DataOnlyToPreparedTarget") {
    $dumpArgs = @("--data-only") + $dumpArgs
    foreach ($table in $appTables) {
      $dumpArgs += "--table=public.$table"
    }
  } else {
    $dumpArgs += "--schema=public"
  }

  Write-Host "Membuat dump dari database lama..."
  & $PgDumpPath @dumpArgs $SourceDatabaseUrl
  if ($LASTEXITCODE -ne 0) {
    throw "pg_dump gagal."
  }
}

if (!$SkipRestore) {
  $restoreArgs = @(
    "--exit-on-error",
    "--single-transaction",
    "--no-owner",
    "--no-privileges",
    "--dbname=$TargetDatabaseUrl"
  )

  if ($Mode -eq "DataOnlyToPreparedTarget") {
    $restoreArgs = @("--data-only") + $restoreArgs
  } else {
    $restoreArgs = @("--clean", "--if-exists") + $restoreArgs
  }

  Write-Host "Restore ke database baru..."
  & $PgRestorePath @restoreArgs $DumpFile
  if ($LASTEXITCODE -ne 0) {
    throw "pg_restore gagal. Target memakai transaksi tunggal, jadi restore yang gagal tidak diterapkan sebagian."
  }
}

Write-Host "Memverifikasi jumlah row sumber vs target..."
$sourceCounts = Get-CountMap -DatabaseUrl $SourceDatabaseUrl -Label "Hitung row source"
$targetCounts = Get-CountMap -DatabaseUrl $TargetDatabaseUrl -Label "Hitung row target"

$hasMismatch = $false
foreach ($table in $appTables) {
  $source = $sourceCounts[$table]
  $target = $targetCounts[$table]
  $status = if ($source -eq $target) { "OK" } else { "MISMATCH" }
  if ($status -ne "OK") {
    $hasMismatch = $true
  }
  Write-Host ("{0,-32} source={1,8} target={2,8} {3}" -f $table, $source, $target, $status)
}

Invoke-Psql -DatabaseUrl $TargetDatabaseUrl -Sql "notify pgrst, 'reload schema';" -Label "Reload PostgREST schema" | Out-Null

if ($hasMismatch) {
  throw "Migrasi selesai tetapi ada jumlah row yang tidak sama. Lihat tabel MISMATCH di atas."
}

Write-Host "Migrasi data selesai dan row count semua tabel app sama."
