import { describe, expect, it } from "vitest";
import { resolveWeights } from "./alerts";
import { WEIGHT_PRESETS } from "./rating";
import { capWeights } from "./recommend";

/** Calculation defects found in the audit; each test pins the corrected behaviour. */
describe("capWeights (water-filling)", () => {
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  it("invests fully when a valid capped allocation exists", () => {
    const w = capWeights([100, 1, 1, 1, 1, 1], 0.35);
    expect(sum(w)).toBeCloseTo(1, 12);
    expect(w[0]).toBeCloseTo(0.35, 12);
    for (const x of w.slice(1)) expect(x).toBeCloseTo(0.13, 12);
  });
  it("caps again when the redistributed remainder pushes another coin over", () => {
    // 10 is capped; the 0.65 left splits 1:3 → 0.1625 / 0.4875, so 3 is capped too and 1 takes 0.30.
    const w = capWeights([10, 1, 3], 0.35);
    expect(w[0]).toBeCloseTo(0.35, 12);
    expect(w[1]).toBeCloseTo(0.3, 12);
    expect(w[2]).toBeCloseTo(0.35, 12);
  });
  it("splits in proportion when no cap binds", () => {
    const w = capWeights([1, 1, 2], 0.6);
    expect(w).toEqual([0.25, 0.25, 0.5]);
  });
  it("leaves the rest in cash only when every coin is capped", () => {
    expect(sum(capWeights([1, 1], 0.35))).toBeCloseTo(0.7, 12);
  });
  it("ignores non-positive weights", () => {
    expect(capWeights([0, -1, 2], 0.6)).toEqual([0, 0, 0.6]);
  });
});

describe("resolveWeights", () => {
  it("doesn't resolve inherited object keys as presets", () => {
    for (const k of ["constructor", "toString", "__proto__", "hasOwnProperty"]) expect(resolveWeights(k)).toEqual(WEIGHT_PRESETS.balanced);
  });
});
