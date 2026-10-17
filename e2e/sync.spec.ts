import { expect, test } from "@playwright/test";

/** A drawing made on one device appears on another after signing in (requires a server DB). */
test("cross-device sync of drawings through the account", async ({ browser, baseURL, request }) => {
  const health = await (await request.get("/api/health")).json();
  test.skip(!health.db, "server has no database");
  const email = `sync-${Date.now()}@example.com`;
  const password = "correct-horse-battery";
  const accept = () => localStorage.setItem("cv.settings", JSON.stringify({ state: { disclaimerAccepted: true }, version: 1 }));

  // Device A: register through the UI, then draw a horizontal line.
  const a = await browser.newContext({ baseURL, locale: "sq-AL" });
  const pa = await a.newPage();
  await pa.addInitScript(accept);
  await pa.goto("/register");
  await pa.fill("input[type=email]", email);
  await pa.fill("input[type=password]", password);
  await pa.getByRole("button", { name: "Krijo llogari" }).click();
  await pa.waitForURL("**/account");
  await pa.goto("/chart?symbol=ETHUSDT&tf=1h");
  const canvas = pa.locator("canvas").first();
  await expect(canvas).toBeVisible();
  await pa.waitForTimeout(4000);
  const box = (await canvas.boundingBox())!;
  await pa.keyboard.press("Alt+h");
  await pa.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.4);
  await expect.poll(async () => (await (await pa.request.get("/api/sync")).json()).drawings?.ETHUSDT?.data?.length ?? 0, { timeout: 15_000 }).toBe(1);
  await a.close();

  // Device B: fresh browser, sign in, the drawing is restored from the server.
  const b = await browser.newContext({ baseURL, locale: "sq-AL" });
  const pb = await b.newPage();
  await pb.addInitScript(accept);
  await pb.goto("/login");
  await pb.fill("input[type=email]", email);
  await pb.fill("input[type=password]", password);
  await pb.getByRole("button", { name: "Hyr" }).click();
  await pb.waitForURL((u) => !u.pathname.startsWith("/login"));
  await expect
    .poll(() => pb.evaluate(() => JSON.parse(localStorage.getItem("cv.drawings") ?? "{}").state?.bySymbol?.ETHUSDT?.[0]?.type ?? null), { timeout: 15_000 })
    .toBe("hline");
  await b.close();
});
