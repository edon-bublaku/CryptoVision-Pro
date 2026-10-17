import type { Candle } from "@cv/core";
import { ema, nanArray, rma, rollingMax, rollingMin, rollingStdev, sma, type Series } from "./ma";

export function trueRange(candles: readonly Candle[]): Series {
  return candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const pc = candles[i - 1]!.close;
    return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
  });
}

export function atr(candles: readonly Candle[], period = 14): Series {
  return rma(trueRange(candles), period);
}

export interface Bands {
  upper: Series;
  middle: Series;
  lower: Series;
}

export function bollinger(
  values: readonly number[],
  period = 20,
  mult = 2,
): Bands & { percentB: Series; bandwidth: Series } {
  const middle = sma(values, period);
  const sd = rollingStdev(values, period);
  const upper = middle.map((m, i) => m + mult * sd[i]!);
  const lower = middle.map((m, i) => m - mult * sd[i]!);
  const percentB = values.map((v, i) => {
    const w = upper[i]! - lower[i]!;
    return w === 0 ? 0.5 : (v - lower[i]!) / w;
  });
  const bandwidth = middle.map((m, i) => (m === 0 ? NaN : (upper[i]! - lower[i]!) / m));
  return { upper, middle, lower, percentB, bandwidth };
}

export function keltner(candles: readonly Candle[], period = 20, atrPeriod = 10, mult = 2): Bands {
  const middle = ema(candles.map((c) => c.close), period);
  const a = atr(candles, atrPeriod);
  return {
    middle,
    upper: middle.map((m, i) => m + mult * a[i]!),
    lower: middle.map((m, i) => m - mult * a[i]!),
  };
}

export function donchian(candles: readonly Candle[], period = 20): Bands {
  const upper = rollingMax(candles.map((c) => c.high), period);
  const lower = rollingMin(candles.map((c) => c.low), period);
  return { upper, lower, middle: upper.map((u, i) => (u + lower[i]!) / 2) };
}

/** Annualised close-to-close volatility in %, crypto trades 365 days a year. */
export function historicalVolatility(values: readonly number[], period = 20, barsPerYear = 365): Series {
  const logRet = values.map((v, i) => (i === 0 ? NaN : Math.log(v / values[i - 1]!)));
  const out = nanArray(values.length);
  for (let i = period; i < values.length; i++) {
    let s = 0;
    for (let k = i - period + 1; k <= i; k++) s += logRet[k]!;
    const m = s / period;
    let v = 0;
    for (let k = i - period + 1; k <= i; k++) v += (logRet[k]! - m) ** 2;
    out[i] = Math.sqrt(v / (period - 1)) * Math.sqrt(barsPerYear) * 100;
  }
  return out;
}

/** ATR as % of price — comparable across coins with very different prices. */
export function atrPercent(candles: readonly Candle[], period = 14): Series {
  const a = atr(candles, period);
  return a.map((v, i) => (v / candles[i]!.close) * 100);
}
