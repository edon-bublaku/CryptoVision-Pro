import type { Candle, Timeframe } from "@cv/core";
import { runBacktest, summarize, type BacktestConfig, type Trade } from "@cv/backtest";

type Kline = [number, string, string, string, string, string, number, string, number, string];
async function fetchCandles(symbol: string, tf: string, bars: number): Promise<Candle[]> {
  const out: Candle[] = []; let end: number | undefined;
  while (out.length < bars) {
    const rows = (await (await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${tf}&limit=1000${end ? `&endTime=${end}` : ""}`)).json()) as Kline[];
    out.unshift(...rows.map((r) => ({ time: r[0] / 1000, open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5], quoteVolume: +r[7], takerBuyVolume: +r[9] })));
    end = rows[0]![0] - 1;
  }
  return out.slice(-bars - 1, -1);
}
const syms = ["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","ADAUSDT","LINKUSDT","AVAXUSDT","DOGEUSDT","LTCUSDT","DOTUSDT","TRXUSDT"];
const all: Trade[] = [], gated: Trade[] = [];
for (const tf of ["1h","4h","1d"] as Timeframe[]) for (const s of syms) {
  const c = await fetchCandles(s, tf, tf === "1d" ? 2000 : 3000);
  const cut = Math.floor(c.length * 0.6);
  const ins = runBacktest(c.slice(0, cut), { timeframe: tf });
  const chosen = Object.entries(ins.byStrategy).filter(([, v]) => v.trades >= 6 && v.profitFactor >= 1.2).map(([k]) => k) as NonNullable<BacktestConfig["strategies"]>;
  const full = runBacktest(c, { timeframe: tf });
  all.push(...full.trades.filter((t) => t.entryIndex >= cut));
  if (chosen.length) {
    const g = runBacktest(c, { timeframe: tf, strategies: chosen });
    gated.push(...g.trades.filter((t) => t.entryIndex >= cut));
  }
}
const show = (n: string, t: Trade[]) => { const s = summarize(t, 10000); console.log(n, "trades", s.trades, "win", (s.winRate*100).toFixed(1)+"%", "PF", s.profitFactor.toFixed(2), "expR", s.expectancyR.toFixed(3)); };
show("OOS all strategies     ", all);
show("OOS backtest-gated only", gated);
