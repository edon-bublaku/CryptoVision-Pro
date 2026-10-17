import type { Candle, UnixSeconds } from "@cv/core";
import { pivots } from "./structure";

export interface Divergence {
  type: "regular" | "hidden";
  direction: "bullish" | "bearish";
  from: { index: number; time: UnixSeconds; price: number; osc: number };
  to: { index: number; time: UnixSeconds; price: number; osc: number };
  /** Bar index at which the divergence could first be known. */
  confirmedAt: number;
}

/**
 * Divergences between price swing points and an oscillator.
 * Regular bullish: price lower low, oscillator higher low (exhaustion of a down move).
 * Hidden bullish: price higher low, oscillator lower low (trend continuation).
 */
export function divergences(
  candles: readonly Candle[],
  osc: readonly number[],
  opts: { left?: number; right?: number; maxBarsBetween?: number; minBarsBetween?: number } = {},
): Divergence[] {
  const ps = pivots(candles, opts.left ?? 3, opts.right ?? 3);
  const maxGap = opts.maxBarsBetween ?? 60;
  const minGap = opts.minBarsBetween ?? 5;
  const out: Divergence[] = [];
  for (const type of ["low", "high"] as const) {
    const pts = ps.filter((p) => p.type === type && Number.isFinite(osc[p.index]));
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1]!;
      const b = pts[k]!;
      const gap = b.index - a.index;
      if (gap > maxGap || gap < minGap) continue;
      const oa = osc[a.index]!;
      const ob = osc[b.index]!;
      const from = { index: a.index, time: a.time, price: a.price, osc: oa };
      const to = { index: b.index, time: b.time, price: b.price, osc: ob };
      const base = { from, to, confirmedAt: b.confirmedAt };
      if (type === "low") {
        if (b.price < a.price && ob > oa) out.push({ ...base, type: "regular", direction: "bullish" });
        else if (b.price > a.price && ob < oa) out.push({ ...base, type: "hidden", direction: "bullish" });
      } else {
        if (b.price > a.price && ob < oa) out.push({ ...base, type: "regular", direction: "bearish" });
        else if (b.price < a.price && ob > oa) out.push({ ...base, type: "hidden", direction: "bearish" });
      }
    }
  }
  return out.sort((x, y) => x.confirmedAt - y.confirmedAt);
}
