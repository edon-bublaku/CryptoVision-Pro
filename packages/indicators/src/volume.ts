import type { Candle } from "@cv/core";
import { nanArray, sma, type Series } from "./ma";

export function obv(candles: readonly Candle[]): Series {
  const out: Series = [];
  let v = 0;
  for (let i = 0; i < candles.length; i++) {
    if (i > 0) {
      const d = candles[i]!.close - candles[i - 1]!.close;
      if (d > 0) v += candles[i]!.volume;
      else if (d < 0) v -= candles[i]!.volume;
    }
    out.push(v);
  }
  return out;
}

function moneyFlowMultiplier(c: Candle): number {
  const range = c.high - c.low;
  return range === 0 ? 0 : (c.close - c.low - (c.high - c.close)) / range;
}

/** Accumulation / Distribution line. */
export function adLine(candles: readonly Candle[]): Series {
  let ad = 0;
  return candles.map((c) => (ad += moneyFlowMultiplier(c) * c.volume));
}

/** Chaikin Money Flow: >0 means buying pressure dominates. */
export function cmf(candles: readonly Candle[], period = 20): Series {
  const out = nanArray(candles.length);
  for (let i = period - 1; i < candles.length; i++) {
    let mfv = 0;
    let vol = 0;
    for (let k = i - period + 1; k <= i; k++) {
      mfv += moneyFlowMultiplier(candles[k]!) * candles[k]!.volume;
      vol += candles[k]!.volume;
    }
    out[i] = vol === 0 ? 0 : mfv / vol;
  }
  return out;
}

/**
 * Cumulative volume delta. Uses Binance taker-buy volume when present (exact per bar);
 * otherwise approximates delta from where the close sits in the bar's range.
 */
export function cvd(candles: readonly Candle[]): Series {
  let s = 0;
  return candles.map((c) => {
    const delta =
      c.takerBuyVolume !== undefined ? 2 * c.takerBuyVolume - c.volume : moneyFlowMultiplier(c) * c.volume;
    return (s += delta);
  });
}

/** Volume relative to its moving average (1 = average). */
export function relativeVolume(candles: readonly Candle[], period = 20): Series {
  const v = candles.map((c) => c.volume);
  const avg = sma(v, period);
  return v.map((x, i) => (avg[i]! > 0 ? x / avg[i]! : NaN));
}

export interface VolumeProfile {
  bins: { priceLow: number; priceHigh: number; volume: number; buyVolume: number }[];
  poc: number;
  vah: number;
  val: number;
}

/** Volume-by-price over the given candles, with Point of Control and 70% value area. */
export function volumeProfile(candles: readonly Candle[], binCount = 40, valueAreaPct = 0.7): VolumeProfile | null {
  if (candles.length === 0) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of candles) {
    lo = Math.min(lo, c.low);
    hi = Math.max(hi, c.high);
  }
  if (!(hi > lo)) return null;
  const step = (hi - lo) / binCount;
  const bins = Array.from({ length: binCount }, (_, i) => ({
    priceLow: lo + i * step,
    priceHigh: lo + (i + 1) * step,
    volume: 0,
    buyVolume: 0,
  }));
  for (const c of candles) {
    const range = Math.max(c.high - c.low, step * 1e-6);
    const buyShare = c.takerBuyVolume !== undefined && c.volume > 0 ? c.takerBuyVolume / c.volume : c.close >= c.open ? 0.6 : 0.4;
    // Clamped to the last bin too: a zero-range candle at the window high would otherwise fall past it.
    const first = Math.min(binCount - 1, Math.max(0, Math.floor((c.low - lo) / step)));
    const lastBin = Math.min(binCount - 1, Math.floor((c.high - lo) / step));
    for (let b = first; b <= lastBin; b++) {
      const bin = bins[b]!;
      const overlap = Math.min(c.high, bin.priceHigh) - Math.max(c.low, bin.priceLow);
      const share = c.high === c.low ? 1 : Math.max(0, overlap) / range;
      bin.volume += c.volume * share;
      bin.buyVolume += c.volume * share * buyShare;
    }
  }
  let pocIdx = 0;
  for (let i = 1; i < binCount; i++) if (bins[i]!.volume > bins[pocIdx]!.volume) pocIdx = i;
  const total = bins.reduce((s, b) => s + b.volume, 0);
  let acc = bins[pocIdx]!.volume;
  let a = pocIdx;
  let b = pocIdx;
  while (acc < total * valueAreaPct && (a > 0 || b < binCount - 1)) {
    const below = a > 0 ? bins[a - 1]!.volume : -1;
    const above = b < binCount - 1 ? bins[b + 1]!.volume : -1;
    if (above >= below) acc += bins[++b]!.volume;
    else acc += bins[--a]!.volume;
  }
  const pocBin = bins[pocIdx]!;
  return { bins, poc: (pocBin.priceLow + pocBin.priceHigh) / 2, vah: bins[b]!.priceHigh, val: bins[a]!.priceLow };
}
