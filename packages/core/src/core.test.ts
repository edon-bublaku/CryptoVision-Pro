import { describe, expect, it } from "vitest";
import { bucketStart, formatCompact, formatPct, formatPrice, formatQty, resample } from "./index";

describe("weekly buckets", () => {
  it("start on Monday 00:00 UTC like exchange 1w candles", () => {
    const mon = Date.UTC(2024, 0, 1) / 1000; // Monday
    expect(bucketStart(mon + 3 * 86_400, 604_800)).toBe(mon);
    expect(new Date(bucketStart(Date.UTC(2026, 9, 18) / 1000, 604_800) * 1000).getUTCDay()).toBe(1);
    const days = Array.from({ length: 14 }, (_, i) => ({ time: mon + i * 86_400, open: 1, high: 1, low: 1, close: 1, volume: 1 }));
    expect(resample(days, 604_800).map((w) => w.lastIndex)).toEqual([6, 13]);
  });
  it("leave daily buckets unchanged", () => {
    expect(bucketStart(90_000, 86_400)).toBe(86_400);
  });
});

describe("formatting", () => {
  it("rolls compact units over after rounding", () => {
    expect(formatCompact(999_999)).toBe("1.00M");
    expect(formatCompact(999_999_999)).toBe("1.00B");
    expect(formatCompact(999.99)).toBe("999.99");
  });
  it("never prints -0.00%", () => {
    expect(formatPct(-0.001)).toBe("0.00%");
    expect(formatPct(-1.234)).toBe("-1.23%");
  });
  it("keeps significant digits for very small prices and quantities", () => {
    expect(formatPrice(1.234e-9)).toBe("0.0000000012340");
    expect(formatQty(0.00004)).toBe("0.00004");
  });
});
