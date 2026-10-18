import type { Candle } from "@cv/core";
import { seededRandom } from "@cv/core";
import { describe, expect, it } from "vitest";
import { investmentPlan, stanceOf } from "./plan";
import { buildRatingContext, DEFAULT_WEIGHTS, gradeOf, METRICS, PILLAR_IDS, rateAt, rateCoin, verdictOf, WEIGHT_PRESETS } from "./rating";
import { lin, sig } from "./score";
import btcJson from "../../core/src/__fixtures__/btcusdt-4h.json";

const btc = btcJson as Candle[];

const DAY = 86_400;
/** Synthetic daily series with a chosen drift: clearly not market data. */
function daily(n: number, seed: number, drift: number, vol = 0.03): Candle[] {
  const rnd = seededRandom(seed);
  const out: Candle[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p;
    const c = Math.max(0.01, o * (1 + drift + (rnd() - 0.5) * 2 * vol));
    const v = 1e6 * (0.5 + rnd());
    out.push({ time: 1_600_000_000 - (1_600_000_000 % DAY) + i * DAY, open: o, high: Math.max(o, c) * (1 + rnd() * vol), low: Math.min(o, c) * (1 - rnd() * vol), close: c, volume: v, quoteVolume: v * c, takerBuyVolume: v * (0.45 + rnd() * 0.1) });
    p = c;
  }
  return out;
}

const bench = daily(500, 1, 0.001);
const fg = bench.map((c, k) => ({ time: c.time, value: 20 + (k % 60) }));

describe("score helpers", () => {
  it("lin interpolates and clamps", () => {
    expect(lin(5, [[0, 0], [10, 100]])).toBe(50);
    expect(lin(-5, [[0, 10], [10, 100]])).toBe(10);
    expect(lin(50, [[0, 10], [10, 100]])).toBe(100);
  });
  it("sig is centred at 50 and bounded", () => {
    expect(sig(0, 1)).toBe(50);
    expect(sig(1e9, 1)).toBeLessThanOrEqual(100);
    expect(sig(-1e9, 1)).toBeGreaterThanOrEqual(0);
  });
});

describe("rating", () => {
  it("has 25 uniquely named metrics spread over all 8 pillars", () => {
    expect(METRICS).toHaveLength(25);
    expect(new Set(METRICS.map((m) => m.id)).size).toBe(25);
    for (const p of PILLAR_IDS) expect(METRICS.some((m) => m.pillar === p)).toBe(true);
    for (const w of Object.values(WEIGHT_PRESETS)) {
      expect(Object.keys(w).sort()).toEqual([...PILLAR_IDS].sort());
      expect(Object.values(w).reduce((a, b) => a + b, 0)).toBe(100);
    }
  });

  it("is causal: the rating at bar i ignores later bars", () => {
    const coin = daily(500, 7, 0.0005);
    const full = buildRatingContext({ candles: coin, bench, fearGreed: fg });
    for (const i of [260, 340, 420]) {
      const cut = buildRatingContext({ candles: coin.slice(0, i + 1), bench: bench.slice(0, i + 1), fearGreed: fg });
      const a = rateAt(full, i)!;
      const b = rateAt(cut, i)!;
      expect(a.score).toBeCloseTo(b.score, 9);
      expect(a.pillars.map((p) => p.metrics.map((m) => [m.id, m.score.toFixed(9)]))).toEqual(b.pillars.map((p) => p.metrics.map((m) => [m.id, m.score.toFixed(9)])));
    }
  });

  it("rates a steady uptrend above a steady downtrend", () => {
    const up = rateCoin({ candles: daily(400, 3, 0.004), bench, fearGreed: fg }, WEIGHT_PRESETS.balanced)!;
    const down = rateCoin({ candles: daily(400, 3, -0.004), bench, fearGreed: fg }, WEIGHT_PRESETS.balanced)!;
    expect(up.score).toBeGreaterThan(65);
    expect(down.score).toBeLessThan(40);
    expect(up.pillars.find((p) => p.id === "trend")!.score).toBeGreaterThan(down.pillars.find((p) => p.id === "trend")!.score);
  });

  it("every score is within 0..100 and pillar weights sum to 1", () => {
    const r = rateCoin({ candles: daily(400, 11, 0), bench, fearGreed: fg })!;
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.pillars.reduce((s, p) => s + p.weight, 0)).toBeCloseTo(1, 12);
    for (const p of r.pillars) for (const m of p.metrics) expect(m.score >= 0 && m.score <= 100).toBe(true);
    expect(r.coverage).toBe(1);
  });

  it("renormalises over available pillars and honours custom weights", () => {
    const coin = daily(400, 5, 0.002);
    const noBench = rateCoin({ candles: coin })!;
    expect(noBench.pillars.some((p) => p.id === "relative" || p.id === "sentiment")).toBe(false);
    const total = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(noBench.coverage).toBeCloseTo((total - DEFAULT_WEIGHTS.relative - DEFAULT_WEIGHTS.sentiment) / total, 12);
    const trendOnly = Object.fromEntries(PILLAR_IDS.map((p) => [p, p === "trend" ? 1 : 0])) as typeof DEFAULT_WEIGHTS;
    const r = rateCoin({ candles: coin, bench, fearGreed: fg }, trendOnly)!;
    expect(r.score).toBeCloseTo(r.pillars[0]!.score, 12);
    expect(r.pillars).toHaveLength(1);
  });

  it("the benchmark itself has no relative-strength pillar", () => {
    const r = rateCoin({ candles: bench, bench, isBench: true })!;
    expect(r.pillars.find((p) => p.id === "relative")).toBeUndefined();
  });

  it("needs enough history", () => {
    expect(rateCoin({ candles: daily(100, 1, 0) })).toBeNull();
  });

  it("maps scores to verdicts and grades", () => {
    expect(verdictOf(80)).toBe("STRONG_ACCUMULATE");
    expect(verdictOf(65)).toBe("ACCUMULATE");
    expect(verdictOf(50)).toBe("HOLD");
    expect(verdictOf(35)).toBe("REDUCE");
    expect(verdictOf(10)).toBe("AVOID");
    expect(gradeOf(90)).toBe("A+");
    expect(gradeOf(20)).toBe("F");
  });
});

describe("investment plan", () => {
  const settings = { equity: 10_000, riskPct: 1, maxLeverage: 3, feeRate: 0.001 };

  it("long plan: entries at or below price, stop below every entry, targets above, sizes 100%, risk within budget", () => {
    for (const seed of [3, 4, 9]) {
      const coin = daily(400, seed, 0.004);
      const ctx = buildRatingContext({ candles: coin, bench, fearGreed: fg });
      const rating = rateAt(ctx)!;
      const plan = investmentPlan(rating, ctx, settings);
      const c = coin[coin.length - 1]!.close;
      expect(plan.side).toBe("LONG");
      expect(plan.entries.reduce((s, e) => s + e.sizePct, 0)).toBe(100);
      const limits = plan.entries.filter((e) => e.kind === "limit");
      for (let k = 1; k < limits.length; k++) {
        expect(limits[k - 1]!.price - limits[k]!.price).toBeGreaterThanOrEqual(0.75 * plan.atr - 1e-9);
        expect(limits[k - 1]!.price - limits[k]!.price).toBeLessThanOrEqual(Math.min(3 * plan.atr, 0.1 * limits[k - 1]!.price) + 1e-9);
      }
      expect(c - limits[0]!.price).toBeLessThanOrEqual(Math.min(3 * plan.atr, 0.1 * c) + 1e-9);
      expect(plan.stopLoss).toBeGreaterThanOrEqual(Math.min(...plan.entries.map((e) => e.price)) * 0.85 - 1e-9);
      for (const e of plan.entries) {
        expect(e.price).toBeLessThanOrEqual(c);
        expect(plan.stopLoss).toBeLessThan(e.price);
      }
      expect(plan.stopLoss).toBeGreaterThan(0);
      for (let k = 0; k < plan.targets.length; k++) {
        expect(plan.targets[k]!.price).toBeGreaterThan(plan.avgEntry);
        expect(plan.targets[k]!.price).toBeGreaterThan(c);
        if (k) expect(plan.targets[k]!.price).toBeGreaterThan(plan.targets[k - 1]!.price);
        expect(plan.targets[k]!.rr).toBeGreaterThanOrEqual(1 - 1e-9);
      }
      expect(plan.riskAmount).toBeLessThanOrEqual(settings.equity * 0.01 + 0.01);
      expect(plan.leverage).toBeLessThanOrEqual(settings.maxLeverage);
      expect(plan.exitRules.some((x) => x.id === "stop_close")).toBe(true);
    }
  });

  it("a weak risk pillar forces spot without leverage", () => {
    const coin = daily(400, 3, 0.004);
    const ctx = buildRatingContext({ candles: coin, bench, fearGreed: fg });
    const rating = rateAt(ctx)!;
    // Same coin, but with a risk pillar below 40 and a risk budget large enough to need leverage.
    const risky = { ...rating, pillars: rating.pillars.map((p) => (p.id === "risk" ? { ...p, score: 30 } : p)) };
    const levered = investmentPlan(rating, ctx, { ...settings, riskPct: 50 });
    const plan = investmentPlan(risky, ctx, { ...settings, riskPct: 50 });
    expect(levered.leverage).toBeGreaterThan(1);
    expect(plan.leverage).toBe(1);
    expect(plan.instrument).toBe("spot");
  });

  it("weak ratings give holders an exit plan, or a short plan when allowed", () => {
    const coin = daily(400, 3, -0.004);
    const ctx = buildRatingContext({ candles: coin, bench, fearGreed: fg });
    const rating = rateAt(ctx)!;
    expect(["reduce", "exit"]).toContain(stanceOf(rating));
    const hold = investmentPlan(rating, ctx, settings);
    expect(hold.side).toBeNull();
    expect(hold.entries).toHaveLength(0);
    expect(hold.exitRules[0]!.id).toBe("sell_now");
    const short = investmentPlan(rating, ctx, { ...settings, allowShort: true });
    if (short.side === "SHORT") {
      const c = coin[coin.length - 1]!.close;
      for (const e of short.entries) expect(e.price).toBeGreaterThanOrEqual(c);
      expect(short.stopLoss).toBeGreaterThan(Math.max(...short.entries.map((e) => e.price)));
      for (const t of short.targets) expect(t.price).toBeLessThan(short.avgEntry);
      expect(short.leverage).toBeLessThanOrEqual(2);
    }
  });

  it("works on real BTC history without NaNs", () => {
    const ctx = buildRatingContext({ candles: btc, isBench: true });
    const rating = rateAt(ctx)!;
    expect(Number.isFinite(rating.score)).toBe(true);
    const plan = investmentPlan(rating, ctx, settings);
    for (const v of [plan.avgEntry, plan.atr, ...plan.entries.map((e) => e.price), ...plan.targets.map((t) => t.price)]) expect(Number.isFinite(v)).toBe(true);
  });
});
