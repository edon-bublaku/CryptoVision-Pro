import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Cross-cutting quality gates for every main page: no horizontal overflow at phone, tablet
 * and desktop widths, no uncaught exceptions, and no serious/critical WCAG 2.1 AA violations.
 */

const PAGES = [
  "/",
  "/recommendations",
  "/rating",
  "/portfolio",
  "/trade",
  "/journal",
  "/chart?symbol=BTCUSDT",
  "/signals",
  "/futures?symbol=BTCUSDT&tf=4h",
  "/screener",
  "/markets",
  "/compare",
  "/seasonality",
  "/backtest",
  "/tools",
  "/alerts",
  "/settings",
  "/account",
  "/welcome",
  "/login",
  "/register",
];

const WIDTHS = [375, 768, 1440];

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!localStorage.getItem("cv.settings")) localStorage.setItem("cv.settings", JSON.stringify({ state: { disclaimerAccepted: true, lang: "sq" }, version: 1 }));
  });
});

async function open(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.locator("main, form").first()).toBeVisible();
  // Let data-driven sections render (live data arrives asynchronously).
  await page.waitForTimeout(path.startsWith("/chart") ? 4000 : 1500);
}

for (const width of WIDTHS) {
  test(`no horizontal overflow or page errors at ${width}px`, async ({ page }) => {
    test.setTimeout(PAGES.length * 20_000);
    await page.setViewportSize({ width, height: width < 500 ? 812 : 900 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));
    const overflow: string[] = [];
    for (const path of PAGES) {
      await open(page, path);
      const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      if (sw > cw + 1) overflow.push(`${path} (${sw} > ${cw})`);
    }
    expect(overflow, "pages wider than the viewport").toEqual([]);
    expect(errors, "uncaught page errors").toEqual([]);
  });
}

for (const theme of ["dark", "light"] as const) {
  test(`no serious accessibility violations (WCAG 2.1 AA, ${theme} theme)`, async ({ page, context }) => {
    test.setTimeout(PAGES.length * 30_000);
    await context.addInitScript((th) => {
      const raw = localStorage.getItem("cv.settings");
      const st = raw ? (JSON.parse(raw) as { state: Record<string, unknown>; version: number }) : { state: {}, version: 1 };
      localStorage.setItem("cv.settings", JSON.stringify({ ...st, state: { ...st.state, disclaimerAccepted: true, theme: th } }));
    }, theme);
    const found: string[] = [];
    for (const path of PAGES) {
      await open(page, path);
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        // The chart canvas is described by its own aria label; axe can't read pixels.
        .exclude(".tv-lightweight-charts")
        .analyze();
      for (const v of result.violations) {
        if (v.impact !== "serious" && v.impact !== "critical") continue;
        found.push(`${path} · ${v.id} (${v.impact}) × ${v.nodes.length}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
      }
    }
    expect(found, "axe violations").toEqual([]);
  });
}
