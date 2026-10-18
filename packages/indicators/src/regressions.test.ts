import type { Candle } from "@cv/core";
import { lastFinite, syntheticCandles } from "@cv/core";
import { describe, expect, it } from "vitest";
import { candlePatternsAt, ema, EmaState, hma, mfi, psar, supertrend, volumeProfile, wma } from "./index";

/** Calculation defects found in the audit; each test pins the corrected behaviour. */
const k = (o: number, h: number, l: number, c: number, v = 1, t = 0): Candle => ({ time: t, open: o, high: h, low: l, close: c, volume: v });

describe("volumeProfile", () => {
  it("keeps the volume of a zero-range candle at the window high", () => {
    const vp = volumeProfile([k(100, 110, 100, 105, 10), k(110, 110, 110, 110, 50, 1)], 10)!;
    expect(vp.bins.reduce((s, b) => s + b.volume, 0)).toBeCloseTo(60, 9);
    expect(vp.poc).toBeGreaterThan(109);
  });
});

describe("psar", () => {
  it("never places the SAR inside the reversal bar's range", () => {
    const cs = syntheticCandles(1500, 1);
    const s = psar(cs);
    for (let i = 2; i < cs.length; i++) {
      const c = cs[i]!;
      expect(s[i]! >= c.high - 1e-12 || s[i]! <= c.low + 1e-12).toBe(true);
    }
  });
});

describe("mfi", () => {
  it("is neutral (50) when the typical price doesn't move", () => {
    const flat = Array.from({ length: 20 }, (_, i) => k(100, 100, 100, 100, 5, i));
    expect(lastFinite(mfi(flat, 14))).toBe(50);
  });
});

describe("hma", () => {
  it("uses floor(√n) for the final WMA, like TradingView", () => {
    const xs = syntheticCandles(300, 3).map((c) => c.close);
    const half = wma(xs, 10);
    const full = wma(xs, 21);
    const ref = wma(half.map((h, i) => 2 * h - full[i]!), 4);
    expect(hma(xs, 21).at(-1)).toBeCloseTo(ref.at(-1)!, 10);
  });
});

describe("supertrend", () => {
  it("starts in a down-trend until the first cross, like ta.supertrend", () => {
    const { direction } = supertrend(syntheticCandles(200, 1));
    expect(direction.find((d) => d !== 0)).toBe(-1);
  });
});

describe("EMA with gaps", () => {
  it("seeds from the first full run of finite values", () => {
    const out = ema([1, NaN, 3, 4, 5, 6, 7], 3);
    expect(out[4]).toBe(4);
    expect(out[5]).toBe(5);
  });
  it("EmaState skips a missing tick instead of restarting", () => {
    const s = new EmaState(3);
    const vals = [1, 2, 3, NaN, 5].map((v) => s.next(v));
    expect(vals[3]).toBe(2);
    expect(vals[4]).toBe(3.5);
  });
});

describe("lastFinite", () => {
  it("returns the last finite value, as documented", () => {
    expect(lastFinite([5, 6, NaN, NaN])).toBe(6);
    expect(lastFinite([5, 6, 7, NaN], 1)).toBe(7); // offset counts from the end: index 2
    expect(lastFinite([NaN])).toBeNaN();
  });
});

describe("candle patterns", () => {
  const prior = Array.from({ length: 20 }, (_, i) => k(120 - i, 121 - i, 119 - i, 119.5 - i, 1, i));
  const ids = (cs: Candle[]) => candlePatternsAt(cs, cs.length - 1).map((p) => p.id);
  it("harami needs the body inside the previous body, not the range", () => {
    expect(ids([...prior, k(110, 112, 98, 100, 1, 20), k(99, 106, 98.5, 105, 1, 21)])).not.toContain("bullish_harami");
    expect(ids([...prior, k(110, 110.2, 99.8, 100, 1, 20), k(101, 111, 99, 104, 1, 21)])).toContain("bullish_harami");
  });
  it("a morning star's middle candle must sit below the first candle's close", () => {
    const star = [...prior, k(110, 110.5, 99.5, 100, 1, 20), k(107.8, 108.3, 107.6, 108, 1, 21), k(104, 106.5, 103.8, 106, 1, 22)];
    expect(ids(star)).not.toContain("morning_star");
  });
});
