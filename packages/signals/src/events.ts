import { candlePatternsAt, type CandlePatternId } from "@cv/indicators";
import type { SeriesContext } from "./context";

/**
 * Discrete market events (crosses, flips, breaks) on closed candles, newest first. Every event at
 * bar i only uses bars ≤ i, and structure/divergence events are placed at the bar they became
 * known, so the list reads like a log a trader would have seen in real time.
 */

export type MarketEventKind =
  | "ema_20_50_cross"
  | "golden_cross"
  | "death_cross"
  | "price_ema200_cross"
  | "macd_signal_cross"
  | "macd_zero_cross"
  | "rsi_overbought"
  | "rsi_oversold"
  | "rsi_exit_overbought"
  | "rsi_exit_oversold"
  | "supertrend_flip"
  | "adx_trend_start"
  | "bb_squeeze"
  | "bb_break"
  | "breakout_20"
  | "volume_spike"
  | "bos"
  | "choch"
  | "divergence"
  | "hidden_divergence"
  | "candle_pattern";

export interface MarketEvent {
  index: number;
  time: number;
  kind: MarketEventKind;
  direction: "bullish" | "bearish" | "neutral";
  price: number;
  /** Optional extra value (RSI, relative volume, pattern id …) for the label. */
  value?: number;
  pattern?: CandlePatternId;
}

const fin = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v);

/** a crossed above b between bar i−1 and i (1), below (−1), or not at all (0). */
function cross(a: readonly number[], b: readonly number[] | number, i: number): -1 | 0 | 1 {
  const b0 = typeof b === "number" ? b : b[i - 1];
  const b1 = typeof b === "number" ? b : b[i];
  const a0 = a[i - 1];
  const a1 = a[i];
  if (!fin(a0) || !fin(a1) || !fin(b0) || !fin(b1)) return 0;
  if (a0 <= b0 && a1 > b1) return 1;
  if (a0 >= b0 && a1 < b1) return -1;
  return 0;
}

export function marketEvents(ctx: SeriesContext, opts: { bars?: number; patterns?: boolean } = {}): MarketEvent[] {
  const c = ctx.candles;
  const n = c.length;
  if (n < 3) return [];
  const from = Math.max(1, n - (opts.bars ?? 200));
  const out: MarketEvent[] = [];
  const push = (i: number, kind: MarketEventKind, direction: MarketEvent["direction"], extra: Partial<MarketEvent> = {}) =>
    out.push({ index: i, time: c[i]!.time, kind, direction, price: c[i]!.close, ...extra });
  const dir = (x: -1 | 1): "bullish" | "bearish" => (x > 0 ? "bullish" : "bearish");
  const bw = ctx.bb.bandwidth;

  for (let i = from; i < n; i++) {
    let x = cross(ctx.ema20, ctx.ema50, i);
    if (x) push(i, "ema_20_50_cross", dir(x));
    x = cross(ctx.ema50, ctx.ema200, i);
    if (x) push(i, x > 0 ? "golden_cross" : "death_cross", dir(x));
    x = cross(ctx.close, ctx.ema200, i);
    if (x) push(i, "price_ema200_cross", dir(x));
    x = cross(ctx.macd.macd, ctx.macd.signal, i);
    if (x) push(i, "macd_signal_cross", dir(x));
    x = cross(ctx.macd.macd, 0, i);
    if (x) push(i, "macd_zero_cross", dir(x));

    x = cross(ctx.rsi, 70, i);
    if (x > 0) push(i, "rsi_overbought", "bearish", { value: ctx.rsi[i] });
    else if (x < 0) push(i, "rsi_exit_overbought", "bearish", { value: ctx.rsi[i] });
    x = cross(ctx.rsi, 30, i);
    if (x < 0) push(i, "rsi_oversold", "bullish", { value: ctx.rsi[i] });
    else if (x > 0) push(i, "rsi_exit_oversold", "bullish", { value: ctx.rsi[i] });

    const d0 = ctx.supertrend.direction[i - 1];
    const d1 = ctx.supertrend.direction[i];
    if (d0 && d1 && d0 !== d1) push(i, "supertrend_flip", d1 > 0 ? "bullish" : "bearish");

    if (cross(ctx.adx.adx, 25, i) > 0) {
      const up = (ctx.adx.plusDI[i] ?? 0) >= (ctx.adx.minusDI[i] ?? 0);
      push(i, "adx_trend_start", up ? "bullish" : "bearish", { value: ctx.adx.adx[i] });
    }

    // Squeeze: Bollinger bandwidth at its lowest of the last 120 bars.
    if (i >= 120 && fin(bw[i])) {
      let min = Infinity;
      for (let k = i - 120; k < i; k++) if (fin(bw[k])) min = Math.min(min, bw[k]!);
      if (bw[i]! < min) push(i, "bb_squeeze", "neutral", { value: bw[i] });
    }
    const up = ctx.bb.upper;
    const lo = ctx.bb.lower;
    if (cross(ctx.close, up, i) > 0) push(i, "bb_break", "bullish");
    else if (cross(ctx.close, lo, i) < 0) push(i, "bb_break", "bearish");

    // 20-bar breakout: close beyond the previous 20 bars' range (Donchian of bar i−1).
    const hi20 = ctx.donchianHigh[i - 1];
    const lo20 = ctx.donchianLow[i - 1];
    const prevClose = c[i - 1]!.close;
    if (fin(hi20) && c[i]!.close > hi20 && prevClose <= hi20) push(i, "breakout_20", "bullish");
    else if (fin(lo20) && c[i]!.close < lo20 && prevClose >= lo20) push(i, "breakout_20", "bearish");

    const rv = ctx.relVol[i];
    if (fin(rv) && rv >= 2.5) push(i, "volume_spike", c[i]!.close >= c[i]!.open ? "bullish" : "bearish", { value: rv });

    if (opts.patterns !== false) {
      for (const p of candlePatternsAt(c, i, ctx.atr[i])) {
        if (p.direction === "neutral" || p.reliability < 0.45) continue;
        push(i, "candle_pattern", p.direction, { pattern: p.id, value: p.reliability });
      }
    }
  }

  for (const e of ctx.structure.events) if (e.index >= from) push(e.index, e.type === "BOS" ? "bos" : "choch", e.direction, { price: e.price });
  for (const d of ctx.rsiDivergences) {
    if (d.confirmedAt < from || d.confirmedAt >= n) continue;
    push(d.confirmedAt, d.type === "regular" ? "divergence" : "hidden_divergence", d.direction);
  }
  return out.sort((a, b) => b.index - a.index);
}

// ── Derivatives positioning ────────────────────────────────────────────────

export type DerivativeEventKind = "funding_extreme_long" | "funding_extreme_short" | "oi_surge" | "oi_flush" | "crowded_longs" | "crowded_shorts" | "taker_buying" | "taker_selling";

export interface DerivativeEvent {
  kind: DerivativeEventKind;
  /** Which side the event warns against (a crowded long market is a risk for new longs). */
  against: "LONG" | "SHORT" | null;
  value: number;
}

/**
 * Positioning extremes from perpetual-swap data. Thresholds are normalised to an 8h funding
 * interval so 1h/4h contracts compare fairly.
 */
export function derivativeEvents(d: { fundingRate: number; fundingIntervalHours?: number; oiChange24hPct: number; longShortRatio: number; takerBuyShare?: number }): DerivativeEvent[] {
  const out: DerivativeEvent[] = [];
  const per8h = Number.isFinite(d.fundingRate) ? d.fundingRate * (8 / (d.fundingIntervalHours || 8)) : NaN;
  if (per8h >= 0.0005) out.push({ kind: "funding_extreme_long", against: "LONG", value: per8h });
  if (per8h <= -0.0005) out.push({ kind: "funding_extreme_short", against: "SHORT", value: per8h });
  if (d.oiChange24hPct >= 10) out.push({ kind: "oi_surge", against: null, value: d.oiChange24hPct });
  if (d.oiChange24hPct <= -10) out.push({ kind: "oi_flush", against: null, value: d.oiChange24hPct });
  if (d.longShortRatio >= 2.5) out.push({ kind: "crowded_longs", against: "LONG", value: d.longShortRatio });
  if (d.longShortRatio > 0 && d.longShortRatio <= 0.6) out.push({ kind: "crowded_shorts", against: "SHORT", value: d.longShortRatio });
  if (d.takerBuyShare !== undefined && d.takerBuyShare >= 0.58) out.push({ kind: "taker_buying", against: "SHORT", value: d.takerBuyShare });
  if (d.takerBuyShare !== undefined && d.takerBuyShare <= 0.42) out.push({ kind: "taker_selling", against: "LONG", value: d.takerBuyShare });
  return out;
}

