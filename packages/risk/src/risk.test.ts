import { describe, expect, it } from "vitest";
import { buildTradePlan, kellyFraction, positionSize, unrealizedPnl } from "./index";

describe("buildTradePlan", () => {
  it("long: stop beyond structure + buffer, targets at R multiples", () => {
    const p = buildTradePlan({ side: "LONG", entry: 100, atr: 2, structuralStop: 96 })!;
    expect(p.stopLoss).toBe(95); // 96 − 0.5×ATR
    expect(p.takeProfits.map((t) => t.price)).toEqual([107.5, 115, 125]);
    expect(p.takeProfits.map((t) => t.sizePct)).toEqual([40, 40, 20]);
    expect(p.stopPct).toBe(5);
  });
  it("never tighter than 1 ATR", () => {
    const p = buildTradePlan({ side: "LONG", entry: 100, atr: 2, structuralStop: 99.9 })!;
    expect(p.stopLoss).toBe(98);
  });
  it("short mirrors long", () => {
    const p = buildTradePlan({ side: "SHORT", entry: 100, atr: 2, structuralStop: 104 })!;
    expect(p.stopLoss).toBe(105);
    expect(p.takeProfits[0]!.price).toBe(92.5);
  });
  it("caps the stop at maxStopPct", () => {
    const p = buildTradePlan({ side: "LONG", entry: 100, atr: 2, structuralStop: 50 })!;
    expect(p.stopLoss).toBe(92);
  });
  it("pulls TP1 in front of a nearer resistance", () => {
    const p = buildTradePlan({ side: "LONG", entry: 100, atr: 2, structuralStop: 96, nextLevel: 104 })!;
    expect(p.takeProfits[0]!.price).toBeCloseTo(103.8, 10);
    expect(p.takeProfits[0]!.rr).toBeCloseTo(0.76, 2);
  });
  it("rejects invalid input", () => {
    expect(buildTradePlan({ side: "LONG", entry: 0, atr: 2 })).toBeNull();
    expect(buildTradePlan({ side: "LONG", entry: 100, atr: 0 })).toBeNull();
  });
});

describe("positionSize", () => {
  it("risks exactly the budget including fees", () => {
    const s = positionSize({ equity: 10_000, riskPct: 1, entry: 100, stopLoss: 95, maxLeverage: 10, feeRate: 0 })!;
    expect(s.quantity).toBeCloseTo(20, 10);
    expect(s.riskAmount).toBe(100);
    expect(s.notional).toBe(2000);
    expect(s.leverage).toBe(1);
    expect(s.liquidationPrice).toBeNull();
  });
  it("caps by leverage", () => {
    const s = positionSize({ equity: 1000, riskPct: 2, entry: 100, stopLoss: 99.9, maxLeverage: 2, feeRate: 0 })!;
    expect(s.cappedByLeverage).toBe(true);
    expect(s.notional).toBe(2000);
    expect(s.liquidationPrice).toBeCloseTo(50.5, 6);
  });
  it("fees reduce size", () => {
    const a = positionSize({ equity: 10_000, riskPct: 1, entry: 100, stopLoss: 95, maxLeverage: 10, feeRate: 0 })!;
    const b = positionSize({ equity: 10_000, riskPct: 1, entry: 100, stopLoss: 95, maxLeverage: 10, feeRate: 0.001 })!;
    expect(b.quantity).toBeLessThan(a.quantity);
    expect(b.riskAmount).toBeCloseTo(100, 1);
  });
});

describe("kelly & pnl", () => {
  it("quarter Kelly", () => expect(kellyFraction(0.5, 2, 1)).toBeCloseTo(0.0625, 10));
  it("never negative", () => expect(kellyFraction(0.2, 1, 1)).toBe(0));
  it("short pnl", () => expect(unrealizedPnl("SHORT", 100, 90, 2)).toEqual({ pnl: 20, pct: 10 }));
});
