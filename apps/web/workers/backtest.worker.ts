/// <reference lib="webworker" />
import type { Candle, Timeframe } from "@cv/core";
import { runBacktest, type BacktestConfig, type BacktestResult } from "@cv/backtest";
import { closedOnly, getKlinesDeep } from "@cv/exchange";
import { buildCustomStrategy, customStrategySchema, type CustomStrategyDef } from "@cv/signals";

export interface BacktestRequest {
  symbol: string;
  timeframe: Timeframe;
  bars: number;
  config: Omit<BacktestConfig, "custom">;
  /** Test this user-defined strategy alone (functions can't cross postMessage, so it's sent as JSON). */
  custom?: CustomStrategyDef;
}

export type BacktestMessage = { type: "fetched"; bars: number } | { type: "done"; result: BacktestResult; candles: Candle[] } | { type: "error"; message: string };

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (e: MessageEvent<BacktestRequest>) => {
  const { symbol, timeframe, bars, config, custom } = e.data;
  try {
    const candles = closedOnly(await getKlinesDeep(symbol, timeframe, bars + 1)).slice(-bars);
    self.postMessage({ type: "fetched", bars: candles.length } satisfies BacktestMessage);
    if (candles.length < 300) throw new Error(`Not enough history (${candles.length} bars)`);
    const customCfg = custom ? { strategies: [], custom: [buildCustomStrategy(customStrategySchema.parse(custom))] } : {};
    const result = runBacktest(candles, { ...config, ...customCfg, timeframe });
    self.postMessage({ type: "done", result, candles } satisfies BacktestMessage);
  } catch (err) {
    self.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) } satisfies BacktestMessage);
  }
};
