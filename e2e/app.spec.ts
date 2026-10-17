import { expect, test, type Page } from "@playwright/test";

async function acceptDisclaimer(page: Page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("cv.e2e")) return;
    sessionStorage.setItem("cv.e2e", "1");
    localStorage.clear();
    localStorage.setItem("cv.settings", JSON.stringify({ state: { disclaimerAccepted: true, lang: "sq" }, version: 1 }));
  });
}

test("first visit shows the risk disclaimer", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("dialog")).toContainText("Jo këshillë financiare");
  await page.getByRole("button", { name: "E kuptoj dhe pranoj" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("dashboard shows live market data and auto-scans signals", async ({ page }) => {
  await acceptDisclaimer(page);
  await page.goto("/");
  await expect(page.getByText("Frikë & Lakmi").first()).toBeVisible();
  await expect(page.locator("a[href='/chart?symbol=BTCUSDT']").first()).toContainText(/\d/);
  await expect(page.getByText("Sinjalet kryesore")).toBeVisible();
});

test("draw a trend line, persist it and restore it after reload", async ({ page }) => {
  await acceptDisclaimer(page);
  await page.goto("/chart?symbol=BTCUSDT&tf=4h");
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(4000);
  const box = (await page.locator("main div.min-h-0.flex-1").first().boundingBox())!;
  await page.keyboard.press("Alt+t");
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.4);
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.25);
  const count = () => page.evaluate(() => JSON.parse(localStorage.getItem("cv.drawings") ?? "{}").state?.bySymbol?.BTCUSDT?.length ?? 0);
  await expect.poll(count).toBe(1);
  // Undo / redo
  await page.keyboard.press("Control+z");
  await expect.poll(count).toBe(0);
  await page.keyboard.press("Control+y");
  await expect.poll(count).toBe(1);
  await page.reload();
  await page.waitForTimeout(3000);
  await expect.poll(count).toBe(1);
  const d = await page.evaluate(() => JSON.parse(localStorage.getItem("cv.drawings")!).state.bySymbol.BTCUSDT[0]);
  expect(d.type).toBe("trendline");
  expect(d.points).toHaveLength(2);
  expect(d.points[1].price).toBeGreaterThan(d.points[0].price);
});

test("backtest lab runs the engine and reports metrics", async ({ page }) => {
  await acceptDisclaimer(page);
  await page.goto("/backtest");
  await page.getByRole("button", { name: "Ekzekuto backtest" }).click();
  await expect(page.getByText("Kurba e kapitalit")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("Profit factor").first()).toBeVisible();
  await expect(page.getByText("Monte Carlo (1000 simulime)")).toBeVisible();
});

test("portfolio: add a position with risk-based sizing", async ({ page }) => {
  await acceptDisclaimer(page);
  await page.goto("/portfolio");
  await page.getByRole("button", { name: "Shto pozicion" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("input[type=number]").nth(0).fill("100000");
  await dialog.locator("input[type=number]").nth(1).fill("95000");
  await dialog.getByRole("button", { name: "Shto", exact: true }).click();
  await expect(page.locator("table")).toContainText("BTC");
  const pos = await page.evaluate(() => JSON.parse(localStorage.getItem("cv.portfolio")!).state.positions[0]);
  // 1% of $10,000 = $100 at risk over a $5,000 stop distance (+ fees) ≈ 0.0195 BTC
  expect(pos.quantity).toBeGreaterThan(0.019);
  expect(pos.quantity).toBeLessThan(0.02);
});
