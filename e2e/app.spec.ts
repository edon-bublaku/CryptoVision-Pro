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

test("strategy builder: load a preset, save it and backtest it alone", async ({ page }) => {
  await acceptDisclaimer(page);
  await page.goto("/backtest");
  await page.getByRole("radio", { name: "Ndërtuesi i strategjive" }).click();
  await page.getByLabel("Ngarko").selectOption({ label: "Donchian 20 breakout" });
  await expect(page.getByText("Hyrje SHORT kur")).toBeVisible();
  await page.getByRole("button", { name: "Ruaj" }).click();
  await page.getByRole("button", { name: "Ekzekuto backtest" }).click();
  await expect(page.getByText("Kurba e kapitalit")).toBeVisible({ timeout: 90_000 });
  // Only the custom strategy traded.
  await expect(page.getByRole("cell", { name: "Strategji custom" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "Trend Pullback" })).toHaveCount(0);
  // Saved strategies survive a reload.
  await page.reload();
  await page.getByRole("radio", { name: "Ndërtuesi i strategjive" }).click();
  await expect(page.getByRole("option", { name: "Donchian 20 breakout" })).toHaveCount(2);
});

test("market intelligence: RRG, correlation matrix and risk table", async ({ page }) => {
  await acceptDisclaimer(page);
  await page.goto("/markets");
  await expect(page.getByText("Grafiku i rotacionit relativ (RRG)")).toBeVisible();
  await expect(page.getByText("Matrica e korrelacionit")).toBeVisible();
  await expect(page.getByRole("cell", { name: "BTC", exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Referenca")).toBeVisible();
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

test("paper trading: orders validate, fill on live prices and exit at the stop", async ({ page }) => {
  await acceptDisclaimer(page);
  await page.goto("/portfolio");
  // A LIMIT buy above the market would fill at once: the form explains and blocks it.
  await page.getByRole("button", { name: "Shto pozicion" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: "Paper · Limit" }).click();
  await dialog.getByLabel("Çmimi i urdhrit").fill("10000000");
  await dialog.getByLabel("Sasia").fill("0.01");
  await expect(dialog.getByText("do të ekzekutohej menjëherë")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Vendos urdhrin" })).toBeDisabled();
  // A sensible LIMIT far below the market rests in the order book and can be cancelled.
  await dialog.getByLabel("Çmimi i urdhrit").fill("1000");
  await dialog.getByRole("button", { name: "Vendos urdhrin" }).click();
  await expect(page.getByText("Urdhrat në pritje (paper trading)")).toBeVisible();
  await page.getByRole("button", { name: "Anulo", exact: true }).click();
  await expect(page.getByText("Urdhrat në pritje (paper trading)")).toHaveCount(0);

  // The executor: an already-triggered order fills at the live price, then its stop (set above
  // the market) closes it immediately.
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("cv.portfolio")!);
    raw.state.orders = [{ id: crypto.randomUUID(), symbol: "BTCUSDT", side: "LONG", type: "LIMIT", price: 10_000_000, quantity: 0.01, stopLoss: 9_000_000, leverage: 1, createdAt: Date.now() }];
    localStorage.setItem("cv.portfolio", JSON.stringify(raw));
  });
  await page.reload();
  await expect(page.getByText("Urdhri u ekzekutua: LONG BTC")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("cell", { name: /BTC LONG PAPER SL/ })).toBeVisible({ timeout: 30_000 });
  const closed = await page.evaluate(() => JSON.parse(localStorage.getItem("cv.portfolio")!).state.closed[0]);
  expect(closed.exitReason).toBe("SL");
  expect(closed.paper).toBe(true);
});

test("CV Rating: ranked table with weighted pillars, presets and the per-coin investment plan", async ({ page }) => {
  await acceptDisclaimer(page);
  await page.goto("/rating");
  await expect(page.getByRole("heading", { name: "CV Rating · vlerësimi i coin-ave" })).toBeVisible();
  const btcRow = page.getByRole("row").filter({ has: page.getByRole("link", { name: "BTC", exact: true }) });
  await expect(btcRow).toBeVisible({ timeout: 90_000 });
  // Changing the weighting re-scores without reloading data.
  await page.getByLabel("Peshat").selectOption({ label: "Ndjekës trendi" });
  await expect(page.getByText("Më shumë peshë te trendi")).toBeVisible();
  await page.getByLabel("Peshat").selectOption({ label: "Të balancuara" });

  await btcRow.getByRole("link", { name: "BTC", exact: true }).click();
  await expect(page.getByText("CV Rating · vlerësimi i investimit")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Plani i investimit")).toBeVisible();
  await expect(page.getByText(/Rregullat e daljes|Për ata që e mbajnë/)).toBeVisible();
  // Pillar drill-down shows the metrics and their weights.
  await page.getByRole("button", { name: /^Trendi/ }).click();
  await expect(page.getByText("Renditja e EMA-ve", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Peshat brenda shtyllës/)).toBeVisible();
});
