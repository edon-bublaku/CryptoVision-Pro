import type { MarketRegime } from "@cv/core";
import { percentileRank } from "@cv/core";
import type { SeriesContext } from "./context";

export interface RegimeInfo {
  regime: MarketRegime;
  /** 0..1, how clearly the market fits the regime. */
  strength: number;
  adx: number;
  atrPercentile: number;
  ema200Slope: number;
}

/** Minimum average traded value per bar (USDT) before we trust the price action. */
const MIN_QUOTE_VOLUME_PER_BAR = 25_000;

export function detectRegime(ctx: SeriesContext, i: number): RegimeInfo {
  const adxV = ctx.adx.adx[i] ?? NaN;
  const e200 = ctx.ema200[i] ?? NaN;
  const e200Prev = ctx.ema200[i - 10] ?? NaN;
  const slope = Number.isFinite(e200) && Number.isFinite(e200Prev) ? ((e200 - e200Prev) / e200) * 100 : 0;
  const window = ctx.atrPct.slice(Math.max(0, i - 200), i + 1);
  const atrPctl = percentileRank(window, ctx.atrPct[i] ?? NaN);
  const c = ctx.candles[i]!;
  const close = c.close;
  const plus = ctx.adx.plusDI[i] ?? 0;
  const minus = ctx.adx.minusDI[i] ?? 0;
  const base = { adx: adxV, atrPercentile: atrPctl, ema200Slope: slope };

  let quoteVol = 0;
  const from = Math.max(0, i - 19);
  for (let k = from; k <= i; k++) {
    const ck = ctx.candles[k]!;
    quoteVol += ck.quoteVolume ?? ck.volume * ck.close;
  }
  quoteVol /= i - from + 1;
  if (quoteVol < MIN_QUOTE_VOLUME_PER_BAR) return { regime: "LOW_LIQUIDITY", strength: 1, ...base };

  if (atrPctl > 0.95 && (!Number.isFinite(adxV) || adxV < 30)) return { regime: "HIGH_VOLATILITY", strength: atrPctl, ...base };

  if (Number.isFinite(adxV) && adxV >= 22) {
    const strength = Math.min(1, (adxV - 15) / 30);
    if (plus > minus && close > (Number.isFinite(e200) ? e200 : -Infinity)) return { regime: "TRENDING_UP", strength, ...base };
    if (minus > plus && close < (Number.isFinite(e200) ? e200 : Infinity)) return { regime: "TRENDING_DOWN", strength, ...base };
  }
  if (Math.abs(slope) > 1.5 && Number.isFinite(e200)) {
    if (slope > 0 && close > e200) return { regime: "TRENDING_UP", strength: 0.5, ...base };
    if (slope < 0 && close < e200) return { regime: "TRENDING_DOWN", strength: 0.5, ...base };
  }
  return { regime: "RANGING", strength: Number.isFinite(adxV) ? Math.min(1, Math.max(0.2, (25 - adxV) / 15)) : 0.5, ...base };
}
