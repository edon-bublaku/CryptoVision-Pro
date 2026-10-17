import type { Candle, UnixSeconds } from "@cv/core";
import { atr } from "./volatility";

export interface Pivot {
  index: number;
  time: UnixSeconds;
  price: number;
  type: "high" | "low";
  /** Bar index at which this pivot became known (index + right). Use it to avoid look-ahead. */
  confirmedAt: number;
}

/** Fractal swing points: a high/low that is the extreme of `left` bars before and `right` bars after. */
export function pivots(candles: readonly Candle[], left = 5, right = 5): Pivot[] {
  const out: Pivot[] = [];
  for (let i = left; i < candles.length - right; i++) {
    const c = candles[i]!;
    let isHigh = true;
    let isLow = true;
    for (let k = i - left; k <= i + right; k++) {
      if (k === i) continue;
      const o = candles[k]!;
      if (o.high > c.high || (k > i && o.high === c.high)) isHigh = false;
      if (o.low < c.low || (k > i && o.low === c.low)) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) out.push({ index: i, time: c.time, price: c.high, type: "high", confirmedAt: i + right });
    if (isLow) out.push({ index: i, time: c.time, price: c.low, type: "low", confirmedAt: i + right });
  }
  return out;
}

export interface Level {
  price: number;
  /** Number of swing points that formed the level. */
  touches: number;
  /** 0..1, weighs touches and recency. */
  strength: number;
  kind: "support" | "resistance";
  lastTouchIndex: number;
}

/**
 * Automatic support/resistance: pivots whose prices lie within `tolerance` (fraction of ATR)
 * are clustered; each cluster becomes a level. Classified relative to the latest close.
 */
export function supportResistance(
  candles: readonly Candle[],
  opts: { left?: number; right?: number; atrMult?: number; maxLevels?: number } = {},
): Level[] {
  if (candles.length < 30) return [];
  const ps = pivots(candles, opts.left ?? 4, opts.right ?? 4);
  const a = atr(candles, 14);
  const lastAtr = a[a.length - 1]!;
  const tol = (opts.atrMult ?? 0.6) * (Number.isFinite(lastAtr) ? lastAtr : candles[candles.length - 1]!.close * 0.01);
  const sorted = [...ps].sort((x, y) => x.price - y.price);
  const clusters: Pivot[][] = [];
  for (const p of sorted) {
    const cur = clusters[clusters.length - 1];
    if (cur && p.price - cur[cur.length - 1]!.price <= tol) cur.push(p);
    else clusters.push([p]);
  }
  const close = candles[candles.length - 1]!.close;
  const n = candles.length;
  const levels: Level[] = clusters
    .filter((c) => c.length >= 2)
    .map((c) => {
      const price = c.reduce((s, p) => s + p.price, 0) / c.length;
      const lastTouchIndex = Math.max(...c.map((p) => p.index));
      const recency = 1 - (n - lastTouchIndex) / n;
      return {
        price,
        touches: c.length,
        strength: Math.min(1, (c.length / 6) * 0.7 + recency * 0.3),
        kind: price >= close ? ("resistance" as const) : ("support" as const),
        lastTouchIndex,
      };
    });
  levels.sort((x, y) => y.strength - x.strength);
  return levels.slice(0, opts.maxLevels ?? 8).sort((x, y) => y.price - x.price);
}

export type SwingLabel = "HH" | "HL" | "LH" | "LL";

export interface StructureEvent {
  index: number;
  time: UnixSeconds;
  price: number;
  type: "BOS" | "CHOCH";
  direction: "bullish" | "bearish";
}

export interface MarketStructure {
  swings: (Pivot & { label: SwingLabel })[];
  events: StructureEvent[];
  trend: "bullish" | "bearish" | "neutral";
  lastSwingHigh?: Pivot;
  lastSwingLow?: Pivot;
}

/**
 * Smart-money market structure. A close beyond the last confirmed swing in the direction of the
 * trend is a Break Of Structure (BOS); against the trend it is a Change Of Character (CHoCH).
 */
export function marketStructure(candles: readonly Candle[], left = 3, right = 3): MarketStructure {
  const ps = pivots(candles, left, right);
  const swings: MarketStructure["swings"] = [];
  let prevHigh: Pivot | undefined;
  let prevLow: Pivot | undefined;
  for (const p of ps) {
    if (p.type === "high") {
      swings.push({ ...p, label: prevHigh && p.price < prevHigh.price ? "LH" : "HH" });
      prevHigh = p;
    } else {
      swings.push({ ...p, label: prevLow && p.price < prevLow.price ? "LL" : "HL" });
      prevLow = p;
    }
  }

  const events: StructureEvent[] = [];
  let trend: MarketStructure["trend"] = "neutral";
  let swingHigh: Pivot | undefined;
  let swingLow: Pivot | undefined;
  let highBroken = true;
  let lowBroken = true;
  let pi = 0;
  const byConfirm = [...ps].sort((a, b) => a.confirmedAt - b.confirmedAt);
  for (let i = 0; i < candles.length; i++) {
    while (pi < byConfirm.length && byConfirm[pi]!.confirmedAt <= i) {
      const p = byConfirm[pi++]!;
      if (p.type === "high") {
        swingHigh = p;
        highBroken = false;
      } else {
        swingLow = p;
        lowBroken = false;
      }
    }
    const c = candles[i]!;
    if (swingHigh && !highBroken && c.close > swingHigh.price) {
      events.push({ index: i, time: c.time, price: swingHigh.price, type: trend === "bearish" ? "CHOCH" : "BOS", direction: "bullish" });
      trend = "bullish";
      highBroken = true;
    }
    if (swingLow && !lowBroken && c.close < swingLow.price) {
      events.push({ index: i, time: c.time, price: swingLow.price, type: trend === "bullish" ? "CHOCH" : "BOS", direction: "bearish" });
      trend = "bearish";
      lowBroken = true;
    }
  }
  return { swings, events, trend, lastSwingHigh: swingHigh, lastSwingLow: swingLow };
}

export interface Zone {
  startIndex: number;
  /** Bar index at which the zone could first be known (no look-ahead before it). */
  createdIndex: number;
  startTime: UnixSeconds;
  top: number;
  bottom: number;
  direction: "bullish" | "bearish";
  mitigated: boolean;
  mitigatedIndex?: number;
}

/** Fair Value Gaps: three-candle imbalances that price often revisits. */
export function fairValueGaps(candles: readonly Candle[], minSizeAtr = 0.2): Zone[] {
  const a = atr(candles, 14);
  const zones: Zone[] = [];
  for (let i = 2; i < candles.length; i++) {
    const c0 = candles[i - 2]!;
    const c2 = candles[i]!;
    const minSize = (Number.isFinite(a[i]) ? a[i]! : 0) * minSizeAtr;
    if (c2.low > c0.high && c2.low - c0.high >= minSize)
      zones.push({ startIndex: i - 1, createdIndex: i, startTime: candles[i - 1]!.time, top: c2.low, bottom: c0.high, direction: "bullish", mitigated: false });
    if (c2.high < c0.low && c0.low - c2.high >= minSize)
      zones.push({ startIndex: i - 1, createdIndex: i, startTime: candles[i - 1]!.time, top: c0.low, bottom: c2.high, direction: "bearish", mitigated: false });
  }
  markMitigation(candles, zones);
  return zones;
}

/**
 * Order blocks: the last opposite-colour candle before an impulsive move that breaks structure.
 * Impulsive = body range over 3 bars of at least `impulseAtr` × ATR.
 */
export function orderBlocks(candles: readonly Candle[], impulseAtr = 1.5): Zone[] {
  const a = atr(candles, 14);
  const ms = marketStructure(candles, 3, 3);
  const zones: Zone[] = [];
  for (const ev of ms.events) {
    const i = ev.index;
    const move = Math.abs(candles[i]!.close - candles[Math.max(0, i - 3)]!.open);
    if (!Number.isFinite(a[i]) || move < impulseAtr * a[i]!) continue;
    for (let k = i - 1; k >= Math.max(0, i - 10); k--) {
      const c = candles[k]!;
      const isOpposite = ev.direction === "bullish" ? c.close < c.open : c.close > c.open;
      if (isOpposite) {
        zones.push({ startIndex: k, createdIndex: i, startTime: c.time, top: c.high, bottom: c.low, direction: ev.direction, mitigated: false });
        break;
      }
    }
  }
  markMitigation(candles, zones);
  return zones;
}

function markMitigation(candles: readonly Candle[], zones: Zone[]) {
  for (const z of zones) {
    for (let k = z.createdIndex + 1; k < candles.length; k++) {
      const c = candles[k]!;
      const touched = z.direction === "bullish" ? c.low <= z.bottom : c.high >= z.top;
      if (touched) {
        z.mitigated = true;
        z.mitigatedIndex = k;
        break;
      }
    }
  }
}

export interface PivotPointLevels {
  pp: number;
  r1: number;
  r2: number;
  r3: number;
  s1: number;
  s2: number;
  s3: number;
}

/** Floor pivots from the previous period's high/low/close. */
export function pivotPoints(prev: { high: number; low: number; close: number }, kind: "classic" | "fibonacci" | "camarilla" = "classic"): PivotPointLevels {
  const { high: h, low: l, close: c } = prev;
  const r = h - l;
  const pp = (h + l + c) / 3;
  if (kind === "fibonacci")
    return { pp, r1: pp + 0.382 * r, r2: pp + 0.618 * r, r3: pp + r, s1: pp - 0.382 * r, s2: pp - 0.618 * r, s3: pp - r };
  if (kind === "camarilla")
    return { pp, r1: c + (r * 1.1) / 12, r2: c + (r * 1.1) / 6, r3: c + (r * 1.1) / 4, s1: c - (r * 1.1) / 12, s2: c - (r * 1.1) / 6, s3: c - (r * 1.1) / 4 };
  return { pp, r1: 2 * pp - l, r2: pp + r, r3: h + 2 * (pp - l), s1: 2 * pp - h, s2: pp - r, s3: l - 2 * (h - pp) };
}

export const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.705, 0.786, 1] as const;
export const FIB_EXTENSIONS = [1.272, 1.618, 2, 2.618] as const;

export interface AutoFib {
  from: { index: number; price: number };
  to: { index: number; price: number };
  direction: "up" | "down";
  levels: { ratio: number; price: number }[];
}

/** Fibonacci of the dominant swing in the lookback window (low→high if the high came last). */
export function autoFib(candles: readonly Candle[], lookback = 150): AutoFib | null {
  const start = Math.max(0, candles.length - lookback);
  let hi = start;
  let lo = start;
  for (let i = start; i < candles.length; i++) {
    if (candles[i]!.high > candles[hi]!.high) hi = i;
    if (candles[i]!.low < candles[lo]!.low) lo = i;
  }
  if (hi === lo) return null;
  const up = hi > lo;
  const from = up ? { index: lo, price: candles[lo]!.low } : { index: hi, price: candles[hi]!.high };
  const to = up ? { index: hi, price: candles[hi]!.high } : { index: lo, price: candles[lo]!.low };
  const range = to.price - from.price;
  const levels = [...FIB_RATIOS, ...FIB_EXTENSIONS].map((ratio) => ({ ratio, price: to.price - range * ratio }));
  return { from, to, direction: up ? "up" : "down", levels };
}
