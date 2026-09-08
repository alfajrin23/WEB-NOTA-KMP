export const BELANJA_RUNNER_VERSION = "playwright-v2.4.3";
export const MIN_COPY_RECONCILE_RUNNER_VERSION = "playwright-v2.4.3";

type VersionTuple = [number, number, number];

export function parseBelanjaRunnerVersion(value: string | null | undefined): VersionTuple | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  const match = /(?:playwright[-_\s]*)?v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/i.exec(normalized);
  if (!match) return null;
  return [
    Number(match[1] ?? 0),
    Number(match[2] ?? 0),
    Number(match[3] ?? 0),
  ];
}

function compareVersion(left: VersionTuple, right: VersionTuple) {
  for (let index = 0; index < left.length; index += 1) {
    const diff = left[index] - right[index];
    if (diff !== 0) return diff;
  }
  return 0;
}

export function isBelanjaRunnerVersionSupported(
  value: string | null | undefined,
  minimum = MIN_COPY_RECONCILE_RUNNER_VERSION,
) {
  const current = parseBelanjaRunnerVersion(value);
  const required = parseBelanjaRunnerVersion(minimum);
  return Boolean(current && required && compareVersion(current, required) >= 0);
}

export function unsupportedBelanjaRunnerVersionMessage(value: string | null | undefined, runnerId?: string) {
  const versionText = String(value ?? "").trim() || "tanpa versi";
  const runnerText = runnerId ? `Runner ${runnerId}` : "Runner";
  return `${runnerText} masih versi lama (${versionText}). Update kode ke versi ${MIN_COPY_RECONCILE_RUNNER_VERSION} dan restart runner sebelum memproses Belanja Sync Playwright v2.`;
}
