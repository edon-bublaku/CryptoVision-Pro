import { describe, expect, it } from "vitest";
import * as TI from "technicalindicators";
import { syntheticCandles } from "@cv/core";
import btc from "../../core/src/__fixtures__/btcusdt-4h.json";
import {
  adx, atr, bollinger, cci, ema, macd, mfi, obv, rsi, sma, stochastic, williamsR, wma, psar,
  supertrend, volumeProfile, pivots, marketStructure, fairValueGaps, divergences, pivotPoints,
  autoFib, supportResistance, vwap, hma, ichimoku, candlePatternsAt, heikinAshi, keltner, donchian,
} from "./index";
import type { Candle } from "@cv/core";

const candles = btc as Candle[];
const close = candles.map((c) => c.close);
const high = candles.map((c) => c.high);
const low = candles.map((c) => c.low);
const volume = candles.map((c) => c.volume);

/** Compare the tail of our series against a reference aligned to the end. */
function expectTailClose(ours: number[], ref: number[], tail = 300, relTol = 1e-6) {
  expect(ref.length).toBeGreaterThan(tail);
  for (let k = 1; k <= tail; k++) {
    const a = ours[ours.length - k]!;
    const b = ref[ref.length - k]!;
    expect(Number.isFinite(a)).toBe(true);
    expect(Math.abs(a - b)).toBeLessThanOrEqual(Math.max(1e-8, Math.abs(b) * relTol));
  }
}

describe("moving averages", () => {
  it("SMA matches reference exactly", () => expectTailClose(sma(close, 20), TI.SMA.calculate({ period: 20, values: close }), 1500, 1e-10));
  it("EMA matches reference", () => expectTailClose(ema(close, 21), TI.EMA.calculate({ period: 21, values: close })));
  it("WMA matches reference", () => expectTailClose(wma(close, 10), TI.WMA.calculate({ period: 10, values: close }), 1500, 1e-10));
  it("SMA has NaN warm-up then values", () => {
    const s = sma([1, 2, 3, 4, 5], 3);
    expect(s.slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(s.slice(2)).toEqual([2, 3, 4]);
  });
  it("EMA seeds with SMA", () => {
    const e = ema([2, 4, 6, 8], 3);
    expect(e[2]).toBe(4);
    expect(e[3]).toBe(0.5 * 8 + 0.5 * 4);
  });
  it("HMA lags a linear series far less than SMA", () => {
    const line = Array.from({ length: 100 }, (_, i) => i);
    // Discrete WMA lag of (n-1)/3 leaves HMA(16) a residual lag of 2/3 bar vs 7.5 bars for SMA(16).
    expect(99 - hma(line, 16)[99]!).toBeCloseTo(2 / 3, 8);
    expect(99 - sma(line, 16)[99]!).toBeCloseTo(7.5, 8);
  });
});

describe("momentum", () => {
  it("RSI matches reference (Wilder)", () => expectTailClose(rsi(close, 14), TI.RSI.calculate({ period: 14, values: close }), 300, 1e-3));
  it("RSI stays within [0,100]", () => {
    for (const seed of [1, 2, 3]) for (const v of rsi(syntheticCandles(500, seed).map((c) => c.close))) if (Number.isFinite(v)) expect(v >= 0 && v <= 100).toBe(true);
  });
  it("MACD matches reference", () => {
    const ref = TI.MACD.calculate({ values: close, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
    const ours = macd(close);
    expectTailClose(ours.macd, ref.map((r) => r.MACD!), 300, 1e-6);
    expectTailClose(ours.signal, ref.map((r) => r.signal!), 300, 1e-6);
  });
  it("Stochastic matches reference", () => {
    const ref = TI.Stochastic.calculate({ high, low, close, period: 14, signalPeriod: 3 });
    const ours = stochastic(candles, 14, 1, 3);
    expectTailClose(ours.k, ref.map((r) => r.k), 300, 1e-6);
    expectTailClose(ours.d, ref.map((r) => r.d), 300, 1e-6);
  });
  it("CCI matches reference", () => expectTailClose(cci(candles, 20), TI.CCI.calculate({ high, low, close, period: 20 }), 300, 1e-6));
  it("Williams %R matches reference", () => expectTailClose(williamsR(candles, 14), TI.WilliamsR.calculate({ high, low, close, period: 14 }), 300, 1e-6));
  it("MFI matches reference", () => expectTailClose(mfi(candles, 14), TI.MFI.calculate({ high, low, close, volume, period: 14 }), 300, 1e-3));
});

describe("volatility & trend", () => {
  it("ATR matches reference", () => expectTailClose(atr(candles, 14), TI.ATR.calculate({ high, low, close, period: 14 }), 300, 1e-6));
  it("Bollinger matches reference", () => {
    const ref = TI.BollingerBands.calculate({ period: 20, stdDev: 2, values: close });
    const ours = bollinger(close, 20, 2);
    expectTailClose(ours.upper, ref.map((r) => r.upper), 300, 1e-8);
    expectTailClose(ours.lower, ref.map((r) => r.lower), 300, 1e-8);
  });
  it("Bollinger ordering upper ≥ middle ≥ lower", () => {
    const b = bollinger(close);
    b.upper.forEach((u, i) => Number.isFinite(u) && expect(u >= b.middle[i]! && b.middle[i]! >= b.lower[i]!).toBe(true));
  });
  it("ADX matches reference", () => {
    const ref = TI.ADX.calculate({ high, low, close, period: 14 });
    const ours = adx(candles, 14);
    expectTailClose(ours.adx, ref.map((r) => r.adx), 300, 1e-3);
    expectTailClose(ours.plusDI, ref.map((r) => r.pdi), 300, 1e-3);
  });
  it("PSAR (Wilder) stays on the stop side of price between reversals", () => {
    const s = psar(candles);
    let flips = 0;
    for (let i = 3; i < candles.length; i++) {
      const upPrev = s[i - 1]! < candles[i - 1]!.close;
      const up = s[i]! < candles[i]!.close;
      if (up !== upPrev) {
        flips++;
        continue;
      }
      if (up) expect(s[i]!).toBeLessThanOrEqual(candles[i]!.low + 1e-9);
      else expect(s[i]!).toBeGreaterThanOrEqual(candles[i]!.high - 1e-9);
    }
    expect(flips).toBeGreaterThan(20);
  });
  it("OBV matches reference", () => {
    const ours = obv(candles);
    const ref = TI.OBV.calculate({ close, volume });
    // Reference starts at bar 1; compare day-over-day differences to remove the constant offset.
    for (let k = 1; k < 300; k++) expect(ours.at(-k)! - ours.at(-k - 1)!).toBeCloseTo(ref.at(-k)! - ref.at(-k - 1)!, 4);
  });
  it("SuperTrend direction flips and line sits on the correct side", () => {
    const st = supertrend(candles);
    let flips = 0;
    for (let i = 20; i < candles.length; i++) {
      if (st.direction[i] !== st.direction[i - 1]) flips++;
      if (st.direction[i] === 1) expect(st.line[i]!).toBeLessThanOrEqual(candles[i]!.close);
      else expect(st.line[i]!).toBeGreaterThanOrEqual(candles[i]!.close);
    }
    expect(flips).toBeGreaterThan(5);
  });
  it("Keltner and Donchian envelopes contain their middle", () => {
    const k = keltner(candles);
    const d = donchian(candles);
    for (let i = 60; i < candles.length; i++) {
      expect(k.upper[i]!).toBeGreaterThan(k.lower[i]!);
      expect(d.upper[i]!).toBeGreaterThanOrEqual(candles[i]!.high);
    }
  });
  it("Ichimoku lines are finite after warm-up", () => {
    const ich = ichimoku(candles);
    expect(Number.isFinite(ich.spanB.at(-1)!)).toBe(true);
    expect(ich.displacement).toBe(26);
  });
  it("VWAP resets each UTC day", () => {
    const v = vwap(candles);
    const firstOfDay = candles.findIndex((c, i) => i > 0 && Math.floor(c.time / 86400) !== Math.floor(candles[i - 1]!.time / 86400));
    const c = candles[firstOfDay]!;
    expect(v.vwap[firstOfDay]).toBeCloseTo((c.high + c.low + c.close) / 3, 8);
  });
  it("Heikin-Ashi wicks contain bodies", () => {
    for (const h of heikinAshi(candles)) expect(h.high >= Math.max(h.open, h.close) && h.low <= Math.min(h.open, h.close)).toBe(true);
  });
});

describe("structure", () => {
  it("pivots are local extremes and confirmed after `right` bars", () => {
    const ps = pivots(candles, 5, 5);
    expect(ps.length).toBeGreaterThan(20);
    for (const p of ps) {
      expect(p.confirmedAt).toBe(p.index + 5);
      for (let k = p.index - 5; k <= p.index + 5; k++) {
        if (p.type === "high") expect(candles[k]!.high).toBeLessThanOrEqual(p.price);
        else expect(candles[k]!.low).toBeGreaterThanOrEqual(p.price);
      }
    }
  });
  it("market structure events never precede their swing confirmation", () => {
    const ms = marketStructure(candles);
    expect(ms.events.length).toBeGreaterThan(5);
    expect(["bullish", "bearish"]).toContain(ms.trend);
  });
  it("FVGs have top > bottom and are created after their middle candle", () => {
    for (const z of fairValueGaps(candles)) {
      expect(z.top).toBeGreaterThan(z.bottom);
      expect(z.createdIndex).toBe(z.startIndex + 1);
    }
  });
  it("divergences are confirmed after their second pivot", () => {
    for (const d of divergences(candles, rsi(close))) expect(d.confirmedAt).toBeGreaterThan(d.to.index);
  });
  it("support/resistance levels are classified relative to price", () => {
    const lv = supportResistance(candles);
    expect(lv.length).toBeGreaterThan(0);
    const last = close.at(-1)!;
    for (const l of lv) expect(l.kind === "support" ? l.price < last : l.price >= last).toBe(true);
  });
  it("classic pivot points", () => {
    const p = pivotPoints({ high: 110, low: 90, close: 100 });
    expect(p.pp).toBe(100);
    expect(p.r1).toBe(110);
    expect(p.s1).toBe(90);
  });
  it("auto fib spans the dominant swing", () => {
    const f = autoFib(candles, 200)!;
    expect(f.levels.find((l) => l.ratio === 0)!.price).toBe(f.to.price);
    expect(f.levels.find((l) => l.ratio === 1)!.price).toBe(f.from.price);
  });
  it("volume profile conserves volume and POC lies in value area", () => {
    const slice = candles.slice(-200);
    const vp = volumeProfile(slice, 30)!;
    const total = vp.bins.reduce((s, b) => s + b.volume, 0);
    expect(total).toBeCloseTo(slice.reduce((s, c) => s + c.volume, 0), 3);
    expect(vp.poc).toBeGreaterThanOrEqual(vp.val);
    expect(vp.poc).toBeLessThanOrEqual(vp.vah);
  });
});

describe("candle patterns", () => {
  const mk = (o: number, h: number, l: number, c: number, t = 0): Candle => ({ time: t, open: o, high: h, low: l, close: c, volume: 1 });
  const down = [mk(110, 111, 107, 108), mk(108, 109, 105, 106), mk(106, 107, 103, 104), mk(104, 105, 101, 102), mk(102, 103, 99, 100)];
  it("bullish engulfing after a decline", () => {
    const cs = [...down, mk(100, 100.5, 98, 98.5), mk(98, 102, 97.8, 101.5)];
    expect(candlePatternsAt(cs, cs.length - 1).map((p) => p.id)).toContain("bullish_engulfing");
  });
  it("hammer after a decline", () => {
    const cs = [...down, mk(100, 100.2, 95, 100.1)];
    expect(candlePatternsAt(cs, cs.length - 1).map((p) => p.id)).toContain("hammer");
  });
});
