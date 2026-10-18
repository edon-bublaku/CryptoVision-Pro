import { describe, expect, it } from "vitest";
import { closeResult, exitHit, liquidationPrice, orderFillPrice, orderProblem, orderTriggered } from "./paper";

describe("paper orders", () => {
  it("triggers LIMIT and STOP orders on the right side", () => {
    expect(orderTriggered({ side: "LONG", type: "LIMIT", price: 100 }, 100.5)).toBe(false);
    expect(orderTriggered({ side: "LONG", type: "LIMIT", price: 100 }, 99.9)).toBe(true);
    expect(orderTriggered({ side: "SHORT", type: "LIMIT", price: 100 }, 100.1)).toBe(true);
    expect(orderTriggered({ side: "LONG", type: "STOP", price: 100 }, 100.1)).toBe(true);
    expect(orderTriggered({ side: "LONG", type: "STOP", price: 100 }, 99.9)).toBe(false);
    expect(orderTriggered({ side: "SHORT", type: "STOP", price: 100 }, 99.9)).toBe(true);
  });

  it("fills limits at the limit (or better on a gap) and stops at the market", () => {
    expect(orderFillPrice({ side: "LONG", type: "LIMIT", price: 100 }, 99.8)).toBe(99.8);
    expect(orderFillPrice({ side: "LONG", type: "LIMIT", price: 100 }, 100)).toBe(100);
    expect(orderFillPrice({ side: "SHORT", type: "LIMIT", price: 100 }, 101)).toBe(101);
    expect(orderFillPrice({ side: "LONG", type: "STOP", price: 100 }, 100.7)).toBe(100.7);
  });

  it("rejects orders that would fill immediately or have levels on the wrong side", () => {
    const base = { side: "LONG" as const, type: "LIMIT" as const, price: 95, quantity: 1 };
    expect(orderProblem(base, 100)).toBeNull();
    expect(orderProblem({ ...base, price: 105 }, 100)).toBe("limitWouldFill");
    expect(orderProblem({ ...base, type: "STOP", price: 95 }, 100)).toBe("stopWouldFill");
    expect(orderProblem({ ...base, stopLoss: 96 }, 100)).toBe("stopSide");
    expect(orderProblem({ ...base, takeProfit: 90 }, 100)).toBe("targetSide");
    expect(orderProblem({ ...base, quantity: 0 }, 100)).toBe("quantity");
  });
});

describe("paper exits", () => {
  const long = { side: "LONG" as const, entry: 100, quantity: 2, stopLoss: 95, takeProfit: 110, leverage: 1 };

  it("hits stop-loss at the observed price and take-profit at its level", () => {
    expect(exitHit(long, 97)).toBeNull();
    expect(exitHit(long, 94.5)).toEqual({ reason: "SL", price: 94.5 });
    expect(exitHit(long, 111)).toEqual({ reason: "TP", price: 110 });
    const short = { ...long, side: "SHORT" as const, stopLoss: 105, takeProfit: 90 };
    expect(exitHit(short, 105.2)).toEqual({ reason: "SL", price: 105.2 });
    expect(exitHit(short, 89)).toEqual({ reason: "TP", price: 90 });
  });

  it("liquidates leveraged positions whose stop is beyond liquidation", () => {
    const lev = { ...long, leverage: 10, stopLoss: 85 };
    const liq = liquidationPrice(lev)!;
    expect(liq).toBeCloseTo(90.5, 10); // 100 × (1 − 1/10 + 0.005)
    expect(exitHit(lev, 90.4)).toEqual({ reason: "LIQ", price: liq });
    // With the stop above liquidation, the stop fills first.
    expect(exitHit({ ...lev, stopLoss: 95 }, 90.4)?.reason).toBe("SL");
    expect(liquidationPrice(long)).toBeNull();
  });

  it("computes PnL and R exactly, and a liquidation loses the full margin", () => {
    expect(closeResult(long, 110, "TP")).toEqual({ pnl: 20, r: 2 });
    expect(closeResult(long, 95, "SL")).toEqual({ pnl: -10, r: -1 });
    const short = { ...long, side: "SHORT" as const, stopLoss: 105 };
    expect(closeResult(short, 90, "MANUAL").pnl).toBe(20);
    const lev = { side: "LONG" as const, entry: 100, quantity: 10, leverage: 10 };
    expect(closeResult(lev, 90.5, "LIQ").pnl).toBe(-100);
    // Decimal arithmetic: no float drift.
    expect(closeResult({ side: "LONG", entry: 0.1, quantity: 3, leverage: 1 }, 0.3, "MANUAL").pnl).toBe(0.6);
  });
});
