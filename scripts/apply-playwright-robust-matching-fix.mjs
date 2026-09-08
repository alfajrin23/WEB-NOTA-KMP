import fs from "node:fs";

const file = "automation/belanja-runner/copy-reconcile.ts";
let source = fs.readFileSync(file, "utf8");

function replaceOnce(label, before, after) {
  const count = source.split(before).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected exactly 1 match, found ${count}`);
  }
  source = source.replace(before, after);
}

const oldSelect = `async function selectKdkmpChoice(page: Page, config: RunnerConfig, selectId: string, identity: KdkmpIdentity) {
  const select = page.locator(\`#\${selectId}\`).first();
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
    \`\${identity.village} \${identity.district}\`,
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

  throw new Error(\`KDKMP "\${formatKdkmpIdentity(identity)}" tidak ditemukan pada dropdown \${selectId}. Opsi terlihat: \${lastSeen.slice(0, 8).join(" | ") || "-"}.\`);
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
}`;

const newSelect = `async function selectedKdkmpState(page: Page, selectId: string) {
  const select = page.locator(\`#\${selectId}\`).first();
  const value = await select.inputValue().catch(() => "");
  const nativeText = normalizeBelanjaText(await select.locator("option:checked").first().textContent().catch(() => ""));
  const choiceText = normalizeBelanjaText(await choiceRoot(page, selectId).locator(".choices__list--single").innerText().catch(() => ""));
  return { value, text: nativeText || choiceText };
}

function selectedKdkmpMatches(state: { value: string; text: string }, expectedOption: NativeOptionSnapshot, identity: KdkmpIdentity) {
  if (expectedOption.value && state.value !== expectedOption.value) return false;
  try {
    findKdkmpOption([{ value: state.value || expectedOption.value || "selected", text: state.text || expectedOption.text }], identity);
    return true;
  } catch {
    return false;
  }
}

async function waitForKdkmpSelection(
  page: Page,
  config: RunnerConfig,
  selectId: string,
  expectedOption: NativeOptionSnapshot,
  identity: KdkmpIdentity,
) {
  const deadline = Date.now() + Math.max(5_000, config.choiceSearchTimeoutMs + 2_000);
  let lastState = { value: "", text: "" };
  do {
    lastState = await selectedKdkmpState(page, selectId);
    if (selectedKdkmpMatches(lastState, expectedOption, identity)) return;
    await page.waitForTimeout(100);
  } while (Date.now() < deadline);
  throw new Error(\`Dropdown \${selectId} belum berpindah ke KDKMP \${formatKdkmpIdentity(identity)}. selected="\${lastState.text || lastState.value || "-"}" expected="\${expectedOption.text}".\`);
}

async function applyNativeKdkmpSelection(
  page: Page,
  config: RunnerConfig,
  selectId: string,
  option: NativeOptionSnapshot,
  identity: KdkmpIdentity,
) {
  const select = page.locator(\`#\${selectId}\`).first();
  await select.selectOption({ value: option.value }, { timeout: 2_000 }).catch(async () => {
    await select.selectOption({ label: option.text }, { timeout: 2_000 });
  });
  await select.dispatchEvent("input").catch(() => {});
  await select.dispatchEvent("change").catch(() => {});
  await waitForKdkmpSelection(page, config, selectId, option, identity);
}

async function selectKdkmpChoice(page: Page, config: RunnerConfig, selectId: string, identity: KdkmpIdentity) {
  const select = page.locator(\`#\${selectId}\`).first();
  const native = await nativeOptions(select);
  const nativeCandidates = native.filter((option) => option.value && option.text);
  if (nativeCandidates.length > 1) {
    const option = findKdkmpOption(nativeCandidates, identity);
    await applyNativeKdkmpSelection(page, config, selectId, option, identity);
    return;
  }

  const root = choiceRoot(page, selectId);
  const searchTerms = [
    identity.village,
    \`\${identity.village} \${identity.district}\`,
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
    try {
      await waitForKdkmpSelection(page, config, selectId, matchedChoice, identity);
      return;
    } catch {
      // Choices.js kadang memperbarui label visual tanpa sinkron native select.
      // Paksa value native yang sudah terverifikasi lalu validasi ulang.
      await applyNativeKdkmpSelection(page, config, selectId, matchedChoice, identity);
      return;
    }
  }

  throw new Error(\`KDKMP "\${formatKdkmpIdentity(identity)}" tidak ditemukan pada dropdown \${selectId}. Opsi terlihat: \${lastSeen.slice(0, 8).join(" | ") || "-"}.\`);
}

async function resolveDestination(page: Page, config: RunnerConfig, destination: KdkmpIdentity) {
  const select = page.locator("#geraiTujuan").first();
  await select.waitFor({ state: "attached", timeout: 5_000 });
  const option = findKdkmpOption(await nativeOptions(select), destination);
  await applyNativeKdkmpSelection(page, config, "geraiTujuan", option, destination);
  return option;
}`;

replaceOnce("robust KDKMP selection", oldSelect, newSelect);

const oldResolveCall = `  await resolveDestination(page, claim.destinationKdkmp);`;
const newResolveCall = `  await resolveDestination(page, config, claim.destinationKdkmp);`;
replaceOnce("resolveDestination config", oldResolveCall, newResolveCall);

const oldChoose = `function chooseExactTargetRow(
  transaction: BelanjaTransactionPayload,
  rows: TargetTransactionRow[],
  snapshots: Map<string, TransactionSnapshot> | undefined,
) {
  if (!rows.length) return null;
  const ranked = rankRowsForTransaction(transaction, rows, snapshots);
  if (snapshots && ranked.length > 1 && ranked[0].score === ranked[1].score) {
    throw new Error(\`Mapping transaksi ambigu: \${transaction.namaItem}, tahap \${transactionStageKey(transaction)}. Dua target memiliki identitas yang sama.\`);
  }
  return ranked[0].row;
}`;

const newChoose = `function snapshotCandidateFit(
  transaction: BelanjaTransactionPayload,
  row: TargetTransactionRow,
  snapshots: Map<string, TransactionSnapshot> | undefined,
) {
  const snapshot = snapshots?.get(row.editHref ?? "");
  if (!snapshot) {
    return { exact: false, differenceCount: Number.MAX_SAFE_INTEGER, semanticSignature: "" };
  }
  try {
    const diff = compareTransactionSnapshot(transaction, snapshot);
    const totalMismatch = Math.abs(rowTotalAmount(row) - transaction.totalAmount) > 1;
    const exact = !totalMismatch && diff.differences.length === 0 && diff.expectedSignature === diff.actualSignature;
    return {
      exact,
      differenceCount: diff.differences.length + (totalMismatch ? 1 : 0),
      semanticSignature: transactionSignature([
        targetRowIdentityKey(row),
        normalizeBelanjaIsoDate(row.dateText),
        roundBelanjaMoney(rowTotalAmount(row)),
        diff.actualSignature,
      ]),
    };
  } catch {
    return {
      exact: false,
      differenceCount: Number.MAX_SAFE_INTEGER - 1,
      semanticSignature: transactionSignature([
        targetRowIdentityKey(row),
        normalizeBelanjaIsoDate(row.dateText),
        roundBelanjaMoney(rowTotalAmount(row)),
        snapshot,
      ]),
    };
  }
}

function chooseExactTargetRow(
  transaction: BelanjaTransactionPayload,
  rows: TargetTransactionRow[],
  snapshots: Map<string, TransactionSnapshot> | undefined,
) {
  if (!rows.length) return null;
  const ranked = rankRowsForTransaction(transaction, rows, snapshots);
  if (!snapshots || ranked.length < 2 || ranked[0].score !== ranked[1].score) return ranked[0].row;

  const topScore = ranked[0].score;
  const tied = ranked
    .filter((entry) => entry.score === topScore)
    .map((entry) => ({ ...entry, fit: snapshotCandidateFit(transaction, entry.row, snapshots) }))
    .sort((left, right) => Number(right.fit.exact) - Number(left.fit.exact)
      || left.fit.differenceCount - right.fit.differenceCount
      || left.row.rowIndex - right.row.rowIndex);

  // Bila salah satu snapshot benar-benar identik dengan transaksi Web Nota,
  // itu kandidat yang aman walaupun score kasar sebelumnya seri.
  if (tied[0].fit.exact && !tied[1]?.fit.exact) return tied[0].row;

  const bestFit = tied.filter((entry) => entry.fit.exact === tied[0].fit.exact
    && entry.fit.differenceCount === tied[0].fit.differenceCount);
  if (bestFit.length === 1) return bestFit[0].row;

  // Template target dapat memiliki dua transaksi yang secara bisnis memang
  // ekuivalen (contoh III.05 Kusen). Bila full comparison menyatakan semuanya
  // exact, row mana pun aman; pilih row terkecil agar hasil deterministik.
  if (bestFit.every((entry) => entry.fit.exact)) {
    return bestFit.sort((left, right) => left.row.rowIndex - right.row.rowIndex)[0].row;
  }

  const semanticSignatures = new Set(bestFit.map((entry) => entry.fit.semanticSignature));
  if (semanticSignatures.size === 1) {
    return bestFit.sort((left, right) => left.row.rowIndex - right.row.rowIndex)[0].row;
  }

  throw new Error(\`Mapping transaksi ambigu: \${transaction.namaItem}, tahap \${transactionStageKey(transaction)}. Kandidat target berbeda dan tidak dapat dibedakan dengan aman: \${bestFit.slice(0, 5).map((entry) => \`row #\${entry.row.rowIndex} total=\${entry.row.totalText} tanggal=\${entry.row.dateText} diff=\${entry.fit.differenceCount}\`).join(" | ")}.\`);
}`;

replaceOnce("duplicate transaction resolver", oldChoose, newChoose);

fs.writeFileSync(file, source);
console.log(`Patched ${file}`);
