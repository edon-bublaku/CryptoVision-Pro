import { describe, expect, it } from "vitest";
import { evaluatePriceAlert, lineLevel } from "./alerts";

const base = { lastSide: null, drawing: null, note: null };

describe("price alert evaluation", () => {
  it("price above / below", () => {
    expect(evaluatePriceAlert({ ...base, type: "price_above", value: "100" }, 101, 90, 0).fire).toMatch(/100/);
    expect(evaluatePriceAlert({ ...base, type: "price_above", value: "100" }, 99, 90, 0).fire).toBeNull();
    expect(evaluatePriceAlert({ ...base, type: "price_below", value: "100" }, 99.5, 90, 0).fire).not.toBeNull();
  });
  it("24h change in either direction", () => {
    expect(evaluatePriceAlert({ ...base, type: "change_pct", value: "5" }, 94, 100, 0).fire).toContain("-6.00%");
    expect(evaluatePriceAlert({ ...base, type: "change_pct", value: "5" }, 103, 100, 0).fire).toBeNull();
  });
  it("drawing alerts fire only on a cross after the first observation", () => {
    const drawing = { id: "d", type: "trendline", points: [{ time: 0, price: 100 }, { time: 100, price: 200 }] };
    expect(lineLevel(drawing, 50)).toBe(150);
    const first = evaluatePriceAlert({ ...base, type: "drawing", value: "0", drawing }, 140, 0, 50);
    expect(first).toEqual({ fire: null, side: -1 });
    expect(evaluatePriceAlert({ ...base, lastSide: -1, type: "drawing", value: "0", drawing }, 149, 0, 50).fire).toBeNull();
    const crossed = evaluatePriceAlert({ ...base, lastSide: -1, type: "drawing", value: "0", drawing }, 151, 0, 50);
    expect(crossed.side).toBe(1);
    expect(crossed.fire).toMatch(/↑/);
  });
});
