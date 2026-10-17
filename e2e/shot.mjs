// Dev helper: node e2e/shot.mjs <path> <out.png> [width] [height] [waitMs]
import { chromium } from "@playwright/test";
const [, , path = "/", out = "shot.png", w = "1440", h = "900", wait = "6000"] = process.argv;
// Route external traffic through the sandbox proxy but keep the local dev server direct.
const proxyArgs = process.env.HTTPS_PROXY ? [`--proxy-server=${process.env.HTTPS_PROXY}`, "--proxy-bypass-list=localhost;127.0.0.1"] : [];
const browser = await chromium.launch({ args: proxyArgs });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, locale: "sq-AL" });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`PAGEERROR ${e.message}\n${e.stack?.split("\n").slice(0, 4).join("\n")}`));
await page.addInitScript(() => {
  const s = JSON.parse(localStorage.getItem("cv.settings") || '{"state":{},"version":1}');
  s.state.disclaimerAccepted = true;
  localStorage.setItem("cv.settings", JSON.stringify(s));
});
await page.goto(`http://localhost:3000${path}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(+wait);
await page.screenshot({ path: out });
console.log(errors.length ? errors.join("\n---\n") : "no console errors");
await browser.close();
