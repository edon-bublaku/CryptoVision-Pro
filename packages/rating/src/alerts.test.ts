import { describe, expect, it } from "vitest";
import { checkRatingAlert, resolveWeights } from "./alerts";
import { WEIGHT_PRESETS } from "./rating";

describe("resolveWeights", () => {
  it("returns presets by id and falls back to balanced", () => {
    expect(resolveWeights("trend")).toEqual(WEIGHT_PRESETS.trend);
    expect(resolveWeights("nope")).toEqual(WEIGHT_PRESETS.balanced);
    expect(resolveWeights(undefined)).toEqual(WEIGHT_PRESETS.balanced);
  });

  it("uses sanitised custom weights", () => {
    const w = resolveWeights("custom", { trend: 50, momentum: -3, risk: "x", sentiment: 10 });
    expect(w.trend).toBe(50);
    expect(w.momentum).toBe(0);
    expect(w.risk).toBe(0);
    expect(w.sentiment).toBe(10);
  });

  it("ignores custom weights that are all zero", () => {
    expect(resolveWeights("custom", { trend: 0 })).toEqual(WEIGHT_PRESETS.balanced);
  });
});

describe("checkRatingAlert", () => {
  it("fires once on entering the zone and re-arms after leaving", () => {
    let side: -1 | 1 | undefined;
    const fired: number[] = [];
    for (const score of [55, 58, 61, 64, 62, 57, 60]) {
      const r = checkRatingAlert("rating_above", 60, score, side);
      if (r.fire) fired.push(score);
      side = r.side;
    }
    expect(fired).toEqual([61, 60]);
  });

  it("fires immediately when created inside the zone", () => {
    expect(checkRatingAlert("rating_below", 40, 35, undefined)).toEqual({ fire: true, side: 1 });
    expect(checkRatingAlert("rating_below", 40, 45, undefined)).toEqual({ fire: false, side: -1 });
  });
});
