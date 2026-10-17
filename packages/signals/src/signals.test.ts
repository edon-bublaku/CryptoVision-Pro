import { describe, expect, it } from "vitest";
import type { Candle } from "@cv/core";
import { syntheticCandles } from "@cv/core";
import btc from "../../core/src/__fixtures__/btcusdt-4h.json";
import { actionFromScore, analyze, buildContext, evaluateAt } from "./index";

const candles = btc as Candle[];

describe("signal engine", () => {
  it("has no look-ahead: evaluating bar i on full history equals evaluating on history up to i", () => {
    const full = buildContext(candles);
    for (const i of [400, 777, 1234, 1600]) {
      const truncated = buildContext(candles.slice(0, i + 1));
      const a = evaluateAt(full, i);
      const b = evaluateAt(truncated, i);
      expect(a.score).toBe(b.score);
      expect(a.regime.regime).toBe(b.regime.regime);
      expect(a.setup?.strategyId ?? null).toBe(b.setup?.strategyId ?? null);
      expect(a.factors.map((f) => [f.id, f.score.toFixed(6)])).toEqual(b.factors.map((f) => [f.id, f.score.toFixed(6)]));
    }
  });

  it("produces a complete, sane signal", () => {
    const res = analyze({ symbol: "BTCUSDT", timeframe: "4h", candles, htfCandles: candles.filter((_, i) => i % 6 === 0) })!;
    const s = res.signal;
    expect(s.score).toBeGreaterThanOrEqual(0);
    expect(s.score).toBeLessThanOrEqual(100);
    expect(s.confidence).toBeGreaterThanOrEqual(0);
    expect(s.confidence).toBeLessThanOrEqual(0.95);
    expect(s.factors.length).toBeGreaterThan(8);
    if (s.plan) {
      const d = s.plan.side === "LONG" ? 1 : -1;
      expect((s.plan.entry - s.plan.stopLoss) * d).toBeGreaterThan(0);
      for (const tp of s.plan.takeProfits) expect((tp.price - s.plan.entry) * d).toBeGreaterThan(0);
    }
    if (s.status === "ACTIVE") expect(s.strategyId).not.toBeNull();
  });

  it("finds setups across history", () => {
    const ctx = buildContext(candles);
    const hits = new Map<string, number>();
    for (let i = 210; i < candles.length; i++) {
      const ev = evaluateAt(ctx, i);
      if (ev.setup) hits.set(ev.setup.strategyId, (hits.get(ev.setup.strategyId) ?? 0) + 1);
    }
    expect([...hits.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(20);
  });

  it("maps scores to actions", () => {
    expect(actionFromScore(80)).toBe("STRONG_BUY");
    expect(actionFromScore(62)).toBe("BUY");
    expect(actionFromScore(50)).toBe("HOLD");
    expect(actionFromScore(38)).toBe("SELL");
    expect(actionFromScore(10)).toBe("STRONG_SELL");
  });

  it("returns null with too little history", () => {
    expect(analyze({ symbol: "X", timeframe: "1h", candles: syntheticCandles(30) })).toBeNull();
  });
});
