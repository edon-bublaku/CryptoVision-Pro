import type { Candle } from "@cv/core";
import { describe, expect, it } from "vitest";
import { histogram, seasonality, topDrawdowns } from "./seasonality";

const DAY = 86_400;
const T0 = Date.UTC(2024, 0, 1) / 1000; // Monday 1 Jan 2024

function series(closes: number[], start = T0): Candle[] {
  return closes.map((c, i) => ({ time: start + i * DAY, open: i ? closes[i - 1]! : c, high: c, low: c, close: c, volume: 1 }));
}

describe("seasonality", () => {
  it("computes calendar-month returns from month-end closes", () => {
    // 31 days of January at 100, February rises to 110 by its last day (29 days in 2024).
    const closes = [...Array(31).fill(100), ...Array.from({ length: 29 }, (_, k) => 100 + ((k + 1) * 10) / 29)];
    const s = seasonality(series(closes))!;
    expect(s.months).toHaveLength(2);
    expect(s.months[0]).toMatchObject({ year: 2024, month: 0, partial: false });
    expect(s.months[0]!.ret).toBeCloseTo(0, 10);
    expect(s.months[1]).toMatchObject({ year: 2024, month: 1, partial: false });
    expect(s.months[1]!.ret).toBeCloseTo(10, 8);
    expect(s.byMonth[1]!.mean).toBeCloseTo(10, 8);
    expect(s.byYear[0]).toMatchObject({ year: 2024, partial: true });
  });

  it("flags months cut by the start or end of history as partial", () => {
    const s = seasonality(series(Array(45).fill(100), T0 + 10 * DAY))!;
    expect(s.months[0]!.partial).toBe(true);
    expect(s.months[s.months.length - 1]!.partial).toBe(true);
    expect(s.byMonth.every((b) => b.count === 0)).toBe(true);
  });

  it("assigns daily returns to weekdays with Monday first, and finds streaks", () => {
    // Up every day for a week, then down 3 days.
    const closes = [100, 101, 102, 103, 104, 105, 106, 107, 106, 105, 104, ...Array(30).fill(104)];
    const s = seasonality(series(closes))!;
    expect(s.streaks.up).toBe(7);
    expect(s.streaks.down).toBe(3);
    // 1 Jan 2024 is a Monday; the first return is on Tuesday 2 Jan.
    expect(s.byWeekday[1]!.mean).toBeGreaterThan(0);
    expect(s.daily.best!.time).toBe(T0 + DAY);
  });
});

describe("topDrawdowns", () => {
  it("finds non-overlapping drawdowns with depth and recovery", () => {
    const dd = topDrawdowns(series([100, 80, 100, 120, 60, 90]));
    expect(dd).toHaveLength(2);
    expect(dd[0]!.depth).toBeCloseTo(-50, 10);
    expect(dd[0]!.recoveryTime).toBeNull();
    expect(dd[1]!.depth).toBeCloseTo(-20, 10);
    expect(dd[1]).toMatchObject({ fallDays: 1, recoveryDays: 1 });
  });
});

describe("histogram", () => {
  it("clips outliers into the edge bins and keeps every value", () => {
    const h = histogram([-50, -1, 0, 0.5, 3, 40], 4, 4);
    expect(h.map((b) => b.count)).toEqual([1, 1, 2, 2]);
  });
});
