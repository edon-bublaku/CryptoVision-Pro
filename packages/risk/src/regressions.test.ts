import { describe, expect, it } from "vitest";
import { buildTradePlan, journalStats, leverageCalc, maxLoss, positionSize, rrTargets } from "./index";
import { closeResult } from "./paper";

/** Calculation defects found in the audit; each test pins the corrected behaviour. */
describe("trade plan R:R", () => {
  it("is capped by an opposing level just above entry, so the setup fails the 1.5 gate", () => {
    const p = buildTradePlan({ side: "LONG", entry: 100, atr: 2, nextLevel: 100.1 })!;
    expect(p.takeProfits[0]!.price).toBeGreaterThan(100); // never back across the entry
    expect(p.takeProfits[0]!.rr).toBeGreaterThan(0);
    expect(p.riskReward).toBeLessThan(1.5);
  });
  it("is unchanged without a close level (40/40/20 of 1.5R/3R/5R)", () => {
    expect(buildTradePlan({ side: "SHORT", entry: 100, atr: 2 })!.riskReward).toBe(2.8);
  });
  it("counts targets beyond the level only up to the level", () => {
    // Risk 2, level at +4 = 2R: TP1 1.5R, TP2 and TP3 capped at 2R → 0.6 + 0.8 + 0.4.
    expect(buildTradePlan({ side: "LONG", entry: 100, atr: 2, nextLevel: 104 })!.riskReward).toBe(1.8);
  });
  it("rejects plans whose short targets would be at or below zero", () => {
    expect(buildTradePlan({ side: "SHORT", entry: 100, atr: 30, config: { maxStopPct: 25 } })).toBeNull();
  });
});

describe("sizing and calculators input guards", () => {
  it("positionSize rejects a missing or negative stop", () => {
    expect(positionSize({ equity: 1000, riskPct: 1, entry: 100, stopLoss: NaN, maxLeverage: 1 })).toBeNull();
    expect(positionSize({ equity: 1000, riskPct: 1, entry: 100, stopLoss: -10, maxLeverage: 1 })).toBeNull();
  });
  it("leverageCalc rejects leverage < 1, NaN margin rate and instant liquidation", () => {
    expect(leverageCalc({ side: "LONG", entry: 100, leverage: 0.5, margin: 100 })).toBeNull();
    expect(leverageCalc({ side: "LONG", entry: 100, leverage: 10, margin: 100, maintenanceMargin: NaN })).toBeNull();
    expect(leverageCalc({ side: "LONG", entry: 100, leverage: 125, margin: 100, maintenanceMargin: 0.01 })).toBeNull();
  });
  it("rrTargets drops short targets at or below zero", () => {
    const r = rrTargets("SHORT", 100, 130)!;
    expect(r.targets.map((t) => t.r)).toEqual([1, 1.5, 2, 3]);
    expect(r.breakevenWinRate).toHaveLength(4);
  });
});

describe("leveraged losses", () => {
  const pos = { id: "p", symbol: "BTCUSDT", side: "LONG" as const, entry: 100, quantity: 1, leverage: 10, stopLoss: 95, openedAt: 0 };
  it("a stop that gaps through liquidation loses at most the margin", () => {
    expect(closeResult(pos, 80, "SL").pnl).toBe(-10);
    expect(closeResult({ ...pos, side: "SHORT", stopLoss: 105 }, 125, "SL").pnl).toBe(-10);
  });
  it("maxLoss is capped by the margin and is 0 once the stop locks in profit", () => {
    expect(maxLoss({ ...pos, stopLoss: 85 })).toBe(10);
    expect(maxLoss(pos)).toBe(5);
    expect(maxLoss({ ...pos, stopLoss: 102 })).toBe(0);
    expect(maxLoss({ ...pos, stopLoss: undefined })).toBeNull();
  });
});

describe("journal drawdown %", () => {
  it("is NaN without a start equity instead of a meaningless percentage", () => {
    const t = (pnl: number, k: number) => ({ id: String(k), symbol: "X", side: "LONG" as const, entry: 1, exit: 1, quantity: 1, pnl, openedAt: k, closedAt: k + 1 });
    const s = journalStats([t(1, 1), t(-100, 2)])!;
    expect(s.maxDrawdown).toBe(-100);
    expect(s.maxDrawdownPct).toBeNaN();
  });
});
