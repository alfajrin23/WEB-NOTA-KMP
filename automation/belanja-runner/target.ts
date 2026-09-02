import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "playwright";
import {
  belanjaTextMatches,
  normalizeBelanjaIsoDate,
  normalizeBelanjaMatchText,
  normalizeBelanjaNumber,
  normalizeBelanjaText,
} from "../../src/lib/belanja-sync/payload";
import type { BelanjaPayload } from "../../src/lib/belanja-sync/types";
import type { RunnerConfig } from "./config";
import { targetUrl } from "./config";
import { targetFieldMap, type BelanjaFieldKey } from "./config/target-field-map";

type BelanjaSection = "material" | "labor" | "equipment";
type FilledValues = Partial<Record<BelanjaFieldKey | "tanggalBayar" | "vendor", string>>;
type PageSummary = {
  url: string;
  title: string;
  heading: string[];
  links: Array<{ text: string; href: string }>;
  buttons: string[];
};
type NativeOptionSnapshot = {
  value: string;
  text: string;
};

const CHOICE_ROOT_XPATH = "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' choices ')]";
const STAGE_TERMS: Record<string, string[]> = {
  TAHAP_I: ["I", "PERSIAPAN"],
  TAHAP_II: ["II", "STRUKTUR"],
  TAHAP_III: ["III", "ARSITEKTUR"],
  TAHAP_IV: ["IV", "MEKANIKAL"],
  TAHAP_V: ["V", "ELEKTRIKAL"],
  TAHAP_VI: ["VI", "LUAR", "KONSTRUKSI"],
  TAHAP_VII: ["VII", "DUKUNGAN", "OPERASIONAL"],
};

function regexFrom(values: string[]) {
  return new RegExp(values.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i");
}

function attr(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function debugTarget(message: string) {
  if (process.env.BELANJA_TARGET_DEBUG === "true") console.log(`[target] ${message}`);
}

function normalizeMatch(value: string | null | undefined) {
  return normalizeBelanjaMatchText(value);
}

function choiceMatches(text: string | null | undefined, terms: string[]) {
  const meaningfulTerms = terms.map(normalizeBelanjaText).filter(Boolean);
  return meaningfulTerms.length > 0 && meaningfulTerms.every((term) => belanjaTextMatches(text, term));
}

function meaningful(value: string | null | undefined) {
  const normalized = normalizeBelanjaText(value);
  return normalized && !/pilih data|no choices|tidak ada pilihan/i.test(normalized);
}

async function dispatchFieldEvents(locator: Locator) {
  for (const eventName of ["input", "change", "keyup", "blur"]) {
    await locator.dispatchEvent(eventName).catch(() => {});
  }
}

async function replaceFieldByKeyboard(locator: Locator, value: string) {
  await locator.click();
  await locator.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await locator.press("Backspace").catch(() => {});
  await locator.type(value);
  await locator.press("Tab").catch(() => {});
  await dispatchFieldEvents(locator);
}

async function setNativeSelectByText(locator: Locator, value: string) {
  const options = await nativeOptions(locator);
  const option = options.find((entry) => belanjaTextMatches(entry.text, value) || belanjaTextMatches(entry.value, value));
  if (!option) {
    throw new Error(`Pilihan "${value}" tidak ditemukan. Opsi terlihat: ${options.map((entry) => entry.text || entry.value).slice(0, 12).join(" | ") || "-"}.`);
  }
  await locator.selectOption({ value: option.value }, { timeout: 2_000 }).catch(async () => {
    await locator.selectOption({ label: option.text }, { timeout: 2_000 });
  });
  await dispatchFieldEvents(locator);
  return true;
}

async function setField(locator: Locator, value: string) {
  const fieldState = await locator.evaluate(function (element) {
    const field = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    return {
      disabled: field.disabled,
      readOnly: (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) && field.readOnly,
      name: field.getAttribute("name") ?? "",
      className: field.getAttribute("class") ?? "",
      tag: field.tagName.toLowerCase(),
    };
  }).catch(() => ({ disabled: false, readOnly: false, name: "", className: "", tag: "" }));
  if (fieldState.disabled) return false;
  const needsKeyboardValue = /tarif|harga|price/i.test(`${fieldState.name} ${fieldState.className}`);
  if (needsKeyboardValue && !fieldState.readOnly && fieldState.tag === "input") {
    await replaceFieldByKeyboard(locator, value);
    return true;
  }
  if (fieldState.readOnly && (fieldState.tag === "input" || fieldState.tag === "textarea")) {
    await locator.evaluate(function (element, nextValue) {
      const field = element as HTMLInputElement | HTMLTextAreaElement;
      field.value = nextValue;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      field.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
      field.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    }, value);
    await dispatchFieldEvents(locator);
    return true;
  }

  const tag = fieldState.tag || await locator.evaluate(function (element) {
    return element.tagName.toLowerCase();
  }).catch(() => "");
  if (tag === "select") {
    return setNativeSelectByText(locator, value);
  }
  await locator.fill(value);
  await dispatchFieldEvents(locator);
  return true;
}

async function clickFirstButton(page: Page, texts: string[]) {
  const button = page.getByRole("button", { name: regexFrom(texts) }).first();
  if (await button.isVisible().catch(() => false)) {
    await button.click();
    return true;
  }
  const link = page.getByRole("link", { name: regexFrom(texts) }).first();
  if (await link.isVisible().catch(() => false)) {
    await link.click();
    return true;
  }
  return false;
}

async function pageSummary(page: Page): Promise<PageSummary> {
  return page.evaluate<PageSummary>(`(() => {
    const textContent = (element) => (element.textContent || "").trim().replace(/\\s+/g, " ");
    return {
      url: location.href,
      title: document.title,
      heading: Array.from(document.querySelectorAll("h1,h2,h3")).map(textContent).filter(Boolean).slice(0, 5),
      links: Array.from(document.querySelectorAll("a")).map((element) => ({
        text: textContent(element),
        href: element.getAttribute("href") || "",
      })).filter((entry) => entry.text || entry.href).slice(0, 20),
      buttons: Array.from(document.querySelectorAll("button")).map(textContent).filter(Boolean).slice(0, 20),
    };
  })()`).catch((): PageSummary => ({
    url: page.url(),
    title: "",
    heading: [],
    links: [],
    buttons: [],
  }));
}

async function gotoTarget(page: Page, config: RunnerConfig, pathName: string) {
  await page.goto(targetUrl(config, pathName), { waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
}

async function clickBelanjaNavigationLink(page: Page) {
  const roleLink = page.getByRole("link", { name: /belanja|pengeluaran|transaksi|realisasi/i }).first();
  if (await roleLink.isVisible().catch(() => false)) {
    await roleLink.click();
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    return true;
  }

  for (const selector of [
    "a[href*='belanja' i]",
    "a[href*='pengeluaran' i]",
    "a[href*='transaksi' i]",
    "a[href*='realisasi' i]",
  ]) {
    const link = page.locator(selector).first();
    if (await link.isVisible().catch(() => false)) {
      await link.click();
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
      return true;
    }
  }
  return false;
}

async function tryOpenBelanjaFormFromCurrentPage(page: Page) {
  if (await inputByName(page, "tanggal", false)) return true;
  const clicked = await clickFirstButton(page, targetFieldMap.addButtonTexts);
  if (!clicked) return false;
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  return Boolean(await inputByName(page, "tanggal", false));
}

function expenseSection(payload: BelanjaPayload): BelanjaSection {
  if (payload.expenseType === "labor" || payload.expenseType === "equipment" || payload.expenseType === "material") {
    return payload.expenseType;
  }
  const text = normalizeMatch(`${payload.namaItem} ${payload.satuan} ${payload.kategori} ${payload.vendor}`);
  if (/orang|mandor|tukang|kenek|kuli|pekerja|upah|honorarium|lembur|borong/.test(text)) return "labor";
  if (/sewa|alat|fasilitas|dumptruck|excavator|tandem|roller|genset|molen|jam/.test(text)) return "equipment";
  return "material";
}

function categoryTerms(payload: BelanjaPayload) {
  const code = normalizeBelanjaText(payload.categoryCode);
  const category = normalizeBelanjaText(payload.kategori).replace(/^[IVX]+\.\d+\s*/i, "");
  return [code, category].filter(Boolean);
}

function stageSearchTerms(payload: BelanjaPayload) {
  const fromCategoryCode = normalizeBelanjaText(payload.categoryCode).split(".")[0];
  const fromStageText = /\b(VII|VI|IV|V|III|II|I)\b/i.exec(payload.tahap ?? "")?.[1];
  const roman = (fromCategoryCode || fromStageText || "").toUpperCase();
  const byCode = STAGE_TERMS[`TAHAP_${roman}`] ?? [];
  return byCode.length > 0 ? byCode : [roman].filter(Boolean);
}

function choiceRoot(page: Page, selectId: string) {
  return page.locator(`#${selectId}`).first().locator(CHOICE_ROOT_XPATH).first();
}

async function selectedChoiceText(page: Page, selectId: string) {
  const selectText = await page.locator(`#${selectId}`).first().locator("option:checked").first().textContent().catch(() => "");
  if (meaningful(selectText)) return normalizeBelanjaText(selectText);
  return normalizeBelanjaText(await choiceRoot(page, selectId).locator(".choices__list--single").innerText().catch(() => ""));
}

async function waitForChoiceSettle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 1_500 }).catch(() => {});
  await page.waitForTimeout(150);
}

async function dispatchChoiceChange(page: Page, selectId: string) {
  await page.locator(`#${selectId}`).first().dispatchEvent("change").catch(() => {});
  await waitForChoiceSettle(page);
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

async function hasMatchingChoice(page: Page, selectId: string, terms: string[]) {
  const select = page.locator(`#${selectId}`).first();
  if (!await select.count().catch(() => 0)) return false;
  for (const option of await nativeOptions(select)) {
    if (meaningful(option.text || option.value) && (choiceMatches(option.text, terms) || choiceMatches(option.value, terms))) return true;
  }

  const options = choiceRoot(page, selectId).locator(".choices__list--dropdown .choices__item--choice");
  const count = await options.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const text = normalizeBelanjaText(await options.nth(index).innerText().catch(() => ""));
    if (meaningful(text) && choiceMatches(text, terms)) return true;
  }
  return false;
}

async function waitForChoices(page: Page, selectId: string, terms: string[]) {
  const deadline = Date.now() + 10_000;
  do {
    if (await hasMatchingChoice(page, selectId, terms)) return true;
    await page.waitForTimeout(250);
  } while (Date.now() < deadline);
  debugTarget(`waitForChoices timeout selectId=${selectId} terms="${terms.join(" ")}"`);
  return false;
}

async function selectNativeChoice(page: Page, selectId: string, terms: string[]) {
  const select = page.locator(`#${selectId}`).first();
  const option = (await nativeOptions(select))
    .find((entry) => meaningful(entry.text || entry.value) && (choiceMatches(entry.text, terms) || choiceMatches(entry.value, terms)));
  if (!option) return false;
  try {
    await select.selectOption({ value: option.value }, { timeout: 2_000 }).catch(async () => {
      await select.selectOption({ label: option.text }, { timeout: 2_000 });
    });
    await dispatchFieldEvents(select);
    return true;
  } catch {
    return false;
  }
}

async function selectChoice(page: Page, selectId: string, searchText: string, terms: string[], options: { forceChange?: boolean } = {}) {
  const started = Date.now();
  const choiceTerms = terms.map(normalizeBelanjaText).filter(Boolean);
  if (choiceTerms.length === 0) throw new Error(`Nilai dropdown ${selectId} kosong.`);

  const current = await selectedChoiceText(page, selectId);
  if (choiceMatches(current, choiceTerms)) {
    if (options.forceChange) await dispatchChoiceChange(page, selectId);
    debugTarget(`selectChoice kept selectId=${selectId} elapsedMs=${Date.now() - started}`);
    return;
  }

  const root = choiceRoot(page, selectId);
  const searchCandidates = [...new Set([searchText, ...terms, choiceTerms.join(" ")].map(normalizeBelanjaText).filter(Boolean))];
  const choiceOptions = root.locator(".choices__list--dropdown .choices__item--choice");
  const seen: string[] = [];

  for (const candidate of searchCandidates) {
    await root.locator(".choices__inner").click();
    const input = root.locator("input.choices__input--cloned").first();
    await input.waitFor({ state: "visible", timeout: 5_000 });
    await input.fill(candidate);
    await waitForChoices(page, selectId, choiceTerms);

    const optionCount = await choiceOptions.count();
    for (let index = 0; index < optionCount; index += 1) {
      const option = choiceOptions.nth(index);
      const text = normalizeBelanjaText(await option.innerText().catch(() => ""));
      if (!meaningful(text)) continue;
      if (!seen.includes(text)) seen.push(text);
      if (choiceMatches(text, choiceTerms)) {
        await option.click();
        await waitForChoiceSettle(page);
        debugTarget(`selectChoice clicked selectId=${selectId} candidate="${candidate}" elapsedMs=${Date.now() - started}`);
        return;
      }
    }
    if (await selectNativeChoice(page, selectId, choiceTerms)) {
      await waitForChoiceSettle(page);
      debugTarget(`selectChoice native selectId=${selectId} candidate="${candidate}" elapsedMs=${Date.now() - started}`);
      return;
    }
    await page.keyboard.press("Escape").catch(() => {});
  }

  debugTarget(`selectChoice failed selectId=${selectId} elapsedMs=${Date.now() - started}`);
  throw new Error(`Pilihan "${terms.join(" ")}" tidak ditemukan pada dropdown ${selectId}. Opsi terlihat: ${seen.slice(0, 8).join(" | ") || "-"}.`);
}

async function inputByName(page: Page, name: string, required = true) {
  for (const selector of [
    `input[name="${attr(name)}"]`,
    `textarea[name="${attr(name)}"]`,
    `select[name="${attr(name)}"]`,
  ]) {
    const candidates = page.locator(selector);
    const count = await candidates.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index);
      if (await candidate.isVisible().catch(() => false)) return candidate;
    }
  }
  if (required) throw new Error(`Field target name="${name}" tidak terlihat.`);
  return null;
}

async function setInputByName(page: Page, name: string, value: string | number, required = true) {
  const locator = await inputByName(page, name, required);
  if (!locator) return;
  await setField(locator, String(value));
}

async function inputValueByName(page: Page, name: string) {
  const locator = await inputByName(page, name, false);
  if (!locator) return "";
  return locator.inputValue().catch(async () => locator.textContent().then((value) => value ?? ""));
}

function laborBreakdown(payload: BelanjaPayload) {
  const days = payload.durationDays && payload.durationDays > 0 ? payload.durationDays : 1;
  const people = payload.qty / days;
  return {
    people: Number.isFinite(people) ? Math.round(people * 100) / 100 : payload.qty,
    days,
  };
}

async function fillWorkflow(page: Page, payload: BelanjaPayload) {
  const district = normalizeBelanjaText(payload.kecamatan);
  await selectChoice(page, "gerai", payload.desa ?? "", [payload.desa ?? "", district], { forceChange: true });
  const stageTerms = stageSearchTerms(payload);
  await selectChoice(page, "tahapan", stageTerms.join(" "), stageTerms, { forceChange: true });
  const itemTerms = categoryTerms(payload);
  await selectChoice(page, "item_pekerjaan", itemTerms.join(" "), itemTerms);
  const section = expenseSection(payload);
  await selectChoice(page, "kategori_belanja", targetFieldMap.categoryTexts[section][0], targetFieldMap.categoryTexts[section]);
  await setInputByName(page, "tanggal", payload.tanggal);
  return section;
}

async function fillMaterial(page: Page, payload: BelanjaPayload) {
  await selectChoice(page, "nama_material", payload.namaItem, [payload.namaItem]);
  await setInputByName(page, "jumlah_material[]", payload.qty);
  await setInputByName(page, "satuan_material[]", payload.satuan);
  await setInputByName(page, "harga_material[]", payload.hargaSatuan);
  await setInputByName(page, "subtotal[]", payload.jumlah, false);
  await setInputByName(page, "tanggal_bayar[]", payload.tanggal);
  await setInputByName(page, "nama_penyedia[]", payload.vendor ?? "", false);
}

async function fillLabor(page: Page, payload: BelanjaPayload) {
  const { people, days } = laborBreakdown(payload);
  await selectChoice(page, "jenis_tukang", payload.namaItem, [payload.namaItem]);
  await setInputByName(page, "jumlah_orang[]", people);
  await setInputByName(page, "jumlah_hari[]", days);
  await setInputByName(page, "tarif_harian[]", payload.hargaSatuan);
  await setInputByName(page, "subtotal[]", payload.jumlah, false);
  await setInputByName(page, "tanggal_bayar[]", payload.tanggal);
  await setInputByName(page, "nama_penyedia[]", payload.vendor ?? "", false);
}

async function fillEquipment(page: Page, payload: BelanjaPayload) {
  await selectChoice(page, "nama_alat", payload.namaItem, [payload.namaItem]);
  await setInputByName(page, "jumlah_alat[]", 1);
  const duration = await inputByName(page, "durasi[]", false);
  if (duration) await setField(duration, payload.satuan);
  await setInputByName(page, "jumlah_durasi[]", payload.qty);
  await setInputByName(page, "tarif_sewa[]", payload.hargaSatuan);
  await setInputByName(page, "subtotal[]", payload.jumlah, false);
  await setInputByName(page, "tanggal_bayar[]", payload.tanggal);
  await setInputByName(page, "nama_penyedia[]", payload.vendor ?? "", false);
}

export async function openBelanjaForm(page: Page, config: RunnerConfig) {
  const candidates = [
    config.targetBelanjaCreateUrlPath,
    targetFieldMap.belanjaCreateUrlPath,
    config.targetBelanjaUrlPath,
    targetFieldMap.belanjaUrlPath,
  ].filter((item, index, items) => item && items.indexOf(item) === index);

  for (const candidate of candidates) {
    await gotoTarget(page, config, candidate);
    if (await tryOpenBelanjaFormFromCurrentPage(page)) return;
  }

  for (const candidate of [config.targetDashboardPath, "/dashboard", "/"].filter((item, index, items) => item && items.indexOf(item) === index)) {
    await gotoTarget(page, config, candidate);
    if (await clickBelanjaNavigationLink(page) && await tryOpenBelanjaFormFromCurrentPage(page)) return;
  }

  const summary = await pageSummary(page);
  throw new Error([
    "Tombol tambah/input Belanja tidak ditemukan.",
    `URL terakhir: ${summary.url}`,
    `Title: ${summary.title || "-"}`,
    `Heading: ${summary.heading.join(" | ") || "-"}`,
    `Link terlihat: ${summary.links.map((link) => `${link.text || "-"} -> ${link.href || "-"}`).join(" | ") || "-"}`,
    `Button terlihat: ${summary.buttons.join(" | ") || "-"}`,
    "Jika path web target berbeda, isi TARGET_BELANJA_URL_PATH atau TARGET_BELANJA_CREATE_URL_PATH di .env.belanja.local.",
  ].join(" "));
}

export async function fillBelanjaForm(page: Page, config: RunnerConfig, payload: BelanjaPayload) {
  await openBelanjaForm(page, config);
  const section = await fillWorkflow(page, payload);

  if (section === "material") await fillMaterial(page, payload);
  else if (section === "labor") await fillLabor(page, payload);
  else await fillEquipment(page, payload);

  return readBelanjaForm(page);
}

export async function readBelanjaForm(page: Page) {
  const section = await inputByName(page, "jumlah_orang[]", false).then((field) => field ? "labor" as const : null)
    ?? await inputByName(page, "jumlah_alat[]", false).then((field) => field ? "equipment" as const : null)
    ?? "material" as const;
  const values: FilledValues = {
    tanggal: await inputValueByName(page, "tanggal"),
    tanggalBayar: await inputValueByName(page, "tanggal_bayar[]"),
    jumlah: await inputValueByName(page, "subtotal[]"),
    vendor: await inputValueByName(page, "nama_penyedia[]"),
  };

  if (section === "labor") {
    const people = normalizeBelanjaNumber(await inputValueByName(page, "jumlah_orang[]"));
    const days = normalizeBelanjaNumber(await inputValueByName(page, "jumlah_hari[]")) || 1;
    values.namaItem = await selectedChoiceText(page, "jenis_tukang");
    values.qty = String(people * days);
    values.satuan = "Orang-Hari";
    values.hargaSatuan = await inputValueByName(page, "tarif_harian[]");
  } else if (section === "equipment") {
    values.namaItem = await selectedChoiceText(page, "nama_alat");
    values.qty = await inputValueByName(page, "jumlah_durasi[]");
    values.satuan = await inputValueByName(page, "durasi[]");
    values.hargaSatuan = await inputValueByName(page, "tarif_sewa[]");
  } else {
    values.namaItem = await selectedChoiceText(page, "nama_material");
    values.qty = await inputValueByName(page, "jumlah_material[]");
    values.satuan = await inputValueByName(page, "satuan_material[]");
    values.hargaSatuan = await inputValueByName(page, "harga_material[]");
  }

  return values;
}

export function compareBelanjaForm(payload: BelanjaPayload, values: FilledValues) {
  const mismatches: string[] = [];
  const compareText = (key: BelanjaFieldKey, expected: string) => {
    const actual = normalizeBelanjaText(values[key]);
    if (!expected || !actual) return;
    if (!belanjaTextMatches(actual, expected)) {
      mismatches.push(`${key}: form "${actual}" != resume "${expected}"`);
    }
  };
  const compareNumber = (key: BelanjaFieldKey, expected: number) => {
    const actualRaw = values[key];
    if (!actualRaw) return;
    const actual = normalizeBelanjaNumber(actualRaw);
    if (Math.abs(actual - expected) > 0.01) mismatches.push(`${key}: form "${actual}" != resume "${expected}"`);
  };

  const actualDate = normalizeBelanjaIsoDate(values.tanggal);
  const actualPaymentDate = normalizeBelanjaIsoDate(values.tanggalBayar);
  if (actualDate && actualDate !== payload.tanggal) mismatches.push(`tanggal: form "${actualDate}" != resume "${payload.tanggal}"`);
  if (actualPaymentDate && actualPaymentDate !== payload.tanggal) mismatches.push(`tanggal_bayar: form "${actualPaymentDate}" != resume "${payload.tanggal}"`);
  compareText("namaItem", payload.namaItem);
  compareNumber("qty", payload.qty);
  compareText("satuan", payload.satuan);
  compareNumber("hargaSatuan", payload.hargaSatuan);
  compareNumber("jumlah", payload.jumlah);

  return {
    ok: mismatches.length === 0,
    mismatches,
    values,
  };
}

export async function saveDryRunScreenshot(page: Page, config: RunnerConfig, jobId: string, itemId: string) {
  const filePath = path.join(config.artifactsDir, `job-${jobId}-item-${itemId}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

export async function submitBelanjaForm(page: Page) {
  const clicked = await clickFirstButton(page, targetFieldMap.submitButtonTexts);
  if (!clicked) throw new Error("Tombol submit/simpan Belanja tidak ditemukan.");
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  const successText = regexFrom(targetFieldMap.successTexts);
  const success = page.getByText(successText).first();
  if (!await success.isVisible().catch(() => false)) {
    throw new Error("Bukti transaksi berhasil tidak ditemukan setelah submit.");
  }
  const body = await page.locator("body").innerText().catch(() => "");
  const reference = /(?:ref(?:erence)?|no(?:mor)?(?: transaksi)?|kode)\s*[:#-]?\s*([A-Z0-9./-]{4,})/i.exec(body)?.[1] ?? null;
  return { targetReference: reference };
}

export async function inspectTargetBelanja(page: Page, config: RunnerConfig) {
  await openBelanjaForm(page, config).catch(async () => {
    await gotoTarget(page, config, config.targetDashboardPath);
  });
  const data = await page.evaluate(`(() => {
    const textContent = (element) => (element.textContent || "").trim().replace(/\\s+/g, " ");
    const headings = [];
    for (const element of Array.from(document.querySelectorAll("h1,h2,h3"))) {
      const text = textContent(element);
      if (text) headings.push(text);
    }
    const labels = [];
    for (const element of Array.from(document.querySelectorAll("label"))) {
      const text = textContent(element);
      if (text) labels.push(text);
    }
    const controls = [];
    for (const element of Array.from(document.querySelectorAll("input,select,textarea,button,a"))) {
      controls.push({
        tag: element.tagName.toLowerCase(),
        type: element.getAttribute("type") || "",
        name: element.getAttribute("name") || "",
        id: element.id || "",
        placeholder: element.getAttribute("placeholder") || "",
        aria: element.getAttribute("aria-label") || "",
        role: element.getAttribute("role") || "",
        href: element.getAttribute("href") || "",
        text: textContent(element),
      });
    }
    return {
      url: location.href,
      title: document.title,
      headings,
      labels,
      controls,
    };
  })()`);
  const filePath = path.join(config.artifactsDir, `belanja-inspect-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return { data, filePath };
}
