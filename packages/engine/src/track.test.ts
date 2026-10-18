import { describe, expect, it } from "vitest";
import type { Signal } from "@cv/core";
import type { TrackedSignal } from "./types";
import { evaluateOutcome } from "./track";

const signal = {
  id: "x",
  symbol: "BTCUSDT",
  timeframe: "1h",
  action: "BUY",
  score: 70,
  confidence: 0.6,
  regime: "TRENDING_UP",
  htfBias: "BULLISH",
  strategyId: "trend_pullback",
  factors: [],
  price: 100,
  candleTime: 0,
  createdAt: 0,
  status: "ACTIVE",
  plan: {
    side: "LONG",
    entry: 100,
    entryZone: [99.5, 100.5],
    stopLoss: 95,
    takeProfits: [
      { price: 107.5, sizePct: 40, rr: 1.5 },
      { price: 115, sizePct: 40, rr: 3 },
      { price: 125, sizePct: 20, rr: 5 },
    ],
    riskReward: 2.8,
    stopPct: 5,
    invalidation: "95",
  },
} satisfies Signal;

const tracked: TrackedSignal = { signal, outcome: "pending", bestR: 0, updatedAt: 0 };
const bar = (i: number, low: number, high: number) => ({ time: i * 3600, low, high, close: (low + high) / 2 });

describe("evaluateOutcome", () => {
  it("stays pending until the entry zone trades, then expires", () => {
    const r = evaluateOutcome(tracked, [1, 2, 3, 4, 5, 6, 7, 8].map((i) => bar(i, 102, 104)), 3600);
    expect(r.outcome).toBe("expired");
  });
  it("hits the stop", () => {
    expect(evaluateOutcome(tracked, [bar(1, 99, 101), bar(2, 94, 99)], 3600).outcome).toBe("sl");
  });
  it("reaches TP1 then is stopped at breakeven: still a TP1 outcome", () => {
    const r = evaluateOutcome(tracked, [bar(1, 99, 101), bar(2, 101, 108), bar(3, 99.9, 103)], 3600);
    expect(r.outcome).toBe("tp1");
    expect(r.bestR).toBeCloseTo(1.6, 6);
  });
  it("runs all the way to TP3", () => {
    expect(evaluateOutcome(tracked, [bar(1, 99, 101), bar(2, 101, 116), bar(3, 114, 126)], 3600).outcome).toBe("tp3");
  });
  it("stop wins when stop and target are in the same bar", () => {
    expect(evaluateOutcome(tracked, [bar(1, 94, 108)], 3600).outcome).toBe("sl");
  });
});

describe("evaluateOutcome on the entry bar", () => {
  it("does not credit a target that may have traded before the entry", () => {
    // Gaps up to 108 (TP1) first, then falls into the zone: the order inside the bar is unknown.
    const r = evaluateOutcome(tracked, [{ time: 3600, open: 106, low: 100, high: 108, close: 101 }], 3600);
    expect(r.outcome).toBe("open");
  });
  it("credits targets when the bar opened inside the entry zone", () => {
    const r = evaluateOutcome(tracked, [{ time: 3600, open: 100, low: 99.8, high: 108, close: 107 }], 3600);
    expect(r.outcome).toBe("tp1");
  });
});
