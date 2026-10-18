import { formatPrice, lastFinite, type Timeframe } from "@cv/core";
import type { Candle } from "@cv/core";
import { activeAlerts, getAllState, markTriggered, setAlertSide, type Db } from "@cv/db";
import { binanceStream, closedOnly, getFearGreed, getKlines, type MiniTicker } from "@cv/exchange";
import { rsi } from "@cv/indicators";
import { buildRatingContext, checkRatingAlert, rateAt, resolveWeights, type PillarWeights, type RatingContext } from "@cv/rating";
import { log } from "@cv/server";
import { deliver } from "./notify";

type ActiveAlert = Awaited<ReturnType<typeof activeAlerts>>[number];

const LABEL: Record<string, string> = {
  price_above: "Çmimi mbi",
  price_below: "Çmimi nën",
  change_pct: "Ndryshim 24h",
  rsi_above: "RSI mbi",
  rsi_below: "RSI nën",
  rating_above: "CV Rating mbi",
  rating_below: "CV Rating nën",
  drawing: "Kalim i vizatimit",
  signal: "Sinjal i ri aktiv",
};

/** Price level of a line drawing at time t (seconds). */
export function lineLevel(d: NonNullable<ActiveAlert["drawing"]>, t: number): number | null {
  const [a, b] = d.points;
  if (!a) return null;
  if (d.type === "hline" || d.type === "hray" || !b || b.time === a.time) return a.price;
  return a.price + ((b.price - a.price) * (t - a.time)) / (b.time - a.time);
}

/**
 * Pure decision for a price tick: returns a message when the alert fires, and the new side for
 * cross-detection alerts (drawings). Exported for unit tests.
 */
export function evaluatePriceAlert(a: Pick<ActiveAlert, "type" | "value" | "lastSide" | "drawing" | "note">, price: number, open: number, nowSec: number): { fire: string | null; side?: -1 | 1 } {
  const v = +a.value;
  switch (a.type) {
    case "price_above":
      return { fire: price >= v ? `${LABEL.price_above} ${formatPrice(v)} → ${formatPrice(price)}` : null };
    case "price_below":
      return { fire: price <= v ? `${LABEL.price_below} ${formatPrice(v)} → ${formatPrice(price)}` : null };
    case "change_pct": {
      const chg = open > 0 ? ((price - open) / open) * 100 : 0;
      return { fire: Math.abs(chg) >= v ? `24h ${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%` : null };
    }
    case "drawing": {
      if (!a.drawing) return { fire: null };
      const level = lineLevel(a.drawing, nowSec);
      if (level === null) return { fire: null };
      const side: -1 | 1 = price >= level ? 1 : -1;
      if (a.lastSide === null || a.lastSide === undefined) return { fire: null, side };
      if (side === a.lastSide) return { fire: null };
      return { fire: `${a.note ?? LABEL.drawing} ${side > 0 ? "↑" : "↓"} ${formatPrice(level)} (${formatPrice(price)})`, side };
    }
    default:
      return { fire: null };
  }
}

async function fire(db: Db, a: ActiveAlert, message: string) {
  if (!(await markTriggered(db, a))) return;
  await deliver(db, a, { alertId: a.id, symbol: a.symbol, title: `${a.symbol} · ${LABEL[a.type] ?? a.type}`, message });
}

/** Live price alerts from the all-market mini ticker. Alert list refreshes every 20 s. */
export function startPriceAlerts(db: Db): () => void {
  let alerts: ActiveAlert[] = [];
  let pending: MiniTicker[] = [];
  let busy = false;
  const refresh = async () => {
    try {
      alerts = await activeAlerts(db);
    } catch (e) {
      log.warn({ err: String(e) }, "alert refresh failed");
    }
  };
  void refresh();
  const refreshTimer = setInterval(refresh, 20_000);
  const unsub = binanceStream.subscribe("!miniTicker@arr", (raw) => pending.push(...(raw as MiniTicker[])));
  const tick = setInterval(async () => {
    if (busy || !pending.length) return;
    busy = true;
    const batch = new Map(pending.map((m) => [m.s, m]));
    pending = [];
    try {
      const now = Date.now() / 1000;
      for (const a of alerts) {
        const m = batch.get(a.symbol);
        if (!m || !a.active) continue;
        const r = evaluatePriceAlert(a, +m.c, +m.o, now);
        if (r.side !== undefined && r.side !== a.lastSide) {
          a.lastSide = r.side;
          await setAlertSide(db, a.id, r.side);
        }
        if (r.fire) {
          a.active = !a.once;
          await fire(db, a, r.fire);
        }
      }
    } catch (e) {
      log.error({ err: String(e) }, "price alert tick failed");
    } finally {
      busy = false;
    }
  }, 1000);
  return () => {
    clearInterval(refreshTimer);
    clearInterval(tick);
    unsub();
  };
}

/** RSI alerts: one kline fetch per (symbol, timeframe) pair per run. */
export async function runRsiAlerts(db: Db) {
  const list = (await activeAlerts(db)).filter((a) => a.type === "rsi_above" || a.type === "rsi_below");
  const cache = new Map<string, number>();
  for (const a of list) {
    const tf = (a.timeframe ?? "1h") as Timeframe;
    const key = `${a.symbol}:${tf}`;
    if (!cache.has(key)) {
      try {
        const cs = closedOnly(await getKlines(a.symbol, tf, 200));
        cache.set(key, lastFinite(rsi(cs.map((c) => c.close))));
      } catch {
        continue;
      }
    }
    const r = cache.get(key)!;
    if ((a.type === "rsi_above" && r >= +a.value) || (a.type === "rsi_below" && r <= +a.value)) await fire(db, a, `RSI(14, ${tf}) = ${r.toFixed(1)}`);
  }
}

/** "New active signal" alerts, run after every scan. */
export async function runSignalAlerts(db: Db, active: { symbol: string; timeframe: string; action: string; score: number }[]) {
  if (!active.length) return;
  const list = (await activeAlerts(db)).filter((a) => a.type === "signal");
  for (const a of list) {
    const s = active.find((x) => x.symbol === a.symbol && (!a.timeframe || a.timeframe === x.timeframe));
    if (s) await fire(db, a, `${s.action} · ${s.timeframe} · score ${s.score}`);
  }
}

const RATING_BARS = 420;

/**
 * CV Rating alerts on daily candles, scored with each user's own pillar weights (from their
 * synced settings) so the alert agrees with what they see in the app. Edge-triggered via
 * `lastSide`: fires on entering the zone, re-arms after leaving it.
 */
export async function runRatingAlerts(db: Db) {
  const list = (await activeAlerts(db)).filter((a) => a.type === "rating_above" || a.type === "rating_below");
  if (!list.length) return;
  const daily = async (symbol: string): Promise<Candle[]> => closedOnly(await getKlines(symbol, "1d", RATING_BARS));
  const bench = await daily("BTCUSDT");
  const fearGreed = await getFearGreed(RATING_BARS).catch(() => []);
  const contexts = new Map<string, RatingContext | null>();
  const weights = new Map<string, PillarWeights>();
  for (const a of list) {
    if (!contexts.has(a.symbol)) {
      try {
        const candles = a.symbol === "BTCUSDT" ? bench : await daily(a.symbol);
        contexts.set(a.symbol, buildRatingContext({ candles, bench, fearGreed, isBench: a.symbol === "BTCUSDT" }));
      } catch {
        contexts.set(a.symbol, null);
      }
    }
    const ctx = contexts.get(a.symbol);
    if (!ctx) continue;
    if (!weights.has(a.userId)) {
      const s = (await getAllState(db, a.userId)).settings?.value as { ratingPreset?: unknown; ratingWeights?: unknown } | undefined;
      weights.set(a.userId, resolveWeights(s?.ratingPreset, s?.ratingWeights));
    }
    const rating = rateAt(ctx, undefined, weights.get(a.userId));
    if (!rating) continue;
    const type = a.type as "rating_above" | "rating_below";
    const r = checkRatingAlert(type, +a.value, rating.score, a.lastSide as -1 | 1 | null);
    if (r.side !== a.lastSide) await setAlertSide(db, a.id, r.side);
    if (r.fire) await fire(db, a, `CV Rating ${rating.score.toFixed(0)} (${rating.grade}) ${type === "rating_above" ? "≥" : "≤"} ${+a.value}`);
  }
}
