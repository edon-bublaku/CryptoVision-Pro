import type { Candle } from "@cv/core";
import { correlation, mean, stdev } from "@cv/core";

/**
 * Cross-asset analytics: correlation, beta, volatility, drawdown and relative rotation (RRG).
 * Pure functions over aligned close series, so the same numbers can be produced in the browser,
 * the worker or a test.
 */

export interface AssetSeries {
  symbol: string;
  candles: readonly Candle[];
}

export interface Aligned {
  times: number[];
  closes: Record<string, number[]>;
}

/** Keeps only the bar times every asset has, so returns line up day by day. */
export function alignCloses(series: readonly AssetSeries[]): Aligned {
  if (!series.length) return { times: [], closes: {} };
  const maps = series.map((s) => new Map(s.candles.map((c) => [c.time, c.close])));
  const times = [...maps[0]!.keys()].filter((t) => maps.every((m) => m.has(t))).sort((a, b) => a - b);
  const closes: Record<string, number[]> = {};
  series.forEach((s, i) => (closes[s.symbol] = times.map((t) => maps[i]!.get(t)!)));
  return { times, closes };
}

export function logReturns(closes: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) out.push(Math.log(closes[i]! / closes[i - 1]!));
  return out;
}

/** Pearson correlation of log returns over the last `lookback` bars, for every pair. */
export function correlationMatrix(closes: Record<string, number[]>, symbols: readonly string[], lookback: number): number[][] {
  const rets = symbols.map((s) => logReturns(closes[s] ?? []).slice(-lookback));
  return rets.map((a, i) => rets.map((b, j) => (i === j ? 1 : correlation(a, b))));
}

/** Orders symbols so that strongly correlated assets sit next to each other (greedy nearest neighbour). */
export function clusterOrder(symbols: readonly string[], matrix: number[][]): number[] {
  if (!symbols.length) return [];
  const avg = matrix.map((row) => mean(row));
  const left = new Set(symbols.map((_, i) => i));
  let cur = avg.indexOf(Math.max(...avg));
  const order = [cur];
  left.delete(cur);
  while (left.size) {
    let best = -1;
    let bestCorr = -Infinity;
    for (const j of left) {
      if (matrix[cur]![j]! > bestCorr) {
        bestCorr = matrix[cur]![j]!;
        best = j;
      }
    }
    order.push(best);
    left.delete(best);
    cur = best;
  }
  return order;
}

/** Sensitivity to the benchmark: cov(asset, bench) / var(bench), on log returns. */
export function beta(asset: readonly number[], bench: readonly number[], lookback: number): number {
  const a = logReturns(asset).slice(-lookback);
  const b = logReturns(bench).slice(-lookback);
  const n = Math.min(a.length, b.length);
  if (n < 3) return NaN;
  const xa = a.slice(-n);
  const xb = b.slice(-n);
  const ma = mean(xa);
  const mb = mean(xb);
  let cov = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    cov += (xa[i]! - ma) * (xb[i]! - mb);
    varB += (xb[i]! - mb) ** 2;
  }
  return varB === 0 ? NaN : cov / varB;
}

/** Annualised realised volatility in % (crypto trades 365 days a year). */
export function realizedVol(closes: readonly number[], lookback: number, periodsPerYear = 365): number {
  const r = logReturns(closes).slice(-lookback);
  return r.length < 2 ? NaN : stdev(r) * Math.sqrt(periodsPerYear) * 100;
}

/** Worst peak-to-trough fall within the last `lookback` bars, in % (negative). */
export function maxDrawdown(closes: readonly number[], lookback: number): number {
  const xs = closes.slice(-lookback);
  let peak = -Infinity;
  let worst = 0;
  for (const c of xs) {
    peak = Math.max(peak, c);
    worst = Math.min(worst, (c / peak - 1) * 100);
  }
  return worst;
}

export function periodReturn(closes: readonly number[], bars: number): number {
  if (closes.length <= bars) return NaN;
  return (closes[closes.length - 1]! / closes[closes.length - 1 - bars]! - 1) * 100;
}

export type Quadrant = "leading" | "weakening" | "lagging" | "improving";

export interface RrgPoint {
  time: number;
  ratio: number;
  momentum: number;
}

export function quadrantOf(p: Pick<RrgPoint, "ratio" | "momentum">): Quadrant {
  if (p.ratio >= 100) return p.momentum >= 100 ? "leading" : "weakening";
  return p.momentum >= 100 ? "improving" : "lagging";
}

function trailingSmaRatio(xs: readonly number[], window: number): number[] {
  let sum = 0;
  return xs.map((x, i) => {
    sum += x;
    if (i >= window) sum -= xs[i - window]!;
    return i + 1 < window ? NaN : (100 * x) / (sum / window);
  });
}

/**
 * Relative Rotation Graph coordinates (an open approximation of JdK RS-Ratio / RS-Momentum):
 * RS-Ratio = 100 · RS / SMA(RS) where RS = EMA₃(asset / benchmark), and RS-Momentum = 100 · Ratio /
 * SMA(Ratio). Above 100 means outperforming / gaining. Causal. Returns the last `tail` points.
 */
export function rrg(asset: readonly number[], bench: readonly number[], times: readonly number[], opts: { window?: number; momentumWindow?: number; tail?: number } = {}): RrgPoint[] {
  const window = opts.window ?? 21;
  const momentumWindow = opts.momentumWindow ?? 8;
  const n = Math.min(asset.length, bench.length, times.length);
  // A short EMA on relative strength removes day-to-day noise without adding look-ahead.
  const raw = Array.from({ length: n }, (_, i) => asset[i]! / bench[i]!);
  const k = 2 / (3 + 1);
  const rs: number[] = [];
  raw.forEach((v, i) => rs.push(i === 0 ? v : rs[i - 1]! + k * (v - rs[i - 1]!)));
  const ratio = trailingSmaRatio(rs, window);
  const from = ratio.findIndex(Number.isFinite);
  if (from < 0) return [];
  const mom = trailingSmaRatio(ratio.slice(from), momentumWindow);
  const out: RrgPoint[] = [];
  mom.forEach((m, k) => {
    if (Number.isFinite(m)) out.push({ time: times[k + from]!, ratio: ratio[k + from]!, momentum: m });
  });
  return out.slice(-(opts.tail ?? 8));
}

export interface AssetStats {
  symbol: string;
  last: number;
  ret7d: number;
  ret30d: number;
  ret90d: number;
  vol30d: number;
  beta: number;
  corrBench: number;
  maxDd90d: number;
  /** Return per unit of volatility over 90 bars (not annualised Sharpe). */
  riskAdjusted: number;
  rrg: RrgPoint[];
  quadrant: Quadrant | null;
}

/** All per-asset numbers for the market intelligence page, against `bench` (normally BTCUSDT). */
export function assetStats(aligned: Aligned, bench: string, lookback = 90): AssetStats[] {
  const b = aligned.closes[bench] ?? [];
  return Object.entries(aligned.closes).map(([symbol, c]) => {
    const r = rrg(c, b, aligned.times);
    const ret90 = periodReturn(c, Math.min(90, c.length - 1));
    const vol90 = realizedVol(c, 90);
    const lastPoint = r[r.length - 1];
    return {
      symbol,
      last: c[c.length - 1] ?? NaN,
      ret7d: periodReturn(c, 7),
      ret30d: periodReturn(c, 30),
      ret90d: ret90,
      vol30d: realizedVol(c, 30),
      beta: symbol === bench ? 1 : beta(c, b, lookback),
      corrBench: symbol === bench ? 1 : correlation(logReturns(c).slice(-lookback), logReturns(b).slice(-lookback)),
      maxDd90d: maxDrawdown(c, 90),
      riskAdjusted: vol90 > 0 ? ret90 / vol90 : NaN,
      rrg: symbol === bench ? [] : r,
      quadrant: symbol === bench || !lastPoint ? null : quadrantOf(lastPoint),
    };
  });
}
export * from "./seasonality";
