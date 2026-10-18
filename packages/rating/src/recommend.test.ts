import type { Candle } from "@cv/core";
import { seededRandom } from "@cv/core";
import { describe, expect, it } from "vitest";
import { buildRatingContext } from "./rating";
import { DEFAULT_RECOMMEND, recommend, type Candidate } from "./recommend";

const DAY = 86_400;
/** Synthetic daily series (not market data). `base` lets two coins share the same shocks. */
function daily(n: number, seed: number, drift: number, vol = 0.03, base?: Candle[], scale = 1): Candle[] {
  const rnd = seededRandom(seed);
  const out: Candle[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p;
    const shock = base ? base[i]!.close / base[i]!.open - 1 : drift + (rnd() - 0.5) * 2 * vol;
    const c = Math.max(0.01, o * (1 + shock * scale + (base ? (rnd() - 0.5) * 0.001 : 0)));
    const v = 1e7 * (0.5 + rnd());
    out.push({ time: 1_600_000_000 - (1_600_000_000 % DAY) + i * DAY, open: o, high: Math.max(o, c) * 1.01, low: Math.min(o, c) * 0.99, close: c, volume: v, quoteVolume: v * c, takerBuyVolume: v * 0.5 });
    p = c;
  }
  return out;
}

const btc = daily(420, 1, 0.002, 0.02);
const ctxOf = (candles: Candle[], isBench = false) => buildRatingContext({ candles, bench: btc, isBench });
const benchC: Candidate = { symbol: "BTCUSDT", ctx: ctxOf(btc, true) };

const up1 = daily(420, 2, 0.004);
const coins: Candidate[] = [
  benchC,
  { symbol: "AAA", ctx: ctxOf(up1) },
  { symbol: "AAB", ctx: ctxOf(daily(420, 99, 0, 0, up1, 1.05)) }, // moves with AAA
  { symbol: "BBB", ctx: ctxOf(daily(420, 3, 0.0035)) },
  { symbol: "CCC", ctx: ctxOf(daily(420, 4, 0.003)) },
  { symbol: "DDD", ctx: ctxOf(daily(420, 5, -0.004)) },
];

describe("recommender", () => {
  const rec = recommend(coins, benchC, { plan: { equity: 10_000, riskPct: 1, maxLeverage: 2, feeRate: 0.001 } });

  it("skips a coin that moves with an already chosen one", () => {
    const pickedA = rec.picks.some((p) => p.symbol === "AAA");
    const pickedB = rec.picks.some((p) => p.symbol === "AAB");
    expect(pickedA && pickedB).toBe(false);
    const ex = rec.excluded.find((e) => e.symbol === (pickedA ? "AAB" : "AAA"));
    expect(ex?.reason).toBe("correlated");
    expect(ex?.rho).toBeGreaterThan(DEFAULT_RECOMMEND.maxCorrelation);
  });

  it("excludes weak coins and explains why", () => {
    expect(rec.picks.some((p) => p.symbol === "DDD")).toBe(false);
    expect(rec.excluded.find((e) => e.symbol === "DDD")?.reason).toBe("low_score");
  });

  it("weights respect the cap and the regime exposure; cash is the rest", () => {
    const invested = rec.picks.reduce((a, p) => a + p.weight, 0);
    expect(invested).toBeLessThanOrEqual(rec.market.exposure + 1e-9);
    for (const p of rec.picks) expect(p.weight).toBeLessThanOrEqual(DEFAULT_RECOMMEND.maxWeight * rec.market.exposure + 1e-9);
    expect(rec.cash).toBeCloseTo(1 - invested, 12);
    expect(rec.picks.every((p) => p.rating.score >= DEFAULT_RECOMMEND.minScore && p.plan !== undefined)).toBe(true);
  });

  it("goes risk-off with BTC below EMA200 and weak breadth", () => {
    const bear = daily(420, 7, -0.003, 0.02);
    const ctx = buildRatingContext({ candles: bear, bench: bear, isBench: true });
    const weak = [1, 2, 3].map((k) => ({ symbol: `W${k}`, ctx: buildRatingContext({ candles: daily(420, 10 + k, -0.003), bench: bear }) }));
    const r = recommend([{ symbol: "BTCUSDT", ctx }, ...weak], { symbol: "BTCUSDT", ctx });
    expect(r.market.regime).toBe("risk_off");
    expect(r.market.exposure).toBe(DEFAULT_RECOMMEND.exposure.risk_off);
    expect(r.cash).toBeGreaterThanOrEqual(1 - DEFAULT_RECOMMEND.exposure.risk_off - 1e-9);
  });

  it("is causal: evaluating at bar i ignores later bars", () => {
    const i = 380;
    const a = recommend(coins.map((c) => ({ ...c, i })), { ...benchC, i });
    const cut = (c: Candidate) => ({ symbol: c.symbol, ctx: buildRatingContext({ candles: c.ctx.candles.slice(0, i + 1), bench: btc.slice(0, i + 1), isBench: c.symbol === "BTCUSDT" }) });
    const b = recommend(coins.map(cut), cut(benchC));
    expect(a.picks.map((p) => [p.symbol, p.weight.toFixed(9)])).toEqual(b.picks.map((p) => [p.symbol, p.weight.toFixed(9)]));
    expect(a.market.regime).toBe(b.market.regime);
  });
});
