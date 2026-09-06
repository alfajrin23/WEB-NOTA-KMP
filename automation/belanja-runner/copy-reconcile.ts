import path from "node:path";
import fs from "node:fs";
import { createHash } from "node:crypto";
import type { Locator, Page } from "playwright";
import { findKdkmpOption, formatKdkmpIdentity, parseKdkmpOptionText, sameKdkmpIdentity } from "../../src/lib/belanja-sync/kdkmp";
import { classifyBelanjaAutomationError } from "../../src/lib/belanja-sync/automation-errors";
import {
  belanjaTextMatches,
  normalizeBelanjaIsoDate,
  normalizeBelanjaNumber,
  normalizeBelanjaText,
  roundBelanjaMoney,
} from "../../src/lib/belanja-sync/payload";
import { honorariumRoleLabel, inferHonorariumRole, transactionKindFromBelanjaCategory } from "../../src/lib/belanja-sync/transaction-plan";
import { readTransactionSnapshot, type DetailLine, type TransactionSnapshot } from "./transaction-snapshot";
import type {
  BelanjaCopyReconcileStage,
  BelanjaTransactionKind,
  BelanjaTransactionLine,
  BelanjaTransactionPayload,
  ClaimedBelanjaSyncJob,
  KdkmpIdentity,
} from "../../src/lib/belanja-sync/types";
import { BelanjaSyncApiClient } from "./api-client";
import type { RunnerConfig } from "./config";
import { targetUrl } from "./config";
import { resolveEffectiveDryRun, resolveEffectiveFieldMapVerified } from "./mode";
import { submitBelanjaForm } from "./target";

type NativeOptionSnapshot = {
  value: string;
  text: string;
};

export type TargetTransactionRow = {
  rowIndex: number;
  uuid: string | null;
  editHref: string | null;
  kdkmpText: string;
  stageText: string;
  itemText: string;
  belanjaCategoryText: string;
  totalText: string;
  dateText: string;
  identityKey: string;
};

export type BudgetStageKey = string;

type LookupBelanjaItem = {
  uuid: string;
  nama?: string | null;
  spesifikasi?: string | null;
  satuan?: string | null;
};

type BudgetTransactionIssue = {
  stageKey: BudgetStageKey;
  kind: BelanjaTransactionKind;
  transactionId?: string;
  itemName: string;
  categoryCode: string;
  date: string;
  expectedTotal: number;
  actualTotal: number;
  difference: number;
  rowIndex?: number;
  issue: "missing" | "extra" | "total_mismatch";
};

type BudgetStageDiagnostic = {
  stageKey: BudgetStageKey;
  expectedCount: number;
  actualCount: number;
  expectedTotal: number;
  actualTotal: number;
  difference: number;
  issues: BudgetTransactionIssue[];
};

export type DestinationBudgetDiagnostic = {
  expectedTotal: number;
  actualTotal: number;
  totalDifference: number;
  duplicateGroups: TargetTransactionRow[][];
  stages: BudgetStageDiagnostic[];
};

export type DestinationBudgetRepairCandidate = {
  stageKey: BudgetStageKey;
  kind: BelanjaTransactionKind;
  transactionId: string;
  itemName: string;
  expectedTotal: number;
  actualTotal: number;
  difference: number;
  rowIndex: number;
  transaction: BelanjaTransactionPayload;
  row: TargetTransactionRow;
};

export type StageBudgetReconcilePlan = {
  mode: "targeted" | "full";
  reason?: string;
  balancedStageKeys: BudgetStageKey[];
  mismatchedStageKeys: BudgetStageKey[];
  fullStageKeys: BudgetStageKey[];
  transactionIdsToEdit: string[];
};

const CHOICE_ROOT_XPATH = "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' choices ')]";
const FINAL_BUDGET_REPAIR_MAX_PASSES = 2;
const TARGET_NAVIGATION_ATTEMPTS = 3;
const EDIT_PAGE_READY_SELECTOR = 'input[name="tanggal"], select#tahapan, select#item_pekerjaan, select#kategori_belanja';

type TargetNavigationOptions = {
  waitTimeoutMs?: number;
  waitState?: "attached" | "detached" | "hidden" | "visible";
};

type MatchLineOptions = {
  allowDuplicateNames?: boolean;
  allowGenericHonorariumLabel?: boolean;
};

function logJob(jobId: string, message: string) {
  console.log(`[JOB ${jobId}] ${message}`);
}

function attr(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function normalizeIdentityPart(value: string | null | undefined) {
  return normalizeBelanjaText(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function transactionIdentityKey(input: {
  stageText?: string;
  itemText?: string;
  belanjaCategoryText?: string;
  kind?: BelanjaTransactionKind;
}) {
  const itemMatch = /([IVX]+\.\d+)\s*(.*)$/i.exec(normalizeBelanjaText(input.itemText));
  const categoryCode = itemMatch?.[1] ?? "";
  return [
    normalizeIdentityPart(budgetStageKey(input.stageText) ?? input.stageText),
    normalizeIdentityPart(categoryCode),
    normalizeIdentityPart(input.kind ?? transactionKindFromBelanjaCategory(input.belanjaCategoryText)),
  ].join("|");
}

function planIdentityKey(transaction: BelanjaTransactionPayload) {
  const categoryCode = transaction.transactionIdentity.categoryCode;
  return [
    normalizeIdentityPart(transactionStageKey(transaction)),
    normalizeIdentityPart(categoryCode),
    normalizeIdentityPart(transaction.kind),
  ].join("|");
}

function stageBefore(stage: BelanjaCopyReconcileStage, target: BelanjaCopyReconcileStage) {
  const order: BelanjaCopyReconcileStage[] = [
    "PRE_FLIGHT",
    "SOURCE_OPENED",
    "SOURCE_SELECTED",
    "COPY_STARTED",
    "COPY_CONFIRMED",
    "DESTINATION_COPIED",
    "RECONCILING",
    "VERIFYING",
    "COMPLETED",
    "FAILED",
  ];
  return order.indexOf(stage) < order.indexOf(target);
}

async function checkpoint(
  api: BelanjaSyncApiClient,
  claim: ClaimedBelanjaSyncJob,
  stage: BelanjaCopyReconcileStage,
  message: string,
  progress: Record<string, unknown> = {},
) {
  await api.checkpointJob(claim.job.id, {
    stage,
    stageMessage: message,
    progress: {
      stage,
      message,
      total: claim.expectedTransactionCount,
      ...progress,
    },
  });
}

async function saveJobScreenshot(page: Page, config: RunnerConfig, jobId: string, label: string) {
  const filePath = path.join(config.artifactsDir, `job-${jobId}-${label}-${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
  await page.screenshot({ path: filePath, fullPage: true }).catch(() => {});
  return filePath;
}

async function gotoTargetPathWithRetry(
  page: Page,
  config: RunnerConfig,
  pathname: string,
  waitSelector: string,
  label: string,
  options: TargetNavigationOptions = {},
) {
  const url = targetUrl(config, pathname);
  const waitTimeoutMs = options.waitTimeoutMs ?? Math.max(8_000, config.choiceSearchTimeoutMs + 5_000);
  let lastError: unknown;
  for (let attempt = 1; attempt <= TARGET_NAVIGATION_ATTEMPTS; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: config.targetNavigationTimeoutMs });
      await page.waitForSelector(waitSelector, {
        state: options.waitState ?? "visible",
        timeout: waitTimeoutMs,
      });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < TARGET_NAVIGATION_ATTEMPTS) {
        logJob("navigation", `${label} gagal dibuka attempt=${attempt}/${TARGET_NAVIGATION_ATTEMPTS}; retry ${pathname}`);
        await page.waitForTimeout(1000 * attempt).catch(() => {});
      }
    }
  }
  const message = lastError instanceof Error ? lastError.message : "unknown";
  throw new Error(`${label} gagal dibuka setelah ${TARGET_NAVIGATION_ATTEMPTS} percobaan. URL terakhir: ${page.url()}. ${message}`);
}

async function gotoBelanjaList(page: Page, config: RunnerConfig) {
  await gotoTargetPathWithRetry(page, config, config.targetBelanjaUrlPath, "#gerai, table, body", "Halaman daftar Belanja", {
    waitTimeoutMs: Math.max(12_000, config.choiceSearchTimeoutMs + 5_000),
  });
}

async function nativeOptions(locator: Locator): Promise<NativeOptionSnapshot[]> {
  const options = locator.locator("option");
  const count = await options.count().catch(() => 0);
  const snapshots: NativeOptionSnapshot[] = [];
  for (let index = 0; index < count; index += 1) {
    const option = options.nth(index);
    snapshots.push({
      value: await option.getAttribute("value").then((item) => item ?? "").catch(() => ""),
      text: normalizeBelanjaText(await option.textContent().then((item) => item ?? "").catch(() => "")),
    });
  }
  return snapshots;
}

function choiceRoot(page: Page, selectId: string) {
  return page.locator(`#${selectId}`).first().locator(CHOICE_ROOT_XPATH).first();
}

async function collectChoiceOptions(page: Page, selectId: string) {
  const items = choiceRoot(page, selectId).locator(".choices__list--dropdown .choices__item--choice");
  const count = await items.count().catch(() => 0);
  const options: Array<NativeOptionSnapshot & { index: number }> = [];
  for (let index = 0; index < count; index += 1) {
    const item = items.nth(index);
    const text = normalizeBelanjaText(await item.innerText().catch(() => ""));
    if (text && !/tidak ada pilihan|no choices|pilih data/i.test(text)) {
      options.push({
        index,
        value: await item.getAttribute("data-value").then((value) => value ?? "").catch(() => ""),
        text,
      });
    }
  }
  return options;
}

async function selectKdkmpChoice(page: Page, config: RunnerConfig, selectId: string, identity: KdkmpIdentity) {
  const select = page.locator(`#${selectId}`).first();
  const native = await nativeOptions(select);
  const nativeCandidates = native.filter((option) => option.value && option.text);
  if (nativeCandidates.length > 1) {
    const option = findKdkmpOption(nativeCandidates, identity);
    await select.selectOption({ value: option.value }, { timeout: 1_000 }).catch(async () => {
      await select.selectOption({ label: option.text }, { timeout: 1_000 });
    });
    await select.dispatchEvent("change").catch(() => {});
    return;
  }

  const root = choiceRoot(page, selectId);
  const searchTerms = [
    identity.village,
    `${identity.village} ${identity.district}`,
    formatKdkmpIdentity(identity),
  ].map(normalizeBelanjaText).filter(Boolean);
  let lastSeen: string[] = [];
  for (const term of searchTerms) {
    await root.locator(".choices__inner").click();
    const input = root.locator("input.choices__input--cloned").first();
    await input.waitFor({ state: "visible", timeout: config.fastUiTimeoutMs });
    await input.fill(term);
    await page.waitForFunction("document.querySelectorAll('.choices__list--dropdown .choices__item--choice').length > 0", null, {
      timeout: config.choiceSearchTimeoutMs,
    }).catch(() => {});
    const choices = await collectChoiceOptions(page, selectId);
    lastSeen = choices.map((option) => option.text);
    let option: NativeOptionSnapshot;
    try {
      option = findKdkmpOption(choices, identity);
    } catch (error) {
      if (error instanceof Error && /ambigu/i.test(error.message)) throw error;
      await page.keyboard.press("Escape").catch(() => {});
      continue;
    }
    const matchedChoice = choices.find((choice) => choice.text === option.text && (!option.value || choice.value === option.value))
      ?? choices.find((choice) => choice.text === option.text);
    if (!matchedChoice) continue;
    await root.locator(".choices__list--dropdown .choices__item--choice").nth(matchedChoice.index).click();
    await select.dispatchEvent("change").catch(() => {});
    return;
  }

  throw new Error(`KDKMP "${formatKdkmpIdentity(identity)}" tidak ditemukan pada dropdown ${selectId}. Opsi terlihat: ${lastSeen.slice(0, 8).join(" | ") || "-"}.`);
}

async function resolveDestination(page: Page, destination: KdkmpIdentity) {
  const select = page.locator("#geraiTujuan").first();
  await select.waitFor({ state: "attached", timeout: 5_000 });
  const option = findKdkmpOption(await nativeOptions(select), destination);
  await select.selectOption({ value: option.value }, { timeout: 2_000 }).catch(async () => {
    await select.selectOption({ label: option.text }, { timeout: 2_000 });
  });
  await select.dispatchEvent("change").catch(() => {});
  return option;
}

async function setEntries100(page: Page, config: RunnerConfig) {
  const lengthSelect = page.locator('select[name="table-1_length"]').first();
  await lengthSelect.waitFor({ state: "visible", timeout: 5_000 });
  await lengthSelect.selectOption("100", { timeout: 2_000 });
  await waitForDataTableSettled(page, config);
}

async function waitForDataTableSettled(page: Page, config: RunnerConfig) {
  await page.waitForFunction(`(() => {
    const table = document.querySelector("table");
    const processingVisible = Array.from(document.querySelectorAll(".dataTables_processing, [id$='_processing']")).some((element) => {
      const style = window.getComputedStyle(element);
      const text = (element.textContent || "").trim();
      return Boolean(text) && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") !== 0;
    });
    const rowTexts = Array.from(document.querySelectorAll("table tbody tr"))
      .map((row) => (row.textContent || "").trim().replace(/\\s+/g, " "))
      .filter(Boolean);
    if (!table || processingVisible || rowTexts.length === 0) return false;
    return rowTexts.every((text) => !/loading|memuat|processing|mohon tunggu/i.test(text));
  })()`, null, { timeout: config.choiceSearchTimeoutMs + 5_000 });
}

async function waitForTransactionRows(page: Page, expectedCount: number, config: RunnerConfig) {
  await page.waitForFunction(`(() => {
    const expected = ${JSON.stringify(expectedCount)};
    const rows = Array.from(document.querySelectorAll("table tbody tr"));
    const meaningfulRows = rows.filter((row) => {
      const text = (row.textContent || "").trim();
      return text && !/tidak ditemukan|no matching|loading|memuat/i.test(text);
    });
    return meaningfulRows.length === expected;
  })()`, null, { timeout: Math.max(20_000, config.choiceSearchTimeoutMs + 12_000) });
}

async function waitForRowsToMatchKdkmp(page: Page, expected: KdkmpIdentity, config: RunnerConfig) {
  const expectedVillage = normalizeBelanjaText(expected.village).toLowerCase();
  await page.waitForFunction(`(() => {
    const village = ${JSON.stringify(expectedVillage)};
    const processingVisible = Array.from(document.querySelectorAll(".dataTables_processing, [id$='_processing']")).some((element) => {
      const style = window.getComputedStyle(element);
      const text = (element.textContent || "").trim();
      return Boolean(text) && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") !== 0;
    });
    const rows = Array.from(document.querySelectorAll("table tbody tr"));
    const rowTexts = rows
      .map((row) => (row.textContent || "").trim().replace(/\\s+/g, " "))
      .filter(Boolean);
    if (processingVisible || rowTexts.length === 0) return false;
    if (rowTexts.some((text) => /loading|memuat|processing|mohon tunggu/i.test(text))) return false;
    const emptyMarker = rowTexts.some((text) => /tidak ditemukan|tidak ada data|no matching|no data|kosong/i.test(text));
    const meaningfulRows = rowTexts.filter((text) => !/tidak ditemukan|tidak ada data|no matching|no data|kosong/i.test(text));
    if (meaningfulRows.length === 0) return emptyMarker;
    return meaningfulRows.every((text) => text.toLowerCase().includes(village));
  })()`, null, { timeout: Math.max(8_000, config.choiceSearchTimeoutMs + 5_000) });
}

async function readTransactionRows(page: Page): Promise<TargetTransactionRow[]> {
  return page.evaluate<Omit<TargetTransactionRow, "identityKey">[]>(`(() => {
    const textContent = (element) => (element?.textContent || "").trim().replace(/\\s+/g, " ");
    return Array.from(document.querySelectorAll("table tbody tr")).map((row, index) => {
      const cells = Array.from(row.querySelectorAll("td")).map((cell) => textContent(cell));
      const checkbox = row.querySelector('input.row-checkbox, input[type="checkbox"]');
      const edit = row.querySelector('a[title="Edit"], a[href*="/edit"]');
      const hasSelectionCell = cells.length >= 9;
      const offset = hasSelectionCell ? 2 : 1;
      return {
        rowIndex: index + 1,
        uuid: checkbox?.value || (edit ? new URL(edit.href, location.href).pathname.split('/').at(-2) : null),
        editHref: edit?.getAttribute("href") || null,
        kdkmpText: cells[offset] || "",
        stageText: cells[offset + 1] || "",
        itemText: cells[offset + 2] || "",
        belanjaCategoryText: cells[offset + 3] || "",
        totalText: cells[offset + 4] || "",
        dateText: cells[offset + 5] || "",
        identityKey: "",
      };
    }).filter((row) => row.stageText && row.itemText && row.belanjaCategoryText);
  })()`).then((rows) => rows.map((row) => ({
    ...row,
    identityKey: transactionIdentityKey({
      stageText: row.stageText,
      itemText: row.itemText,
      belanjaCategoryText: row.belanjaCategoryText,
    }),
  })));
}

function assertRowsBelongToKdkmp(rows: TargetTransactionRow[], expected: KdkmpIdentity, label: string) {
  const mismatches = rows.filter((row) => {
    const parsed = parseKdkmpOptionText(`${row.kdkmpText} (${expected.province ?? "Jawa Barat"}, ${expected.regency}, ${expected.district}, ${expected.village})`);
    return parsed && !sameKdkmpIdentity(parsed, expected);
  });
  if (mismatches.length > 0) {
    throw new Error(`${label} tidak cocok. Expected ${formatKdkmpIdentity(expected)}, tetapi baris tabel memuat: ${mismatches.slice(0, 3).map((row) => row.kdkmpText).join(" | ")}.`);
  }
}

function rowExactDuplicateKey(row: TargetTransactionRow) {
  return [
    normalizeBelanjaText(row.stageText).toLowerCase(),
    normalizeBelanjaText(row.itemText).toLowerCase(),
    normalizeBelanjaText(row.belanjaCategoryText).toLowerCase(),
    normalizeBelanjaText(row.totalText).toLowerCase(),
    normalizeBelanjaText(row.dateText).toLowerCase(),
  ].join("|");
}

function rowTotalAmount(row: TargetTransactionRow) {
  return normalizeBelanjaNumber(row.totalText);
}

function exactDuplicateGroups(rows: TargetTransactionRow[]) {
  const groups = new Map<string, TargetTransactionRow[]>();
  for (const row of rows) {
    const key = rowExactDuplicateKey(row);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  return Array.from(groups.values()).filter((group) => group.length > 1);
}

function budgetStageKey(value: string | null | undefined): BudgetStageKey | null {
  const text = normalizeBelanjaText(value).toUpperCase().replace(/_/g, " ");
  return /^(?:TAHAP\s*)?([IVXLCDM]+|\d+)(?=[\s.\-]|$)/.exec(text)?.[1] ?? null;
}

function transactionStageKey(transaction: BelanjaTransactionPayload): BudgetStageKey {
  return budgetStageKey(transaction.transactionIdentity.stageText)
    ?? budgetStageKey(transaction.transactionIdentity.categoryCode)
    ?? budgetStageKey(transaction.transactionIdentity.stageKey)
    ?? (() => { throw new Error(`Tahap transaksi tidak valid: ${transaction.namaItem}`); })();
}

function rowStageKey(row: TargetTransactionRow): BudgetStageKey {
  return budgetStageKey(row.stageText) ?? budgetStageKey(row.itemText)
    ?? (() => { throw new Error(`Tahap target tidak valid: ${row.stageText}`); })();
}

function targetRowIdentityKey(row: TargetTransactionRow) {
  return row.identityKey || transactionIdentityKey({
    stageText: row.stageText,
    itemText: row.itemText,
    belanjaCategoryText: row.belanjaCategoryText,
  });
}

function transactionBudgetIssue(
  transaction: BelanjaTransactionPayload,
  row: TargetTransactionRow | null,
  issue: BudgetTransactionIssue["issue"],
  actualTotal = row ? rowTotalAmount(row) : 0,
): BudgetTransactionIssue {
  const expectedTotal = roundBelanjaMoney(transaction.totalAmount);
  return {
    stageKey: transactionStageKey(transaction),
    kind: transaction.kind,
    transactionId: transaction.transactionId,
    itemName: transaction.namaItem,
    categoryCode: transaction.transactionIdentity.categoryCode,
    date: transaction.transactionIdentity.transactionDate,
    expectedTotal,
    actualTotal: roundBelanjaMoney(actualTotal),
    difference: roundBelanjaMoney(actualTotal - expectedTotal),
    rowIndex: row?.rowIndex,
    issue,
  };
}

function extraBudgetIssue(row: TargetTransactionRow): BudgetTransactionIssue {
  return {
    stageKey: rowStageKey(row),
    kind: transactionKindFromBelanjaCategory(row.belanjaCategoryText),
    itemName: row.itemText,
    categoryCode: /\b([IVX]+\.\d+)\b/i.exec(row.itemText)?.[1] ?? "",
    date: normalizeBelanjaIsoDate(row.dateText),
    expectedTotal: 0,
    actualTotal: roundBelanjaMoney(rowTotalAmount(row)),
    difference: roundBelanjaMoney(rowTotalAmount(row)),
    rowIndex: row.rowIndex,
    issue: "extra",
  };
}

function sortedRowsForBudget(rows: TargetTransactionRow[]) {
  return [...rows].sort((left, right) => {
    const dateOrder = normalizeBelanjaIsoDate(left.dateText).localeCompare(normalizeBelanjaIsoDate(right.dateText));
    return dateOrder || left.rowIndex - right.rowIndex;
  });
}

function sortedTransactionsForBudget(transactions: BelanjaTransactionPayload[]) {
  return [...transactions].sort((left, right) => {
    const dateOrder = left.transactionIdentity.transactionDate.localeCompare(right.transactionIdentity.transactionDate);
    return dateOrder || left.sequence - right.sequence;
  });
}

function transactionIssuePriority(issue: BudgetTransactionIssue) {
  const kindScore = issue.kind === "material" ? 0 : issue.kind === "equipment" ? 1 : 2;
  const issueScore = issue.issue === "total_mismatch" ? 0 : issue.issue === "missing" ? 1 : 2;
  return kindScore * 10 + issueScore;
}

function sortBudgetIssues(issues: BudgetTransactionIssue[]) {
  return [...issues].sort((left, right) => {
    return transactionIssuePriority(left) - transactionIssuePriority(right)
      || Math.abs(right.difference) - Math.abs(left.difference)
      || left.date.localeCompare(right.date)
      || left.itemName.localeCompare(right.itemName);
  });
}

export function diagnoseDestinationBudget(rows: TargetTransactionRow[], transactions: BelanjaTransactionPayload[]): DestinationBudgetDiagnostic {
  const expectedTotal = roundBelanjaMoney(transactions.reduce((sum, transaction) => sum + transaction.totalAmount, 0));
  const actualTotal = roundBelanjaMoney(rows.reduce((sum, row) => sum + rowTotalAmount(row), 0));
  const rowsByKey = new Map<string, TargetTransactionRow[]>();
  const transactionsByKey = new Map<string, BelanjaTransactionPayload[]>();

  for (const row of rows) {
    const key = targetRowIdentityKey(row);
    rowsByKey.set(key, [...(rowsByKey.get(key) ?? []), row]);
  }
  for (const transaction of transactions) {
    const key = planIdentityKey(transaction);
    transactionsByKey.set(key, [...(transactionsByKey.get(key) ?? []), transaction]);
  }

  const issueByStage = new Map<BudgetStageKey, BudgetTransactionIssue[]>();
  const addIssue = (issue: BudgetTransactionIssue) => {
    issueByStage.set(issue.stageKey, [...(issueByStage.get(issue.stageKey) ?? []), issue]);
  };

  const keys = new Set([...rowsByKey.keys(), ...transactionsByKey.keys()]);
  for (const key of keys) {
    const keyTransactions = sortedTransactionsForBudget(transactionsByKey.get(key) ?? []);
    const keyRows = sortedRowsForBudget(rowsByKey.get(key) ?? []);
    const length = Math.max(keyTransactions.length, keyRows.length);
    for (let index = 0; index < length; index += 1) {
      const transaction = keyTransactions[index];
      const row = keyRows[index];
      if (transaction && row) {
        const actualRowTotal = rowTotalAmount(row);
        const difference = roundBelanjaMoney(actualRowTotal - transaction.totalAmount);
        if (difference !== 0) {
          addIssue(transactionBudgetIssue(transaction, row, "total_mismatch", actualRowTotal));
        }
      } else if (transaction) {
        addIssue(transactionBudgetIssue(transaction, null, "missing"));
      } else if (row) {
        addIssue(extraBudgetIssue(row));
      }
    }
  }

  const stageKeys = [...new Set([...transactions.map(transactionStageKey), ...rows.map(rowStageKey)])].sort((a, b) => a.localeCompare(b));
  const stages = stageKeys.map((stageKey): BudgetStageDiagnostic => {
    const expectedTransactions = transactions.filter((transaction) => transactionStageKey(transaction) === stageKey);
    const actualRows = rows.filter((row) => rowStageKey(row) === stageKey);
    return {
      stageKey,
      expectedCount: expectedTransactions.length,
      actualCount: actualRows.length,
      expectedTotal: roundBelanjaMoney(expectedTransactions.reduce((sum, transaction) => sum + transaction.totalAmount, 0)),
      actualTotal: roundBelanjaMoney(actualRows.reduce((sum, row) => sum + rowTotalAmount(row), 0)),
      difference: roundBelanjaMoney(actualRows.reduce((sum, row) => sum + rowTotalAmount(row), 0) - expectedTransactions.reduce((sum, transaction) => sum + transaction.totalAmount, 0)),
      issues: sortBudgetIssues(issueByStage.get(stageKey) ?? []),
    };
  });

  return {
    expectedTotal,
    actualTotal,
    totalDifference: roundBelanjaMoney(actualTotal - expectedTotal),
    duplicateGroups: exactDuplicateGroups(rows),
    stages,
  };
}

function formatBelanjaMoney(amount: number) {
  return `Rp ${new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}`;
}

function issueLabel(issue: BudgetTransactionIssue["issue"]) {
  if (issue === "missing") return "belum ada di target";
  if (issue === "extra") return "lebih di target";
  return "total beda";
}

export function formatBudgetDiagnostics(diagnostic: DestinationBudgetDiagnostic, options: { maxStages?: number; maxIssues?: number } = {}) {
  const maxStages = options.maxStages ?? 7;
  const maxIssues = options.maxIssues ?? 8;
  const stageDiffs = diagnostic.stages
    .filter(stageNeedsBudgetReconcile)
    .slice(0, maxStages);
  const stageText = stageDiffs.length > 0
    ? ` Selisih per tahap: ${stageDiffs.map((stage) => `Tahap ${stage.stageKey} target ${formatBelanjaMoney(stage.actualTotal)} vs Web Nota ${formatBelanjaMoney(stage.expectedTotal)} = ${formatBelanjaMoney(stage.difference)} (${stage.actualCount}/${stage.expectedCount} transaksi)`).join("; ")}.`
    : " Selisih per tahap tidak terdeteksi dari tabel ringkasan.";
  const issues = stageDiffs.flatMap((stage) => stage.issues.map((issue) => ({ ...issue, stageKey: stage.stageKey }))).slice(0, maxIssues);
  const issueText = issues.length > 0
    ? ` Kandidat transaksi: ${issues.map((issue) => `Tahap ${issue.stageKey} ${issue.kind} "${issue.itemName}" ${issueLabel(issue.issue)} expected ${formatBelanjaMoney(issue.expectedTotal)} target ${formatBelanjaMoney(issue.actualTotal)} selisih ${formatBelanjaMoney(issue.difference)}${issue.rowIndex ? ` row #${issue.rowIndex}` : ""}`).join("; ")}.`
    : "";
  const duplicateText = diagnostic.duplicateGroups.length > 0
    ? ` Duplicate exact ${diagnostic.duplicateGroups.length} grup; contoh: ${diagnostic.duplicateGroups.slice(0, 5).map((group) => `${group.length}x ${group[0].itemText} / ${group[0].belanjaCategoryText} / ${group[0].dateText} / ${group[0].totalText}`).join("; ")}.`
    : " Duplicate exact tidak ditemukan.";
  return `Total target ${formatBelanjaMoney(diagnostic.actualTotal)}, total Web Nota ${formatBelanjaMoney(diagnostic.expectedTotal)}, selisih ${formatBelanjaMoney(diagnostic.totalDifference)}.${stageText}${issueText} ${duplicateText}`;
}

function summarizeDestinationRows(rows: TargetTransactionRow[], claim: ClaimedBelanjaSyncJob) {
  return formatBudgetDiagnostics(diagnoseDestinationBudget(rows, claim.transactions));
}

function destinationBudgetIsBalanced(diagnostic: DestinationBudgetDiagnostic) {
  return diagnostic.totalDifference === 0
    && diagnostic.stages.every((stage) => stage.difference === 0 && stage.expectedCount === stage.actualCount && stage.issues.length === 0)
    && diagnostic.duplicateGroups.length === 0;
}

function stageNeedsBudgetReconcile(stage: BudgetStageDiagnostic) {
  return stage.difference !== 0 || stage.expectedCount !== stage.actualCount || stage.issues.length > 0;
}

function stageNeedsFullReconcile(stage: BudgetStageDiagnostic) {
  return stage.expectedCount !== stage.actualCount || stage.issues.some((issue) => issue.issue !== "total_mismatch");
}

export function planStageBudgetReconcile(
  rows: TargetTransactionRow[],
  transactions: BelanjaTransactionPayload[],
  diagnostic: DestinationBudgetDiagnostic = diagnoseDestinationBudget(rows, transactions),
): StageBudgetReconcilePlan {
  const stageKeys = diagnostic.stages.map((stage) => stage.stageKey);
  if (rows.length !== transactions.length) {
    return {
      mode: "full",
      reason: `Jumlah transaksi target ${rows.length} tidak sama dengan Web Nota ${transactions.length}.`,
      balancedStageKeys: [],
      mismatchedStageKeys: stageKeys,
      fullStageKeys: stageKeys,
      transactionIdsToEdit: transactions.map((transaction) => transaction.transactionId),
    };
  }
  if (diagnostic.duplicateGroups.length > 0) {
    return {
      mode: "full",
      reason: `Terdeteksi ${diagnostic.duplicateGroups.length} grup transaksi duplikat.`,
      balancedStageKeys: [],
      mismatchedStageKeys: stageKeys,
      fullStageKeys: stageKeys,
      transactionIdsToEdit: transactions.map((transaction) => transaction.transactionId),
    };
  }

  const mismatchedStages = diagnostic.stages.filter(stageNeedsBudgetReconcile);
  const mismatchedStageKeys = new Set(mismatchedStages.map((stage) => stage.stageKey));
  const fullStageKeys = new Set(mismatchedStages.filter(stageNeedsFullReconcile).map((stage) => stage.stageKey));
  const directTransactionIds = new Set<string>();

  for (const stage of mismatchedStages) {
    const directIssues = stage.issues.filter((issue) => issue.issue === "total_mismatch" && issue.transactionId);
    if (stage.difference !== 0 && directIssues.length === 0) fullStageKeys.add(stage.stageKey);
    for (const issue of directIssues) {
      if (issue.transactionId) directTransactionIds.add(issue.transactionId);
    }
  }

  for (const transaction of transactions) {
    if (fullStageKeys.has(transactionStageKey(transaction))) directTransactionIds.add(transaction.transactionId);
  }

  return {
    mode: "targeted",
    balancedStageKeys: stageKeys.filter((stageKey) => !mismatchedStageKeys.has(stageKey)),
    mismatchedStageKeys: [...mismatchedStageKeys],
    fullStageKeys: [...fullStageKeys],
    transactionIdsToEdit: [...directTransactionIds],
  };
}

export function shouldReconcileTransactionForStageBudgetPlan(
  transaction: BelanjaTransactionPayload,
  plan: StageBudgetReconcilePlan,
) {
  if (plan.mode === "full") return true;
  return plan.transactionIdsToEdit.includes(transaction.transactionId);
}

function pairBudgetRows(transactions: BelanjaTransactionPayload[], rows: TargetTransactionRow[]) {
  const rowsByKey = new Map<string, TargetTransactionRow[]>();
  const transactionsByKey = new Map<string, BelanjaTransactionPayload[]>();
  for (const row of rows) {
    const key = targetRowIdentityKey(row);
    rowsByKey.set(key, [...(rowsByKey.get(key) ?? []), row]);
  }
  for (const transaction of transactions) {
    const key = planIdentityKey(transaction);
    transactionsByKey.set(key, [...(transactionsByKey.get(key) ?? []), transaction]);
  }

  const pairs: Array<{ transaction: BelanjaTransactionPayload; row: TargetTransactionRow }> = [];
  for (const [key, keyTransactions] of transactionsByKey.entries()) {
    const keyRows = sortedRowsForBudget(rowsByKey.get(key) ?? []);
    const sortedTransactions = sortedTransactionsForBudget(keyTransactions);
    for (let index = 0; index < sortedTransactions.length; index += 1) {
      if (keyRows[index]) pairs.push({ transaction: sortedTransactions[index], row: keyRows[index] });
    }
  }
  return pairs;
}

function makeBudgetRepairCandidate(transaction: BelanjaTransactionPayload, row: TargetTransactionRow): DestinationBudgetRepairCandidate {
  const actualTotal = rowTotalAmount(row);
  return {
    stageKey: transactionStageKey(transaction),
    kind: transaction.kind,
    transactionId: transaction.transactionId,
    itemName: transaction.namaItem,
    expectedTotal: roundBelanjaMoney(transaction.totalAmount),
    actualTotal: roundBelanjaMoney(actualTotal),
    difference: roundBelanjaMoney(actualTotal - transaction.totalAmount),
    rowIndex: row.rowIndex,
    transaction,
    row,
  };
}

function sortBudgetRepairCandidates(candidates: DestinationBudgetRepairCandidate[]) {
  return [...candidates].sort((left, right) => {
    const leftIssue = transactionBudgetIssue(left.transaction, left.row, "total_mismatch", left.actualTotal);
    const rightIssue = transactionBudgetIssue(right.transaction, right.row, "total_mismatch", right.actualTotal);
    return transactionIssuePriority(leftIssue) - transactionIssuePriority(rightIssue)
      || Math.abs(right.difference) - Math.abs(left.difference)
      || left.transaction.transactionIdentity.transactionDate.localeCompare(right.transaction.transactionIdentity.transactionDate)
      || left.transaction.sequence - right.transaction.sequence;
  });
}

export function planDestinationBudgetRepairs(
  rows: TargetTransactionRow[],
  transactions: BelanjaTransactionPayload[],
  diagnostic: DestinationBudgetDiagnostic = diagnoseDestinationBudget(rows, transactions),
) {
  const mismatchedStages = new Set(diagnostic.stages
    .filter((stage) => stage.difference !== 0 || stage.issues.some((issue) => issue.issue === "total_mismatch"))
    .map((stage) => stage.stageKey));
  const directIssueKeys = new Set(diagnostic.stages.flatMap((stage) => stage.issues)
    .filter((issue) => issue.issue === "total_mismatch" && issue.transactionId && issue.rowIndex)
    .map((issue) => `${issue.transactionId}|${issue.rowIndex}`));
  const candidates = new Map<string, DestinationBudgetRepairCandidate>();

  for (const pair of pairBudgetRows(transactions, rows)) {
    const candidate = makeBudgetRepairCandidate(pair.transaction, pair.row);
    const directKey = `${candidate.transactionId}|${candidate.rowIndex}`;
    const rowMismatch = candidate.difference !== 0;
    const stageMismatch = mismatchedStages.has(candidate.stageKey);
    if (!directIssueKeys.has(directKey) && (!stageMismatch || !rowMismatch)) continue;
    const uniqueKey = `${candidate.transactionId}|${candidate.row.uuid ?? candidate.rowIndex}`;
    candidates.set(uniqueKey, candidate);
  }

  return sortBudgetRepairCandidates(Array.from(candidates.values()));
}

function formattedNumber(value: number) {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(value);
}

function pushNumericIssue(issues: string[], label: string, itemName: string, expected: number, actual: number, tolerance: number) {
  if (Math.abs(actual - expected) > tolerance) {
    issues.push(`${label} "${itemName}" expected ${formattedNumber(expected)} target ${formattedNumber(actual)}`);
  }
}

function compareDetailLines(transaction: BelanjaTransactionPayload, actualLines: DetailLine[]) {
  const issues: string[] = [];

  if (actualLines.length !== transaction.lines.length) {
    issues.push(`Jumlah detail expected ${transaction.lines.length} target ${actualLines.length}`);
  }

  const used = new Set<number>();
  for (const line of transaction.lines) {
    let target: DetailLine;
    try {
      target = matchLine(line, actualLines, used, { allowDuplicateNames: transaction.kind === "honorarium" });
    } catch (error) {
      issues.push(error instanceof Error ? error.message : `Detail "${line.namaItem}" tidak ditemukan.`);
      continue;
    }

    if (transaction.kind === "honorarium") {
      const expectedRecipient = honorariumRecipient(line, target.recipient);
      const actualRecipient = normalizeBelanjaText(target.recipient);
      pushNumericIssue(issues, "Qty honorarium", line.namaItem, line.qty, target.qty ?? 0, 0.01);
      pushNumericIssue(issues, "Tarif honorarium", line.namaItem, line.hargaSatuan, target.unitPrice ?? 0, 0.01);
      pushNumericIssue(issues, "Subtotal honorarium", line.namaItem, line.jumlah, target.subtotal ?? 0, 1);
      if (target.paymentDate && target.paymentDate !== line.tanggal) {
        issues.push(`Tanggal bayar honorarium "${line.namaItem}" expected ${line.tanggal} target ${target.paymentDate}`);
      }
      if (expectedRecipient && actualRecipient && !belanjaTextMatches(actualRecipient, expectedRecipient)) {
        issues.push(`Penerima honorarium "${line.namaItem}" expected ${expectedRecipient} target ${actualRecipient}`);
      }
      continue;
    }

    const priceLabel = transaction.kind === "equipment" ? "Tarif sewa" : "Harga satuan";
    if (!detailQuantityMatches(line, target)) {
      pushNumericIssue(issues, "Qty", line.namaItem, line.qty, target.qty ?? 0, 0.01);
    }
    pushNumericIssue(issues, priceLabel, line.namaItem, line.hargaSatuan, target.unitPrice ?? 0, 0.01);
    pushNumericIssue(issues, "Subtotal", line.namaItem, line.jumlah, target.subtotal ?? 0, 1);
    if (target.unit && line.satuan && !belanjaTextMatches(target.unit, line.satuan)) {
      issues.push(`Satuan "${line.namaItem}" expected ${line.satuan} target ${target.unit}`);
    }
    if (target.paymentDate && target.paymentDate !== line.tanggal) {
      issues.push(`Tanggal bayar "${line.namaItem}" expected ${line.tanggal} target ${target.paymentDate}`);
    }
  }

  return issues;
}

async function inspectTransactionFieldDifferences(page: Page, config: RunnerConfig, transaction: BelanjaTransactionPayload, row: TargetTransactionRow) {
  await openEditPage(page, config, row);
  const issues: string[] = [];
  const actualDate = normalizeBelanjaIsoDate(await inputValue(page, "tanggal", 0));
  if (actualDate && actualDate !== transaction.transactionIdentity.transactionDate) {
    issues.push(`Tanggal transaksi expected ${transaction.transactionIdentity.transactionDate} target ${actualDate}`);
  }
  const actualLines = await readDetailLines(page, transaction.kind);
  issues.push(...compareDetailLines(transaction, actualLines));
  return issues;
}

async function inspectMismatchedStageDetails(page: Page, config: RunnerConfig, claim: ClaimedBelanjaSyncJob, rows: TargetTransactionRow[], diagnostic: DestinationBudgetDiagnostic) {
  const mismatchedStages = new Set(diagnostic.stages
    .filter(stageNeedsBudgetReconcile)
    .map((stage) => stage.stageKey));
  if (mismatchedStages.size === 0) return "";

  const pairs = pairBudgetRows(claim.transactions, rows)
    .filter(({ transaction }) => mismatchedStages.has(transactionStageKey(transaction)))
    .sort((left, right) => transactionIssuePriority({
      stageKey: transactionStageKey(left.transaction),
      kind: left.transaction.kind,
      itemName: left.transaction.namaItem,
      categoryCode: left.transaction.transactionIdentity.categoryCode,
      date: left.transaction.transactionIdentity.transactionDate,
      expectedTotal: left.transaction.totalAmount,
      actualTotal: rowTotalAmount(left.row),
      difference: rowTotalAmount(left.row) - left.transaction.totalAmount,
      issue: "total_mismatch",
    }) - transactionIssuePriority({
      stageKey: transactionStageKey(right.transaction),
      kind: right.transaction.kind,
      itemName: right.transaction.namaItem,
      categoryCode: right.transaction.transactionIdentity.categoryCode,
      date: right.transaction.transactionIdentity.transactionDate,
      expectedTotal: right.transaction.totalAmount,
      actualTotal: rowTotalAmount(right.row),
      difference: rowTotalAmount(right.row) - right.transaction.totalAmount,
      issue: "total_mismatch",
    }) || Math.abs(rowTotalAmount(right.row) - right.transaction.totalAmount) - Math.abs(rowTotalAmount(left.row) - left.transaction.totalAmount));

  const detailIssues: string[] = [];
  for (const { transaction, row } of pairs.slice(0, 18)) {
    try {
      const issues = await inspectTransactionFieldDifferences(page, config, transaction, row);
      if (issues.length > 0) {
        detailIssues.push(`Tahap ${transactionStageKey(transaction)} ${transaction.kind} "${transaction.namaItem}" row #${row.rowIndex}: ${issues.slice(0, 5).join(", ")}`);
      }
    } catch (error) {
      detailIssues.push(`Tahap ${transactionStageKey(transaction)} "${transaction.namaItem}" row #${row.rowIndex}: gagal baca detail edit (${error instanceof Error ? error.message : "unknown"})`);
    }
  }

  if (detailIssues.length === 0) {
    return " Detail field tahap selisih sudah dicek, tetapi perbedaan field tidak terlihat dari halaman edit; kemungkinan tabel target belum refresh atau perhitungan total target berbeda.";
  }
  return ` Detail field tahap selisih: ${detailIssues.slice(0, 10).join("; ")}.`;
}

function budgetRepairCandidateLabel(candidate: DestinationBudgetRepairCandidate) {
  return `Tahap ${candidate.stageKey} ${candidate.kind} "${candidate.itemName}" row #${candidate.rowIndex} target ${formatBelanjaMoney(candidate.actualTotal)} vs Web Nota ${formatBelanjaMoney(candidate.expectedTotal)}`;
}

async function repairDestinationBudgetMismatches(
  page: Page,
  config: RunnerConfig,
  api: BelanjaSyncApiClient,
  claim: ClaimedBelanjaSyncJob,
  initialRows: TargetTransactionRow[],
  initialDiagnostic: DestinationBudgetDiagnostic,
) {
  let rows = initialRows;
  let diagnostic = initialDiagnostic;
  const repairedTransactions: string[] = [];
  let repairPasses = 0;

  for (let pass = 1; pass <= FINAL_BUDGET_REPAIR_MAX_PASSES; pass += 1) {
    if (destinationBudgetIsBalanced(diagnostic)) break;
    if (rows.length !== claim.expectedTransactionCount || diagnostic.duplicateGroups.length > 0) break;

    const candidates = planDestinationBudgetRepairs(rows, claim.transactions, diagnostic);
    if (candidates.length === 0) break;

    repairPasses = pass;
    logJob(claim.job.id, `stage=VERIFYING action=auto_repair pass=${pass}/${FINAL_BUDGET_REPAIR_MAX_PASSES} candidates=${candidates.length} difference=${diagnostic.totalDifference}`);
    await api.checkpointJob(claim.job.id, {
      stage: "VERIFYING",
      stageMessage: `Final verification menemukan selisih; memperbaiki otomatis ${candidates.length} transaksi kandidat (pass ${pass}/${FINAL_BUDGET_REPAIR_MAX_PASSES}).`,
      progress: {
        current: claim.expectedTransactionCount,
        verifiedTransactions: claim.expectedTransactionCount,
      },
      report: {
        expectedTotalAmount: diagnostic.expectedTotal,
        actualTotalAmount: diagnostic.actualTotal,
        totalDifference: diagnostic.totalDifference,
        budgetRepairAttempts: pass,
        budgetRepairedTransactions: repairedTransactions.length,
      },
    });

    for (const candidate of candidates) {
      logJob(claim.job.id, `stage=VERIFYING action=auto_repair_transaction ${budgetRepairCandidateLabel(candidate)}`);
      try {
        await reconcileOneTransaction(page, config, candidate.transaction, candidate.row);
        repairedTransactions.push(budgetRepairCandidateLabel(candidate));
      } catch (error) {
        const screenshotPath = await saveJobScreenshot(page, config, claim.job.id, `final-repair-failed-${candidate.transaction.sequence}`);
        const message = error instanceof Error ? error.message : "Repair otomatis final budget gagal.";
        throw new Error(`Repair otomatis final budget gagal pada ${budgetRepairCandidateLabel(candidate)}. ${message} Screenshot: ${screenshotPath}`);
      }
    }

    rows = await readDestinationTransactionRows(page, config, claim);
    diagnostic = diagnoseDestinationBudget(rows, claim.transactions);
    await api.checkpointJob(claim.job.id, {
      stage: "VERIFYING",
      stageMessage: `Repair otomatis pass ${pass} selesai; selisih sekarang ${formatBelanjaMoney(diagnostic.totalDifference)}.`,
      progress: {
        current: claim.expectedTransactionCount,
        verifiedTransactions: claim.expectedTransactionCount,
      },
      report: {
        expectedTotalAmount: diagnostic.expectedTotal,
        actualTotalAmount: diagnostic.actualTotal,
        totalDifference: diagnostic.totalDifference,
        budgetRepairAttempts: pass,
        budgetRepairedTransactions: repairedTransactions.length,
        budgetRepairDetails: repairedTransactions.slice(-12),
      },
    });
  }

  return {
    rows,
    diagnostic,
    repairPasses,
    repairedTransactions,
  };
}

async function openSourceMaleber(page: Page, config: RunnerConfig, claim: ClaimedBelanjaSyncJob) {
  await gotoBelanjaList(page, config);
  await selectKdkmpChoice(page, config, "gerai", claim.sourceKdkmp);
  await setEntries100(page, config);
  await waitForTransactionRows(page, claim.expectedTransactionCount, config);
  const rows = await readTransactionRows(page);
  if (rows.length !== claim.expectedTransactionCount) {
    throw new Error(`Copy dibatalkan. Expected transaksi Maleber: ${claim.expectedTransactionCount}. Transaksi terdeteksi: ${rows.length}.`);
  }
  assertRowsBelongToKdkmp(rows, claim.sourceKdkmp, "Source Maleber");
  return rows;
}

async function selectAllSourceRows(page: Page, expectedCount: number) {
  const chooseButton = page.locator("#btnPilihTransaksi").first();
  await chooseButton.waitFor({ state: "visible", timeout: 5_000 });
  await chooseButton.click();
  const checkboxes = page.locator("input.form-check-input.row-checkbox");
  await checkboxes.first().waitFor({ state: "attached", timeout: 5_000 });
  const count = await checkboxes.count();
  if (count !== expectedCount) {
    throw new Error(`Copy dibatalkan. Expected transaksi Maleber: ${expectedCount}. Checkbox terdeteksi: ${count}.`);
  }
  await checkboxes.evaluateAll(function (items) {
    for (const item of items) {
      const checkbox = item as HTMLInputElement;
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event("input", { bubbles: true }));
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  const checkedCount = await checkboxes.evaluateAll(function (items) {
    return items.filter((item) => (item as HTMLInputElement).checked).length;
  });
  if (checkedCount !== expectedCount) {
    throw new Error(`Copy dibatalkan. Expected selected: ${expectedCount}. Selected terdeteksi: ${checkedCount}.`);
  }
}

async function verifyCopyModal(page: Page, claim: ClaimedBelanjaSyncJob) {
  const copyButton = page.locator("#btnSalinKeGerai").first();
  await copyButton.waitFor({ state: "visible", timeout: 5_000 });
  await copyButton.click();
  const submitButton = page.locator("#btnSubmitSalin").first();
  await submitButton.waitFor({ state: "visible", timeout: 5_000 });
  await resolveDestination(page, claim.destinationKdkmp);

  const modalText = await page.locator(".modal.show, [role='dialog']").first().innerText().catch(() => "");
  const detectedCount = Number(/(\d+)\s+transaksi/i.exec(modalText)?.[1] ?? claim.expectedTransactionCount);
  if (detectedCount !== claim.expectedTransactionCount) {
    throw new Error(`Modal copy menampilkan ${detectedCount} transaksi, expected ${claim.expectedTransactionCount}.`);
  }

  const firstConfirm = page.locator("#confirmPeriksa").first();
  const secondConfirm = page.locator("#confirmYakin").first();
  await firstConfirm.waitFor({ state: "attached", timeout: 5_000 });
  await secondConfirm.waitFor({ state: "attached", timeout: 5_000 });
  return { submitButton, firstConfirm, secondConfirm };
}

async function verifyEditFieldPresence(page: Page, config: RunnerConfig, rows: TargetTransactionRow[]) {
  const materialRow = rows.find((row) => transactionKindFromBelanjaCategory(row.belanjaCategoryText) === "material");
  const honorariumRow = rows.find((row) => transactionKindFromBelanjaCategory(row.belanjaCategoryText) === "honorarium");
  const equipmentRow = rows.find((row) => transactionKindFromBelanjaCategory(row.belanjaCategoryText) === "equipment");
  if (!materialRow) throw new Error("Dry-run gagal: transaksi material template tidak ditemukan.");
  if (!honorariumRow) throw new Error("Dry-run gagal: transaksi honorarium template tidak ditemukan.");

  await openEditPage(page, config, materialRow);
  for (const selector of [
    'input[name="tanggal"]',
    'select[name="nama_material[]"]',
    'input[name="jumlah_material[]"]',
    'input[name="harga_material[]"]',
    'input[name="tanggal_bayar[]"]',
  ]) {
    await page.locator(selector).first().waitFor({ state: "attached", timeout: 5_000 });
  }

  await openEditPage(page, config, honorariumRow);
  for (const selector of [
    'select[name="jenis_tukang[]"]',
    'input[name="nama_penyedia[]"]',
  ]) {
    await page.locator(selector).first().waitFor({ state: "attached", timeout: 5_000 });
  }

  if (equipmentRow) {
    await openEditPage(page, config, equipmentRow);
    for (const selector of [
      'select[name="nama_alat[]"]',
      'input[name="jumlah_durasi[]"]',
      'input[name="tarif_sewa[]"]',
    ]) {
      await page.locator(selector).first().waitFor({ state: "attached", timeout: 5_000 });
    }
  }
}

export async function copyBaseTransactions(page: Page, config: RunnerConfig, api: BelanjaSyncApiClient, claim: ClaimedBelanjaSyncJob) {
  await checkpoint(api, claim, "SOURCE_OPENED", `Membuka template ${formatKdkmpIdentity(claim.sourceKdkmp)}.`, { current: 0 });
  const sourceRows = await openSourceMaleber(page, config, claim);
  await selectAllSourceRows(page, claim.expectedTransactionCount);
  await checkpoint(api, claim, "SOURCE_SELECTED", `Memilih ${claim.expectedTransactionCount} transaksi template Maleber.`, {
    current: 0,
    copiedTransactions: 0,
  });

  const modal = await verifyCopyModal(page, claim);
  await checkpoint(api, claim, "COPY_STARTED", `Siap menyalin transaksi ke ${formatKdkmpIdentity(claim.destinationKdkmp)}.`, {
    current: 0,
    copiedTransactions: 0,
  });

  if (resolveEffectiveDryRun(config, claim.job)) {
    await saveJobScreenshot(page, config, claim.job.id, "dry-run-copy-modal");
    await page.keyboard.press("Escape").catch(() => {});
    await verifyEditFieldPresence(page, config, sourceRows);
    await checkpoint(api, claim, "COPY_CONFIRMED", "DRY_RUN_OK: modal copy, destination, dan checkbox konfirmasi ditemukan. Tidak melakukan copy.", {
      copiedTransactions: 0,
    });
    return { copied: false, rows: sourceRows };
  }

  await modal.firstConfirm.check({ force: true });
  await modal.secondConfirm.check({ force: true });
  await checkpoint(api, claim, "COPY_CONFIRMED", `Konfirmasi copy ${claim.expectedTransactionCount} transaksi sudah dicentang.`, {
    current: 0,
    copiedTransactions: 0,
  });
  await modal.submitButton.click();
  const successText = page.getByText(/berhasil|tersimpan|sukses|success/i).first();
  const successVisible = await successText.waitFor({ state: "visible", timeout: config.copySuccessWaitMs })
    .then(() => true)
    .catch(async () => {
      await page.waitForLoadState("domcontentloaded", { timeout: 2_000 }).catch(() => {});
      return successText.isVisible().catch(() => false);
    });
  if (!successVisible) {
    throw new Error("Bukti copy berhasil tidak ditemukan setelah klik Salin Transaksi. Jangan retry copy otomatis; cek target manual untuk memastikan tidak ada duplikasi.");
  }
  await checkpoint(api, claim, "DESTINATION_COPIED", `Copy berhasil ke ${formatKdkmpIdentity(claim.destinationKdkmp)}.`, {
    copiedTransactions: claim.expectedTransactionCount,
  });
  return { copied: true, rows: sourceRows };
}

async function openDestinationTransactions(page: Page, config: RunnerConfig, claim: ClaimedBelanjaSyncJob) {
  const rows = await readDestinationTransactionRows(page, config, claim);
  if (rows.length !== claim.expectedTransactionCount) {
    throw new Error(`Expected ${claim.expectedTransactionCount} transaksi destination, tetapi ditemukan ${rows.length}. ${summarizeDestinationRows(rows, claim)}`);
  }
  return rows;
}

export async function readDestinationTransactionRows(page: Page, config: RunnerConfig, claim: ClaimedBelanjaSyncJob) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= TARGET_NAVIGATION_ATTEMPTS; attempt += 1) {
    try {
      await gotoBelanjaList(page, config);
      await selectKdkmpChoice(page, config, "gerai", claim.destinationKdkmp);
      await setEntries100(page, config);
      await waitForRowsToMatchKdkmp(page, claim.destinationKdkmp, config);
      const rows = await readTransactionRows(page);
      if (rows.length > 0) assertRowsBelongToKdkmp(rows, claim.destinationKdkmp, "Destination");
      return rows;
    } catch (error) {
      lastError = error;
      if (attempt >= TARGET_NAVIGATION_ATTEMPTS) break;
      logJob(claim.job.id, `stage=${claim.stage} action=retry_destination_rows attempt=${attempt + 1}/${TARGET_NAVIGATION_ATTEMPTS}`);
      await page.waitForTimeout(1_000 * attempt);
    }
  }
  const message = lastError instanceof Error ? lastError.message : "unknown";
  throw new Error(`Gagal membaca transaksi destination setelah ${TARGET_NAVIGATION_ATTEMPTS} percobaan. ${message}`);
}

async function destinationAlreadyHasExpectedTransactions(page: Page, config: RunnerConfig, claim: ClaimedBelanjaSyncJob) {
  try {
    const rows = await openDestinationTransactions(page, config, claim);
    return rows.length === claim.expectedTransactionCount;
  } catch {
    return false;
  }
}

export function matchResumeToTargetTransaction(transactions: BelanjaTransactionPayload[], targetRows: TargetTransactionRow[], snapshots?: Map<string, TransactionSnapshot>) {
  const byKey = new Map<string, TargetTransactionRow[]>();
  for (const row of targetRows) {
    const list = byKey.get(row.identityKey) ?? [];
    list.push(row);
    byKey.set(row.identityKey, list);
  }

  const planByKey = new Map<string, BelanjaTransactionPayload[]>();
  for (const transaction of transactions) {
    const key = planIdentityKey(transaction);
    const list = planByKey.get(key) ?? [];
    list.push(transaction);
    planByKey.set(key, list);
  }

  const matches: Array<{ transaction: BelanjaTransactionPayload; row: TargetTransactionRow }> = [];
  for (const [key, planRows] of planByKey.entries()) {
    const rows = (byKey.get(key) ?? []).sort((left, right) => left.dateText.localeCompare(right.dateText) || left.rowIndex - right.rowIndex);
    const sortedPlan = planRows.sort((left, right) => left.transactionIdentity.transactionDate.localeCompare(right.transactionIdentity.transactionDate) || left.sequence - right.sequence);
    if (rows.length !== sortedPlan.length) {
      throw new Error(`Mapping transaksi ambigu untuk key ${key}. Resume membentuk ${sortedPlan.length}, target menemukan ${rows.length}.`);
    }
    for (let index = 0; index < sortedPlan.length; index += 1) {
      const transaction = sortedPlan[index];
      let chosen = rows[index];
      if (snapshots) {
        const available = rows.filter((row) => !matches.some((entry) => entry.row.editHref === row.editHref));
        const ranked = available.map((row) => {
          const snapshot = snapshots.get(row.editHref ?? "");
          if (!snapshot) throw new Error("Snapshot identitas transaksi tidak ditemukan.");
          const names = transaction.lines.filter((line) => snapshot.lines.some((actual) => detailNamesMatch(actual.name, line.namaItem, transaction.kind === "honorarium"))).length;
          const score = names / transaction.lines.length * 1000
            + (snapshot.date === transaction.transactionIdentity.transactionDate ? 10 : 0)
            + (rowTotalAmount(row) === transaction.totalAmount ? 20 : 0);
          return { row, score };
        }).sort((a, b) => b.score - a.score);
        if (ranked.length > 1 && ranked[0].score === ranked[1].score) {
          throw new Error(`Mapping transaksi ambigu: ${transaction.namaItem}, tahap ${transactionStageKey(transaction)}. Dua target memiliki identitas yang sama.`);
        }
        chosen = ranked[0].row;
      }
      matches.push({ transaction, row: chosen });
    }
  }
  if (matches.length !== transactions.length) {
    throw new Error(`Mapping transaksi belum lengkap. Expected ${transactions.length}, berhasil dicocokkan ${matches.length}.`);
  }
  return matches.sort((left, right) => left.transaction.sequence - right.transaction.sequence);
}

async function inputValue(page: Page, name: string, index: number) {
  return page.locator(`${name.endsWith("[]") ? "#item-container " : ""}[name="${attr(name)}"]`).nth(index).inputValue();
}

async function selectedText(page: Page, selector: string, index: number) {
  const locator = page.locator(selector).nth(index);
  return normalizeBelanjaText(await locator.evaluate((select) => (select as HTMLSelectElement).selectedOptions[0]?.textContent ?? ""));
}

async function dispatchIndexedFieldEvents(locator: Locator) {
  for (const eventName of ["input", "change", "keyup", "blur"]) {
    await locator.dispatchEvent(eventName).catch(() => {});
  }
}

async function replaceIndexedValueByKeyboard(locator: Locator, value: string | number) {
  await locator.click({ timeout: 5_000 });
  await locator.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await locator.press("Backspace").catch(() => {});
  await locator.type(String(value));
  await locator.press("Tab").catch(() => {});
  await dispatchIndexedFieldEvents(locator);
}

async function setIndexedValue(page: Page, name: string, index: number, value: string | number) {
  const locator = page.locator(`${name.endsWith("[]") ? "#item-container " : ""}[name="${attr(name)}"]`).nth(index);
  await locator.waitFor({ state: "attached", timeout: 5_000 });
  const current = await locator.inputValue();
  if (typeof value === "number") {
    const numeric = /harga|tarif|subtotal/.test(name) ? normalizeBelanjaNumber(current) : Number(current.replace(",", "."));
    if (current.trim() && numeric === value) return;
  } else if (current === value) return;
  const state = await locator.evaluate(function (element) {
    const field = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    return {
      disabled: field.disabled,
      readOnly: (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) && field.readOnly,
      visible: Boolean(field.offsetParent || field.getClientRects().length > 0),
    };
  }).catch(() => ({ disabled: false, readOnly: false, visible: false }));
  const isMaskedMoneyField = /harga|tarif/i.test(name);
  if (/harga|tarif|subtotal/.test(name)) {
    const applied = await locator.evaluate((element, nextValue) => {
      const autoNumeric = (window as unknown as { AutoNumeric?: { getAutoNumericElement: (element: Element) => { set: (value: string) => void } | undefined } }).AutoNumeric;
      const instance = autoNumeric?.getAutoNumericElement(element);
      if (!instance) return false;
      instance.set(nextValue);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }, String(value));
    if (applied) return;
  }
  if (isMaskedMoneyField && state.visible && !state.disabled && !state.readOnly) {
    await replaceIndexedValueByKeyboard(locator, value).catch(async () => {
      await locator.evaluate(function (element, nextValue) {
        const field = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        field.value = String(nextValue);
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
        field.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
        field.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
      }, String(value));
    });
    return;
  }
  await locator.evaluate(function (element, nextValue) {
    const field = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    field.value = String(nextValue);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
    field.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
  }, String(value));
}

async function setTopDate(page: Page, date: string) {
  await setIndexedValue(page, "tanggal", 0, date);
}

function honorariumBreakdown(line: BelanjaTransactionLine) {
  const explicitDays = line.durationDays && line.durationDays > 0 ? line.durationDays : 0;
  if (explicitDays > 0) {
    const people = line.qty / explicitDays;
    return {
      people: Number.isFinite(people) ? Math.round(people * 100) / 100 : line.qty,
      days: explicitDays,
    };
  }

  const unit = normalizeBelanjaText(line.satuan).toLowerCase();
  if (/orang\s*-?\s*hari|oranghari|\boh\b|\bhari\b/.test(unit)) {
    return { people: 1, days: line.qty };
  }
  return { people: line.qty, days: 1 };
}

function isGenericHonorariumRecipient(value: string | null | undefined) {
  const text = normalizeBelanjaText(value).toLowerCase();
  return !text || /^(honorarium|kwitansi|upah|upah honorarium|penerima)$/i.test(text);
}

function honorariumRecipient(line: BelanjaTransactionLine, fallback: string | undefined) {
  const role = inferHonorariumRole({ namaItem: line.namaItem, satuan: "", vendor: "", keterangan: "" });
  if (role !== "other") return honorariumRoleLabel(role);
  const candidate = normalizeBelanjaText(line.recipient || line.vendor);
  if (candidate && !isGenericHonorariumRecipient(candidate)) return candidate;
  return normalizeBelanjaText(fallback || line.recipient || line.vendor || line.namaItem);
}



async function readDetailLines(page: Page, kind: BelanjaTransactionKind): Promise<DetailLine[]> {
  const selector = kind === "honorarium"
    ? '#item-container select[name="jenis_tukang[]"]'
    : kind === "equipment"
      ? '#item-container select[name="nama_alat[]"]'
      : '#item-container select[name="nama_material[]"]';
  const count = await page.locator(selector).count();
  const lines: DetailLine[] = [];
  for (let index = 0; index < count; index += 1) {
    const name = await selectedText(page, selector, index);
    if (!name || /pilih|select/i.test(name)) continue;
    if (kind === "honorarium") {
      lines.push({
        index,
        name,
        qty: normalizeBelanjaNumber(await inputValue(page, "jumlah_orang[]", index)) * (normalizeBelanjaNumber(await inputValue(page, "jumlah_hari[]", index)) || 1),
        unitPrice: normalizeBelanjaNumber(await inputValue(page, "tarif_harian[]", index)),
        subtotal: normalizeBelanjaNumber(await inputValue(page, "subtotal[]", index)),
        paymentDate: normalizeBelanjaIsoDate(await inputValue(page, "tanggal_bayar[]", index)),
        recipient: await inputValue(page, "nama_penyedia[]", index),
      });
    } else if (kind === "equipment") {
      lines.push({
        index,
        name,
        qty: normalizeBelanjaNumber(await inputValue(page, "jumlah_durasi[]", index)),
        unit: await inputValue(page, "durasi[]", index),
        unitPrice: normalizeBelanjaNumber(await inputValue(page, "tarif_sewa[]", index)),
        subtotal: normalizeBelanjaNumber(await inputValue(page, "subtotal[]", index)),
        paymentDate: normalizeBelanjaIsoDate(await inputValue(page, "tanggal_bayar[]", index)),
        recipient: await inputValue(page, "nama_penyedia[]", index),
      });
    } else {
      lines.push({
        index,
        name,
        qty: normalizeBelanjaNumber(await inputValue(page, "jumlah_material[]", index)),
        unit: await inputValue(page, "satuan_material[]", index),
        unitPrice: normalizeBelanjaNumber(await inputValue(page, "harga_material[]", index)),
        subtotal: normalizeBelanjaNumber(await inputValue(page, "subtotal[]", index)),
        paymentDate: normalizeBelanjaIsoDate(await inputValue(page, "tanggal_bayar[]", index)),
        recipient: await inputValue(page, "nama_penyedia[]", index),
      });
    }
  }
  return lines;
}

function detailNameBase(value: string | null | undefined) {
  return normalizeIdentityPart(normalizeBelanjaText(value)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s*[-–]\s*(unit|bh|buah|set|lbr|lembar|btg|batang|kg|m3|m³|liter|tube|hari|jam)\s*$/i, ""));
}

export function genericHonorariumNameMatches(actualName: string | null | undefined, expectedName: string | null | undefined) {
  const actualBase = detailNameBase(actualName);
  const expectedBase = detailNameBase(expectedName);
  if (!actualBase || !expectedBase) return false;
  if (expectedBase.includes("lembur") && (actualBase === "lembur" || actualBase === "lemburpekerjaan")) return true;
  return false;
}

export function detailNamesMatch(actual: string, expected: string, honorarium = false) {
  // Do not let substring matching merge different sizes, such as 8 and 18 mm.
  const numbers = (value: string): string[] => value.match(/\d+(?:[.,]\d+)?/g) ?? [];
  const a = numbers(actual), e = numbers(expected);
  const dimensionConflict = e.length > 0 && a.length > 0 && !e.every((value) => a.includes(value));
  if (dimensionConflict && !/batu\s*belah/i.test(expected)) return false;
  const actualBase = detailNameBase(actual);
  const expectedBase = detailNameBase(expected);
  return belanjaTextMatches(actual, expected)
    || belanjaTextMatches(actualBase, expectedBase)
    || (honorarium && genericHonorariumNameMatches(actual, expected));
}

function numericMatchScore(expected: number, actual: number | undefined, tolerance: number) {
  if (actual == null || !Number.isFinite(actual)) return 0;
  const difference = Math.abs(actual - expected);
  if (difference <= tolerance) return 200;
  return Math.max(0, 20 - Math.min(difference / Math.max(Math.abs(expected), 1), 1) * 20);
}

function detailQuantityMatches(expected: BelanjaTransactionLine, actual: DetailLine) {
  if (Math.abs((actual.qty ?? 0) - expected.qty) <= 0.01) return true;
  const priceMatches = Math.abs((actual.unitPrice ?? 0) - expected.hargaSatuan) <= 0.01;
  const subtotalMatches = Math.abs((actual.subtotal ?? 0) - expected.jumlah) <= 1;
  if (!priceMatches || !subtotalMatches) return false;
  const actualQty = actual.qty ?? 0;
  if (expected.qty < 1000 || actualQty >= expected.qty) return false;
  return Math.abs(actualQty * 1000 - expected.qty) <= 0.01
    || Math.abs(actualQty - expected.qty / 1000) <= 0.01;
}

function detailLineMatchScore(expected: BelanjaTransactionLine, actual: DetailLine) {
  const expectedBase = detailNameBase(expected.namaItem);
  const actualBase = detailNameBase(actual.name);
  let score = 0;
  if (actualBase === expectedBase) score += 1000;
  else if (actualBase.includes(expectedBase)) score += Math.max(300, 700 - (actualBase.length - expectedBase.length) * 15);
  else score += 100;

  if (expectedBase && actualBase && actualBase.includes("pvc") && !expectedBase.includes("pvc")) score -= 120;
  if (expectedBase && actualBase && actualBase.includes("polding") && expectedBase.includes("folding")) score += 40;
  if (expected.satuan && actual.unit && belanjaTextMatches(actual.unit, expected.satuan)) score += 80;
  if (expected.tanggal && actual.paymentDate && actual.paymentDate === expected.tanggal) score += 120;
  if (expected.vendor && actual.recipient && belanjaTextMatches(actual.recipient, expected.vendor)) score += 80;
  score += detailQuantityMatches(expected, actual) ? 200 : numericMatchScore(expected.qty, actual.qty, 0.01);
  score += numericMatchScore(expected.hargaSatuan, actual.unitPrice, 0.01);
  score += numericMatchScore(expected.jumlah, actual.subtotal, 1);
  return score;
}

export function matchLine(expected: BelanjaTransactionLine, actualLines: DetailLine[], used: Set<number>, options: MatchLineOptions = {}) {
  let matches = actualLines.filter((line) => !used.has(line.index) && detailNamesMatch(line.name, expected.namaItem));
  if (matches.length === 0 && options.allowGenericHonorariumLabel) {
    matches = actualLines.filter((line) => !used.has(line.index) && genericHonorariumNameMatches(line.name, expected.namaItem));
  }
  if (matches.length === 0) {
    throw new Error(`Transaksi "${expected.namaItem}" tidak dapat dicocokkan dengan detail target.`);
  }
  const ranked = matches
    .map((line) => ({ line, score: detailLineMatchScore(expected, line)
      + (options.allowGenericHonorariumLabel && line.recipient === honorariumRecipient(expected, "") ? 200 : 0) }))
    .sort((left, right) => right.score - left.score || left.line.index - right.line.index);
  if (ranked.length > 1 && ranked[0].score === ranked[1].score && !options.allowDuplicateNames) {
    throw new Error(`Item ambigu: ${expected.namaItem}. Kandidat: ${ranked.filter((item) => item.score === ranked[0].score).map((item) => JSON.stringify(item.line)).join(" | ")}`);
  }
  const match = ranked[0].line;
  if (matches.length > 1 && !options.allowDuplicateNames && process.env.BELANJA_TARGET_DEBUG === "true") {
    console.log(`[copy-reconcile] matchLine resolved "${expected.namaItem}" -> "${match.name}" from ${matches.map((line) => `"${line.name}"`).join(" | ")}`);
  }
  used.add(match.index);
  return match;
}

function detailSelectSelector(kind: BelanjaTransactionKind) {
  if (kind === "honorarium") return 'select[name="jenis_tukang[]"]';
  if (kind === "equipment") return 'select[name="nama_alat[]"]';
  return 'select[name="nama_material[]"]';
}

function detailLookupLabel(kind: BelanjaTransactionKind, item: LookupBelanjaItem) {
  if (kind === "material") {
    return [
      item.nama,
      item.spesifikasi ? `(${item.spesifikasi})` : "",
      item.satuan ? `- ${item.satuan}` : "",
    ].filter(Boolean).join(" ");
  }
  return normalizeBelanjaText(item.nama);
}

function unitIdentity(value: string | null | undefined) {
  const normalized = normalizeIdentityPart(value?.normalize("NFKC"));
  const aliases: Record<string, string> = { ltr: "liter", lt: "liter", btg: "batang", bh: "buah", lbr: "lembar", roll: "rol", truk: "truck" };
  return aliases[normalized] ?? normalized;
}

export function findLookupItemForLine(items: LookupBelanjaItem[], line: BelanjaTransactionLine, kind: BelanjaTransactionKind) {
  const matches = items.filter((item) => {
    const label = detailLookupLabel(kind, item);
    return detailNamesMatch(label, line.namaItem) || detailNamesMatch(item.nama ?? "", line.namaItem);
  });
  if (matches.length === 0) {
    throw new Error(`Opsi target untuk "${line.namaItem}" tidak ditemukan pada lookup ${kind}.`);
  }
  const specification = (item: LookupBelanjaItem) => normalizeIdentityPart(item.spesifikasi).replace(/^(standar|standard|standart|setandar)$/, "");
  const ranked = matches.map((item) => ({ item,
    score: (normalizeIdentityPart(item.nama) === normalizeIdentityPart(line.namaItem) ? 1000 : 0)
      + (unitIdentity(item.satuan) === unitIdentity(line.satuan) ? 200 : 0)
      + (!specification(item) ? 50 : 0),
  })).sort((a, b) => b.score - a.score || a.item.uuid.localeCompare(b.item.uuid));
  const semanticKey = (item: LookupBelanjaItem) => [normalizeIdentityPart(item.nama), unitIdentity(item.satuan), specification(item)].join("|");
  if (ranked.some((candidate) => candidate.score === ranked[0].score && semanticKey(candidate.item) !== semanticKey(ranked[0].item))) {
    throw new Error(`Opsi target ambigu untuk ${line.namaItem}; spesifikasi/satuan kandidat berbeda.`);
  }
  return ranked[0].item;
}

async function fetchCurrentLookupItems(page: Page): Promise<LookupBelanjaItem[]> {
  return page.evaluate<LookupBelanjaItem[]>(`(async () => {
    const categoryId = document.querySelector('#kategori_belanja')?.value || '';
    if (!categoryId) return [];
    const response = await fetch('/lookup/item-belanja/' + categoryId, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Lookup item belanja gagal: HTTP ' + response.status);
    const items = await response.json();
    return Array.isArray(items) ? items.map((item) => ({
      uuid: item.uuid || '',
      nama: item.nama || '',
      spesifikasi: item.spesifikasi || '',
      satuan: item.satuan || '',
    })) : [];
  })()`);
}

async function setDetailSelectValue(page: Page, kind: BelanjaTransactionKind, rowIndex: number, item: LookupBelanjaItem) {
  const selector = detailSelectSelector(kind);
  const label = detailLookupLabel(kind, item);
  const row = page.locator("#item-container .item-row").nth(rowIndex);
  const select = row.locator(selector).first();
  await select.waitFor({ state: "attached", timeout: 5_000 });
  await select.evaluate(function (element, option) {
    const selectElement = element as HTMLSelectElement;
    const value = String(option.value);
    if (![...selectElement.options].some((item) => item.value === value)) {
      selectElement.add(new Option(String(option.label), value));
    }
    selectElement.value = value;
    selectElement.dispatchEvent(new Event("input", { bubbles: true }));
    selectElement.dispatchEvent(new Event("change", { bubbles: true }));
  }, { value: item.uuid, label });
  await page.waitForTimeout(150);
}

async function removeDetailLine(page: Page, kind: BelanjaTransactionKind, index: number) {
  const selector = detailSelectSelector(kind);
  const before = await page.locator(selector).count();
  const removeButtons = page.locator("#item-container .item-row button.btn-outline-danger");
  await removeButtons.nth(index).waitFor({ state: "visible", timeout: 5_000 });
  await removeButtons.nth(index).click();
  await page.waitForFunction(`(() => {
    return document.querySelectorAll(${JSON.stringify(selector)}).length < ${JSON.stringify(before)};
  })()`, null, { timeout: 5_000 });
}



async function normalizeDetailLineCount(page: Page, kind: BelanjaTransactionKind, transaction: BelanjaTransactionPayload, options: { allowDuplicateNames?: boolean } = {}) {
  const matchOptions = { ...options, allowGenericHonorariumLabel: kind === "honorarium" };
  let actual = await readDetailLines(page, kind);
  const used = new Set<number>();
  const missing: BelanjaTransactionLine[] = [];
  for (const line of transaction.lines) {
    try { matchLine(line, actual, used, matchOptions); }
    catch (error) {
      if (!(error instanceof Error) || !/tidak dapat dicocokkan/.test(error.message)) throw error;
      missing.push(line);
    }
  }
  if (missing.length) {
    const lookup = await fetchCurrentLookupItems(page);
    // Resolve every replacement before touching this form. Unmatched template
    // rows are replaced with source items, never treated as equivalent items.
    const replacements = missing.map((line) => ({ line, option: findLookupItemForLine(lookup, line, kind) }));
    const spare = actual.filter((line) => !used.has(line.index));
    for (const replacement of replacements) {
      const row = spare.shift();
      let index = row?.index;
      if (index == null) {
        index = await page.locator("#item-container .item-row").count();
        await page.locator("#add-item-button button").first().click();
        await page.waitForFunction(`document.querySelectorAll('#item-container .item-row').length > ${index}`, null, { timeout: 8000 });
      }
      await setDetailSelectValue(page, kind, index, replacement.option);
      used.add(index);
    }
  }
  for (const extra of actual.filter((line) => !used.has(line.index)).sort((a, b) => b.index - a.index)) {
    await removeDetailLine(page, kind, extra.index);
  }
  actual = await readDetailLines(page, kind);
  return actual;
}

async function reconcileMaterialTransaction(page: Page, transaction: BelanjaTransactionPayload) {
  await setTopDate(page, transaction.transactionIdentity.transactionDate);
  const actualLines = await normalizeDetailLineCount(page, "material", transaction);
  if (actualLines.length !== transaction.lines.length) {
    throw new Error(`Jumlah detail material tidak cocok untuk ${transaction.namaItem}. Resume ${transaction.lines.length}, target ${actualLines.length}.`);
  }
  const used = new Set<number>();
  for (const line of transaction.lines) {
    const target = matchLine(line, actualLines, used);
    await setIndexedValue(page, "jumlah_material[]", target.index, line.qty);
    await setIndexedValue(page, "satuan_material[]", target.index, line.satuan);
    await setIndexedValue(page, "harga_material[]", target.index, line.hargaSatuan);
    await setIndexedValue(page, "subtotal[]", target.index, line.jumlah);
    await setIndexedValue(page, "tanggal_bayar[]", target.index, line.tanggal);
    if (line.vendor) await setIndexedValue(page, "nama_penyedia[]", target.index, line.vendor);
  }
}

async function reconcileEquipmentTransaction(page: Page, transaction: BelanjaTransactionPayload) {
  await setTopDate(page, transaction.transactionIdentity.transactionDate);
  const actualLines = await normalizeDetailLineCount(page, "equipment", transaction);
  if (actualLines.length !== transaction.lines.length) {
    throw new Error(`Jumlah detail sewa alat tidak cocok untuk ${transaction.namaItem}. Resume ${transaction.lines.length}, target ${actualLines.length}.`);
  }
  const used = new Set<number>();
  for (const line of transaction.lines) {
    const target = matchLine(line, actualLines, used);
    await setIndexedValue(page, "jumlah_durasi[]", target.index, line.qty);
    await setIndexedValue(page, "durasi[]", target.index, line.satuan);
    await setIndexedValue(page, "tarif_sewa[]", target.index, line.hargaSatuan);
    await setIndexedValue(page, "subtotal[]", target.index, line.jumlah);
    await setIndexedValue(page, "tanggal_bayar[]", target.index, line.tanggal);
    if (line.vendor) await setIndexedValue(page, "nama_penyedia[]", target.index, line.vendor);
  }
}

async function reconcileHonorariumTransaction(page: Page, transaction: BelanjaTransactionPayload) {
  await setTopDate(page, transaction.transactionIdentity.transactionDate);
  const actualLines = await normalizeDetailLineCount(page, "honorarium", transaction, { allowDuplicateNames: true });
  if (actualLines.length !== transaction.lines.length) {
    throw new Error(`Jumlah detail honorarium tidak cocok untuk ${transaction.namaItem}. Resume ${transaction.lines.length}, target ${actualLines.length}.`);
  }
  const used = new Set<number>();
  for (const line of transaction.lines) {
    const target = matchLine(line, actualLines, used, {
      allowDuplicateNames: true,
      allowGenericHonorariumLabel: true,
    });
    const { people, days } = honorariumBreakdown(line);
    await setIndexedValue(page, "jumlah_orang[]", target.index, people);
    await setIndexedValue(page, "jumlah_hari[]", target.index, days);
    await setIndexedValue(page, "tarif_harian[]", target.index, line.hargaSatuan);
    await setIndexedValue(page, "subtotal[]", target.index, line.jumlah);
    await setIndexedValue(page, "tanggal_bayar[]", target.index, line.tanggal);
    await setIndexedValue(page, "nama_penyedia[]", target.index, honorariumRecipient(line, target.recipient));
  }
}



async function openEditPage(page: Page, config: RunnerConfig, row: TargetTransactionRow) {
  if (!row.editHref) throw new Error(`Tombol edit transaksi ${row.itemText} tidak ditemukan.`);
  await gotoTargetPathWithRetry(page, config, row.editHref, EDIT_PAGE_READY_SELECTOR, `Halaman edit transaksi ${row.itemText}`, {
    waitTimeoutMs: Math.max(30_000, config.choiceSearchTimeoutMs + 20_000),
    waitState: "attached",
  });
  await page.waitForFunction(`(() => {
    const hasDate = Boolean(document.querySelector('input[name="tanggal"]'));
    const requiredSelects = ["tahapan", "item_pekerjaan", "kategori_belanja"];
    const selectsReady = requiredSelects.every((id) => {
      const select = document.getElementById(id) || document.querySelector('select[name="' + id + '"]');
      if (!select) return false;
      if (select instanceof HTMLSelectElement) return select.options.length > 0;
      return true;
    });
    return hasDate && selectsReady;
  })()`, null, { timeout: Math.max(20_000, config.choiceSearchTimeoutMs + 10_000) });
}

async function reconcileOneTransaction(page: Page, config: RunnerConfig, transaction: BelanjaTransactionPayload, row: TargetTransactionRow) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try { return await reconcileTransactionAttempt(page, config, transaction, row); }
    catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (attempt === 2 || !/Hasil simpan belum sesuai|timeout|detached|HTTP 5\d\d/i.test(message)) throw error;
      logJob("edit", `retry=${attempt + 1}/2 transaction=${transaction.transactionId} reason=${message}`);
    }
  }
}

async function reconcileTransactionAttempt(page: Page, config: RunnerConfig, transaction: BelanjaTransactionPayload, row: TargetTransactionRow) {
  const before = await readTransactionSnapshot(page, config, row.editHref!, transaction.kind);
  const expectedDestination: KdkmpIdentity = { village: transaction.desa ?? "", district: transaction.kecamatan ?? "", regency: transaction.kabupaten ?? "" };
  assertSnapshotDestination(before, expectedDestination);
  if (!compareTransactionSnapshot(transaction, before).differences.length && rowTotalAmount(row) === transaction.totalAmount) return;
  await openEditPage(page, config, row);
  const selectedDestination = await page.locator("#gerai option:checked").textContent();
  assertSnapshotDestination({ ...before, destination: selectedDestination ?? "" }, expectedDestination);
  const actualKey = transactionIdentityKey({
    stageText: (await page.locator("#tahapan option:checked").textContent().catch(() => row.stageText)) ?? row.stageText,
    itemText: (await page.locator("#item_pekerjaan option:checked").textContent().catch(() => row.itemText)) ?? row.itemText,
    belanjaCategoryText: (await page.locator("#kategori_belanja option:checked").textContent().catch(() => row.belanjaCategoryText)) ?? row.belanjaCategoryText,
  });
  if (actualKey !== planIdentityKey(transaction)) {
    throw new Error(`Context edit transaksi tidak cocok. Expected ${transaction.transactionKey}, detected ${actualKey}.`);
  }

  if (transaction.kind === "material") await reconcileMaterialTransaction(page, transaction);
  else if (transaction.kind === "honorarium") await reconcileHonorariumTransaction(page, transaction);
  else await reconcileEquipmentTransaction(page, transaction);

  await page.evaluate("updateGrandTotal()");
  const formTotal = normalizeBelanjaNumber(await page.locator("#grand-total").inputValue());
  if (formTotal !== transaction.totalAmount) throw new Error(`Total form belum sesuai: ${formTotal} vs ${transaction.totalAmount}. Save dibatalkan.`);

  try {
    await submitBelanjaForm(page, config);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/Bukti transaksi berhasil tidak ditemukan/i.test(message)) throw error;
    await page.waitForLoadState("domcontentloaded", { timeout: 2_000 }).catch(() => {});
  }
  const saved = await readTransactionSnapshot(page, config, row.editHref!, transaction.kind);
  assertSnapshotDestination(saved, expectedDestination);
  const verification = compareTransactionSnapshot(transaction, saved);
  if (verification.differences.length) throw new Error(`Hasil simpan belum sesuai: ${verification.differences.join("; ")}`);
}

export function assertSnapshotDestination(snapshot: TransactionSnapshot, expected: KdkmpIdentity) {
  const actual = parseKdkmpOptionText(snapshot.destination);
  if (!actual || !sameKdkmpIdentity(actual, expected)) {
    throw new Error(`Destination salah. Expected ${formatKdkmpIdentity(expected)}, target ${snapshot.destination}.`);
  }
}

export function compareTransactionSnapshot(transaction: BelanjaTransactionPayload, snapshot: TransactionSnapshot) {
  const differences: string[] = [];
  const actualKey = transactionIdentityKey({ stageText: snapshot.stage, itemText: snapshot.category, belanjaCategoryText: snapshot.kind });
  if (actualKey !== planIdentityKey(transaction)) throw new Error(`Identitas transaksi salah: ${transaction.namaItem}.`);
  if (snapshot.date !== transaction.transactionIdentity.transactionDate) differences.push(`tanggal: ${snapshot.date} -> ${transaction.transactionIdentity.transactionDate}`);
  if (snapshot.lines.length !== transaction.lines.length) differences.push(`jumlah detail: ${snapshot.lines.length} -> ${transaction.lines.length}`);
  const used = new Set<number>();
  const expectedValues: unknown[] = [];
  const actualValues: unknown[] = [];
  for (const line of transaction.lines) {
    let actual: DetailLine;
    try {
      actual = matchLine(line, snapshot.lines, used, { allowDuplicateNames: transaction.kind === "honorarium", allowGenericHonorariumLabel: transaction.kind === "honorarium" });
    } catch (error) {
      if (error instanceof Error && /ambigu/i.test(error.message)) throw error;
      differences.push(`item belum cocok: ${line.namaItem}`);
      continue;
    }
    const recipient = transaction.kind === "honorarium" ? honorariumRecipient(line, actual.recipient) : line.vendor;
    const detectedQty = detailQuantityMatches(line, actual) ? line.qty : actual.qty;
    const expected = [line.qty, line.hargaSatuan, line.jumlah, line.tanggal, normalizeBelanjaText(recipient)];
    const detected = [detectedQty, actual.unitPrice, actual.subtotal, actual.paymentDate, normalizeBelanjaText(actual.recipient)];
    const fields = ["qty", "harga", "subtotal", "tanggal bayar", "penerima"];
    for (let i = 0; i < expected.length; i += 1) {
      if (expected[i] !== detected[i]) differences.push(`${line.namaItem} ${fields[i]}: ${detected[i] ?? "kosong"} -> ${expected[i]}`);
    }
    expectedValues.push([line.lineId, ...expected]);
    actualValues.push([line.lineId, ...detected]);
  }
  const signature = (values: unknown[]) => createHash("sha256").update(JSON.stringify(values)).digest("hex");
  return {
    differences,
    expectedSignature: signature([transaction.transactionIdentity.transactionDate, transaction.lines.length, expectedValues]),
    actualSignature: signature([snapshot.date, snapshot.lines.length, actualValues]),
  };
}

export async function compareDestinationTransactions(page: Page, config: RunnerConfig, claim: ClaimedBelanjaSyncJob) {
  const started = Date.now();
  const rows = await openDestinationTransactions(page, config, claim);
  const diagnostic = diagnoseDestinationBudget(rows, claim.transactions);
  if (diagnostic.duplicateGroups.length) throw new Error(`Duplicate transaksi target. ${formatBudgetDiagnostics(diagnostic)}`);
  const snapshots = new Map<string, TransactionSnapshot>();
  for (const row of rows) {
    if (!row.editHref) throw new Error(`Identitas edit tidak ditemukan: ${row.itemText}`);
    const snapshot = await readTransactionSnapshot(page, config, row.editHref, transactionKindFromBelanjaCategory(row.belanjaCategoryText));
    assertSnapshotDestination(snapshot, claim.destinationKdkmp);
    snapshots.set(row.editHref, snapshot);
    if (snapshots.size % 10 === 0) logJob(claim.job.id, `SCAN ${snapshots.size}/${rows.length} elapsed_ms=${Date.now() - started}`);
  }
  fs.writeFileSync(path.join(config.artifactsDir, `snapshots-${claim.job.id}.json`), JSON.stringify([...snapshots]));
  const matches = matchResumeToTargetTransaction(claim.transactions, rows, snapshots);
  const entries = matches.map(({ transaction, row }) => {
    const diff = compareTransactionSnapshot(transaction, snapshots.get(row.editHref!)!);
    if (rowTotalAmount(row) !== transaction.totalAmount) diff.differences.push(`total transaksi: ${rowTotalAmount(row)} -> ${transaction.totalAmount}`);
    return { transaction, row, ...diff };
  });
  const stages = diagnostic.stages.map((stage) => {
    const entriesInStage = entries.filter((entry) => transactionStageKey(entry.transaction) === stage.stageKey);
    const hash = (values: string[]) => createHash("sha256").update(values.join("|")).digest("hex");
    return { ...stage,
      expectedSignature: hash(entriesInStage.map((entry) => entry.expectedSignature)),
      actualSignature: hash(entriesInStage.map((entry) => entry.actualSignature)),
      mismatchedTransactions: entriesInStage.filter((entry) => entry.differences.length).length,
    };
  });
  logJob(claim.job.id, `COMPARE destination=${claim.destinationKdkmp.village} expected=${diagnostic.expectedTotal} actual=${diagnostic.actualTotal} difference=${diagnostic.totalDifference} scan_ms=${Date.now() - started}`);
  for (const stage of stages) logJob(claim.job.id, `TAHAP ${stage.stageKey} expected=${stage.expectedTotal} actual=${stage.actualTotal} diff=${stage.difference} signature=${stage.expectedSignature === stage.actualSignature ? "MATCH" : "DIFF"} mismatch_transactions=${stage.mismatchedTransactions}`);
  return { rows, diagnostic, entries, stages, scanMs: Date.now() - started };
}

export async function reconcileTransactions(page: Page, config: RunnerConfig, api: BelanjaSyncApiClient, claim: ClaimedBelanjaSyncJob) {
  await checkpoint(api, claim, "RECONCILING", `Membuka transaksi ${formatKdkmpIdentity(claim.destinationKdkmp)}.`, { current: claim.completedTransactionIds.length });
  const comparison = await compareDestinationTransactions(page, config, claim);
  const { rows, diagnostic: budgetDiagnostic } = comparison;
  const matches = comparison.entries;
  const stageBudgetPlan = planStageBudgetReconcile(rows, claim.transactions, budgetDiagnostic);
  stageBudgetPlan.transactionIdsToEdit = matches.filter((entry) => entry.differences.length).map((entry) => entry.transaction.transactionId);
  stageBudgetPlan.mismatchedStageKeys = comparison.stages.filter((stage) => stage.difference !== 0 || stage.mismatchedTransactions > 0).map((stage) => stage.stageKey);
  stageBudgetPlan.balancedStageKeys = comparison.stages.filter((stage) => stage.difference === 0 && stage.mismatchedTransactions === 0).map((stage) => stage.stageKey);
  const itemByTransactionId = new Map(claim.items.map((item) => {
    const payload = item.payload as unknown as BelanjaTransactionPayload;
    return [payload.transactionId, item];
  }));
  const completed = new Set<string>();
  const updated = { material: 0, honorarium: 0, equipment: 0 };
  const reconcileStarted = Date.now();
  const totals = {
    materialTotal: claim.transactions.filter((transaction) => transaction.kind === "material").length,
    honorariumTotal: claim.transactions.filter((transaction) => transaction.kind === "honorarium").length,
    equipmentTotal: claim.transactions.filter((transaction) => transaction.kind === "equipment").length,
    materialCompleted: 0,
    honorariumCompleted: 0,
    equipmentCompleted: 0,
  };
  const incrementTotals = (transaction: BelanjaTransactionPayload) => {
    if (transaction.kind === "material") totals.materialCompleted += 1;
    else if (transaction.kind === "honorarium") totals.honorariumCompleted += 1;
    else totals.equipmentCompleted += 1;
  };

  if (stageBudgetPlan.mode === "targeted") {
    logJob(claim.job.id, `stage=RECONCILING action=stage_budget_plan mismatched_stages=${stageBudgetPlan.mismatchedStageKeys.join(",") || "-"} edit_transactions=${stageBudgetPlan.transactionIdsToEdit.length} balanced_stages=${stageBudgetPlan.balancedStageKeys.join(",") || "-"}`);
    await api.checkpointJob(claim.job.id, {
      stage: "RECONCILING",
      stageMessage: stageBudgetPlan.transactionIdsToEdit.length > 0
        ? `Budget check awal: edit hanya ${stageBudgetPlan.transactionIdsToEdit.length} transaksi pada tahap ${stageBudgetPlan.mismatchedStageKeys.join(", ")}.`
        : "Budget check awal: semua tahap sudah balance, edit detail dilewati.",
      progress: {
        total: claim.expectedTransactionCount,
        verifiedTransactions: completed.size,
      },
      report: {
        expectedTotalAmount: budgetDiagnostic.expectedTotal,
        actualTotalAmount: budgetDiagnostic.actualTotal,
        totalDifference: budgetDiagnostic.totalDifference,
        reconciliation: { initialExpectedTotal: budgetDiagnostic.expectedTotal, initialActualTotal: budgetDiagnostic.actualTotal,
          initialDifference: budgetDiagnostic.totalDifference, mismatchedStages: stageBudgetPlan.mismatchedStageKeys,
          updatedTransactions: 0, scanMs: comparison.scanMs, finalStatus: "RECONCILING" },
      },
    });
  } else {
    logJob(claim.job.id, `stage=RECONCILING action=stage_budget_plan mode=full reason="${stageBudgetPlan.reason ?? "-"}"`);
  }

  for (const { transaction, row, differences } of [...matches].sort((a, b) => transactionStageKey(a.transaction).localeCompare(transactionStageKey(b.transaction)) || a.transaction.sequence - b.transaction.sequence)) {
    if (completed.has(transaction.transactionId)) {
      incrementTotals(transaction);
      continue;
    }
    const item = itemByTransactionId.get(transaction.transactionId);
    if (!item) throw new Error(`Item job untuk transaksi ${transaction.transactionId} tidak ditemukan.`);
    const current = completed.size + 1;
    if (!shouldReconcileTransactionForStageBudgetPlan(transaction, stageBudgetPlan)) {
      completed.add(transaction.transactionId);
      incrementTotals(transaction);
      await api.markSuccess(item.id, {
        dryRun: false,
        targetReference: row.uuid,
        metadataJson: {
          transaction_id: transaction.transactionId,
          transaction_key: transaction.transactionKey,
          target_row_uuid: row.uuid,
          stage_budget_already_balanced: true,
          detail_signature_verified: true,
          skipped_edit: true,
          verified_at: new Date().toISOString(),
        },
      });
      await api.checkpointJob(claim.job.id, {
        stage: "RECONCILING",
        stageMessage: `Transaksi ${current}/${claim.expectedTransactionCount} dilewati; tahap ${transactionStageKey(transaction)} sudah balance.`,
        completedTransactionIds: [...completed],
        progress: {
          current,
          total: claim.expectedTransactionCount,
          verifiedTransactions: completed.size,
          ...totals,
        },
        report: {
          verifiedTransactions: completed.size,
          materialsUpdated: updated.material,
          honorariumUpdated: updated.honorarium,
          equipmentUpdated: updated.equipment,
          expectedTotalAmount: budgetDiagnostic.expectedTotal,
          actualTotalAmount: budgetDiagnostic.actualTotal,
          totalDifference: budgetDiagnostic.totalDifference,
        },
      });
      continue;
    }
    logJob(claim.job.id, `stage=RECONCILING destination=${claim.destinationKdkmp.village} transaction=${current}/${claim.expectedTransactionCount} type=${transaction.kind.toUpperCase()} item="${transaction.namaItem}"`);
    await checkpoint(api, claim, "RECONCILING", `Mencocokkan transaksi ${current}/${claim.expectedTransactionCount}: ${transaction.namaItem}.`, {
      current,
      verifiedTransactions: completed.size,
      ...totals,
    });
    try {
      logJob(claim.job.id, `DIFF ${differences.join("; ")}`);
      await reconcileOneTransaction(page, config, transaction, row);
      updated[transaction.kind] += 1;
      completed.add(transaction.transactionId);
      incrementTotals(transaction);
      await api.markSuccess(item.id, {
        dryRun: false,
        targetReference: row.uuid,
        metadataJson: {
          transaction_id: transaction.transactionId,
          transaction_key: transaction.transactionKey,
          target_row_uuid: row.uuid,
          detail_signature_verified: true,
          verified_at: new Date().toISOString(),
        },
      });
      const stageKey = transactionStageKey(transaction);
      const remainingInStage = matches.some((entry) => transactionStageKey(entry.transaction) === stageKey
        && entry.differences.length > 0 && !completed.has(entry.transaction.transactionId));
      if (!remainingInStage) {
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          const freshRows = await readDestinationTransactionRows(page, config, claim);
          const stage = diagnoseDestinationBudget(freshRows, claim.transactions).stages.find((entry) => entry.stageKey === stageKey);
          if (stage && stage.difference === 0 && stage.actualCount === stage.expectedCount) {
            logJob(claim.job.id, `TAHAP ${stageKey} VERIFIED expected=${stage.expectedTotal} actual=${stage.actualTotal} diff=0`);
            break;
          }
          if (attempt === 2) throw new Error(`Tahap ${stageKey} masih selisih setelah verifikasi ulang: ${stage?.difference ?? "tidak ditemukan"}.`);
          for (const entry of matches.filter((entry) => transactionStageKey(entry.transaction) === stageKey)) {
            await reconcileOneTransaction(page, config, entry.transaction, entry.row);
          }
        }
      }
      await api.checkpointJob(claim.job.id, {
        stage: "RECONCILING",
        stageMessage: `Transaksi ${current}/${claim.expectedTransactionCount} selesai diverifikasi.`,
        completedTransactionIds: [...completed],
        progress: {
          current,
          total: claim.expectedTransactionCount,
          verifiedTransactions: completed.size,
          ...totals,
        },
        report: {
          verifiedTransactions: completed.size,
          materialsUpdated: updated.material,
          honorariumUpdated: updated.honorarium,
          equipmentUpdated: updated.equipment,
          reconciliation: { initialExpectedTotal: budgetDiagnostic.expectedTotal, initialActualTotal: budgetDiagnostic.actualTotal,
            initialDifference: budgetDiagnostic.totalDifference, mismatchedStages: stageBudgetPlan.mismatchedStageKeys,
            updatedTransactions: updated.material + updated.honorarium + updated.equipment,
            scanMs: comparison.scanMs, editMs: Date.now() - reconcileStarted, finalStatus: "RECONCILING" },
        },
      });
    } catch (error) {
      const classified = classifyBelanjaAutomationError(error, { phase: "unknown", dryRun: false });
      if (classified.retryable) throw classified;
      const screenshotPath = await saveJobScreenshot(page, config, claim.job.id, `failed-${transaction.sequence}`);
      const message = error instanceof Error ? error.message : "Rekonsiliasi transaksi gagal.";
      await api.markFailed(item.id, {
        errorMessage: message,
        retryable: false,
        metadataJson: {
          transaction_id: transaction.transactionId,
          transaction_key: transaction.transactionKey,
          screenshot_path: screenshotPath,
        },
      });
      throw new Error(`${message} Screenshot: ${screenshotPath}`);
    }
  }
  claim.job.report = { ...claim.job.report, reconciliation: {
    initialExpectedTotal: budgetDiagnostic.expectedTotal, initialActualTotal: budgetDiagnostic.actualTotal,
    initialDifference: budgetDiagnostic.totalDifference, mismatchedStages: stageBudgetPlan.mismatchedStageKeys,
    updatedTransactions: updated.material + updated.honorarium + updated.equipment,
    scanMs: comparison.scanMs, editMs: Date.now() - reconcileStarted, finalStatus: "RECONCILING",
  } };
}

export async function verifyDestinationTransactions(page: Page, config: RunnerConfig, api: BelanjaSyncApiClient, claim: ClaimedBelanjaSyncJob) {
  await checkpoint(api, claim, "VERIFYING", "Memverifikasi jumlah transaksi destination.", {
    current: claim.expectedTransactionCount,
    verifiedTransactions: claim.expectedTransactionCount,
  });
  let rows = await readDestinationTransactionRows(page, config, claim);
  let diagnostic = diagnoseDestinationBudget(rows, claim.transactions);
  let budgetRepairAttempts = 0;
  let budgetRepairDetails: string[] = [];
  if (rows.length !== claim.expectedTransactionCount) {
    const detailText = await inspectMismatchedStageDetails(page, config, claim, rows, diagnostic);
    const screenshotPath = await saveJobScreenshot(page, config, claim.job.id, "final-row-count-mismatch");
    throw new Error(`Final verification gagal. Expected ${claim.expectedTransactionCount} transaksi, detected ${rows.length}. ${formatBudgetDiagnostics(diagnostic)}${detailText} Screenshot: ${screenshotPath}`);
  }
  if (diagnostic.duplicateGroups.length > 0) {
    const screenshotPath = await saveJobScreenshot(page, config, claim.job.id, "final-duplicate-detected");
    throw new Error(`Final verification gagal. Ada transaksi duplikat. ${formatBudgetDiagnostics(diagnostic)} Screenshot: ${screenshotPath}`);
  }
  if (!destinationBudgetIsBalanced(diagnostic)) {
    const repair = await repairDestinationBudgetMismatches(page, config, api, claim, rows, diagnostic);
    rows = repair.rows;
    diagnostic = repair.diagnostic;
    budgetRepairAttempts = repair.repairPasses;
    budgetRepairDetails = repair.repairedTransactions;

    if (rows.length !== claim.expectedTransactionCount) {
      const detailText = await inspectMismatchedStageDetails(page, config, claim, rows, diagnostic);
      const screenshotPath = await saveJobScreenshot(page, config, claim.job.id, "final-row-count-mismatch-after-repair");
      throw new Error(`Final verification gagal setelah repair otomatis. Expected ${claim.expectedTransactionCount} transaksi, detected ${rows.length}. ${formatBudgetDiagnostics(diagnostic)}${detailText} Screenshot: ${screenshotPath}`);
    }
    if (diagnostic.duplicateGroups.length > 0) {
      const screenshotPath = await saveJobScreenshot(page, config, claim.job.id, "final-duplicate-detected-after-repair");
      throw new Error(`Final verification gagal setelah repair otomatis. Ada transaksi duplikat. ${formatBudgetDiagnostics(diagnostic)} Screenshot: ${screenshotPath}`);
    }
    if (!destinationBudgetIsBalanced(diagnostic)) {
      const detailText = await inspectMismatchedStageDetails(page, config, claim, rows, diagnostic);
      const screenshotPath = await saveJobScreenshot(page, config, claim.job.id, "final-budget-mismatch-after-repair");
      throw new Error(`Final budget verification masih selisih setelah repair otomatis ${budgetRepairAttempts} pass. ${formatBudgetDiagnostics(diagnostic)}${detailText} Screenshot: ${screenshotPath}`);
    }
  }
  const actualTotal = diagnostic.actualTotal;
  const expectedTotal = diagnostic.expectedTotal;
  const finalComparison = await compareDestinationTransactions(page, config, claim);
  const mismatches = finalComparison.entries.filter((entry) => entry.differences.length > 0 || entry.expectedSignature !== entry.actualSignature);
  if (!destinationBudgetIsBalanced(finalComparison.diagnostic) || mismatches.length) {
    throw new Error(`Final verification gagal: ${formatBudgetDiagnostics(finalComparison.diagnostic)} ${mismatches.map((entry) => entry.differences.join("; ")).join(" | ")}`);
  }
  await api.checkpointJob(claim.job.id, {
    stage: "COMPLETED",
    stageMessage: "Pengiriman berhasil. Copy, rekonsiliasi, dan verification selesai.",
    status: "completed",
    progress: {
      current: claim.expectedTransactionCount,
      total: claim.expectedTransactionCount,
      copiedTransactions: claim.expectedTransactionCount,
      verifiedTransactions: claim.expectedTransactionCount,
    },
    report: {
      source: claim.sourceKdkmp,
      destination: claim.destinationKdkmp,
      expectedTransactions: claim.expectedTransactionCount,
      copiedTransactions: claim.expectedTransactionCount,
      verifiedTransactions: claim.expectedTransactionCount,
      expectedTotalAmount: expectedTotal,
      actualTotalAmount: actualTotal,
      totalDifference: roundBelanjaMoney(actualTotal - expectedTotal),
      budgetRepairAttempts,
      budgetRepairedTransactions: budgetRepairDetails.length,
      budgetRepairDetails: budgetRepairDetails.slice(-12),
      reconciliation: { ...claim.job.report?.reconciliation, verifyMs: finalComparison.scanMs, finalStatus: "VERIFIED",
        stages: finalComparison.stages.map((stage) => ({ stageKey: stage.stageKey, expectedTotal: stage.expectedTotal, actualTotal: stage.actualTotal, difference: stage.difference, signatureMatches: stage.expectedSignature === stage.actualSignature })) },
      status: "COMPLETED",
      errors: [],
    },
  });
}

export async function processCopyReconcileJob(api: BelanjaSyncApiClient, config: RunnerConfig, page: Page, claim: ClaimedBelanjaSyncJob) {
  const effectiveDryRun = resolveEffectiveDryRun(config, claim.job);
  logJob(claim.job.id, `stage=${claim.stage} destination=${formatKdkmpIdentity(claim.destinationKdkmp)} mode=${effectiveDryRun ? "DRY_RUN" : "LIVE"}`);

  if (!effectiveDryRun && !resolveEffectiveFieldMapVerified(config, claim.job)) {
    throw new Error("Live mode diblokir karena mapping Belanja belum terverifikasi. Jalankan dry run sampai DRY_RUN_OK atau set BELANJA_FIELD_MAP_VERIFIED=true pada runner yang sudah diverifikasi.");
  }
  if (claim.transactions.length !== claim.expectedTransactionCount) {
    throw new Error(`Payload job berisi ${claim.transactions.length} transaksi, expected ${claim.expectedTransactionCount}. Copy dibatalkan.`);
  }

  if (effectiveDryRun && !stageBefore(claim.stage, "DESTINATION_COPIED")) {
    const comparison = await compareDestinationTransactions(page, config, claim);
    await api.checkpointJob(claim.job.id, { stage: "COMPLETED", status: "completed",
      stageMessage: `DRY_COMPARE_OK: ${comparison.entries.filter((entry) => entry.differences.length).length} transaksi perlu penyesuaian. Tidak melakukan save atau copy.`,
      report: { expectedTotalAmount: comparison.diagnostic.expectedTotal, actualTotalAmount: comparison.diagnostic.actualTotal,
        totalDifference: comparison.diagnostic.totalDifference, copiedTransactions: 0, verifiedTransactions: 0 },
    });
    return;
  }

  if (claim.stage === "COPY_CONFIRMED") {
    const alreadyCopied = await destinationAlreadyHasExpectedTransactions(page, config, claim);
    if (!alreadyCopied) {
      throw new Error("Job terakhir berhenti pada stage COPY_CONFIRMED. Runner tidak akan mengulang copy otomatis karena copy mungkin sudah diklik. Cek destination manual, lalu reset atau lanjutkan job setelah status target jelas.");
    }
    await api.checkpointJob(claim.job.id, {
      stage: "DESTINATION_COPIED",
      stageMessage: "Destination sudah memiliki 43 transaksi; melanjutkan rekonsiliasi tanpa copy ulang.",
      progress: {
        copiedTransactions: claim.expectedTransactionCount,
        total: claim.expectedTransactionCount,
      },
    });
  } else if (stageBefore(claim.stage, "DESTINATION_COPIED")) {
    const destinationRows = !effectiveDryRun
      ? await readDestinationTransactionRows(page, config, claim)
      : [];
    if (!effectiveDryRun && destinationRows.length === claim.expectedTransactionCount) {
      await api.checkpointJob(claim.job.id, {
        stage: "DESTINATION_COPIED",
        stageMessage: "Destination sudah memiliki 43 transaksi; copy dilewati dan rekonsiliasi existing rows dimulai.",
        progress: {
          copiedTransactions: claim.expectedTransactionCount,
          total: claim.expectedTransactionCount,
        },
      });
    } else if (!effectiveDryRun && destinationRows.length > 0) {
      throw new Error(`Destination sudah memiliki ${destinationRows.length} transaksi. Live copy dibatalkan untuk mencegah duplikasi/partial data; kosongkan atau verifikasi target manual sebelum retry.`);
    } else {
      const copyResult = await copyBaseTransactions(page, config, api, claim);
      if (effectiveDryRun) {
        const sourceRows = copyResult.rows;
        await api.checkpointJob(claim.job.id, {
          stage: "COMPLETED",
          stageMessage: "DRY_RUN_OK: source Maleber, entries 100, 43 checkbox, modal copy, destination selector, dan konfirmasi sudah tervalidasi. Tidak melakukan copy.",
          status: "completed",
          report: {
            source: claim.sourceKdkmp,
            destination: claim.destinationKdkmp,
            expectedTransactions: claim.expectedTransactionCount,
            copiedTransactions: 0,
            verifiedTransactions: sourceRows.length,
            status: "COMPLETED",
            errors: [],
          },
        });
        for (const item of claim.items) {
          await api.markSuccess(item.id, {
            dryRun: true,
            metadataJson: {
              dry_run_checks: ["source", "entries_100", "checkboxes_43", "copy_modal", "destination_selector", "confirmations"],
            },
          });
        }
        return;
      }
    }
  } else {
    logJob(claim.job.id, "stage=DESTINATION_COPIED action=resume_without_copy");
  }

  await reconcileTransactions(page, config, api, claim);
  await verifyDestinationTransactions(page, config, api, claim);
}
