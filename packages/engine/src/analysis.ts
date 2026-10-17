import type { BacktestSummary, Candle, Timeframe } from "@cv/core";
import { lastFinite, percentileRank } from "@cv/core";
import { runBacktest, type BacktestResult } from "@cv/backtest";
import { analyze, trendScore, type Analysis } from "@cv/signals";
import type { Snapshot } from "./types";

/** A strategy must have earned its place on this coin/timeframe before its signals go ACTIVE. */
export const GATE = { minTrades: 6, minProfitFactor: 1.2 } as const;

export function passesGate(s: BacktestSummary | undefined): boolean {
  return !!s && s.trades >= GATE.minTrades && s.profitFactor >= GATE.minProfitFactor;
}

export interface FullAnalysis {
  analysis: Analysis;
  backtest: BacktestResult;
  gate: Record<string, boolean>;
}

/**
 * Live analysis + a backtest of every strategy on the same history. The signal carries the
 * backtest stats of its own strategy and is downgraded to WATCH when that strategy has not
 * been profitable on this coin.
 */
export function fullAnalysis(input: { symbol: string; timeframe: Timeframe; candles: Candle[]; htfCandles?: Candle[]; fearGreed?: number; derivativesBias?: number }): FullAnalysis | null {
  const first = analyze(input);
  if (!first) return null;
  const backtest = runBacktest(input.candles, { timeframe: input.timeframe });
  const gate: Record<string, boolean> = {};
  for (const [id, s] of Object.entries(backtest.byStrategy)) gate[id] = passesGate(s);
  const sid = first.signal.strategyId;
  if (!sid) return { analysis: first, backtest, gate };
  const stats = backtest.byStrategy[sid];
  const analysis = analyze({ ...input, backtest: stats }) ?? first;
  if (analysis.signal.status === "ACTIVE" && !gate[sid]) analysis.signal.status = "WATCH";
  return { analysis, backtest, gate };
}

export function snapshotOf(a: Analysis, change24h: number, quoteVolume: number): Snapshot {
  const ctx = a.context;
  const i = ctx.candles.length - 1;
  const close = ctx.close[i]!;
  const dist = (v: number) => (Number.isFinite(v) && v !== 0 ? ((close - v) / v) * 100 : NaN);
  const bw = ctx.bb.bandwidth.slice(-120);
  return {
    price: close,
    change24h,
    quoteVolume,
    rsi: lastFinite(ctx.rsi),
    adx: lastFinite(ctx.adx.adx),
    macdHist: lastFinite(ctx.macd.histogram),
    percentB: lastFinite(ctx.bb.percentB),
    bbWidthPctl: percentileRank(bw, lastFinite(ctx.bb.bandwidth)) * 100,
    relVol: lastFinite(ctx.relVol),
    atrPct: lastFinite(ctx.atrPct),
    stochK: lastFinite(ctx.stochRsi.k),
    distEma20: dist(lastFinite(ctx.ema20)),
    distEma50: dist(lastFinite(ctx.ema50)),
    distEma200: dist(lastFinite(ctx.ema200)),
    distHigh20: dist(lastFinite(ctx.donchianHigh)),
    distLow20: dist(lastFinite(ctx.donchianLow)),
    trendScore: trendScore(ctx, i),
    spark: ctx.close.slice(-60),
  };
}
