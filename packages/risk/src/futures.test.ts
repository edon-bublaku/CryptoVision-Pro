import { describe, expect, it } from "vitest";
import { futuresPlan } from "./futures";

describe("futuresPlan", () => {
  it("sizes from the risk budget with fees and the hold's funding, all by hand", () => {
    const p = futuresPlan({ side: "LONG", entry: 100, stopLoss: 95, targets: [{ price: 107.5, sizePct: 100 }], equity: 10_000, riskPct: 1, maxLeverage: 10, takerFee: 0.0005, fundingRate: 0.0001, fundingIntervalHours: 8, holdHours: 24 })!;
    // per unit: 5 move + (100 + 95)·0.0005 fees + 100·0.0001·3 funding = 5.1275
    expect(p.quantity).toBeCloseTo(100 / 5.1275, 8);
    expect(p.riskAmount).toBe(100);
    expect(p.maxSafeLeverage).toBe(12); // floor(1 / (1.5·5% + 0.5%))
    expect(p.leverage).toBe(1); // 1,950 notional fits in 25% of 10k at 1×
    expect(p.breakeven).toBeCloseTo((100 * 1.0005 + 0.03) / 0.9995, 8);
    expect(p.funding.youPay).toBe(true);
    expect(p.funding.annualizedPct).toBeCloseTo(10.95, 8);
    expect(p.marginMode).toBe("isolated");
  });

  it("picks the lowest leverage that keeps margin within 25% of the account", () => {
    const p = futuresPlan({ side: "LONG", entry: 100, stopLoss: 98, targets: [], equity: 1000, riskPct: 2, maxLeverage: 20, takerFee: 0 })!;
    expect(p.quantity).toBe(10);
    expect(p.leverage).toBe(4);
    expect(p.margin).toBe(250);
    expect(p.isolated.liquidation).toBeCloseTo(75.5, 10); // 100 × (1 − 1/4 + 0.005)
    expect(p.isolated.distancePct).toBeCloseTo(24.5, 10);
    expect(p.cross.liquidation).toBeNull(); // the whole balance covers the position
  });

  it("caps leverage so liquidation stays well beyond the stop, and receives funding on a short", () => {
    const p = futuresPlan({ side: "SHORT", entry: 100, stopLoss: 104, targets: [{ price: 96, sizePct: 50 }, { price: 92, sizePct: 50 }], equity: 1000, riskPct: 1, maxLeverage: 50, takerFee: 0, fundingRate: 0.0002, holdHours: 16 })!;
    expect(p.maxSafeLeverage).toBe(15);
    expect(p.warnings).toContain("leverage_capped_by_safety");
    expect(p.quantity).toBe(2.5);
    expect(p.funding.youPay).toBe(false);
    expect(p.costs.fundingForHold).toBeCloseTo(-0.1, 10);
    expect(p.breakeven).toBeCloseTo(100.04, 10);
    expect(p.targets.map((t) => t.pnl)).toEqual([5, 10]);
    expect(p.rrNet).toBeCloseTo(1.51, 10);
  });

  it("shrinks the position when the leverage cap can't carry the risk budget", () => {
    const p = futuresPlan({ side: "LONG", entry: 100, stopLoss: 99.5, targets: [], equity: 1000, riskPct: 2, maxLeverage: 3, takerFee: 0 })!;
    expect(p.quantity).toBe(30);
    expect(p.leverage).toBe(3);
    expect(p.riskAmount).toBe(15);
    expect(p.warnings).toEqual(expect.arrayContaining(["risk_reduced_by_leverage", "margin_heavy"]));
  });

  it("cross liquidation is the price where the balance is used up", () => {
    const p = futuresPlan({ side: "LONG", entry: 100, stopLoss: 99, targets: [], equity: 100, riskPct: 2, maxLeverage: 20, takerFee: 0, maintenanceMargin: 0 })!;
    // qty = 2 / 1 = 2 (notional 200 ≤ 100 × 20); cross liq = (100·2 − 100) / 2 = 50
    expect(p.quantity).toBe(2);
    expect(p.cross.liquidation).toBe(50);
  });

  it("caps the net R:R at the next opposing level, like the trade plan", () => {
    const base = { side: "LONG" as const, entry: 100, stopLoss: 98, targets: [{ price: 103, sizePct: 40 }, { price: 106, sizePct: 40 }, { price: 110, sizePct: 20 }], equity: 1000, riskPct: 1, maxLeverage: 5, takerFee: 0 };
    // Risk 2/unit; level at 101 caps every target at +1 → 0.5R.
    expect(futuresPlan({ ...base, nextLevel: 101 })!.rrNet).toBeCloseTo(0.5, 10);
    // Without a level: (0.4·3 + 0.4·6 + 0.2·10) / 2 = 2.8.
    expect(futuresPlan(base)!.rrNet).toBeCloseTo(2.8, 10);
  });

  it("rejects a stop on the wrong side or invalid inputs", () => {
    expect(futuresPlan({ side: "LONG", entry: 100, stopLoss: 101, targets: [], equity: 1000, riskPct: 1, maxLeverage: 5 })).toBeNull();
    expect(futuresPlan({ side: "SHORT", entry: 100, stopLoss: 99, targets: [], equity: 1000, riskPct: 1, maxLeverage: 5 })).toBeNull();
    expect(futuresPlan({ side: "LONG", entry: 100, stopLoss: NaN, targets: [], equity: 1000, riskPct: 1, maxLeverage: 5 })).toBeNull();
  });
});
