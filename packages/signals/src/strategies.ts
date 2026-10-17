import type { MarketRegime, Side } from "@cv/core";
import { extremeAt, lastSwingAt, structureTrendAt, type SeriesContext } from "./context";

export interface Setup {
  side: Side;
  /** Level whose break invalidates the idea; the risk module places the stop beyond it. */
  structuralStop: number;
  /** 0..1 quality of the setup. */
  strength: number;
}

export interface Strategy {
  id: StrategyId;
  regimes: MarketRegime[];
  detect(ctx: SeriesContext, i: number): Setup | null;
}

export type StrategyId = "trend_pullback" | "breakout_volume" | "mean_reversion" | "macd_adx_momentum" | "smc_zone_retest" | "rsi_divergence";

const fin = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v);

function mirror(side: Side) {
  return side === "LONG" ? 1 : -1;
}

/** Trend Pullback: aligned EMAs, price dips to the EMA20–EMA50 band and closes back in trend direction. */
const trendPullback: Strategy = {
  id: "trend_pullback",
  regimes: ["TRENDING_UP", "TRENDING_DOWN"],
  detect(ctx, i) {
    const c = ctx.candles[i]!;
    const [e20, e50, e200, r, rPrev, a] = [ctx.ema20[i], ctx.ema50[i], ctx.ema200[i], ctx.rsi[i], ctx.rsi[i - 1], ctx.atr[i]];
    if (!fin(e20) || !fin(e50) || !fin(e200) || !fin(r) || !fin(rPrev) || !fin(a)) return null;
    for (const side of ["LONG", "SHORT"] as const) {
      const d = mirror(side);
      const aligned = d * (e20 - e50) > 0 && d * (e50 - e200) > 0;
      if (!aligned) continue;
      const recentExtreme = side === "LONG" ? extremeAt(ctx, i, 3, "low") : extremeAt(ctx, i, 3, "high");
      const touched = side === "LONG" ? recentExtreme <= e20 + 0.2 * a && recentExtreme >= e50 - 0.6 * a : recentExtreme >= e20 - 0.2 * a && recentExtreme <= e50 + 0.6 * a;
      const resumed = d * (c.close - c.open) > 0 && d * (c.close - e20) > 0;
      const rsiOk = side === "LONG" ? r >= 40 && r <= 65 && r > rPrev : r <= 60 && r >= 35 && r < rPrev;
      if (touched && resumed && rsiOk) {
        const vol = ctx.relVol[i] ?? 1;
        return { side, structuralStop: side === "LONG" ? extremeAt(ctx, i, 5, "low") : extremeAt(ctx, i, 5, "high"), strength: Math.min(1, 0.55 + (vol > 1.2 ? 0.2 : 0) + (Math.abs(e50 - e200) / e200 > 0.03 ? 0.15 : 0)) };
      }
    }
    return null;
  },
};

/** Breakout: close beyond the 20-bar range on ≥1.8× volume with a strong close. */
const breakoutVolume: Strategy = {
  id: "breakout_volume",
  regimes: ["TRENDING_UP", "TRENDING_DOWN", "RANGING"],
  detect(ctx, i) {
    const c = ctx.candles[i]!;
    const hi = ctx.donchianHigh[i - 1];
    const lo = ctx.donchianLow[i - 1];
    const rv = ctx.relVol[i];
    const a = ctx.atr[i];
    if (!fin(hi) || !fin(lo) || !fin(rv) || !fin(a) || rv < 1.8) return null;
    const range = c.high - c.low;
    if (range <= 0) return null;
    const closePos = (c.close - c.low) / range;
    // Squeeze before the break raises quality: a tight range releasing energy.
    const bw = ctx.bb.bandwidth.slice(Math.max(0, i - 30), i).filter(Number.isFinite);
    const squeeze = bw.length > 10 && (ctx.bb.bandwidth[i - 1] ?? Infinity) <= Math.min(...bw) * 1.3;
    if (c.close > hi && closePos > 0.7) {
      return { side: "LONG", structuralStop: Math.max(c.low, (hi + lo) / 2), strength: Math.min(1, 0.5 + (rv - 1.8) * 0.15 + (squeeze ? 0.2 : 0)) };
    }
    if (c.close < lo && closePos < 0.3) {
      return { side: "SHORT", structuralStop: Math.min(c.high, (hi + lo) / 2), strength: Math.min(1, 0.5 + (rv - 1.8) * 0.15 + (squeeze ? 0.2 : 0)) };
    }
    return null;
  },
};

/** Mean Reversion (ranging only): re-entry into the Bollinger band from outside with oversold/overbought RSI. */
const meanReversion: Strategy = {
  id: "mean_reversion",
  regimes: ["RANGING"],
  detect(ctx, i) {
    const c = ctx.candles[i]!;
    const p = ctx.candles[i - 1];
    const [lb, ub, lbp, ubp] = [ctx.bb.lower[i], ctx.bb.upper[i], ctx.bb.lower[i - 1], ctx.bb.upper[i - 1]];
    if (!p || !fin(lb) || !fin(ub) || !fin(lbp) || !fin(ubp)) return null;
    const minR = Math.min(ctx.rsi[i] ?? 50, ctx.rsi[i - 1] ?? 50, ctx.rsi[i - 2] ?? 50);
    const maxR = Math.max(ctx.rsi[i] ?? 50, ctx.rsi[i - 1] ?? 50, ctx.rsi[i - 2] ?? 50);
    const bullDiv = ctx.rsiDivergences.some((d) => d.direction === "bullish" && d.confirmedAt <= i && i - d.confirmedAt <= 6);
    const bearDiv = ctx.rsiDivergences.some((d) => d.direction === "bearish" && d.confirmedAt <= i && i - d.confirmedAt <= 6);
    if ((p.close < lbp || c.low < lb) && c.close > lb && c.close > c.open && minR < 35)
      return { side: "LONG", structuralStop: extremeAt(ctx, i, 4, "low"), strength: 0.55 + (bullDiv ? 0.25 : 0) + (minR < 25 ? 0.1 : 0) };
    if ((p.close > ubp || c.high > ub) && c.close < ub && c.close < c.open && maxR > 65)
      return { side: "SHORT", structuralStop: extremeAt(ctx, i, 4, "high"), strength: 0.55 + (bearDiv ? 0.25 : 0) + (maxR > 75 ? 0.1 : 0) };
    return null;
  },
};

/** Momentum: MACD crosses its signal while ADX > 25 confirms a directional market. */
const macdAdx: Strategy = {
  id: "macd_adx_momentum",
  regimes: ["TRENDING_UP", "TRENDING_DOWN"],
  detect(ctx, i) {
    const [h, hp, adxV, p, m, e50] = [ctx.macd.histogram[i], ctx.macd.histogram[i - 1], ctx.adx.adx[i], ctx.adx.plusDI[i], ctx.adx.minusDI[i], ctx.ema50[i]];
    if (!fin(h) || !fin(hp) || !fin(adxV) || !fin(p) || !fin(m) || !fin(e50) || adxV < 25) return null;
    const c = ctx.close[i]!;
    if (hp <= 0 && h > 0 && p > m && c > e50) {
      const sw = lastSwingAt(ctx, i, "low");
      return { side: "LONG", structuralStop: sw?.price ?? extremeAt(ctx, i, 10, "low"), strength: Math.min(1, 0.5 + (adxV - 25) / 40) };
    }
    if (hp >= 0 && h < 0 && m > p && c < e50) {
      const sw = lastSwingAt(ctx, i, "high");
      return { side: "SHORT", structuralStop: sw?.price ?? extremeAt(ctx, i, 10, "high"), strength: Math.min(1, 0.5 + (adxV - 25) / 40) };
    }
    return null;
  },
};

/** SMC: after a BOS/CHoCH, first retest of an unmitigated order block or FVG in the new direction. */
const smcRetest: Strategy = {
  id: "smc_zone_retest",
  regimes: ["TRENDING_UP", "TRENDING_DOWN", "RANGING"],
  detect(ctx, i) {
    const { trend, lastEvent } = structureTrendAt(ctx, i);
    if (!lastEvent || trend === "neutral" || i - lastEvent.index > 40) return null;
    const c = ctx.candles[i]!;
    const zones = [...ctx.orderBlocks, ...ctx.fvgs].filter((z) => z.direction === trend && z.createdIndex < i && i - z.createdIndex <= 60 && (z.mitigatedIndex === undefined || z.mitigatedIndex >= i));
    for (const z of zones) {
      const tapped = trend === "bullish" ? c.low <= z.top && c.close > z.bottom && c.close > c.open : c.high >= z.bottom && c.close < z.top && c.close < c.open;
      if (!tapped) continue;
      // Only the first touch: earlier touches have already absorbed the orders resting there.
      let touchedBefore = false;
      for (let k = z.createdIndex + 1; k < i; k++) {
        const ck = ctx.candles[k]!;
        if (trend === "bullish" ? ck.low <= z.top : ck.high >= z.bottom) {
          touchedBefore = true;
          break;
        }
      }
      if (touchedBefore) continue;
      const isOb = ctx.orderBlocks.includes(z);
      return { side: trend === "bullish" ? "LONG" : "SHORT", structuralStop: trend === "bullish" ? z.bottom : z.top, strength: (isOb ? 0.7 : 0.6) + (lastEvent.type === "CHOCH" ? 0.1 : 0) };
    }
    return null;
  },
};

/** Reversal on a fresh regular RSI divergence, confirmed by a close back over/under EMA20. */
const rsiDivergence: Strategy = {
  id: "rsi_divergence",
  regimes: ["RANGING", "TRENDING_UP", "TRENDING_DOWN", "HIGH_VOLATILITY"],
  detect(ctx, i) {
    const e20 = ctx.ema20[i];
    const e20p = ctx.ema20[i - 1];
    if (!fin(e20) || !fin(e20p)) return null;
    const c = ctx.close[i]!;
    const pc = ctx.close[i - 1]!;
    for (let k = ctx.rsiDivergences.length - 1; k >= 0; k--) {
      const d = ctx.rsiDivergences[k]!;
      if (d.confirmedAt > i) continue;
      if (i - d.confirmedAt > 8) break;
      if (d.type !== "regular") continue;
      if (d.direction === "bullish" && pc <= e20p && c > e20 && d.to.osc < 45)
        return { side: "LONG", structuralStop: d.to.price, strength: 0.55 + Math.min(0.3, (d.to.osc - d.from.osc) / 30) };
      if (d.direction === "bearish" && pc >= e20p && c < e20 && d.to.osc > 55)
        return { side: "SHORT", structuralStop: d.to.price, strength: 0.55 + Math.min(0.3, (d.from.osc - d.to.osc) / 30) };
    }
    return null;
  },
};

export const STRATEGIES: Strategy[] = [trendPullback, breakoutVolume, meanReversion, macdAdx, smcRetest, rsiDivergence];

export const STRATEGY_IDS = STRATEGIES.map((s) => s.id);

export function getStrategy(id: StrategyId): Strategy {
  const s = STRATEGIES.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown strategy ${id}`);
  return s;
}
