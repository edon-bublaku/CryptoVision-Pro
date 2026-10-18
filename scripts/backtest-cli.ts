/**
 * Usage: pnpm backtest --symbol BTCUSDT --tf 4h --bars 2000 [--strategy trend_pullback]
 * Fetches public Binance klines and prints the same report the Backtest Lab shows.
 */
import type { Candle, Timeframe } from "@cv/core";
import { runBacktest } from "@cv/backtest";
import { STRATEGY_IDS, type BuiltInStrategyId } from "@cv/signals";

const args = Object.fromEntries(
  process.argv.slice(2).reduce<[string, string][]>((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] ?? ""]);
    return acc;
  }, []),
);

const symbol = (args.symbol ?? "BTCUSDT").toUpperCase();
const tf = (args.tf ?? "4h") as Timeframe;
const bars = Number(args.bars ?? 2000);
const strategy = args.strategy as BuiltInStrategyId | undefined;

async function fetchCandles(): Promise<Candle[]> {
  const out: Candle[] = [];
  let end: number | undefined;
  while (out.length < bars) {
    const url = `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${tf}&limit=1000${end ? `&endTime=${end}` : ""}`;
    const rows = (await (await fetch(url)).json()) as (string | number)[][];
    if (!rows.length) break;
    out.unshift(
      ...rows.map((r) => ({
        time: Number(r[0]) / 1000,
        open: +r[1]!,
        high: +r[2]!,
        low: +r[3]!,
        close: +r[4]!,
        volume: +r[5]!,
        quoteVolume: +r[7]!,
        takerBuyVolume: +r[9]!,
      })),
    );
    end = Number(rows[0]![0]) - 1;
  }
  // Drop the still-forming candle.
  return out.slice(-bars - 1, -1);
}

const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;

const candles = await fetchCandles();
const strategies = strategy ? [strategy] : undefined;
if (strategy && !STRATEGY_IDS.includes(strategy)) throw new Error(`Unknown strategy. Use one of: ${STRATEGY_IDS.join(", ")}`);
const r = runBacktest(candles, { strategies, timeframe: tf });
const m = r.metrics;
console.log(`\n${symbol} ${tf} · ${candles.length} bars · ${new Date(candles[0]!.time * 1000).toISOString().slice(0, 10)} → ${new Date(candles.at(-1)!.time * 1000).toISOString().slice(0, 10)}`);
console.log(`Strategy: ${strategy ?? "all"} · risk 1%/trade · fee 0.1% · slippage 0.05 ATR\n`);
console.table({
  Trades: m.trades,
  "Win rate": `${(m.winRate * 100).toFixed(1)}%`,
  "Profit factor": m.profitFactor.toFixed(2),
  "Expectancy (R)": m.expectancyR.toFixed(2),
  "Total return": pct(m.totalReturnPct),
  CAGR: pct(m.cagrPct),
  "Max drawdown": pct(m.maxDrawdownPct),
  Sharpe: m.sharpe.toFixed(2),
  Sortino: m.sortino.toFixed(2),
  Exposure: `${m.exposurePct.toFixed(1)}%`,
});
console.log("By strategy:");
console.table(Object.fromEntries(Object.entries(r.byStrategy).map(([k, v]) => [k, { trades: v.trades, winRate: `${(v.winRate * 100).toFixed(0)}%`, pf: v.profitFactor.toFixed(2), expR: v.expectancyR.toFixed(2), ret: pct(v.totalReturnPct) }])));
console.log("Walk-forward segments:");
console.table(r.walkForward.map((s) => ({ from: new Date(s.from * 1000).toISOString().slice(0, 10), trades: s.trades, winRate: `${(s.winRate * 100).toFixed(0)}%`, pf: s.profitFactor.toFixed(2), ret: pct(s.totalReturnPct) })));
console.log(`Monte Carlo (${r.monteCarlo.runs} runs): return P5 ${pct(r.monteCarlo.returnP5)} · P50 ${pct(r.monteCarlo.returnP50)} · P95 ${pct(r.monteCarlo.returnP95)} · DD P95 ${pct(r.monteCarlo.maxDrawdownP95)} · P(loss) ${(r.monteCarlo.probabilityOfLoss * 100).toFixed(0)}%`);
