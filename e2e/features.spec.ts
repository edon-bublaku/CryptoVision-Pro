import { expect, test, type Page } from "@playwright/test";

async function acceptDisclaimer(page: Page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("cv.e2e")) return;
    sessionStorage.setItem("cv.e2e", "1");
    localStorage.clear();
    localStorage.setItem("cv.settings", JSON.stringify({ state: { disclaimerAccepted: true, lang: "sq" }, version: 1 }));
  });
}

test("calculators: liquidation and R:R targets are computed from the inputs", async ({ page }) => {
  await acceptDisclaimer(page);
  await page.goto("/tools");
  await expect(page.getByRole("heading", { name: "Kalkulatorët e tregtarit" })).toBeVisible();

  // LONG 10× from 100 with 0.5% maintenance margin liquidates at 100 × (1 − 0.1 + 0.005) = 90.5.
  await page.getByRole("radio", { name: "Leverage & likuidimi" }).click();
  await expect(page.getByText("Çmimi i likuidimit").locator("..")).toContainText("90.5");
  await expect(page.getByText(/larg/).first()).toBeVisible();

  // 2R above a 100 entry with a 95 stop is 110; break-even win rate at 2R is 33.33%.
  await page.getByRole("radio", { name: "Objektivat R:R" }).click();
  const row = page.getByRole("row").filter({ has: page.getByRole("cell", { name: "2R", exact: true }) });
  await expect(row).toContainText("110");
  await expect(row).toContainText("33.33%");
});

test("compare: URL-driven coin set with radar, performance and metric table", async ({ page }) => {
  await acceptDisclaimer(page);
  await page.goto("/compare?s=BTCUSDT,ETHUSDT");
  await expect(page.getByRole("heading", { name: "Krahaso coinat" })).toBeVisible();
  await expect(page.getByText("Shtyllat e vlerësimit")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Performanca relative")).toBeVisible();
  await expect(page.getByRole("cell", { name: "CV Rating", exact: true })).toBeVisible();

  await page.getByLabel("Shto coin…").selectOption({ label: "SOL" });
  await expect(page).toHaveURL(/s=BTCUSDT,ETHUSDT,SOLUSDT/);
  await expect(page.getByRole("columnheader", { name: "SOL" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Hiq ETH" }).click();
  await expect(page).toHaveURL(/s=BTCUSDT,SOLUSDT$/);
});

test("command palette: Ctrl+K finds pages in either language and navigates", async ({ page }) => {
  await acceptDisclaimer(page);
  await page.goto("/");
  await expect(page.getByText("Frikë & Lakmi").first()).toBeVisible();
  await page.keyboard.press("Control+k");
  const box = page.getByRole("combobox", { name: "Kërko faqe, veprim ose coin…" });
  await expect(box).toBeFocused();
  await box.fill("calculators");
  await expect(page.getByRole("option", { name: /Kalkulatorët/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/tools$/);
});

test("mobile: the More sheet reaches pages outside the bottom bar", async ({ page }) => {
  await acceptDisclaimer(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByRole("button", { name: "Më shumë" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await sheet.getByRole("link", { name: "Krahaso" }).click();
  await expect(page).toHaveURL(/\/compare/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("rating alerts: create a CV Rating threshold alert", async ({ page }) => {
  await acceptDisclaimer(page);
  await page.goto("/alerts");
  await page.getByRole("button", { name: "Alert i ri" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Lloji").selectOption({ label: "CV Rating mbi" });
  await expect(dialog.getByText(/llogaritet mbi candle ditore/)).toBeVisible();
  await dialog.getByLabel("Vlera").fill("150");
  await expect(dialog.getByRole("button", { name: "Shto" })).toBeDisabled();
  await dialog.getByLabel("Vlera").fill("60");
  await dialog.getByRole("button", { name: "Shto" }).click();
  await expect(page.getByText(/CV Rating mbi\s*60/)).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("cv.alerts")!).state.alerts[0]);
  expect(saved).toMatchObject({ type: "rating_above", value: 60, active: true });
});
