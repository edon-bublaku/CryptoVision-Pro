import type { Candle } from "@cv/core";
import { closes, ema, nanArray, rma, rollingMax, rollingMin, sma, typicalPrice, type Series } from "./ma";

/** Wilder RSI. */
export function rsi(values: readonly number[], period = 14): Series {
  const n = values.length;
  const gains = nanArray(n);
  const losses = nanArray(n);
  for (let i = 1; i < n; i++) {
    const d = values[i]! - values[i - 1]!;
    if (!Number.isFinite(d)) continue;
    gains[i] = Math.max(d, 0);
    losses[i] = Math.max(-d, 0);
  }
  const ag = rma(gains, period);
  const al = rma(losses, period);
  return ag.map((g, i) => {
    const l = al[i]!;
    if (!Number.isFinite(g) || !Number.isFinite(l)) return NaN;
    if (l === 0) return g === 0 ? 50 : 100;
    return 100 - 100 / (1 + g / l);
  });
}

export function macd(
  values: readonly number[],
  fast = 12,
  slow = 26,
  signal = 9,
): { macd: Series; signal: Series; histogram: Series } {
  const f = ema(values, fast);
  const s = ema(values, slow);
  const line = f.map((v, i) => v - s[i]!);
  const sig = ema(line, signal);
  return { macd: line, signal: sig, histogram: line.map((v, i) => v - sig[i]!) };
}

export function stochastic(
  candles: readonly Candle[],
  kPeriod = 14,
  smoothK = 3,
  dPeriod = 3,
): { k: Series; d: Series } {
  const hh = rollingMax(candles.map((c) => c.high), kPeriod);
  const ll = rollingMin(candles.map((c) => c.low), kPeriod);
  const raw = candles.map((c, i) => {
    const range = hh[i]! - ll[i]!;
    if (!Number.isFinite(range)) return NaN;
    return range === 0 ? 50 : (100 * (c.close - ll[i]!)) / range;
  });
  const k = smoothK > 1 ? sma(raw, smoothK) : raw;
  return { k, d: sma(k, dPeriod) };
}

export function stochRsi(
  values: readonly number[],
  rsiPeriod = 14,
  stochPeriod = 14,
  smoothK = 3,
  dPeriod = 3,
): { k: Series; d: Series } {
  const r = rsi(values, rsiPeriod);
  const hh = rollingMax(r, stochPeriod);
  const ll = rollingMin(r, stochPeriod);
  const raw = r.map((v, i) => {
    const range = hh[i]! - ll[i]!;
    if (!Number.isFinite(range) || !Number.isFinite(v)) return NaN;
    return range === 0 ? 50 : (100 * (v - ll[i]!)) / range;
  });
  const k = sma(raw, smoothK);
  return { k, d: sma(k, dPeriod) };
}

export function cci(candles: readonly Candle[], period = 20): Series {
  const tp = typicalPrice(candles);
  const mean = sma(tp, period);
  const out = nanArray(candles.length);
  for (let i = period - 1; i < candles.length; i++) {
    let dev = 0;
    for (let k = i - period + 1; k <= i; k++) dev += Math.abs(tp[k]! - mean[i]!);
    dev /= period;
    out[i] = dev === 0 ? 0 : (tp[i]! - mean[i]!) / (0.015 * dev);
  }
  return out;
}

export function williamsR(candles: readonly Candle[], period = 14): Series {
  const hh = rollingMax(candles.map((c) => c.high), period);
  const ll = rollingMin(candles.map((c) => c.low), period);
  return candles.map((c, i) => {
    const range = hh[i]! - ll[i]!;
    if (!Number.isFinite(range)) return NaN;
    return range === 0 ? -50 : (-100 * (hh[i]! - c.close)) / range;
  });
}

export function roc(values: readonly number[], period = 10): Series {
  return values.map((v, i) => {
    if (i < period) return NaN;
    const p = values[i - period]!;
    return p === 0 ? NaN : ((v - p) / p) * 100;
  });
}

/** Money Flow Index: volume-weighted RSI. */
export function mfi(candles: readonly Candle[], period = 14): Series {
  const tp = typicalPrice(candles);
  const out = nanArray(candles.length);
  for (let i = period; i < candles.length; i++) {
    let pos = 0;
    let neg = 0;
    for (let k = i - period + 1; k <= i; k++) {
      const flow = tp[k]! * candles[k]!.volume;
      if (tp[k]! > tp[k - 1]!) pos += flow;
      else if (tp[k]! < tp[k - 1]!) neg += flow;
    }
    out[i] = neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
  }
  return out;
}

/** True Strength Index (double-smoothed momentum). */
export function tsi(values: readonly number[], long = 25, short = 13, signal = 13): { tsi: Series; signal: Series } {
  const mom = values.map((v, i) => (i === 0 ? NaN : v - values[i - 1]!));
  const absMom = mom.map(Math.abs);
  const num = ema(ema(mom, long), short);
  const den = ema(ema(absMom, long), short);
  const t = num.map((v, i) => (den[i] === 0 ? 0 : (100 * v) / den[i]!));
  return { tsi: t, signal: ema(t, signal) };
}

export const closeRsi = (candles: readonly Candle[], period = 14) => rsi(closes(candles), period);
