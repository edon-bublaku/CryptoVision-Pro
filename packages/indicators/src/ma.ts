import type { Candle } from "@cv/core";

/**
 * All batch indicators return arrays aligned 1:1 with the input; warm-up bars are NaN.
 * NaN inputs are treated as "not yet available", which lets indicators be chained
 * (e.g. EMA of MACD) without index bookkeeping.
 */
export type Series = number[];

export const nanArray = (n: number): Series => new Array<number>(n).fill(NaN);

export const closes = (c: readonly Candle[]) => c.map((x) => x.close);
export const highs = (c: readonly Candle[]) => c.map((x) => x.high);
export const lows = (c: readonly Candle[]) => c.map((x) => x.low);
export const volumes = (c: readonly Candle[]) => c.map((x) => x.volume);
export const typicalPrice = (c: readonly Candle[]) => c.map((x) => (x.high + x.low + x.close) / 3);
export const hl2 = (c: readonly Candle[]) => c.map((x) => (x.high + x.low) / 2);

function firstFinite(values: readonly number[]): number {
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) return i;
  return values.length;
}

export function sma(values: readonly number[], period: number): Series {
  const out = nanArray(values.length);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (!Number.isFinite(v)) {
      sum = 0;
      count = 0;
      continue;
    }
    sum += v;
    count++;
    if (count > period) {
      sum -= values[i - period]!;
      count = period;
    }
    if (count === period) out[i] = sum / period;
  }
  return out;
}

/** EMA seeded with the SMA of the first `period` finite values (TradingView / TA-Lib convention). */
export function ema(values: readonly number[], period: number): Series {
  return expSmooth(values, period, 2 / (period + 1));
}

/** Wilder's smoothing (RMA), used by RSI, ATR and ADX. */
export function rma(values: readonly number[], period: number): Series {
  return expSmooth(values, period, 1 / period);
}

function expSmooth(values: readonly number[], period: number, alpha: number): Series {
  const out = nanArray(values.length);
  const start = firstFinite(values);
  if (values.length - start < period) return out;
  let seed = 0;
  for (let i = start; i < start + period; i++) seed += values[i]!;
  let prev = seed / period;
  out[start + period - 1] = prev;
  for (let i = start + period; i < values.length; i++) {
    const v = values[i]!;
    if (!Number.isFinite(v)) {
      out[i] = prev;
      continue;
    }
    prev = alpha * v + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

export function wma(values: readonly number[], period: number): Series {
  const out = nanArray(values.length);
  const denom = (period * (period + 1)) / 2;
  for (let i = period - 1; i < values.length; i++) {
    let s = 0;
    let ok = true;
    for (let k = 0; k < period; k++) {
      const v = values[i - k]!;
      if (!Number.isFinite(v)) {
        ok = false;
        break;
      }
      s += v * (period - k);
    }
    if (ok) out[i] = s / denom;
  }
  return out;
}

/** Hull MA: responsive trend line with little lag. */
export function hma(values: readonly number[], period: number): Series {
  const half = wma(values, Math.max(1, Math.floor(period / 2)));
  const full = wma(values, period);
  const diff = half.map((h, i) => 2 * h - full[i]!);
  return wma(diff, Math.max(1, Math.round(Math.sqrt(period))));
}

export function vwma(candles: readonly Candle[], period: number): Series {
  const out = nanArray(candles.length);
  for (let i = period - 1; i < candles.length; i++) {
    let pv = 0;
    let v = 0;
    for (let k = i - period + 1; k <= i; k++) {
      pv += candles[k]!.close * candles[k]!.volume;
      v += candles[k]!.volume;
    }
    out[i] = v === 0 ? candles[i]!.close : pv / v;
  }
  return out;
}

/**
 * VWAP that resets every UTC day (session VWAP), or anchored at `anchorIndex`.
 * Returns the VWAP and ±1σ bands which act as intraday mean-reversion targets.
 */
export function vwap(
  candles: readonly Candle[],
  opts: { anchorIndex?: number; sessionSeconds?: number } = {},
): { vwap: Series; upper: Series; lower: Series } {
  const n = candles.length;
  const out = { vwap: nanArray(n), upper: nanArray(n), lower: nanArray(n) };
  const session = opts.sessionSeconds ?? 86400;
  let pv = 0;
  let pv2 = 0;
  let vol = 0;
  let currentSession = -1;
  for (let i = 0; i < n; i++) {
    const c = candles[i]!;
    if (opts.anchorIndex !== undefined) {
      if (i < opts.anchorIndex) continue;
    } else {
      const s = Math.floor(c.time / session);
      if (s !== currentSession) {
        currentSession = s;
        pv = 0;
        pv2 = 0;
        vol = 0;
      }
    }
    const tp = (c.high + c.low + c.close) / 3;
    pv += tp * c.volume;
    pv2 += tp * tp * c.volume;
    vol += c.volume;
    if (vol > 0) {
      const v = pv / vol;
      const sd = Math.sqrt(Math.max(0, pv2 / vol - v * v));
      out.vwap[i] = v;
      out.upper[i] = v + sd;
      out.lower[i] = v - sd;
    }
  }
  return out;
}

export function rollingMax(values: readonly number[], period: number): Series {
  const out = nanArray(values.length);
  for (let i = period - 1; i < values.length; i++) {
    let m = -Infinity;
    for (let k = i - period + 1; k <= i; k++) m = Math.max(m, values[k]!);
    out[i] = m;
  }
  return out;
}

export function rollingMin(values: readonly number[], period: number): Series {
  const out = nanArray(values.length);
  for (let i = period - 1; i < values.length; i++) {
    let m = Infinity;
    for (let k = i - period + 1; k <= i; k++) m = Math.min(m, values[k]!);
    out[i] = m;
  }
  return out;
}

/** Population standard deviation over a rolling window (Bollinger convention). */
export function rollingStdev(values: readonly number[], period: number): Series {
  const out = nanArray(values.length);
  for (let i = period - 1; i < values.length; i++) {
    let s = 0;
    for (let k = i - period + 1; k <= i; k++) s += values[k]!;
    const m = s / period;
    let v = 0;
    for (let k = i - period + 1; k <= i; k++) v += (values[k]! - m) ** 2;
    out[i] = Math.sqrt(v / period);
  }
  return out;
}

/** Incremental EMA for live ticks: O(1) per closed candle. */
export class EmaState {
  private value = NaN;
  private seed: number[] = [];
  constructor(private readonly period: number) {}
  next(v: number): number {
    if (Number.isNaN(this.value)) {
      this.seed.push(v);
      if (this.seed.length === this.period) {
        this.value = this.seed.reduce((a, b) => a + b, 0) / this.period;
        this.seed = [];
      }
      return this.value;
    }
    const k = 2 / (this.period + 1);
    this.value = k * v + (1 - k) * this.value;
    return this.value;
  }
  /** Value the EMA would have if `v` closed now, without mutating state (for the forming candle). */
  peek(v: number): number {
    if (Number.isNaN(this.value)) return NaN;
    const k = 2 / (this.period + 1);
    return k * v + (1 - k) * this.value;
  }
}
