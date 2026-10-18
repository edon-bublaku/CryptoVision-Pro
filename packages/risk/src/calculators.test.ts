import { describe, expect, it } from "vitest";
import { compound, dca, dcaBacktest, leverageCalc, quantityForTargetAverage, recoveryGain, requiredRate, rrTargets } from "./calculators";

describe("dca", () => {
  it("averages by quantity, not by price", () => {
    // $100 at 10 and $100 at 20 buys 10 + 5 = 15 units → average 13.33, not 15.
    const r = dca([{ price: 10, amount: 100 }, { price: 20, amount: 100 }], 0)!;
    expect(r.quantity).toBe(15);
    expect(r.avgPrice).toBeCloseTo(13.33333333, 8);
    expect(r.breakeven).toBeCloseTo(r.avgPrice, 8);
  });
  it("counts fees on entry and exit in the breakeven", () => {
    const r = dca([{ price: 100, amount: 1000 }], 0.001)!;
    expect(r.fees).toBe(1);
    expect(r.quantity).toBe(9.99);
    // Selling 9.99 at breakeven, minus 0.1%, returns exactly $1000.
    expect(r.breakeven * r.quantity * 0.999).toBeCloseTo(1000, 6);
  });
  it("rejects nonsense", () => {
    expect(dca([])).toBeNull();
    expect(dca([{ price: -1, amount: 10 }])).toBeNull();
  });
});

describe("target average", () => {
  it("solves the averaging-down quantity", () => {
    const q = quantityForTargetAverage(1, 100, 50, 75)!;
    expect(q).toBe(1); // (1×100 + 1×50) / 2 = 75
    expect(quantityForTargetAverage(1, 100, 50, 40)).toBeNull(); // below the buy price: impossible
  });
});

describe("leverage", () => {
  it("matches the isolated-margin liquidation formula and reports PnL / ROE", () => {
    const r = leverageCalc({ side: "LONG", entry: 100, leverage: 10, margin: 100, maintenanceMargin: 0.005, exit: 110, feeRate: 0 })!;
    expect(r.notional).toBe(1000);
    expect(r.quantity).toBe(10);
    expect(r.liquidation).toBeCloseTo(90.5, 10);
    expect(r.distanceToLiquidationPct).toBeCloseTo(9.5, 10);
    expect(r.pnl).toBe(100);
    expect(r.roe).toBe(100);
    const s = leverageCalc({ side: "SHORT", entry: 100, leverage: 5, margin: 200, maintenanceMargin: 0.005 })!;
    expect(s.liquidation).toBeCloseTo(119.5, 10);
  });
  it("rejects impossible leverage", () => {
    expect(leverageCalc({ side: "LONG", entry: 100, leverage: 200, margin: 10 })).toBeNull();
  });
});

describe("R:R targets", () => {
  it("places targets in R multiples and gives breakeven win rates", () => {
    const r = rrTargets("LONG", 100, 95, [1, 2, 3])!;
    expect(r.targets.map((t) => t.price)).toEqual([105, 110, 115]);
    expect(r.breakevenWinRate.map((w) => w.winRate)).toEqual([50, 33.33, 25]);
    expect(rrTargets("SHORT", 100, 104, [2])!.targets[0]!.price).toBe(92);
    expect(rrTargets("LONG", 100, 105)).toBeNull(); // stop on the wrong side
  });
});

describe("compounding", () => {
  it("compounds with contributions", () => {
    const r = compound({ start: 1000, ratePct: 10, periods: 2, contribution: 100 })!;
    expect(r.path).toEqual([1000, 1200, 1420]);
    expect(r.contributed).toBe(1200);
    expect(r.gain).toBe(220);
  });
  it("inverts to the required rate", () => {
    expect(requiredRate(1000, 2000, 1)).toBe(100);
    expect(requiredRate(1000, 1210, 2)).toBeCloseTo(10, 8);
  });
  it("recovery after a loss is asymmetric", () => {
    expect(recoveryGain(50)).toBe(100);
    expect(recoveryGain(20)).toBe(25);
    expect(recoveryGain(100)).toBeNull();
  });
});

describe("dcaBacktest", () => {
  const day = (k: number, close: number) => ({ time: 1_700_000_000 + k * 86_400, close });

  it("buys every N days at the close and compares with a lump sum", () => {
    // Price falls then recovers: DCA buys cheaper units than the lump sum.
    const candles = [day(0, 100), day(1, 50), day(2, 50), day(3, 100)];
    const r = dcaBacktest({ candles, amount: 100, everyDays: 1, feeRate: 0 })!;
    expect(r.buys).toBe(4);
    expect(r.invested).toBe(400);
    expect(r.quantity).toBe(6); // 1 + 2 + 2 + 1
    expect(r.value).toBe(600);
    expect(r.returnPct).toBe(50);
    expect(r.avgCost).toBeCloseTo(66.6666667, 6);
    expect(r.lump).toMatchObject({ quantity: 4, value: 400, returnPct: 0, worstPct: -50 });
    expect(r.worstPct).toBe(-25); // day 1: 3 units × 50 = 150 against 200 put in
    expect(r.path).toHaveLength(4);
  });

  it("respects the interval and the fee", () => {
    const candles = Array.from({ length: 10 }, (_, k) => day(k, 10));
    const r = dcaBacktest({ candles, amount: 10, everyDays: 7, feeRate: 0.01 })!;
    expect(r.buys).toBe(2); // days 0 and 7
    expect(r.quantity).toBeCloseTo(1.98, 12);
    expect(r.returnPct).toBeCloseTo(-1, 10);
  });

  it("rejects invalid input", () => {
    expect(dcaBacktest({ candles: [day(0, 1)], amount: 10, everyDays: 1 })).toBeNull();
    expect(dcaBacktest({ candles: [day(0, 1), day(1, 2)], amount: 0, everyDays: 1 })).toBeNull();
    expect(dcaBacktest({ candles: [day(0, 1), day(1, 2)], amount: 10, everyDays: 1.5 })).toBeNull();
  });
});
