import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type RunnerConfig = {
  targetBaseUrl: string;
  targetEmail: string;
  targetPassword: string;
  notaKmpBaseUrl: string;
  runnerToken: string;
  runnerId: string;
  dryRun: boolean;
  headed: boolean;
  fieldMapVerified: boolean;
  pollIntervalMs: number;
  rootDir: string;
  authStatePath: string;
  artifactsDir: string;
};

function parseEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    const key = match[1];
    const rawValue = match[2].trim();
    const value = rawValue.replace(/^['"]|['"]$/g, "");
    if (process.env[key] == null) process.env[key] = value;
  }
}

export function loadLocalEnv(rootDir = process.cwd()) {
  for (const fileName of [".env.belanja.local", ".env.belanja"]) {
    parseEnvFile(path.join(rootDir, fileName));
  }
}

function booleanEnv(name: string, fallback: boolean) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

function numberEnv(name: string, fallback: number) {
  const numeric = Number(process.env[name]);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

export function getRunnerConfig(): RunnerConfig {
  const rootDir = process.cwd();
  loadLocalEnv(rootDir);
  const runnerRoot = path.join(rootDir, "automation", "belanja-runner");
  const artifactsDir = path.join(runnerRoot, "artifacts");
  const authDir = path.join(runnerRoot, ".auth");

  return {
    targetBaseUrl: process.env.TARGET_BASE_URL || "http://10.21.21.10:9023",
    targetEmail: process.env.TARGET_EMAIL || "",
    targetPassword: process.env.TARGET_PASSWORD || "",
    notaKmpBaseUrl: process.env.NOTA_KMP_BASE_URL || "http://localhost:3000",
    runnerToken: process.env.BELANJA_RUNNER_TOKEN || "",
    runnerId: process.env.BELANJA_RUNNER_ID || `belanja-${os.hostname()}`,
    dryRun: booleanEnv("BELANJA_DRY_RUN", true),
    headed: booleanEnv("BELANJA_RUNNER_HEADED", true),
    fieldMapVerified: booleanEnv("BELANJA_FIELD_MAP_VERIFIED", false),
    pollIntervalMs: numberEnv("BELANJA_RUNNER_POLL_MS", 5000),
    rootDir,
    artifactsDir,
    authStatePath: path.join(authDir, "belanja.json"),
  };
}

export function ensureRunnerDirs(config: RunnerConfig) {
  fs.mkdirSync(path.dirname(config.authStatePath), { recursive: true });
  fs.mkdirSync(config.artifactsDir, { recursive: true });
}

export function targetUrl(config: RunnerConfig, pathname = "") {
  return new URL(pathname, config.targetBaseUrl.endsWith("/") ? config.targetBaseUrl : `${config.targetBaseUrl}/`).toString();
}
