import type { Side } from "@cv/core";
import { z } from "zod";
import { extremeAt, lastSwingAt, type SeriesContext } from "./context";
import type { Setup, Strategy } from "./strategies";

/**
 * User-defined strategies: a list of conditions per side, evaluated on the same causal series as
 * the built-in strategies. A definition is plain JSON (stored, synced, sent to Web Workers) and
 * `buildCustomStrategy` turns it into a regular `Strategy`, so the backtester, walk-forward and
 * Monte Carlo treat it exactly like the built-ins.
 */

export const SERIES_IDS = [
  "close",
  "open",
  "high",
  "low",
  "ema20",
  "ema50",
  "ema200",
  "rsi",
  "macd",
  "macdSignal",
  "macdHist",
  "bbUpper",
  "bbMiddle",
  "bbLower",
  "percentB",
  "atrPct",
  "adx",
  "plusDi",
  "minusDi",
  "stochK",
  "stochD",
  "relVol",
  "high20",
  "low20",
  "supertrend",
  "supertrendDir",
  "cmf",
  "mfi",
  "obv",
  "obvEma",
] as const;

export type SeriesId = (typeof SERIES_IDS)[number];

const operand = z.union([z.object({ series: z.enum(SERIES_IDS) }), z.object({ value: z.number().finite() })]);
export type Operand = z.infer<typeof operand>;

export const CONDITION_OPS = [">", "<", "crossAbove", "crossBelow"] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

const condition = z.object({ left: operand, op: z.enum(CONDITION_OPS), right: operand });
export type Condition = z.infer<typeof condition>;

export const customStrategySchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(60),
  long: z.array(condition).max(12),
  short: z.array(condition).max(12),
  stop: z.discriminatedUnion("type", [
    z.object({ type: z.literal("atr"), mult: z.number().min(0.3).max(10) }),
    z.object({ type: z.literal("swing"), lookback: z.number().int().min(3).max(100) }),
  ]),
  /** Also require the multi-factor confluence not to contradict the trade (like built-ins). */
  confluence: z.boolean().default(false),
});
export type CustomStrategyDef = z.infer<typeof customStrategySchema>;

/** Value of a series at bar i. Previous-bar 20-bar extremes, so "close > high20" is a real breakout. */
export function seriesValue(ctx: SeriesContext, id: SeriesId, i: number): number | undefined {
  const c = ctx.candles[i];
  if (!c) return undefined;
  switch (id) {
    case "close":
      return c.close;
    case "open":
      return c.open;
    case "high":
      return c.high;
    case "low":
      return c.low;
    case "ema20":
      return ctx.ema20[i];
    case "ema50":
      return ctx.ema50[i];
    case "ema200":
      return ctx.ema200[i];
    case "rsi":
      return ctx.rsi[i];
    case "macd":
      return ctx.macd.macd[i];
    case "macdSignal":
      return ctx.macd.signal[i];
    case "macdHist":
      return ctx.macd.histogram[i];
    case "bbUpper":
      return ctx.bb.upper[i];
    case "bbMiddle":
      return ctx.bb.middle[i];
    case "bbLower":
      return ctx.bb.lower[i];
    case "percentB":
      return ctx.bb.percentB[i];
    case "atrPct":
      return ctx.atrPct[i];
    case "adx":
      return ctx.adx.adx[i];
    case "plusDi":
      return ctx.adx.plusDI[i];
    case "minusDi":
      return ctx.adx.minusDI[i];
    case "stochK":
      return ctx.stochRsi.k[i];
    case "stochD":
      return ctx.stochRsi.d[i];
    case "relVol":
      return ctx.relVol[i];
    case "high20":
      return i > 0 ? ctx.donchianHigh[i - 1] : undefined;
    case "low20":
      return i > 0 ? ctx.donchianLow[i - 1] : undefined;
    case "supertrend":
      return ctx.supertrend.line[i];
    case "supertrendDir":
      return ctx.supertrend.direction[i];
    case "cmf":
      return ctx.cmf[i];
    case "mfi":
      return ctx.mfi[i];
    case "obv":
      return ctx.obv[i];
    case "obvEma":
      return ctx.obvEma[i];
  }
}

function value(ctx: SeriesContext, o: Operand, i: number): number | undefined {
  const v = "series" in o ? seriesValue(ctx, o.series, i) : o.value;
  return v !== undefined && Number.isFinite(v) ? v : undefined;
}

/** True when the condition holds at bar i (using only bars ≤ i). Missing data never passes. */
export function conditionHolds(ctx: SeriesContext, cond: Condition, i: number): boolean {
  const l = value(ctx, cond.left, i);
  const r = value(ctx, cond.right, i);
  if (l === undefined || r === undefined) return false;
  if (cond.op === ">") return l > r;
  if (cond.op === "<") return l < r;
  const lp = value(ctx, cond.left, i - 1);
  const rp = value(ctx, cond.right, i - 1);
  if (lp === undefined || rp === undefined) return false;
  return cond.op === "crossAbove" ? lp <= rp && l > r : lp >= rp && l < r;
}

function stopFor(ctx: SeriesContext, def: CustomStrategyDef, side: Side, i: number): number {
  const c = ctx.close[i]!;
  if (def.stop.type === "atr") {
    const a = ctx.atr[i];
    const dist = (a !== undefined && Number.isFinite(a) ? a : c * 0.02) * def.stop.mult;
    return side === "LONG" ? c - dist : c + dist;
  }
  const sw = lastSwingAt(ctx, i, side === "LONG" ? "low" : "high", def.stop.lookback);
  return sw?.price ?? extremeAt(ctx, i, def.stop.lookback, side === "LONG" ? "low" : "high");
}

export function buildCustomStrategy(def: CustomStrategyDef): Strategy {
  const sides: [Side, Condition[]][] = [
    ["LONG", def.long],
    ["SHORT", def.short],
  ];
  return {
    id: "custom",
    // Rules decide on their own; only illiquid markets are excluded (by the engine).
    regimes: ["TRENDING_UP", "TRENDING_DOWN", "RANGING", "HIGH_VOLATILITY"],
    ignoreConfluence: !def.confluence,
    detect(ctx, i): Setup | null {
      for (const [side, conds] of sides) {
        if (!conds.length || !conds.every((c) => conditionHolds(ctx, c, i))) continue;
        const stop = stopFor(ctx, def, side, i);
        const close = ctx.close[i]!;
        // A stop on the wrong side of price would be an invalid trade.
        if (side === "LONG" ? stop >= close : stop <= close) continue;
        return { side, structuralStop: stop, strength: 0.6 };
      }
      return null;
    },
  };
}

/** Ready-made examples users can start from. */
export const CUSTOM_PRESETS: CustomStrategyDef[] = [
  {
    id: "preset-golden-pullback",
    name: "EMA50 > EMA200 + RSI bounce",
    long: [
      { left: { series: "ema50" }, op: ">", right: { series: "ema200" } },
      { left: { series: "rsi" }, op: "crossAbove", right: { value: 40 } },
    ],
    short: [],
    stop: { type: "swing", lookback: 20 },
    confluence: false,
  },
  {
    id: "preset-donchian",
    name: "Donchian 20 breakout",
    long: [
      { left: { series: "close" }, op: ">", right: { series: "high20" } },
      { left: { series: "relVol" }, op: ">", right: { value: 1.5 } },
    ],
    short: [
      { left: { series: "close" }, op: "<", right: { series: "low20" } },
      { left: { series: "relVol" }, op: ">", right: { value: 1.5 } },
    ],
    stop: { type: "atr", mult: 2 },
    confluence: false,
  },
  {
    id: "preset-supertrend-adx",
    name: "SuperTrend flip + ADX",
    long: [
      { left: { series: "close" }, op: "crossAbove", right: { series: "supertrend" } },
      { left: { series: "adx" }, op: ">", right: { value: 20 } },
    ],
    short: [
      { left: { series: "close" }, op: "crossBelow", right: { series: "supertrend" } },
      { left: { series: "adx" }, op: ">", right: { value: 20 } },
    ],
    stop: { type: "atr", mult: 2.5 },
    confluence: true,
  },
];
