import type { Candle } from "@cv/core";
import { nanArray, rma, rollingMax, rollingMin, type Series } from "./ma";
import { atr, trueRange } from "./volatility";

/** ADX with +DI / -DI (Wilder). */
export function adx(candles: readonly Candle[], period = 14): { adx: Series; plusDI: Series; minusDI: Series } {
  const n = candles.length;
  const plusDM = nanArray(n);
  const minusDM = nanArray(n);
  const tr = trueRange(candles);
  tr[0] = NaN;
  for (let i = 1; i < n; i++) {
    const up = candles[i]!.high - candles[i - 1]!.high;
    const down = candles[i - 1]!.low - candles[i]!.low;
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
  }
  const sTR = rma(tr, period);
  const sPlus = rma(plusDM, period);
  const sMinus = rma(minusDM, period);
  const plusDI = sPlus.map((v, i) => (sTR[i] === 0 ? 0 : (100 * v) / sTR[i]!));
  const minusDI = sMinus.map((v, i) => (sTR[i] === 0 ? 0 : (100 * v) / sTR[i]!));
  const dx = plusDI.map((p, i) => {
    const m = minusDI[i]!;
    const s = p + m;
    if (!Number.isFinite(s)) return NaN;
    return s === 0 ? 0 : (100 * Math.abs(p - m)) / s;
  });
  return { adx: rma(dx, period), plusDI, minusDI };
}

/** SuperTrend: direction 1 = up-trend (line below price), -1 = down-trend. */
export function supertrend(
  candles: readonly Candle[],
  period = 10,
  factor = 3,
): { line: Series; direction: number[] } {
  const n = candles.length;
  const a = atr(candles, period);
  const line = nanArray(n);
  const direction = new Array<number>(n).fill(0);
  let upperPrev = NaN;
  let lowerPrev = NaN;
  let dirPrev = 1;
  for (let i = 0; i < n; i++) {
    const c = candles[i]!;
    if (!Number.isFinite(a[i])) continue;
    const mid = (c.high + c.low) / 2;
    let upper = mid + factor * a[i]!;
    let lower = mid - factor * a[i]!;
    const prevClose = i > 0 ? candles[i - 1]!.close : c.close;
    if (Number.isFinite(lowerPrev)) lower = lower > lowerPrev || prevClose < lowerPrev ? lower : lowerPrev;
    if (Number.isFinite(upperPrev)) upper = upper < upperPrev || prevClose > upperPrev ? upper : upperPrev;
    let dir: number;
    if (!Number.isFinite(upperPrev)) dir = 1;
    else if (dirPrev === -1) dir = c.close > upper ? 1 : -1;
    else dir = c.close < lower ? -1 : 1;
    line[i] = dir === 1 ? lower : upper;
    direction[i] = dir;
    upperPrev = upper;
    lowerPrev = lower;
    dirPrev = dir;
  }
  return { line, direction };
}

/** Parabolic SAR (Wilder). */
export function psar(candles: readonly Candle[], step = 0.02, max = 0.2): Series {
  const n = candles.length;
  const out = nanArray(n);
  if (n < 2) return out;
  let up = candles[1]!.close >= candles[0]!.close;
  let sar = up ? candles[0]!.low : candles[0]!.high;
  let ep = up ? candles[1]!.high : candles[1]!.low;
  let af = step;
  out[1] = sar;
  for (let i = 2; i < n; i++) {
    const c = candles[i]!;
    const p1 = candles[i - 1]!;
    const p2 = candles[i - 2]!;
    sar = sar + af * (ep - sar);
    if (up) {
      sar = Math.min(sar, p1.low, p2.low);
      if (c.low < sar) {
        up = false;
        sar = ep;
        ep = c.low;
        af = step;
      } else if (c.high > ep) {
        ep = c.high;
        af = Math.min(max, af + step);
      }
    } else {
      sar = Math.max(sar, p1.high, p2.high);
      if (c.high > sar) {
        up = true;
        sar = ep;
        ep = c.high;
        af = step;
      } else if (c.low < ep) {
        ep = c.low;
        af = Math.min(max, af + step);
      }
    }
    out[i] = sar;
  }
  return out;
}

export interface Ichimoku {
  tenkan: Series;
  kijun: Series;
  /** Senkou spans computed at bar i; they are plotted `displacement` bars ahead. */
  spanA: Series;
  spanB: Series;
  /** Chikou is the close plotted `displacement` bars back. */
  chikou: Series;
  displacement: number;
}

export function ichimoku(candles: readonly Candle[], tenkanP = 9, kijunP = 26, spanBP = 52, displacement = 26): Ichimoku {
  const h = candles.map((c) => c.high);
  const l = candles.map((c) => c.low);
  const mid = (p: number) => {
    const hh = rollingMax(h, p);
    const ll = rollingMin(l, p);
    return hh.map((v, i) => (v + ll[i]!) / 2);
  };
  const tenkan = mid(tenkanP);
  const kijun = mid(kijunP);
  return {
    tenkan,
    kijun,
    spanA: tenkan.map((t, i) => (t + kijun[i]!) / 2),
    spanB: mid(spanBP),
    chikou: candles.map((c) => c.close),
    displacement,
  };
}

export function aroon(candles: readonly Candle[], period = 25): { up: Series; down: Series } {
  const n = candles.length;
  const up = nanArray(n);
  const down = nanArray(n);
  for (let i = period; i < n; i++) {
    let hiIdx = i;
    let loIdx = i;
    for (let k = i - period; k <= i; k++) {
      if (candles[k]!.high >= candles[hiIdx]!.high) hiIdx = k;
      if (candles[k]!.low <= candles[loIdx]!.low) loIdx = k;
    }
    up[i] = (100 * (period - (i - hiIdx))) / period;
    down[i] = (100 * (period - (i - loIdx))) / period;
  }
  return { up, down };
}

/** Slope of a series over `lookback` bars, in % of the latest value per bar. */
export function slopePct(values: readonly number[], lookback = 10): number {
  const n = values.length;
  const a = values[n - 1 - lookback];
  const b = values[n - 1];
  if (a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 0;
  return ((b - a) / b / lookback) * 100;
}

/** Heikin-Ashi candles for a smoother trend view. */
export function heikinAshi(candles: readonly Candle[]): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    const close = (c.open + c.high + c.low + c.close) / 4;
    const prev = out[i - 1];
    const open = prev ? (prev.open + prev.close) / 2 : (c.open + c.close) / 2;
    out.push({ ...c, open, close, high: Math.max(c.high, open, close), low: Math.min(c.low, open, close) });
  }
  return out;
}
