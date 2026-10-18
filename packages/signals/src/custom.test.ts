import type { Candle } from "@cv/core";
import { describe, expect, it } from "vitest";
import btc from "../../core/src/__fixtures__/btcusdt-4h.json";
import { buildContext } from "./context";
import { buildCustomStrategy, conditionHolds, CUSTOM_PRESETS, customStrategySchema, seriesValue, SERIES_IDS, type CustomStrategyDef } from "./custom";
import { evaluateAt } from "./engine";

const candles = btc as Candle[];
const ctx = buildContext(candles);

describe("custom strategy conditions", () => {
  it("every series id resolves to a finite number after warm-up", () => {
    for (const id of SERIES_IDS) expect(Number.isFinite(seriesValue(ctx, id, 600)), id).toBe(true);
  });

  it("high20/low20 are the previous 20 bars, so a breakout bar can exceed them", () => {
    const i = 700;
    const prevHigh = Math.max(...candles.slice(i - 20, i).map((c) => c.high));
    expect(seriesValue(ctx, "high20", i)).toBeCloseTo(prevHigh, 10);
  });

  it("crossAbove fires exactly on the crossing bar", () => {
    const cross = { left: { series: "close" as const }, op: "crossAbove" as const, right: { series: "ema20" as const } };
    let hits = 0;
    for (let i = 250; i < 900; i++) {
      if (!conditionHolds(ctx, cross, i)) continue;
      hits++;
      expect(ctx.close[i - 1]!).toBeLessThanOrEqual(ctx.ema20[i - 1]!);
      expect(ctx.close[i]!).toBeGreaterThan(ctx.ema20[i]!);
    }
    expect(hits).toBeGreaterThan(5);
  });

  it("missing data never passes (warm-up bars)", () => {
    expect(conditionHolds(ctx, { left: { series: "ema200" }, op: ">", right: { value: 0 } }, 5)).toBe(false);
  });

  it("validates definitions", () => {
    for (const p of CUSTOM_PRESETS) expect(customStrategySchema.safeParse(p).success).toBe(true);
    expect(customStrategySchema.safeParse({ ...CUSTOM_PRESETS[0], stop: { type: "atr", mult: 0 } }).success).toBe(false);
    expect(customStrategySchema.safeParse({ ...CUSTOM_PRESETS[0], long: [{ left: { series: "nope" }, op: ">", right: { value: 1 } }] }).success).toBe(false);
  });
});

describe("custom strategy in the engine", () => {
  const donchian = buildCustomStrategy(CUSTOM_PRESETS.find((p) => p.id === "preset-donchian")!);

  it("produces setups with a stop on the correct side", () => {
    let n = 0;
    for (let i = 250; i < candles.length; i++) {
      const s = donchian.detect(ctx, i);
      if (!s) continue;
      n++;
      if (s.side === "LONG") expect(s.structuralStop).toBeLessThan(ctx.close[i]!);
      else expect(s.structuralStop).toBeGreaterThan(ctx.close[i]!);
    }
    expect(n).toBeGreaterThan(3);
  });

  it("has no look-ahead", () => {
    for (const i of [500, 900, 1400]) {
      const a = evaluateAt(ctx, i, { strategies: [], custom: [donchian] });
      const b = evaluateAt(buildContext(candles.slice(0, i + 1)), i, { strategies: [], custom: [donchian] });
      expect(a.setup).toEqual(b.setup);
    }
  });

  it("with strategies: [] only the custom strategy can trigger", () => {
    for (let i = 250; i < candles.length; i += 7) {
      const ev = evaluateAt(ctx, i, { strategies: [], custom: [donchian] });
      if (ev.setup) expect(ev.setup.strategyId).toBe("custom");
    }
  });

  it("an empty rule set never trades", () => {
    const def: CustomStrategyDef = { id: "x", name: "x", long: [], short: [], stop: { type: "atr", mult: 2 }, confluence: false };
    const s = buildCustomStrategy(def);
    for (let i = 250; i < candles.length; i += 3) expect(s.detect(ctx, i)).toBeNull();
  });
});
