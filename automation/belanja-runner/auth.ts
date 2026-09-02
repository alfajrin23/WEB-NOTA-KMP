import fs from "node:fs";
import type { Browser, BrowserContext, Page } from "playwright";
import type { RunnerConfig } from "./config";
import { targetUrl } from "./config";
import { targetFieldMap } from "./config/target-field-map";

async function isLoginPage(page: Page) {
  return page.url().includes("/login") || await page.locator("#email, input[name='email']").first().isVisible().catch(() => false);
}

async function hasLoginForm(page: Page) {
  return await page.locator("#email, input[name='email']").first().isVisible().catch(() => false);
}

export async function createBelanjaContext(browser: Browser, config: RunnerConfig) {
  if (config.reuseAuthState && fs.existsSync(config.authStatePath)) {
    return browser.newContext({ storageState: config.authStatePath });
  }
  return browser.newContext();
}

export async function ensureAuthenticated(page: Page, context: BrowserContext, config: RunnerConfig) {
  await page.goto(targetUrl(config, "/login"), { waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  if (!await isLoginPage(page) || !await hasLoginForm(page)) return true;

  if (!config.targetEmail || !config.targetPassword) {
    throw new Error("TARGET_EMAIL/TARGET_PASSWORD belum diisi. Login otomatis tidak dapat dilakukan.");
  }

  const email = page.getByLabel(new RegExp(targetFieldMap.login.email.labels?.[0] ?? "email", "i"))
    .or(page.locator("#email"))
    .or(page.locator("input[name='email']"))
    .first();
  const password = page.getByLabel(new RegExp(targetFieldMap.login.password.labels?.[0] ?? "password", "i"))
    .or(page.locator("#password-input"))
    .or(page.locator("input[name='password']"))
    .first();
  await email.fill(config.targetEmail);
  await password.fill(config.targetPassword);

  const remember = page.locator("#remember, input[name='remember']").first();
  if (await remember.isVisible().catch(() => false)) await remember.check().catch(() => {});

  const submit = page.getByRole("button", { name: new RegExp(targetFieldMap.login.submitTexts.join("|"), "i") }).first();
  await Promise.all([
    page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {}),
    submit.click(),
  ]);
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30_000 }).catch(() => {});
  if (await isLoginPage(page)) {
    throw new Error("Login belum berhasil. Jika ada captcha, login manual sekali lalu simpan ulang auth state dengan runner headed.");
  }

  await context.storageState({ path: config.authStatePath });
  return true;
}
