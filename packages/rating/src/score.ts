/** Maps raw metric values onto 0..100 scores. Every mapping is explicit so it can be shown and audited. */

/** Piecewise-linear through (x, score) knots, clamped at both ends. Knots must be sorted by x. */
export function lin(v: number, knots: readonly (readonly [number, number])[]): number {
  const first = knots[0]!;
  const last = knots[knots.length - 1]!;
  if (v <= first[0]) return first[1];
  if (v >= last[0]) return last[1];
  for (let k = 1; k < knots.length; k++) {
    const [x1, s1] = knots[k]!;
    const [x0, s0] = knots[k - 1]!;
    if (v <= x1) return s0 + ((v - x0) / (x1 - x0)) * (s1 - s0);
  }
  return last[1];
}

/** 50 at zero, approaching 0 / 100 for large negative / positive values; `scale` is where it reaches ≈ 88 / 12. */
export function sig(v: number, scale: number): number {
  return 50 + 50 * Math.tanh(v / scale);
}

export const fin = (v: number | undefined | null): v is number => v !== undefined && v !== null && Number.isFinite(v);
