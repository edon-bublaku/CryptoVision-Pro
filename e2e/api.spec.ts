import { expect, test, type APIRequestContext } from "@playwright/test";
import { base32Decode, totp } from "@cv/server";

/** API tests need a server with DATABASE_URL (and ideally REDIS_URL) configured. */
const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
const password = "correct-horse-battery";

async function healthy(request: APIRequestContext) {
  const h = await (await request.get("/api/health")).json();
  return h.db === true;
}

test.describe.serial("auth, 2FA and sync API", () => {
  let secret = "";
  let recovery: string[] = [];
  // One cookie jar shared by the serial tests (the default `request` fixture is per-test).
  let request: APIRequestContext;

  test.beforeAll(async ({ playwright, baseURL }) => {
    request = await playwright.request.newContext({ baseURL });
  });
  test.afterAll(() => request.dispose());
  test.beforeEach(async () => test.skip(!(await healthy(request)), "server has no database"));

  test("register validates input and creates a session", async () => {
    const bad = await request.post("/api/auth/register", { data: { email, password: "short" } });
    expect(bad.status()).toBe(400);
    const res = await request.post("/api/auth/register", { data: { email, password, name: "E2E" } });
    expect(res.status()).toBe(201);
    const cookie = res.headers()["set-cookie"] ?? "";
    expect(cookie).toMatch(/cv_session=/);
    expect(cookie.toLowerCase()).toContain("httponly");
    const me = await (await request.get("/api/auth/me")).json();
    expect(me.user.email).toBe(email);
    expect(me.user).not.toHaveProperty("passwordHash");
    const dup = await request.post("/api/auth/register", { data: { email: email.toUpperCase(), password } });
    expect(dup.status()).toBe(409);
  });

  test("cross-origin writes are rejected", async () => {
    const res = await request.post("/api/auth/logout", { headers: { origin: "https://evil.example" } });
    expect(res.status()).toBe(403);
  });

  test("sync round-trip: state with optimistic concurrency, drawings, portfolio, alerts", async () => {
    const s1 = await request.put("/api/sync/state/settings", { data: { value: { lang: "en" }, baseVersion: null } });
    expect((await s1.json()).version).toBe(1);
    const conflict = await request.put("/api/sync/state/settings", { data: { value: { lang: "sq" }, baseVersion: 0 } });
    expect(conflict.status()).toBe(409);
    const drawing = { id: "d1", type: "trendline", points: [{ time: 1, price: 2 }, { time: 3, price: 4 }], style: { color: "#fff" }, locked: false, visible: true, schemaVersion: 1, createdAt: 1, updatedAt: 1 };
    expect((await request.put("/api/sync/drawings/BTCUSDT", { data: { data: [drawing] } })).ok()).toBe(true);
    const badDrawing = await request.put("/api/sync/drawings/BTCUSDT", { data: { data: [{ ...drawing, points: "x" }] } });
    expect(badDrawing.status()).toBe(400);
    const pos = { id: crypto.randomUUID(), symbol: "ETHUSDT", side: "LONG", entry: 2400.123456, quantity: 0.5, stopLoss: 2300, leverage: 1, openedAt: Date.now() };
    expect((await request.put("/api/sync/portfolio", { data: { positions: [pos], closed: [] } })).ok()).toBe(true);
    const alert = { id: crypto.randomUUID(), symbol: "BTCUSDT", type: "price_above", value: 1e6, once: true, active: true, createdAt: Date.now() };
    expect((await request.put("/api/sync/alerts", { data: { alerts: [alert] } })).ok()).toBe(true);
    const all = await (await request.get("/api/sync")).json();
    expect(all.state.settings.value).toEqual({ lang: "en" });
    expect(all.drawings.BTCUSDT.data[0].id).toBe("d1");
    expect(all.portfolio.positions[0].entry).toBeCloseTo(2400.123456, 6);
    expect(all.alerts[0].value).toBe(1e6);
  });

  test("2FA: setup, enable with TOTP, login requires a code, recovery code works once", async ({ playwright, baseURL }) => {
    const setup = await (await request.post("/api/auth/2fa/setup")).json();
    secret = setup.secret;
    expect(setup.url).toMatch(/^otpauth:\/\/totp\//);
    expect(setup.qr).toContain("<svg");
    expect((await request.post("/api/auth/2fa/enable", { data: { code: "000000" } })).status()).toBe(400);
    const enabled = await (await request.post("/api/auth/2fa/enable", { data: { code: totp(base32Decode(secret)) } })).json();
    recovery = enabled.recoveryCodes;
    expect(recovery).toHaveLength(10);

    const fresh = await playwright.request.newContext({ baseURL });
    expect((await fresh.post("/api/auth/login", { data: { email, password: "wrong-password!" } })).status()).toBe(401);
    expect(await (await fresh.post("/api/auth/login", { data: { email, password } })).json()).toEqual({ needTotp: true });
    expect((await fresh.post("/api/auth/login", { data: { email, password, code: "123456" } })).status()).toBe(401);
    const ok = await fresh.post("/api/auth/login", { data: { email, password, code: totp(base32Decode(secret)) } });
    expect(ok.status()).toBe(200);
    expect((await (await fresh.get("/api/auth/me")).json()).user.totpEnabled).toBe(true);
    await fresh.dispose();

    const viaRecovery = await playwright.request.newContext({ baseURL });
    expect((await viaRecovery.post("/api/auth/login", { data: { email, password, code: recovery[0] } })).status()).toBe(200);
    expect((await viaRecovery.post("/api/auth/login", { data: { email, password, code: recovery[0] } })).status()).toBe(401);
    const sessions = await (await viaRecovery.get("/api/auth/sessions")).json();
    expect(sessions.sessions.length).toBeGreaterThanOrEqual(2);
    await viaRecovery.dispose();
  });

  test("unauthenticated access is refused and logout clears the session", async ({ playwright, baseURL }) => {
    const anon = await playwright.request.newContext({ baseURL });
    expect((await anon.get("/api/sync")).status()).toBe(401);
    await anon.dispose();
    expect((await request.post("/api/auth/logout")).ok()).toBe(true);
    expect((await (await request.get("/api/auth/me")).json()).user).toBeNull();
  });

  test("account deletion requires the password and cascades", async ({ playwright, baseURL }) => {
    const ctx = await playwright.request.newContext({ baseURL });
    await ctx.post("/api/auth/login", { data: { email, password, code: totp(base32Decode(secret)) } });
    expect((await ctx.delete("/api/account", { data: { password: "nope-nope-nope" } })).status()).toBe(401);
    expect((await ctx.delete("/api/account", { data: { password } })).ok()).toBe(true);
    expect((await ctx.post("/api/auth/login", { data: { email, password } })).status()).toBe(401);
    await ctx.dispose();
  });
});

test("derivatives proxy returns OKX positioning", async ({ request }) => {
  const res = await request.get("/api/derivatives?symbol=BTCUSDT");
  test.skip(res.status() === 404, "OKX unreachable from this network");
  const d = await res.json();
  expect(d.instId).toBe("BTC-USDT-SWAP");
  expect(Number.isFinite(d.fundingRate)).toBe(true);
  expect(d.bias).toBeGreaterThanOrEqual(-1);
  expect(d.bias).toBeLessThanOrEqual(1);
  expect((await request.get("/api/derivatives?symbol=../../etc")).status()).toBe(400);
});
