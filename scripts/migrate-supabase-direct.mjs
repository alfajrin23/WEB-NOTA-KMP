import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const APP_TABLES = [
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
  "belanja_runner_heartbeats",
];

const REVERSE_APP_TABLES = [...APP_TABLES].reverse();

function parseArgs(argv) {
  const args = {
    applySchema: true,
    checkSourceOnly: false,
    dryRun: false,
    truncateTarget: false,
    updateEnvLocal: false,
    updateEnvOnly: false,
    batchSize: 250,
  };

  for (const arg of argv) {
    if (arg === "--skip-schema") args.applySchema = false;
    else if (arg === "--apply-schema") args.applySchema = true;
    else if (arg === "--check-source") args.checkSourceOnly = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--truncate-target") args.truncateTarget = true;
    else if (arg === "--update-env-local") args.updateEnvLocal = true;
    else if (arg === "--update-env-only") args.updateEnvOnly = true;
    else if (arg.startsWith("--batch-size=")) {
      args.batchSize = Number(arg.slice("--batch-size=".length));
    } else {
      throw new Error(`Argumen tidak dikenal: ${arg}`);
    }
  }

  if (!Number.isInteger(args.batchSize) || args.batchSize < 1 || args.batchSize > 1000) {
    throw new Error("--batch-size harus angka 1 sampai 1000.");
  }

  return args;
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const values = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }

  return values;
}

function mergeEnv() {
  return {
    ...parseEnvFile(path.join(repoRoot, ".env.local")),
    ...parseEnvFile(path.join(repoRoot, ".env.migration.local")),
    ...process.env,
  };
}

function requireValue(value, label) {
  if (!value || !String(value).trim()) {
    throw new Error(`${label} belum diisi.`);
  }
  return String(value).trim();
}

function requirePostgresUrl(value, label) {
  const trimmed = requireValue(value, label);
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`${label} bukan URL database yang valid.`);
  }

  if (!["postgresql:", "postgres:"].includes(url.protocol)) {
    throw new Error(
      `${label} harus Database connection string, bukan Project API URL. Format yang benar: postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres`,
    );
  }

  if (!url.username || !url.password || !url.hostname || !url.pathname || url.pathname === "/") {
    throw new Error(`${label} belum lengkap. Pastikan username, password, host, dan database path /postgres ada.`);
  }

  const decodedPassword = decodeURIComponent(url.password);
  if (/^\[.*\]$/.test(decodedPassword) || /^\[?your[-_ ]?password\]?$/i.test(decodedPassword) || /^\[.*password.*\]$/i.test(decodedPassword)) {
    throw new Error(`${label} masih terlihat memakai placeholder password. Ganti bagian [YOUR-PASSWORD] dengan password database Supabase project tersebut, tanpa tanda kurung siku.`);
  }

  return trimmed;
}

function maskDatabaseUrl(value) {
  try {
    const url = new URL(value);
    const username = url.username || "postgres";
    const port = url.port ? `:${url.port}` : "";
    return `${url.protocol}//${username}:***@${url.hostname}${port}${url.pathname}`;
  } catch {
    return "<database-url>";
  }
}

function makeClient(connectionString, label) {
  return new Client({
    connectionString,
    application_name: `web-nota-migration-${label}`,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 120000,
    query_timeout: 120000,
    connectionTimeoutMillis: 15000,
  });
}

function buildPoolerUrl(connectionString, region) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    return null;
  }

  const match = url.hostname.match(/^db\.([^.]+)\.supabase\.co$/);
  if (!match) return null;

  const projectRef = match[1];
  const username = decodeURIComponent(url.username || "postgres");
  const poolerUrl = new URL(url.toString());
  poolerUrl.hostname = `aws-0-${region}.pooler.supabase.com`;
  poolerUrl.port = "5432";
  poolerUrl.username = `${username}.${projectRef}`;
  return poolerUrl.toString();
}

async function connectWithFallback(connectionString, label, region) {
  const attempts = [connectionString];
  const poolerUrl = buildPoolerUrl(connectionString, region || "ap-southeast-1");
  if (poolerUrl && poolerUrl !== connectionString) attempts.push(poolerUrl);

  let lastError;
  for (const attempt of attempts) {
    const client = makeClient(attempt, label);
    try {
      await client.connect();
      if (attempt !== connectionString) {
        console.log(`${label}: direct IPv6 gagal, tersambung via Session Pooler ${maskDatabaseUrl(attempt)}`);
      }
      return { client, connectionString: attempt };
    } catch (error) {
      lastError = error;
      await client.end().catch(() => undefined);
      if (attempt === connectionString && attempts.length > 1) {
        console.log(`${label}: direct connection gagal (${error.message}). Mencoba Session Pooler...`);
      }
    }
  }

  const hint = attempts.length > 1
    ? ` Kalau ini Supabase, ambil connection string resmi "Session Pooler" dari Dashboard > Connect dan isi ${label === "source" ? "SOURCE_DATABASE_URL" : "TARGET_DATABASE_URL"} di .env.migration.local.`
    : "";
  throw new Error(`${label} gagal tersambung: ${lastError?.message ?? "unknown error"}.${hint}`);
}

function quoteIdentifier(value) {
  if (!APP_TABLES.includes(value) && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Identifier tidak aman: ${value}`);
  }
  return `"${String(value).replaceAll('"', '""')}"`;
}

function tableName(table) {
  if (!APP_TABLES.includes(table)) {
    throw new Error(`Tabel tidak diizinkan: ${table}`);
  }
  return `public.${quoteIdentifier(table)}`;
}

async function tableExists(client, table) {
  const result = await client.query("select to_regclass($1) is not null as exists", [`public.${table}`]);
  return Boolean(result.rows[0]?.exists);
}

async function getColumns(client, table) {
  const result = await client.query(
    `
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = $1
      order by ordinal_position
    `,
    [table],
  );
  return result.rows.map((row) => row.column_name);
}

async function assertAppTables(client, label) {
  const missing = [];
  for (const table of APP_TABLES) {
    if (!(await tableExists(client, table))) missing.push(table);
  }
  if (missing.length) {
    throw new Error(`Tabel app belum lengkap di ${label}: ${missing.join(", ")}`);
  }
}

async function applySchema(client) {
  const sqlPath = path.join(repoRoot, "supabase", "sql-editor-new-account.sql");
  if (!fs.existsSync(sqlPath)) {
    throw new Error("supabase/sql-editor-new-account.sql belum ada. Jalankan npm run supabase:prepare-sql dulu.");
  }

  const sql = fs.readFileSync(sqlPath, "utf8").replace(/^\uFEFF/, "");
  await client.query(sql);
}

async function getTableStats(client, table, columns = null) {
  const relationSql = columns?.length
    ? `(select ${columns.map(quoteIdentifier).join(", ")} from ${tableName(table)})`
    : tableName(table);
  const result = await client.query(`
    select
      count(*)::bigint as row_count,
      coalesce(
        md5(string_agg(md5(to_jsonb(t)::text), '' order by md5(to_jsonb(t)::text))),
        md5('')
      ) as checksum
    from ${relationSql} as t
  `);
  const row = result.rows[0];
  return {
    rowCount: BigInt(row.row_count),
    checksum: row.checksum,
  };
}

async function getAllStats(client) {
  const stats = new Map();
  for (const table of APP_TABLES) {
    stats.set(table, await getTableStats(client, table));
  }
  return stats;
}

async function getComparableStats(source, target) {
  const sourceStats = new Map();
  const targetStats = new Map();

  for (const table of APP_TABLES) {
    const sourceColumns = await getColumns(source, table);
    const targetColumns = await getColumns(target, table);
    const targetColumnSet = new Set(targetColumns);
    const columns = sourceColumns.filter((column) => targetColumnSet.has(column));
    sourceStats.set(table, await getTableStats(source, table, columns));
    targetStats.set(table, await getTableStats(target, table, columns));
  }

  return { sourceStats, targetStats };
}

function printStats(label, stats) {
  console.log(label);
  for (const table of APP_TABLES) {
    const value = stats.get(table);
    console.log(`  ${table.padEnd(32)} rows=${value.rowCount.toString().padStart(8)} checksum=${value.checksum}`);
  }
}

async function assertTargetEmpty(target) {
  const nonEmpty = [];
  for (const table of APP_TABLES) {
    const stats = await getTableStats(target, table);
    if (stats.rowCount > 0n) nonEmpty.push(`${table}=${stats.rowCount}`);
  }

  if (nonEmpty.length) {
    throw new Error(
      `Target sudah berisi data: ${nonEmpty.join(", ")}. Gunakan --truncate-target jika target memang boleh dikosongkan.`,
    );
  }
}

async function truncateTarget(target) {
  const tables = REVERSE_APP_TABLES.map(tableName).join(", ");
  await target.query(`truncate table ${tables} restart identity cascade`);
}

async function fetchBatch(source, table, columns, offset, limit) {
  const orderColumn = columns.includes("id") ? "id" : columns.includes("runner_id") ? "runner_id" : columns[0];
  const columnSql = columns.map(quoteIdentifier).join(", ");
  const result = await source.query(
    `
      select to_jsonb(batch_row)::text as row_json
      from (
        select ${columnSql}
        from ${tableName(table)}
        order by ${quoteIdentifier(orderColumn)}
        offset $1
        limit $2
      ) as batch_row
    `,
    [offset, limit],
  );
  return result.rows;
}

async function insertBatch(target, table, columns, rows) {
  if (!rows.length) return;
  const columnSql = columns.map(quoteIdentifier).join(", ");
  const payload = `[${rows.map((row) => row.row_json).join(",")}]`;
  await target.query(
    `
      insert into ${tableName(table)} (${columnSql})
      select ${columnSql}
      from jsonb_populate_recordset(null::${tableName(table)}, $1::jsonb)
    `,
    [payload],
  );
}

async function migrateTable(source, target, table, batchSize) {
  const sourceColumns = await getColumns(source, table);
  const targetColumns = await getColumns(target, table);
  const targetColumnSet = new Set(targetColumns);
  const columns = sourceColumns.filter((column) => targetColumnSet.has(column));
  const extraSourceColumns = sourceColumns.filter((column) => !targetColumnSet.has(column));
  const missingTargetColumns = targetColumns.filter((column) => !sourceColumns.includes(column));

  if (!columns.length) {
    throw new Error(`Tidak ada kolom yang cocok untuk tabel ${table}.`);
  }

  if (extraSourceColumns.length) {
    console.log(`  ${table}: kolom lama tidak ada di target dan dilewati: ${extraSourceColumns.join(", ")}`);
  }
  if (missingTargetColumns.length) {
    console.log(`  ${table}: kolom target memakai default: ${missingTargetColumns.join(", ")}`);
  }

  const stats = await getTableStats(source, table);
  let copied = 0n;
  let offset = 0;

  while (true) {
    const rows = await fetchBatch(source, table, columns, offset, batchSize);
    if (!rows.length) break;
    await insertBatch(target, table, columns, rows);
    copied += BigInt(rows.length);
    offset += rows.length;
    process.stdout.write(`\r  ${table.padEnd(32)} ${copied.toString().padStart(8)}/${stats.rowCount.toString().padEnd(8)}`);
  }

  if (stats.rowCount === 0n) {
    console.log(`  ${table.padEnd(32)}        0/0`);
  } else {
    process.stdout.write("\n");
  }
}

async function migrateData(source, target, batchSize) {
  await target.query("begin");
  try {
    for (const table of APP_TABLES) {
      await migrateTable(source, target, table, batchSize);
    }
    await target.query("commit");
  } catch (error) {
    await target.query("rollback").catch(() => undefined);
    throw error;
  }
}

function compareStats(sourceStats, targetStats) {
  const mismatches = [];
  for (const table of APP_TABLES) {
    const source = sourceStats.get(table);
    const target = targetStats.get(table);
    if (source.rowCount !== target.rowCount || source.checksum !== target.checksum) {
      mismatches.push({
        table,
        source,
        target,
      });
    }
  }
  return mismatches;
}

function readEnvLocalText() {
  const envPath = path.join(repoRoot, ".env.local");
  return fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
}

function upsertEnvValue(text, key, value) {
  const escaped = value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n");
  const line = `${key}=${escaped}`;
  const regex = new RegExp(`^${key}=.*$`, "m");
  if (regex.test(text)) return text.replace(regex, line);
  return `${text.trimEnd()}\r\n${line}\r\n`;
}

function updateEnvLocal(env, targetDatabaseUrl) {
  const targetUrl = requireValue(env.TARGET_SUPABASE_URL, "TARGET_SUPABASE_URL");
  const targetAnonKey = requireValue(env.TARGET_SUPABASE_ANON_KEY, "TARGET_SUPABASE_ANON_KEY");
  const targetServiceRoleKey = requireValue(env.TARGET_SUPABASE_SERVICE_ROLE_KEY, "TARGET_SUPABASE_SERVICE_ROLE_KEY");

  const envPath = path.join(repoRoot, ".env.local");
  const backupPath = path.join(
    repoRoot,
    `.env.local.before-supabase-migration-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`,
  );
  const original = readEnvLocalText();
  let next = original;
  next = upsertEnvValue(next, "NEXT_PUBLIC_SUPABASE_URL", targetUrl);
  next = upsertEnvValue(next, "NEXT_PUBLIC_SUPABASE_ANON_KEY", targetAnonKey);
  next = upsertEnvValue(next, "SUPABASE_SERVICE_ROLE_KEY", targetServiceRoleKey);
  next = upsertEnvValue(next, "DATABASE_URL", targetDatabaseUrl);

  fs.writeFileSync(backupPath, original, "utf8");
  fs.writeFileSync(envPath, next, "utf8");
  console.log(`.env.local diperbarui. Backup lama: ${path.relative(repoRoot, backupPath)}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = mergeEnv();

  if (args.updateEnvOnly) {
    const targetDatabaseUrl = requirePostgresUrl(env.TARGET_DATABASE_URL, "TARGET_DATABASE_URL");
    updateEnvLocal(env, targetDatabaseUrl);
    return;
  }

  const sourceDatabaseUrl = requirePostgresUrl(
    env.SOURCE_DATABASE_URL || env.DATABASE_URL || env.POSTGRES_URL || env.SUPABASE_DB_URL,
    "SOURCE_DATABASE_URL atau DATABASE_URL",
  );

  console.log(`Source: ${maskDatabaseUrl(sourceDatabaseUrl)}`);
  const { client: source, connectionString: connectedSourceUrl } = await connectWithFallback(
    sourceDatabaseUrl,
    "source",
    env.SOURCE_SUPABASE_POOLER_REGION,
  );

  try {
    await assertAppTables(source, "source");
    const sourceStats = await getAllStats(source);
    printStats("Source stats:", sourceStats);

    if (args.checkSourceOnly) return;

    const targetDatabaseUrl = requirePostgresUrl(env.TARGET_DATABASE_URL, "TARGET_DATABASE_URL");
    if (sourceDatabaseUrl === targetDatabaseUrl || connectedSourceUrl === targetDatabaseUrl) {
      throw new Error("SOURCE_DATABASE_URL dan TARGET_DATABASE_URL sama. Migrasi dibatalkan.");
    }

    console.log(`Target: ${maskDatabaseUrl(targetDatabaseUrl)}`);
    const { client: target, connectionString: connectedTargetUrl } = await connectWithFallback(
      targetDatabaseUrl,
      "target",
      env.TARGET_SUPABASE_POOLER_REGION,
    );

    try {
      if (args.applySchema) {
        console.log("Apply schema ke target...");
        if (!args.dryRun) await applySchema(target);
      }

      await assertAppTables(target, "target");

      if (args.truncateTarget) {
        console.log("Mengosongkan tabel app target...");
        if (!args.dryRun) await truncateTarget(target);
      } else {
        await assertTargetEmpty(target);
      }

      if (args.dryRun) {
        console.log("Dry run selesai. Tidak ada data yang ditulis.");
        return;
      }

      console.log("Copy data ke target...");
      await migrateData(source, target, args.batchSize);
      await target.query("notify pgrst, 'reload schema'");

      const { sourceStats: comparableSourceStats, targetStats } = await getComparableStats(source, target);
      printStats("Target stats for migrated columns:", targetStats);
      const mismatches = compareStats(comparableSourceStats, targetStats);
      if (mismatches.length) {
        for (const mismatch of mismatches) {
          console.error(
            `Mismatch ${mismatch.table}: source rows=${mismatch.source.rowCount} checksum=${mismatch.source.checksum}; target rows=${mismatch.target.rowCount} checksum=${mismatch.target.checksum}`,
          );
        }
        throw new Error("Migrasi selesai tetapi verifikasi data tidak sama.");
      }

      if (args.updateEnvLocal) {
        updateEnvLocal(env, connectedTargetUrl);
      }

      console.log("Migrasi direct selesai. Row count dan checksum semua tabel app sama.");
    } finally {
      await target.end().catch(() => undefined);
    }
  } finally {
    await source.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exit(1);
});
