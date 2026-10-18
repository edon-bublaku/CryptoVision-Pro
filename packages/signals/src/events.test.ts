import type { Candle } from "@cv/core";
import { syntheticCandles } from "@cv/core";
import { describe, expect, it } from "vitest";
import { buildContext } from "./context";
import { derivativeEvents, marketEvents } from "./events";

const DAY = 86_400;
const series = (closes: number[]): Candle[] => closes.map((c, i) => ({ time: i * DAY, open: i ? closes[i - 1]! : c, high: Math.max(c, i ? closes[i - 1]! : c) + 0.5, low: Math.min(c, i ? closes[i - 1]! : c) - 0.5, close: c, volume: 100 }));

describe("marketEvents", () => {
  it("reports a golden cross when EMA50 crosses above EMA200 after a long decline turns up", () => {
    const closes = [...Array.from({ length: 260 }, (_, i) => 200 - i * 0.4), ...Array.from({ length: 200 }, (_, i) => 96 + i * 1.2)];
    const ev = marketEvents(buildContext(series(closes)), { bars: 460, patterns: false });
    const golden = ev.find((e) => e.kind === "golden_cross");
    expect(golden?.direction).toBe("bullish");
    // Newest first, and every event after the warm-up.
    expect(ev.every((e, k) => k === 0 || ev[k - 1]!.index >= e.index)).toBe(true);
    expect(ev.find((e) => e.kind === "ema_20_50_cross" && e.direction === "bullish")).toBeDefined();
  });

  it("is causal: events up to bar i are the same with or without later bars", () => {
    const cs = syntheticCandles(600, 7);
    const full = marketEvents(buildContext(cs), { bars: 600 }).filter((e) => e.index <= 450 && e.kind !== "bos" && e.kind !== "choch" && e.kind !== "divergence" && e.kind !== "hidden_divergence");
    const cut = marketEvents(buildContext(cs.slice(0, 451)), { bars: 600 }).filter((e) => e.kind !== "bos" && e.kind !== "choch" && e.kind !== "divergence" && e.kind !== "hidden_divergence");
    expect(cut.map((e) => `${e.index}:${e.kind}:${e.direction}`).sort()).toEqual(full.map((e) => `${e.index}:${e.kind}:${e.direction}`).sort());
  });

  it("detects RSI entering oversold and a 20-bar breakdown", () => {
    const closes = [...Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 3)), ...Array.from({ length: 12 }, (_, i) => 99 - i * 2)];
    const kinds = marketEvents(buildContext(series(closes)), { bars: 30, patterns: false }).map((e) => `${e.kind}:${e.direction}`);
    expect(kinds).toContain("rsi_oversold:bullish");
    expect(kinds).toContain("breakout_20:bearish");
  });
});

describe("derivativeEvents", () => {
  it("normalises funding to 8h (0.03% per 4h = 0.06% per 8h) and flags crowded positioning", () => {
    const ev = derivativeEvents({ fundingRate: 0.0003, fundingIntervalHours: 4, oiChange24hPct: 12, longShortRatio: 3, takerBuyShare: 0.4 });
    expect(ev.map((e) => e.kind)).toEqual(["funding_extreme_long", "oi_surge", "crowded_longs", "taker_selling"]);
    expect(ev[0]!.against).toBe("LONG");
    expect(derivativeEvents({ fundingRate: 0.0001, oiChange24hPct: 2, longShortRatio: 1.1 })).toEqual([]);
  });
});
