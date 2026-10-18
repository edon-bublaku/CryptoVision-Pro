import type { Candle } from "@cv/core";
import { seededRandom } from "@cv/core";
import { describe, expect, it } from "vitest";
import { alignCloses, assetStats, beta, clusterOrder, correlationMatrix, logReturns, maxDrawdown, periodReturn, quadrantOf, realizedVol, rrg } from "./index";

const DAY = 86_400;
const candles = (closes: number[], start = 0): Candle[] =>
  closes.map((c, i) => ({ time: (start + i) * DAY, open: c, high: c, low: c, close: c, volume: 1, quoteVolume: c, takerBuyVolume: 0.5 }));

/** Random walk from a fixed seed. */
function walk(n: number, seed: number, vol = 0.03, drift = 0): number[] {
  const rnd = seededRandom(seed);
  const out = [100];
  for (let i = 1; i < n; i++) out.push(out[i - 1]! * Math.exp(drift + (rnd() - 0.5) * 2 * vol));
  return out;
}

describe("alignment and returns", () => {
  it("keeps only common bar times", () => {
    const a = alignCloses([
      { symbol: "A", candles: candles([1, 2, 3, 4], 0) },
      { symbol: "B", candles: candles([10, 20, 30], 1) },
    ]);
    expect(a.times).toEqual([DAY, 2 * DAY, 3 * DAY]);
    expect(a.closes.A).toEqual([2, 3, 4]);
    expect(a.closes.B).toEqual([10, 20, 30]);
  });
  it("log returns", () => {
    expect(logReturns([100, 110, 99])[0]).toBeCloseTo(Math.log(1.1), 12);
  });
});

describe("correlation, beta, volatility", () => {
  const btc = walk(200, 1);
  const lev = btc.map((c) => c ** 2 / 100); // log returns exactly 2× BTC
  const inverse = btc.map((c) => 10_000 / c); // log returns exactly −1× BTC
  const noise = walk(200, 99);

  it("matrix is symmetric with a unit diagonal and recovers ±1", () => {
    const m = correlationMatrix({ BTC: btc, LEV: lev, INV: inverse, N: noise }, ["BTC", "LEV", "INV", "N"], 90);
    for (let i = 0; i < 4; i++) {
      expect(m[i]![i]).toBe(1);
      for (let j = 0; j < 4; j++) expect(m[i]![j]).toBeCloseTo(m[j]![i]!, 12);
    }
    expect(m[0]![1]).toBeCloseTo(1, 10);
    expect(m[0]![2]).toBeCloseTo(-1, 10);
    expect(Math.abs(m[0]![3]!)).toBeLessThan(0.4);
  });

  it("beta of a 2× asset is 2 and of an inverse asset is −1", () => {
    expect(beta(lev, btc, 90)).toBeCloseTo(2, 10);
    expect(beta(inverse, btc, 90)).toBeCloseTo(-1, 10);
  });

  it("realised volatility scales with sqrt(time) and is 0 for steady growth", () => {
    const steady = Array.from({ length: 50 }, (_, i) => 100 * 1.01 ** i);
    expect(realizedVol(steady, 30)).toBeCloseTo(0, 8);
    expect(realizedVol(lev, 60)).toBeCloseTo(2 * realizedVol(btc, 60), 8);
  });

  it("clusters correlated assets next to each other", () => {
    const syms = ["BTC", "N", "LEV"];
    const m = correlationMatrix({ BTC: btc, LEV: lev, N: noise }, syms, 90);
    const order = clusterOrder(syms, m).map((i) => syms[i]);
    expect(Math.abs(order.indexOf("BTC") - order.indexOf("LEV"))).toBe(1);
  });
});

describe("drawdown and period returns", () => {
  it("measures the worst peak-to-trough fall", () => {
    expect(maxDrawdown([100, 120, 90, 130, 117], 5)).toBeCloseTo(-25, 10);
    expect(maxDrawdown([1, 2, 3], 3)).toBe(0);
  });
  it("period return and insufficient history", () => {
    expect(periodReturn([100, 105, 110], 2)).toBeCloseTo(10, 10);
    expect(periodReturn([100], 7)).toBeNaN();
  });
});

describe("relative rotation", () => {
  it("assigns quadrants", () => {
    expect(quadrantOf({ ratio: 101, momentum: 101 })).toBe("leading");
    expect(quadrantOf({ ratio: 101, momentum: 99 })).toBe("weakening");
    expect(quadrantOf({ ratio: 99, momentum: 99 })).toBe("lagging");
    expect(quadrantOf({ ratio: 99, momentum: 101 })).toBe("improving");
  });

  it("an accelerating outperformer is leading, an accelerating laggard is lagging", () => {
    const n = 80;
    const bench = walk(n, 3, 0.01);
    const times = bench.map((_, i) => i * DAY);
    const strong = bench.map((c, i) => c * Math.exp(0.0002 * i * i));
    const weak = bench.map((c, i) => c * Math.exp(-0.0002 * i * i));
    const s = rrg(strong, bench, times);
    const w = rrg(weak, bench, times);
    expect(s).toHaveLength(8);
    expect(quadrantOf(s[s.length - 1]!)).toBe("leading");
    expect(quadrantOf(w[w.length - 1]!)).toBe("lagging");
  });

  it("is causal: appending future bars does not change past points", () => {
    const bench = walk(120, 5);
    const asset = walk(120, 6);
    const times = bench.map((_, i) => i * DAY);
    const full = rrg(asset, bench, times, { tail: 200 });
    const cut = rrg(asset.slice(0, 100), bench.slice(0, 100), times.slice(0, 100), { tail: 200 });
    const byTime = new Map(full.map((p) => [p.time, p]));
    for (const p of cut) {
      expect(byTime.get(p.time)!.ratio).toBeCloseTo(p.ratio, 10);
      expect(byTime.get(p.time)!.momentum).toBeCloseTo(p.momentum, 10);
    }
  });
});

describe("assetStats", () => {
  it("benchmark has beta 1 and no RRG trail", () => {
    const aligned = alignCloses([
      { symbol: "BTCUSDT", candles: candles(walk(150, 7)) },
      { symbol: "ETHUSDT", candles: candles(walk(150, 8)) },
    ]);
    const stats = assetStats(aligned, "BTCUSDT");
    const btc = stats.find((s) => s.symbol === "BTCUSDT")!;
    const eth = stats.find((s) => s.symbol === "ETHUSDT")!;
    expect(btc.beta).toBe(1);
    expect(btc.rrg).toEqual([]);
    expect(btc.quadrant).toBeNull();
    expect(eth.rrg.length).toBeGreaterThan(0);
    expect(eth.quadrant).not.toBeNull();
    expect(Number.isFinite(eth.vol30d)).toBe(true);
  });
});

describe("assetStats on short histories", () => {
  it("reports ret90d as NaN instead of a shorter return", async () => {
    const { alignCloses, assetStats } = await import("./index");
    const candles = Array.from({ length: 50 }, (_, i) => ({ time: i * 86_400, open: 100 + i, high: 100 + i, low: 100 + i, close: 100 + i, volume: 1 }));
    const s = assetStats(alignCloses([{ symbol: "A", candles }, { symbol: "BTCUSDT", candles }]), "BTCUSDT");
    expect(s[0]!.ret90d).toBeNaN();
    expect(s[0]!.ret30d).toBeCloseTo((149 / 119 - 1) * 100, 9);
  });
});
