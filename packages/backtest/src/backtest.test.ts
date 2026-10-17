import { describe, expect, it } from "vitest";
import type { Candle } from "@cv/core";
import btc from "../../core/src/__fixtures__/btcusdt-4h.json";
import { monteCarlo, runBacktest } from "./index";

const candles = btc as Candle[];

describe("backtest", () => {
  const res = runBacktest(candles, { timeframe: "4h" });

  it("trades and accounts consistently", () => {
    expect(res.trades.length).toBeGreaterThan(5);
    const sum = res.trades.reduce((s, t) => s + t.pnl, 0);
    expect(res.metrics.finalEquity).toBeCloseTo(10_000 + sum, 6);
    expect(res.equity.length).toBe(candles.length - 210);
  });

  it("enters only after the signal bar and never overlaps trades", () => {
    for (let k = 1; k < res.trades.length; k++) expect(res.trades[k]!.entryIndex).toBeGreaterThan(res.trades[k - 1]!.exitIndex);
  });

  it("stops respect the 1R risk budget (allowing slippage, gaps and fees)", () => {
    for (const t of res.trades) if (t.exitReason === "STOP") expect(t.rMultiple).toBeGreaterThan(-1.6);
  });

  it("metrics are bounded", () => {
    const m = res.metrics;
    expect(m.winRate).toBeGreaterThanOrEqual(0);
    expect(m.winRate).toBeLessThanOrEqual(1);
    expect(m.maxDrawdownPct).toBeLessThanOrEqual(0);
    expect(res.walkForward.length).toBe(4);
  });

  it("single-strategy filter is honoured", () => {
    const r = runBacktest(candles, { strategies: ["breakout_volume"] });
    for (const t of r.trades) expect(t.strategyId).toBe("breakout_volume");
  });

  it("monte carlo is deterministic and ordered", () => {
    const a = monteCarlo(res.trades, 10_000);
    const b = monteCarlo(res.trades, 10_000);
    expect(a).toEqual(b);
    expect(a.returnP5).toBeLessThanOrEqual(a.returnP50);
    expect(a.returnP50).toBeLessThanOrEqual(a.returnP95);
  });
});
