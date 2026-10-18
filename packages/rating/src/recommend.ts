import { correlation, mean, stdev } from "@cv/core";
import { investmentPlan, type InvestmentPlan, type PlanSettings } from "./plan";
import { DEFAULT_WEIGHTS, rateAt, type PillarId, type PillarWeights, type Rating, type RatingContext } from "./rating";
import { fin } from "./score";

/**
 * Model-portfolio recommender built on the CV Rating. Deterministic rules, no fitting:
 * 1. Market regime from BTC vs its EMA200 and breadth (share of coins above their EMA50) decides how
 *    much of the capital to invest at all; the rest stays in cash.
 * 2. Candidates are coins rated ≥ `minScore` and not wildly volatile, taken best first.
 * 3. A coin is skipped when its 90-day return correlation with an already chosen coin exceeds
 *    `maxCorrelation`, so the portfolio isn't five copies of the same bet.
 * 4. Weights are inverse-volatility tilted by rating, capped per coin, then scaled by the regime exposure.
 * Every step is causal, so `scripts/validate-rating.ts` replays it month by month on history.
 */

export type Regime = "risk_on" | "neutral" | "risk_off";

export interface RecommendSettings {
  /** Number of coins to hold at most. */
  maxPositions: number;
  /** Minimum CV Rating to be considered. */
  minScore: number;
  /** Skip coins more correlated than this with one already chosen. */
  maxCorrelation: number;
  /** Cap per coin, as a share of the invested part (0..1). */
  maxWeight: number;
  /** Skip coins whose 30-day annualised volatility (%) is above this: too wild for a model portfolio. */
  maxVol: number;
  /** Share of capital invested in each regime (0..1). */
  exposure: Record<Regime, number>;
  weights?: PillarWeights;
}

export const DEFAULT_RECOMMEND: RecommendSettings = {
  maxPositions: 6,
  minScore: 58,
  maxCorrelation: 0.85,
  maxWeight: 0.35,
  maxVol: 200,
  exposure: { risk_on: 1, neutral: 0.6, risk_off: 0.25 },
};

export interface MarketState {
  regime: Regime;
  exposure: number;
  btcAboveEma200: boolean;
  btcEma200Distance: number;
  /** Share of rated coins whose close is above their EMA50 (0..1). */
  breadth: number;
  avgScore: number;
  rated: number;
}

export interface Pick {
  symbol: string;
  rating: Rating;
  /** Share of total capital (0..1), already scaled by the regime exposure. */
  weight: number;
  vol30: number;
  /** Strongest and weakest pillars, for the "why". */
  strengths: PillarId[];
  watch: PillarId | null;
  plan?: InvestmentPlan;
}

export type ExclusionReason = "low_score" | "too_volatile" | "correlated" | "full" | "no_data";

export interface Exclusion {
  symbol: string;
  reason: ExclusionReason;
  score?: number;
  /** For "correlated": the chosen coin it moves with, and how strongly. */
  with?: string;
  rho?: number;
}

export interface Recommendation {
  market: MarketState;
  picks: Pick[];
  cash: number;
  excluded: Exclusion[];
}

export interface Candidate {
  symbol: string;
  ctx: RatingContext;
  /** Bar index to evaluate (defaults to the last bar). */
  i?: number;
}

function logReturns(xs: readonly number[], end: number, n: number): number[] {
  const out: number[] = [];
  for (let k = Math.max(1, end - n + 1); k <= end; k++) out.push(Math.log(xs[k]! / xs[k - 1]!));
  return out;
}

/**
 * Log returns of `a` and `b` over the last `n` bars of `a` (up to ia), matched by timestamp, so a
 * day missing on one coin (halt, late listing) never pairs returns from different days.
 */
function alignedReturns(a: RatingContext, ia: number, b: RatingContext, ib: number, n: number): [number[], number[]] {
  const bClose = new Map<number, number>();
  for (let k = 0; k <= ib; k++) bClose.set(b.candles[k]!.time, b.sc.close[k]!);
  const pa: number[] = [];
  const pb: number[] = [];
  for (let k = Math.max(0, ia - n); k <= ia; k++) {
    const t = a.candles[k]!.time;
    const cb = bClose.get(t);
    if (cb === undefined) continue;
    pa.push(a.sc.close[k]!);
    pb.push(cb);
  }
  const ra: number[] = [];
  const rb: number[] = [];
  for (let k = 1; k < pa.length; k++) {
    ra.push(Math.log(pa[k]! / pa[k - 1]!));
    rb.push(Math.log(pb[k]! / pb[k - 1]!));
  }
  return [ra, rb];
}

/**
 * Normalises raw weights to sum to 1 with no weight above `cap` (water-filling): capped coins are
 * fixed at the cap and the rest is shared among the others in proportion, until nothing exceeds it.
 * When every coin is capped (n × cap < 1) the weights sum to n × cap and the rest is cash.
 */
export function capWeights(raw: readonly number[], cap: number): number[] {
  const out = raw.map(() => 0);
  let free = raw.map((_, k) => k).filter((k) => raw[k]! > 0);
  let budget = 1;
  while (free.length && budget > 1e-12) {
    const total = free.reduce((a, k) => a + raw[k]!, 0);
    const over = free.filter((k) => (raw[k]! / total) * budget > cap);
    if (!over.length) {
      for (const k of free) out[k] = (raw[k]! / total) * budget;
      break;
    }
    for (const k of over) out[k] = cap;
    budget -= cap * over.length;
    free = free.filter((k) => !over.includes(k));
  }
  return out;
}

export function marketState(rows: { ctx: RatingContext; i: number; rating: Rating }[], bench: { ctx: RatingContext; i: number } | undefined, s: RecommendSettings): MarketState {
  const above50 = rows.filter(({ ctx, i }) => fin(ctx.sc.ema50[i]) && ctx.sc.close[i]! > ctx.sc.ema50[i]!).length;
  const breadth = rows.length ? above50 / rows.length : 0;
  const bc = bench ? bench.ctx.sc.close[bench.i]! : NaN;
  const be = bench ? bench.ctx.sc.ema200[bench.i] : undefined;
  const dist = fin(be) ? (bc / be - 1) * 100 : NaN;
  const above = dist > 0;
  const regime: Regime = above && breadth >= 0.5 ? "risk_on" : !above && breadth < 0.35 ? "risk_off" : "neutral";
  return { regime, exposure: s.exposure[regime], btcAboveEma200: above, btcEma200Distance: dist, breadth, avgScore: mean(rows.map((r) => r.rating.score)), rated: rows.length };
}

export function recommend(
  candidates: readonly Candidate[],
  bench: Candidate | undefined,
  opts: Partial<RecommendSettings> & { plan?: PlanSettings } = {},
): Recommendation {
  const s: RecommendSettings = { ...DEFAULT_RECOMMEND, ...opts, exposure: { ...DEFAULT_RECOMMEND.exposure, ...opts.exposure } };
  const weights = s.weights ?? DEFAULT_WEIGHTS;
  const excluded: Exclusion[] = [];
  const rows: { symbol: string; ctx: RatingContext; i: number; rating: Rating }[] = [];
  for (const c of candidates) {
    const i = c.i ?? c.ctx.candles.length - 1;
    const rating = rateAt(c.ctx, i, weights);
    if (rating) rows.push({ symbol: c.symbol, ctx: c.ctx, i, rating });
    else excluded.push({ symbol: c.symbol, reason: "no_data" });
  }
  const market = marketState(rows, bench ? { ctx: bench.ctx, i: bench.i ?? bench.ctx.candles.length - 1 } : undefined, s);

  rows.sort((a, b) => b.rating.score - a.rating.score);
  const chosen: (typeof rows)[number][] = [];
  for (const r of rows) {
    if (r.rating.score < s.minScore) {
      excluded.push({ symbol: r.symbol, reason: "low_score", score: r.rating.score });
      continue;
    }
    const vol = stdev(logReturns(r.ctx.sc.close, r.i, 30)) * Math.sqrt(365) * 100;
    if (vol > s.maxVol) {
      excluded.push({ symbol: r.symbol, reason: "too_volatile", score: r.rating.score });
      continue;
    }
    if (chosen.length >= s.maxPositions) {
      excluded.push({ symbol: r.symbol, reason: "full", score: r.rating.score });
      continue;
    }
    let worst: { with: string; rho: number } | null = null;
    for (const c of chosen) {
      const rho = correlation(...alignedReturns(r.ctx, r.i, c.ctx, c.i, 90));
      if (rho > s.maxCorrelation && (!worst || rho > worst.rho)) worst = { with: c.symbol, rho };
    }
    if (worst) {
      excluded.push({ symbol: r.symbol, reason: "correlated", score: r.rating.score, ...worst });
      continue;
    }
    chosen.push(r);
  }

  // Inverse volatility × rating tilt, capped, normalised to the regime exposure.
  const raw = chosen.map((c) => {
    const vol = stdev(logReturns(c.ctx.sc.close, c.i, 30)) * Math.sqrt(365) * 100;
    // Tilt is 0 at a score of 50, so a caller-supplied minScore below 50 can't make weights negative.
    return { c, vol, w: (1 / Math.max(vol, 10)) * Math.max(0, (c.rating.score - 50) / 50) };
  });
  const w = capWeights(
    raw.map((x) => x.w),
    s.maxWeight,
  );
  const picks: Pick[] = raw.map(({ c, vol }, k) => {
    const ordered = [...c.rating.pillars].sort((a, b) => b.score - a.score);
    const weakest = ordered[ordered.length - 1];
    return {
      symbol: c.symbol,
      rating: c.rating,
      weight: w[k]! * market.exposure,
      vol30: vol,
      strengths: ordered.slice(0, 2).map((p) => p.id),
      watch: weakest && weakest.score < 45 ? weakest.id : null,
      plan: opts.plan ? investmentPlan(c.rating, c.ctx, opts.plan, c.i) : undefined,
    };
  });
  return { market, picks, cash: 1 - picks.reduce((a, p) => a + p.weight, 0), excluded };
}
