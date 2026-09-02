import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "playwright";
import { normalizeBelanjaIsoDate, normalizeBelanjaNumber, normalizeBelanjaText } from "../../src/lib/belanja-sync/payload";
import type { BelanjaPayload } from "../../src/lib/belanja-sync/types";
import type { RunnerConfig } from "./config";
import { targetUrl } from "./config";
import { targetFieldMap, type BelanjaFieldKey, type FieldCandidate } from "./config/target-field-map";

type BelanjaSection = "material" | "labor" | "equipment";
type FilledValues = Partial<Record<BelanjaFieldKey | "tanggalBayar" | "vendor", string>>;

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

function normalizeMatch(value: string | null | undefined) {
  return normalizeBelanjaText(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function meaningful(value: string | null | undefined) {
  const normalized = normalizeBelanjaText(value);
  return normalized && !/pilih data|no choices|tidak ada pilihan/i.test(normalized);
}

function candidateLocators(page: Page, candidate: FieldCandidate): Locator[] {
  const locators: Locator[] = [];
  for (const label of candidate.labels ?? []) locators.push(page.getByLabel(new RegExp(label, "i")).first());
  for (const placeholder of candidate.placeholders ?? []) locators.push(page.getByPlaceholder(new RegExp(placeholder, "i")).first());
  for (const id of candidate.ids ?? []) locators.push(page.locator(`[id="${attr(id)}"]`).first());
  for (const name of candidate.names ?? []) locators.push(page.locator(`[name="${attr(name)}"]`).first());
  return locators;
}

async function firstVisible(locators: Locator[]) {
  for (const locator of locators) {
    if (await locator.isVisible().catch(() => false)) return locator;
  }
  return null;
}

async function findField(page: Page, key: BelanjaFieldKey) {
  const candidate = targetFieldMap.fields[key];
  const locator = await firstVisible(candidateLocators(page, candidate));
  if (!locator && candidate.required) throw new Error(`Field target "${key}" tidak ditemukan. Jalankan belanja:inspect dan update target-field-map.`);
  return locator;
}

async function setField(locator: Locator, value: string) {
  const fieldState = await locator.evaluate((element) => {
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
  const needsProgrammaticValue = fieldState.readOnly || /tarif|harga|subtotal|price/i.test(`${fieldState.name} ${fieldState.className}`);
  if (needsProgrammaticValue && (fieldState.tag === "input" || fieldState.tag === "textarea")) {
    await locator.evaluate((element, nextValue) => {
      const field = element as HTMLInputElement | HTMLTextAreaElement;
      field.value = nextValue;
    }, value);
    return true;
  }

  const tag = fieldState.tag || await locator.evaluate((element) => element.tagName.toLowerCase()).catch(() => "");
  if (tag === "select") {
    await locator.selectOption({ label: value }).catch(async () => {
      await locator.selectOption(value);
    });
    return true;
  }
  await locator.fill(value);
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
  const selectText = await page.locator(`#${selectId}`).first().evaluate((element) => {
    const select = element as HTMLSelectElement;
    return select.selectedOptions?.[0]?.textContent ?? "";
  }).catch(() => "");
  if (meaningful(selectText)) return normalizeBelanjaText(selectText);
  return normalizeBelanjaText(await choiceRoot(page, selectId).locator(".choices__list--single").innerText().catch(() => ""));
}

async function waitForAnyChoices(page: Page, selectId: string) {
  await page.waitForFunction(
    (id) => {
      const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
      const select = document.getElementById(id);
      const root = select?.closest(".choices");
      if (!root) return false;
      const options = Array.from(root.querySelectorAll(".choices__list--dropdown .choices__item--choice"));
      return options.some((option) => {
        const normalized = normalize(option.textContent ?? "");
        return normalized && !/pilihdata|nochoices|tidakadapilihan/.test(normalized);
      });
    },
    selectId,
    { timeout: 12_000 },
  ).catch(() => {});
}

async function waitForChoices(page: Page, selectId: string, normalizedTerms: string[]) {
  await page.waitForFunction(
    ({ id, terms }) => {
      const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
      const select = document.getElementById(id);
      const root = select?.closest(".choices");
      if (!root) return false;
      const options = Array.from(root.querySelectorAll(".choices__list--dropdown .choices__item--choice"));
      return options.some((option) => {
        const text = option.textContent ?? "";
        const normalized = normalize(text);
        return normalized && !/pilihdata|nochoices|tidakadapilihan/.test(normalized) && terms.every((term) => normalized.includes(term));
      });
    },
    { id: selectId, terms: normalizedTerms },
    { timeout: 10_000 },
  ).catch(() => {});
}

async function selectChoice(page: Page, selectId: string, searchText: string, terms: string[]) {
  const normalizedTerms = terms.map(normalizeMatch).filter(Boolean);
  if (normalizedTerms.length === 0) throw new Error(`Nilai dropdown ${selectId} kosong.`);

  const current = normalizeMatch(await selectedChoiceText(page, selectId));
  if (current && normalizedTerms.every((term) => current.includes(term))) return;

  await waitForAnyChoices(page, selectId);
  const root = choiceRoot(page, selectId);
  await root.locator(".choices__inner").click();
  const input = root.locator("input.choices__input--cloned").first();
  await input.waitFor({ state: "visible", timeout: 5_000 });
  await input.fill(searchText || terms[0] || "");
  await waitForChoices(page, selectId, normalizedTerms);

  const options = root.locator(".choices__list--dropdown .choices__item--choice");
  const optionCount = await options.count();
  const seen: string[] = [];
  for (let index = 0; index < optionCount; index += 1) {
    const option = options.nth(index);
    const text = normalizeBelanjaText(await option.innerText().catch(() => ""));
    if (!meaningful(text)) continue;
    seen.push(text);
    const normalized = normalizeMatch(text);
    if (normalizedTerms.every((term) => normalized.includes(term))) {
      await option.click();
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
      return;
    }
  }

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
  await selectChoice(page, "gerai", payload.desa ?? "", [payload.desa ?? "", district]);
  const stageTerms = stageSearchTerms(payload);
  await selectChoice(page, "tahapan", stageTerms.join(" "), stageTerms);
  await waitForAnyChoices(page, "item_pekerjaan");
  const itemTerms = categoryTerms(payload);
  await selectChoice(page, "item_pekerjaan", itemTerms.join(" "), itemTerms);
  await waitForAnyChoices(page, "kategori_belanja");
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
  await page.goto(targetUrl(config, targetFieldMap.belanjaCreateUrlPath), { waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  if (await page.locator("#gerai").first().count()) return;

  await page.goto(targetUrl(config, targetFieldMap.belanjaUrlPath), { waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  const clicked = await clickFirstButton(page, targetFieldMap.addButtonTexts);
  if (!clicked) throw new Error("Tombol tambah/input Belanja tidak ditemukan.");
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
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
    const actualNorm = normalizeMatch(actual);
    const expectedNorm = normalizeMatch(expected);
    if (actualNorm !== expectedNorm && !actualNorm.includes(expectedNorm) && !expectedNorm.includes(actualNorm)) {
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
  await page.goto(targetUrl(config, targetFieldMap.belanjaUrlPath), { waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  const data = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    headings: Array.from(document.querySelectorAll("h1,h2,h3")).map((element) => element.textContent?.trim()).filter(Boolean),
    labels: Array.from(document.querySelectorAll("label")).map((element) => element.textContent?.trim()).filter(Boolean),
    controls: Array.from(document.querySelectorAll("input,select,textarea,button,a")).map((element) => ({
      tag: element.tagName.toLowerCase(),
      type: element.getAttribute("type") || "",
      name: element.getAttribute("name") || "",
      id: element.id || "",
      placeholder: element.getAttribute("placeholder") || "",
      aria: element.getAttribute("aria-label") || "",
      role: element.getAttribute("role") || "",
      href: element.getAttribute("href") || "",
      text: element.textContent?.trim().replace(/\s+/g, " ") || "",
    })),
  }));
  const filePath = path.join(config.artifactsDir, `belanja-inspect-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return { data, filePath };
}
