import type { Candle } from "@cv/core";
import {
  adx,
  atr,
  bollinger,
  cmf,
  divergences,
  ema,
  fairValueGaps,
  ichimoku,
  macd,
  marketStructure,
  mfi,
  obv,
  orderBlocks,
  pivots,
  relativeVolume,
  rollingMax,
  rollingMin,
  rsi,
  sma,
  stochRsi,
  supertrend,
  type Divergence,
  type Ichimoku,
  type MarketStructure,
  type Pivot,
  type Series,
  type Zone,
} from "@cv/indicators";

/**
 * Every series the factors and strategies need, computed once over the full history.
 * All series are causal (value at i only depends on bars ≤ i); event lists carry the bar
 * index at which they became known, so evaluating at any i never peeks into the future.
 * This is what lets the backtester run the exact same code as the live engine.
 */
export interface SeriesContext {
  candles: readonly Candle[];
  close: Series;
  ema20: Series;
  ema50: Series;
  ema200: Series;
  rsi: Series;
  macd: ReturnType<typeof macd>;
  bb: ReturnType<typeof bollinger>;
  atr: Series;
  atrPct: Series;
  adx: ReturnType<typeof adx>;
  supertrend: ReturnType<typeof supertrend>;
  stochRsi: ReturnType<typeof stochRsi>;
  obv: Series;
  obvEma: Series;
  cmf: Series;
  mfi: Series;
  relVol: Series;
  volSma: Series;
  donchianHigh: Series;
  donchianLow: Series;
  ichimoku: Ichimoku;
  pivots: Pivot[];
  structure: MarketStructure;
  rsiDivergences: Divergence[];
  fvgs: Zone[];
  orderBlocks: Zone[];
}

export function buildContext(candles: readonly Candle[]): SeriesContext {
  const close = candles.map((c) => c.close);
  const r = rsi(close, 14);
  const a = atr(candles, 14);
  const o = obv(candles);
  const prevHigh = rollingMax(candles.map((c) => c.high), 20);
  const prevLow = rollingMin(candles.map((c) => c.low), 20);
  return {
    candles,
    close,
    ema20: ema(close, 20),
    ema50: ema(close, 50),
    ema200: ema(close, 200),
    rsi: r,
    macd: macd(close),
    bb: bollinger(close, 20, 2),
    atr: a,
    atrPct: a.map((v, i) => (v / close[i]!) * 100),
    adx: adx(candles, 14),
    supertrend: supertrend(candles, 10, 3),
    stochRsi: stochRsi(close),
    obv: o,
    obvEma: ema(o, 20),
    cmf: cmf(candles, 20),
    mfi: mfi(candles, 14),
    relVol: relativeVolume(candles, 20),
    volSma: sma(candles.map((c) => c.volume), 20),
    donchianHigh: prevHigh,
    donchianLow: prevLow,
    ichimoku: ichimoku(candles),
    pivots: pivots(candles, 4, 4),
    structure: marketStructure(candles, 3, 3),
    rsiDivergences: divergences(candles, r, { left: 3, right: 3 }),
    fvgs: fairValueGaps(candles),
    orderBlocks: orderBlocks(candles),
  };
}

/** Structure trend as known at bar i (from BOS/CHoCH events up to i). */
export function structureTrendAt(ctx: SeriesContext, i: number): { trend: "bullish" | "bearish" | "neutral"; lastEvent?: MarketStructure["events"][number] } {
  let last: MarketStructure["events"][number] | undefined;
  for (const ev of ctx.structure.events) {
    if (ev.index > i) break;
    last = ev;
  }
  return { trend: last ? last.direction : "neutral", lastEvent: last };
}

/** Most recent confirmed swing low / high strictly known at bar i. */
export function lastSwingAt(ctx: SeriesContext, i: number, type: "high" | "low", maxAge = 60): Pivot | undefined {
  let found: Pivot | undefined;
  for (const p of ctx.pivots) {
    if (p.confirmedAt > i) continue;
    if (p.type !== type || i - p.index > maxAge) continue;
    if (!found || p.index > found.index) found = p;
  }
  return found;
}

/** Lowest low / highest high of the last `bars` bars ending at i. */
export function extremeAt(ctx: SeriesContext, i: number, bars: number, type: "high" | "low"): number {
  let v = type === "high" ? -Infinity : Infinity;
  for (let k = Math.max(0, i - bars + 1); k <= i; k++) {
    const c = ctx.candles[k]!;
    v = type === "high" ? Math.max(v, c.high) : Math.min(v, c.low);
  }
  return v;
}
