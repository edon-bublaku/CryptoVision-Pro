import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  activeAlerts,
  closeDb,
  createSession,
  createUser,
  finishScan,
  findUserByEmail,
  getAllState,
  getCandles,
  getDb,
  getSessionUser,
  isLocked,
  latestScan,
  listDrawings,
  listPositions,
  markTriggered,
  openTracked,
  putDrawings,
  putState,
  recordLoginAttempt,
  replaceAlerts,
  replacePortfolio,
  startScan,
  trackRecord,
  updateTracked,
  upsertCandles,
} from "./index";
import { runMigrations } from "./migrate";

const url = process.env.TEST_DATABASE_URL;

/** Integration tests against a real PostgreSQL (run `scripts/dev-services.sh` first). */
describe.skipIf(!url)("db repositories", () => {
  const db = getDb(url)!;
  let userId = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    await runMigrations();
    await db.execute(sql`TRUNCATE users, signals, scans, candles, audit_log CASCADE`);
  });
  afterAll(() => closeDb());

  it("creates users with case-insensitive unique emails", async () => {
    const u = await createUser(db, { email: "Ana@Example.com", passwordHash: "x" });
    userId = u.id;
    expect((await findUserByEmail(db, "ana@example.COM"))?.id).toBe(u.id);
    await expect(createUser(db, { email: "ANA@example.com", passwordHash: "y" })).rejects.toThrow();
  });

  it("locks the account after 5 failed logins", async () => {
    for (let i = 0; i < 5; i++) await recordLoginAttempt(db, (await findUserByEmail(db, "ana@example.com"))!, false);
    expect(isLocked((await findUserByEmail(db, "ana@example.com"))!)).toBe(true);
    await recordLoginAttempt(db, (await findUserByEmail(db, "ana@example.com"))!, true);
    expect(isLocked((await findUserByEmail(db, "ana@example.com"))!)).toBe(false);
  });

  it("resolves sessions and drops expired ones", async () => {
    await createSession(db, { id: "live", userId, ttlMs: 60_000 });
    await createSession(db, { id: "dead", userId, ttlMs: -1 });
    expect((await getSessionUser(db, "live", 60_000))?.user.id).toBe(userId);
    expect(await getSessionUser(db, "dead", 60_000)).toBeNull();
  });

  it("state documents use optimistic concurrency", async () => {
    const a = await putState(db, userId, "settings", { lang: "sq" }, null);
    expect(a).toEqual({ ok: true, version: 1 });
    const stale = await putState(db, userId, "settings", { lang: "en" }, 0);
    expect(stale.ok).toBe(false);
    const b = await putState(db, userId, "settings", { lang: "en" }, 1);
    expect(b).toEqual({ ok: true, version: 2 });
    expect((await getAllState(db, userId)).settings?.value).toEqual({ lang: "en" });
  });

  it("stores drawings per symbol", async () => {
    await putDrawings(db, userId, "BTCUSDT", [{ id: "d1" }]);
    expect((await listDrawings(db, userId)).BTCUSDT?.data).toEqual([{ id: "d1" }]);
    await putDrawings(db, userId, "BTCUSDT", []);
    expect(await listDrawings(db, userId)).toEqual({});
  });

  it("keeps numeric precision for positions", async () => {
    await replacePortfolio(db, userId, [
      { id: crypto.randomUUID(), symbol: "BTCUSDT", side: "LONG", entry: "81234.123456789012345678", quantity: "0.000123456789", leverage: "1", openedAt: new Date() },
    ]);
    const { open } = await listPositions(db, userId);
    expect(open[0]!.entry).toBe("81234.123456789012345678");
  });

  it("alerts keep evaluation state and trigger only once", async () => {
    const id = crypto.randomUUID();
    await replaceAlerts(db, userId, [{ id, symbol: "BTCUSDT", type: "price_above", value: "100000", timeframe: null, drawing: null, once: true, active: true, note: null }]);
    expect((await activeAlerts(db)).map((a) => a.id)).toContain(id);
    expect(await markTriggered(db, { id, once: true })).toBe(true);
    expect(await markTriggered(db, { id, once: true })).toBe(false);
    expect((await activeAlerts(db)).map((a) => a.id)).not.toContain(id);
  });

  it("stores scans and tracks active signals", async () => {
    const scanId = await startScan(db, "4h");
    const base = { timeframe: "4h", score: 70, confidence: 0.6, strategyId: "trend_pullback", candleTime: new Date(), signal: {}, snapshot: {}, gate: {} };
    await finishScan(db, scanId, [
      { ...base, id: "BTC-4h-1", symbol: "BTCUSDT", action: "BUY", status: "ACTIVE" },
      { ...base, id: "ETH-4h-1", symbol: "ETHUSDT", action: "HOLD", status: "WATCH" },
    ], []);
    const latest = await latestScan(db, "4h");
    expect(latest?.rows).toHaveLength(2);
    expect(latest?.scan.active).toBe(1);
    const open = await openTracked(db);
    expect(open.map((o) => o.s.id)).toEqual(["BTC-4h-1"]);
    await updateTracked(db, "BTC-4h-1", "tp2", 3.1);
    const rec = await trackRecord(db);
    expect(rec.stats).toMatchObject({ resolved: 1, wins: 1, winRate: 1 });
  });

  it("upserts candles idempotently", async () => {
    const c = { time: 1_700_000_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 };
    await upsertCandles(db, "BTCUSDT", "1h", [c, { ...c, time: c.time + 3600 }]);
    await upsertCandles(db, "BTCUSDT", "1h", [{ ...c, close: 1.75 }]);
    const rows = await getCandles(db, "BTCUSDT", "1h");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.close).toBe(1.75);
  });
});
