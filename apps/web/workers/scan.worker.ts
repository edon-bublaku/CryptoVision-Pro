/// <reference lib="webworker" />
import type { Timeframe } from "@cv/core";
import { HIGHER_TIMEFRAME } from "@cv/core";
import { fullAnalysis, snapshotOf } from "../lib/analysis";
import { closedOnly, getKlines, mapLimit } from "../lib/data/binance";
import type { ScanRow } from "../lib/store/scan";

export interface ScanRequest {
  timeframe: Timeframe;
  coins: { symbol: string; change24h: number; quoteVolume: number }[];
  fearGreed?: number;
}

export type ScanMessage =
  | { type: "progress"; done: number; total: number }
  | { type: "done"; rows: ScanRow[]; failed: string[] }
  | { type: "error"; message: string };

declare const self: DedicatedWorkerGlobalScope;

/** Fetch + analysis + per-coin backtest runs here so the UI thread stays smooth. */
self.onmessage = async (e: MessageEvent<ScanRequest>) => {
  const { timeframe, coins, fearGreed } = e.data;
  const htf = HIGHER_TIMEFRAME[timeframe];
  let done = 0;
  const failed: string[] = [];
  try {
    const results = await mapLimit(coins, 4, async (coin) => {
      try {
        const [main, higher] = await Promise.all([getKlines(coin.symbol, timeframe, 1000), htf !== timeframe ? getKlines(coin.symbol, htf, 300) : Promise.resolve(null)]);
        const candles = closedOnly(main);
        const fa = fullAnalysis({ symbol: coin.symbol, timeframe, candles, htfCandles: higher ? closedOnly(higher) : undefined, fearGreed });
        if (!fa) {
          failed.push(coin.symbol);
          return null;
        }
        const row: ScanRow = { symbol: coin.symbol, signal: fa.analysis.signal, snapshot: snapshotOf(fa.analysis, coin.change24h, coin.quoteVolume), gate: fa.gate };
        return row;
      } catch {
        failed.push(coin.symbol);
        return null;
      } finally {
        done++;
        self.postMessage({ type: "progress", done, total: coins.length } satisfies ScanMessage);
      }
    });
    const rows = results.filter((r): r is ScanRow => !!r && !(r instanceof Error));
    self.postMessage({ type: "done", rows, failed } satisfies ScanMessage);
  } catch (err) {
    self.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) } satisfies ScanMessage);
  }
};
