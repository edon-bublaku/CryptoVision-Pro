import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Binance trading against the local simulator (scripts/mock-binance.ts, started by the Playwright
 * config with BINANCE_TESTNET_*_URL pointing at it). No real exchange or money is involved.
 */

const KEY = "e2eMockApiKey0000000000000000001";
const SECRET = "e2eMockSecret000000000000000000001";

async function signUp(page: Page) {
  await page.addInitScript(() => localStorage.setItem("cv.settings", JSON.stringify({ state: { disclaimerAccepted: true, lang: "sq", riskPct: 1 }, version: 1 })));
  const res = await page.request.post("/api/auth/register", { data: { email: `trade-${Date.now()}@example.com`, password: "correct-horse-battery" } });
  expect(res.ok(), await res.text()).toBe(true);
}

test("trade page asks for an account when signed out", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cv.settings", JSON.stringify({ state: { disclaimerAccepted: true, lang: "sq" }, version: 1 })));
  await page.goto("/trade");
  await expect(page.getByRole("heading", { name: "Tregtimi në Binance" })).toBeVisible();
  await expect(page.getByText(/Hyr në llogari: çelësat e Binance ruhen të enkriptuar/)).toBeVisible();
});

test("testnet: connect a key, review the exact bracket, confirm, and see it in the history", async ({ page, request }) => {
  const health = await (await request.get("/api/health")).json();
  test.skip(!health.db || health.trading === "off", "server has no database or trading is off");
  await signUp(page);

  // Deep link as sent by /futures: LONG BTCUSDT, limit entry, stop, three targets, 5×.
  await page.goto("/trade?market=futures&symbol=BTCUSDT&side=LONG&type=LIMIT&price=79800&sl=79000&tp1=81500&tp1pct=40&tp2=83000&tp2pct=40&tp3=85000&tp3pct=20&lev=5");
  await expect(page.getByText(/Lidh fillimisht një çelës API për Futures/)).toBeVisible();

  // A wrong secret is refused by the exchange's signature check.
  await page.getByLabel("Çelësi për").selectOption("futures");
  await page.getByLabel("API Key").fill(KEY);
  await page.getByLabel("Secret Key").fill("wrongSecret00000000000000000000000");
  await page.getByRole("button", { name: "Verifiko dhe ruaj" }).click();
  await expect(page.getByText(/Binance nuk e pranoi çelësin/)).toBeVisible();
  await page.getByLabel("Secret Key").fill(SECRET);
  await page.getByRole("button", { name: "Verifiko dhe ruaj" }).click();
  await expect(page.getByText("•••• 0001")).toBeVisible();

  // Risk sizing uses the real balance (10 000 USDT on the simulator) and the fields from the link.
  await expect(page.getByText(/nga 10,000 USDT në llogari|nga 10\.000 USDT në llogari/)).toBeVisible();
  await expect(page.getByLabel("Çmimi limit")).toHaveValue("79800");
  await page.getByLabel(/Sasia \(BTC\)/).fill("0.01234");
  await page.getByRole("button", { name: "Shiko urdhrin" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Konfirmo urdhrin · Testnet")).toBeVisible();
  // Floored to the 0.0001 step; split 40/40/20 on the grid with the remainder in the last target.
  await expect(dialog.getByText("0.0123", { exact: true })).toBeVisible();
  await expect(dialog.getByText("81500 × 0.0049")).toBeVisible();
  await expect(dialog.getByText("85000 × 0.0025")).toBeVisible();
  await dialog.getByText(/Kërkesat e sakta për Binance \(7\)/).click();
  await expect(dialog.getByText("closePosition=true")).toBeVisible();
  const axe = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);

  await dialog.getByRole("button", { name: /Dërgo LONG BTC/ }).click();
  await expect(dialog.getByText("Hyrja, stop-i dhe targetet u pranuan nga Binance.")).toBeVisible();
  await dialog.getByRole("button", { name: "Mbyll" }).click();

  const history = page.getByRole("region", { name: "Historiku i veprimeve" });
  await expect(history.getByText("U vendos").first()).toBeVisible();
  await history.getByText("BTCUSDT").first().click();
  await expect(history.getByText("Stop-loss").first()).toBeVisible();

  // Kill switch: the ticket refuses new orders, the server too.
  await page.getByRole("switch").click();
  await expect(page.getByText("Kill switch është aktiv: urdhra të rinj nuk dërgohen.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Shiko urdhrin" })).toBeDisabled();

  // Live stays locked without 2FA.
  await page.getByRole("radio", { name: "Live" }).first().click();
  await expect(page.getByText(/Je në LIVE/)).toBeVisible();
  await page.getByRole("button", { name: "Aktivizo Live" }).click();
  await expect(page.getByText("Për tregtim live duhet 2FA. Aktivizoje te llogaria.")).toBeVisible();
});
