export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function last<T>(arr: readonly T[], offset = 0): T | undefined {
  return arr[arr.length - 1 - offset];
}

/** Last finite value of a series (indicator warm-up produces NaN). */
export function lastFinite(arr: readonly number[], offset = 0): number {
  const v = arr[arr.length - 1 - offset];
  return v === undefined ? NaN : v;
}

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function median(xs: readonly number[]): number {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
}

export function stdev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return Math.sqrt(s / (xs.length - 1));
}

/** Percentile rank (0..1) of `value` within `xs`. */
export function percentileRank(xs: readonly number[], value: number): number {
  const finite = xs.filter(Number.isFinite);
  if (finite.length === 0) return 0.5;
  let below = 0;
  for (const x of finite) if (x < value) below++;
  return below / finite.length;
}

export function pctChange(from: number, to: number): number {
  return from === 0 ? 0 : ((to - from) / from) * 100;
}

/** Pearson correlation of two equally long series. */
export function correlation(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const xa = a.slice(-n);
  const xb = b.slice(-n);
  const ma = mean(xa);
  const mb = mean(xb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = xa[i]! - ma;
    const y = xb[i]! - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
}

/** Deterministic PRNG (mulberry32) so Monte Carlo results are reproducible. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
