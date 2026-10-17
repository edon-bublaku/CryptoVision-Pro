import type { Candle } from "@cv/core";
import { pivots } from "./structure";
import { atr } from "./volatility";

export type CandlePatternId =
  | "doji"
  | "hammer"
  | "inverted_hammer"
  | "shooting_star"
  | "hanging_man"
  | "bullish_engulfing"
  | "bearish_engulfing"
  | "piercing_line"
  | "dark_cloud_cover"
  | "morning_star"
  | "evening_star"
  | "three_white_soldiers"
  | "three_black_crows"
  | "bullish_harami"
  | "bearish_harami"
  | "inside_bar";

export interface CandlePattern {
  id: CandlePatternId;
  index: number;
  direction: "bullish" | "bearish" | "neutral";
  /** 0..1 based on how clean the shape is and whether it appears after a counter move. */
  reliability: number;
}

const body = (c: Candle) => Math.abs(c.close - c.open);
const range = (c: Candle) => c.high - c.low;
const upperWick = (c: Candle) => c.high - Math.max(c.open, c.close);
const lowerWick = (c: Candle) => Math.min(c.open, c.close) - c.low;
const bull = (c: Candle) => c.close > c.open;
const bear = (c: Candle) => c.close < c.open;

/** Prior short-term direction, so reversal patterns only count after a move to reverse. */
function priorTrend(candles: readonly Candle[], i: number, bars = 5): number {
  const a = candles[i - bars];
  const b = candles[i - 1];
  if (!a || !b) return 0;
  return Math.sign(b.close - a.close);
}

/** Detects candlestick patterns completing on bar `i`. */
export function candlePatternsAt(candles: readonly Candle[], i: number, atrValue?: number): CandlePattern[] {
  const c = candles[i];
  if (!c) return [];
  const p1 = candles[i - 1];
  const p2 = candles[i - 2];
  const out: CandlePattern[] = [];
  const r = range(c);
  if (r === 0) return out;
  const avgRange = atrValue && Number.isFinite(atrValue) ? atrValue : r;
  const trend = priorTrend(candles, i);
  const push = (id: CandlePatternId, direction: CandlePattern["direction"], base: number, counter: boolean) =>
    out.push({ id, index: i, direction, reliability: Math.min(1, base + (counter ? 0.25 : 0)) });

  if (body(c) <= r * 0.1) push("doji", "neutral", 0.3, false);

  const smallBody = body(c) <= r * 0.35;
  if (smallBody && lowerWick(c) >= 2 * body(c) && upperWick(c) <= r * 0.15) {
    if (trend < 0) push("hammer", "bullish", 0.5, true);
    else if (trend > 0) push("hanging_man", "bearish", 0.4, true);
  }
  if (smallBody && upperWick(c) >= 2 * body(c) && lowerWick(c) <= r * 0.15) {
    if (trend > 0) push("shooting_star", "bearish", 0.5, true);
    else if (trend < 0) push("inverted_hammer", "bullish", 0.4, true);
  }

  if (p1) {
    if (bull(c) && bear(p1) && c.close >= p1.open && c.open <= p1.close && body(c) > body(p1))
      push("bullish_engulfing", "bullish", 0.5 + Math.min(0.2, body(c) / avgRange / 5), trend < 0);
    if (bear(c) && bull(p1) && c.close <= p1.open && c.open >= p1.close && body(c) > body(p1))
      push("bearish_engulfing", "bearish", 0.5 + Math.min(0.2, body(c) / avgRange / 5), trend > 0);
    const mid1 = (p1.open + p1.close) / 2;
    if (bear(p1) && bull(c) && c.open < p1.close && c.close > mid1 && c.close < p1.open) push("piercing_line", "bullish", 0.45, trend < 0);
    if (bull(p1) && bear(c) && c.open > p1.close && c.close < mid1 && c.close > p1.open) push("dark_cloud_cover", "bearish", 0.45, trend > 0);
    const inside = c.high <= p1.high && c.low >= p1.low;
    if (inside) push("inside_bar", "neutral", 0.3, false);
    if (inside && bear(p1) && bull(c) && body(p1) > avgRange * 0.6) push("bullish_harami", "bullish", 0.35, trend < 0);
    if (inside && bull(p1) && bear(c) && body(p1) > avgRange * 0.6) push("bearish_harami", "bearish", 0.35, trend > 0);
  }

  if (p1 && p2) {
    const smallMiddle = body(p1) <= range(p1) * 0.3;
    if (bear(p2) && body(p2) > avgRange * 0.6 && smallMiddle && bull(c) && c.close > (p2.open + p2.close) / 2)
      push("morning_star", "bullish", 0.6, trend < 0 || priorTrend(candles, i - 1) < 0);
    if (bull(p2) && body(p2) > avgRange * 0.6 && smallMiddle && bear(c) && c.close < (p2.open + p2.close) / 2)
      push("evening_star", "bearish", 0.6, trend > 0 || priorTrend(candles, i - 1) > 0);
    const three = [p2, p1, c];
    if (three.every(bull) && p1.close > p2.close && c.close > p1.close && three.every((x) => body(x) > range(x) * 0.5))
      push("three_white_soldiers", "bullish", 0.55, false);
    if (three.every(bear) && p1.close < p2.close && c.close < p1.close && three.every((x) => body(x) > range(x) * 0.5))
      push("three_black_crows", "bearish", 0.55, false);
  }
  return out;
}

/** Patterns completed within the last `bars` candles. */
export function recentCandlePatterns(candles: readonly Candle[], bars = 3): CandlePattern[] {
  const a = atr(candles, 14);
  const out: CandlePattern[] = [];
  for (let i = Math.max(2, candles.length - bars); i < candles.length; i++) out.push(...candlePatternsAt(candles, i, a[i]));
  return out;
}

export interface ChartPattern {
  id: "double_top" | "double_bottom";
  direction: "bullish" | "bearish";
  points: { index: number; price: number }[];
  neckline: number;
  target: number;
  confirmed: boolean;
}

/** Double tops / bottoms from the last confirmed swing points (peaks within `tolerance` ATR). */
export function doubleTopsBottoms(candles: readonly Candle[], tolerance = 0.5): ChartPattern[] {
  const a = atr(candles, 14);
  const ps = pivots(candles, 5, 5);
  const out: ChartPattern[] = [];
  const close = candles[candles.length - 1]?.close ?? NaN;
  for (const kind of ["high", "low"] as const) {
    const pts = ps.filter((p) => p.type === kind).slice(-2);
    if (pts.length < 2) continue;
    const [p, q] = pts as [(typeof pts)[0], (typeof pts)[0]];
    const atrAt = a[q.index]!;
    if (!Number.isFinite(atrAt) || Math.abs(p.price - q.price) > tolerance * atrAt || q.index - p.index < 8) continue;
    let neck = kind === "high" ? Infinity : -Infinity;
    for (let k = p.index; k <= q.index; k++)
      neck = kind === "high" ? Math.min(neck, candles[k]!.low) : Math.max(neck, candles[k]!.high);
    const height = Math.abs((p.price + q.price) / 2 - neck);
    if (height < 1.5 * atrAt) continue;
    out.push({
      id: kind === "high" ? "double_top" : "double_bottom",
      direction: kind === "high" ? "bearish" : "bullish",
      points: [
        { index: p.index, price: p.price },
        { index: q.index, price: q.price },
      ],
      neckline: neck,
      target: kind === "high" ? neck - height : neck + height,
      confirmed: kind === "high" ? close < neck : close > neck,
    });
  }
  return out;
}
