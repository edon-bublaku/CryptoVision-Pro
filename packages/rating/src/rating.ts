import type { Candle } from "@cv/core";
import { mean, stdev } from "@cv/core";
import { quadrantOf, rrg, type RrgPoint } from "@cv/analytics";
import { supportResistance, type Level } from "@cv/indicators";
import { buildContext, structureTrendAt, type SeriesContext } from "@cv/signals";
import calibration from "./calibration.json";
import { fin, lin, sig } from "./score";

export { calibration };

/**
 * CV Rating: a 0–100 investment rating per coin on daily candles, built from 8 pillars and 25 metrics.
 * Each metric maps a raw value to 0..100 with an explicit curve and carries its own weight inside its
 * pillar; pillars carry user-adjustable weights. Everything is causal (bar i only uses bars ≤ i), so the
 * same code is used live and in the historical validation (scripts/validate-rating.ts).
 */

export const PILLAR_IDS = ["trend", "momentum", "relative", "volume", "risk", "structure", "liquidity", "sentiment"] as const;
export type PillarId = (typeof PILLAR_IDS)[number];
export type PillarWeights = Record<PillarId, number>;

/** A priori weights, chosen before looking at results; the baseline of the historical validation. */
export const BALANCED_WEIGHTS: PillarWeights = { trend: 22, momentum: 15, relative: 15, volume: 10, risk: 13, structure: 13, liquidity: 6, sentiment: 6 };

/**
 * Weights fitted by `pnpm validate:rating` on the first half of the history only (walk-forward) to rank
 * coins against each other; they beat the balanced weights at that on the second half. They ignore
 * market direction (trend gets ~0), so they are an option, not the default. See docs/strategies/rating.md.
 */
export const CALIBRATED_WEIGHTS: PillarWeights = { ...BALANCED_WEIGHTS, ...(calibration.calibrated?.weights as Partial<PillarWeights> | undefined) };

export const DEFAULT_WEIGHTS: PillarWeights = BALANCED_WEIGHTS;

export type PresetId = "calibrated" | "balanced" | "trend" | "momentum" | "conservative";

/** Ready-made weightings; users can also set their own. */
export const WEIGHT_PRESETS: Record<PresetId, PillarWeights> = {
  balanced: BALANCED_WEIGHTS,
  calibrated: CALIBRATED_WEIGHTS,
  trend: { trend: 32, momentum: 12, relative: 14, volume: 8, risk: 10, structure: 14, liquidity: 5, sentiment: 5 },
  momentum: { trend: 15, momentum: 28, relative: 22, volume: 12, risk: 8, structure: 8, liquidity: 4, sentiment: 3 },
  conservative: { trend: 18, momentum: 8, relative: 10, volume: 8, risk: 28, structure: 12, liquidity: 12, sentiment: 4 },
};

export interface RatingContext {
  candles: readonly Candle[];
  sc: SeriesContext;
  /** Benchmark close at the same bar time, when the benchmark has that bar. */
  benchClose: (number | undefined)[];
  rrgAt: (RrgPoint | undefined)[];
  fearGreed: (number | undefined)[];
  isBench: boolean;
}

export interface RatingInput {
  /** Closed daily candles, oldest first. */
  candles: readonly Candle[];
  /** Benchmark daily candles (BTCUSDT) for relative strength; omitted for the benchmark itself. */
  bench?: readonly Candle[];
  /** Fear & Greed history (time in seconds, value 0..100). */
  fearGreed?: readonly { time: number; value: number }[];
  isBench?: boolean;
}

const DAY = 86_400;

export function buildRatingContext(input: RatingInput): RatingContext {
  const { candles } = input;
  const sc = buildContext(candles);
  const benchByTime = new Map((input.bench ?? []).map((c) => [c.time, c.close]));
  const benchClose = candles.map((c) => benchByTime.get(c.time));
  const idx = candles.map((_, i) => i).filter((i) => benchClose[i] !== undefined);
  const rrgAt: (RrgPoint | undefined)[] = new Array(candles.length).fill(undefined);
  if (!input.isBench && idx.length > 40) {
    const pts = rrg(
      idx.map((i) => candles[i]!.close),
      idx.map((i) => benchClose[i]!),
      idx.map((i) => candles[i]!.time),
      { tail: Infinity },
    );
    const byTime = new Map(pts.map((p) => [p.time, p]));
    candles.forEach((c, i) => (rrgAt[i] = byTime.get(c.time)));
  }
  // F&G is published once per UTC day; use that day's value, else the previous day's.
  const fg = new Map((input.fearGreed ?? []).map((p) => [Math.floor(p.time / DAY), p.value]));
  const fearGreed = candles.map((c) => {
    const d = Math.floor(c.time / DAY);
    return fg.get(d) ?? fg.get(d - 1);
  });
  return { candles, sc, benchClose, rrgAt, fearGreed, isBench: !!input.isBench };
}

// ── Helpers (all use bars ≤ i only) ─────────────────────────────────────────

function ret(xs: readonly number[], i: number, n: number): number {
  return i - n >= 0 ? xs[i]! / xs[i - n]! - 1 : NaN;
}

function logRets(xs: readonly number[], i: number, n: number): number[] {
  const out: number[] = [];
  for (let k = Math.max(1, i - n + 1); k <= i; k++) out.push(Math.log(xs[k]! / xs[k - 1]!));
  return out;
}

function annualVol(xs: readonly number[], i: number, n: number): number {
  const r = logRets(xs, i, n);
  return r.length < Math.min(n, 10) ? NaN : stdev(r) * Math.sqrt(365) * 100;
}

function benchRet(r: RatingContext, i: number, n: number): number {
  const a = r.benchClose[i];
  const b = r.benchClose[i - n];
  return fin(a) && fin(b) ? a / b - 1 : NaN;
}

/** Nearest support below and resistance above the close, from pivots of the last 300 bars. */
export function levelsAt(r: RatingContext, i: number): { supports: number[]; resistances: number[]; levels: Level[] } {
  const c = r.candles[i]!.close;
  const levels = supportResistance(r.candles.slice(Math.max(0, i - 300), i + 1), { maxLevels: 12 });
  return {
    levels,
    supports: levels.map((l) => l.price).filter((p) => p < c).sort((a, b) => b - a),
    resistances: levels.map((l) => l.price).filter((p) => p > c).sort((a, b) => a - b),
  };
}

// ── Metrics ─────────────────────────────────────────────────────────────────

/** Unit of the raw value, so the UI can format it. */
export type MetricUnit = "pct" | "ratio" | "index" | "count" | "usd" | "state";

interface MetricDef {
  id: string;
  pillar: PillarId;
  weight: number;
  unit: MetricUnit;
  /** Raw value and its 0..100 score, or null when the data isn't available at bar i. */
  compute(r: RatingContext, i: number): { value: number; score: number } | null;
}

export const METRICS: MetricDef[] = [
  // Trend
  {
    id: "ema_alignment",
    pillar: "trend",
    weight: 3,
    unit: "count",
    compute: ({ sc }, i) => {
      const c = sc.close[i]!;
      const [a, b, d] = [sc.ema20[i], sc.ema50[i], sc.ema200[i]];
      if (!fin(a) || !fin(b) || !fin(d)) return null;
      const n = +(c > a) + +(a > b) + +(b > d) + +(c > d);
      return { value: n, score: lin(n, [[0, 5], [4, 95]]) };
    },
  },
  {
    id: "ema200_slope",
    pillar: "trend",
    weight: 2,
    unit: "pct",
    compute: ({ sc }, i) => {
      const v = (sc.ema200[i]! / sc.ema200[i - 20]! - 1) * 100;
      return fin(v) ? { value: v, score: sig(v, 4) } : null;
    },
  },
  {
    id: "golden_cross",
    pillar: "trend",
    weight: 1.5,
    unit: "pct",
    compute: ({ sc }, i) => {
      const v = (sc.ema50[i]! / sc.ema200[i]! - 1) * 100;
      return fin(v) ? { value: v, score: sig(v, 10) } : null;
    },
  },
  {
    id: "adx_trend",
    pillar: "trend",
    weight: 1.5,
    unit: "index",
    compute: ({ sc }, i) => {
      const [a, p, m] = [sc.adx.adx[i], sc.adx.plusDI[i], sc.adx.minusDI[i]];
      if (!fin(a) || !fin(p) || !fin(m)) return null;
      const strength = lin(a, [[15, 0], [40, 1]]);
      return { value: a * Math.sign(p - m), score: 50 + 45 * Math.sign(p - m) * strength };
    },
  },
  {
    id: "supertrend",
    pillar: "trend",
    weight: 1,
    unit: "state",
    compute: ({ sc }, i) => {
      const d = sc.supertrend.direction[i];
      if (!d) return null;
      const fresh = sc.supertrend.direction[i - 5] !== d;
      return { value: d, score: d > 0 ? (fresh ? 85 : 75) : fresh ? 15 : 25 };
    },
  },
  // Momentum
  {
    id: "rsi",
    pillar: "momentum",
    weight: 2,
    unit: "index",
    compute: ({ sc }, i) => {
      const v = sc.rsi[i];
      // Strong but not exhausted momentum scores best; deep oversold is only a mild positive.
      return fin(v) ? { value: v, score: lin(v, [[20, 30], [30, 35], [45, 50], [55, 70], [65, 85], [72, 75], [80, 45], [90, 25]]) } : null;
    },
  },
  {
    id: "roc_30",
    pillar: "momentum",
    weight: 2,
    unit: "pct",
    compute: ({ sc }, i) => {
      const v = ret(sc.close, i, 30) * 100;
      return fin(v) ? { value: v, score: sig(v, 25) } : null;
    },
  },
  {
    id: "roc_90",
    pillar: "momentum",
    weight: 1.5,
    unit: "pct",
    compute: ({ sc }, i) => {
      const v = ret(sc.close, i, 90) * 100;
      return fin(v) ? { value: v, score: sig(v, 50) } : null;
    },
  },
  {
    id: "macd",
    pillar: "momentum",
    weight: 1.5,
    unit: "ratio",
    compute: ({ sc }, i) => {
      const h = sc.macd.histogram[i];
      const hp = sc.macd.histogram[i - 1];
      if (!fin(h) || !fin(hp)) return null;
      const rising = h > hp;
      return { value: (h / sc.close[i]!) * 100, score: h > 0 ? (rising ? 80 : 62) : rising ? 40 : 20 };
    },
  },
  // Relative strength vs benchmark
  {
    id: "rs_30",
    pillar: "relative",
    weight: 2,
    unit: "pct",
    compute: (r, i) => {
      if (r.isBench) return null;
      const v = (ret(r.sc.close, i, 30) - benchRet(r, i, 30)) * 100;
      return fin(v) ? { value: v, score: sig(v, 20) } : null;
    },
  },
  {
    id: "rs_90",
    pillar: "relative",
    weight: 1.5,
    unit: "pct",
    compute: (r, i) => {
      if (r.isBench) return null;
      const v = (ret(r.sc.close, i, 90) - benchRet(r, i, 90)) * 100;
      return fin(v) ? { value: v, score: sig(v, 40) } : null;
    },
  },
  {
    id: "rrg",
    pillar: "relative",
    weight: 1.5,
    unit: "state",
    compute: (r, i) => {
      const p = r.rrgAt[i];
      if (!p) return null;
      const q = quadrantOf(p);
      const score = { leading: 85, improving: 62, weakening: 40, lagging: 18 }[q];
      return { value: ["lagging", "improving", "weakening", "leading"].indexOf(q), score };
    },
  },
  // Volume / flow
  {
    id: "obv_trend",
    pillar: "volume",
    weight: 1.5,
    unit: "state",
    compute: ({ sc }, i) => {
      const [o, e, o10] = [sc.obv[i], sc.obvEma[i], sc.obv[i - 10]];
      if (!fin(o) || !fin(e) || !fin(o10)) return null;
      const v = Math.sign(o - e) + Math.sign(o - o10);
      return { value: v, score: 50 + 20 * v };
    },
  },
  {
    id: "cmf",
    pillar: "volume",
    weight: 1.5,
    unit: "ratio",
    compute: ({ sc }, i) => (fin(sc.cmf[i]) ? { value: sc.cmf[i]!, score: sig(sc.cmf[i]!, 0.15) } : null),
  },
  {
    id: "updown_volume",
    pillar: "volume",
    weight: 1.5,
    unit: "ratio",
    compute: ({ candles }, i) => {
      if (i < 31) return null;
      let up = 0;
      let down = 0;
      for (let k = i - 29; k <= i; k++) {
        const v = candles[k]!.volume;
        if (candles[k]!.close >= candles[k - 1]!.close) up += v;
        else down += v;
      }
      if (!(down > 0)) return null;
      const v = up / down;
      return { value: v, score: sig(Math.log(v), 0.5) };
    },
  },
  {
    id: "taker_buy",
    pillar: "volume",
    weight: 1,
    unit: "pct",
    compute: ({ candles }, i) => {
      let b = 0;
      let v = 0;
      for (let k = Math.max(0, i - 13); k <= i; k++) {
        const c = candles[k]!;
        if (!fin(c.takerBuyVolume) || !(c.volume > 0)) return null;
        b += c.takerBuyVolume;
        v += c.volume;
      }
      const share = (b / v) * 100;
      return { value: share, score: sig(share - 50, 3) };
    },
  },
  // Risk (higher score = calmer, better risk-adjusted)
  {
    id: "volatility",
    pillar: "risk",
    weight: 2,
    unit: "pct",
    compute: ({ sc }, i) => {
      const v = annualVol(sc.close, i, 30);
      return fin(v) ? { value: v, score: lin(v, [[20, 95], [40, 85], [60, 70], [90, 50], [130, 30], [200, 10]]) } : null;
    },
  },
  {
    id: "drawdown_90",
    pillar: "risk",
    weight: 1.5,
    unit: "pct",
    compute: ({ sc }, i) => {
      if (i < 90) return null;
      let peak = -Infinity;
      let worst = 0;
      for (let k = i - 89; k <= i; k++) {
        peak = Math.max(peak, sc.close[k]!);
        worst = Math.min(worst, (sc.close[k]! / peak - 1) * 100);
      }
      return { value: worst, score: lin(worst, [[-70, 5], [-50, 20], [-35, 40], [-20, 65], [-10, 85], [0, 100]]) };
    },
  },
  {
    id: "risk_adjusted",
    pillar: "risk",
    weight: 2,
    unit: "ratio",
    compute: ({ sc }, i) => {
      const r90 = ret(sc.close, i, 90) * 100;
      const v90 = annualVol(sc.close, i, 90);
      if (!fin(r90) || !(v90 > 0)) return null;
      const v = r90 / v90;
      return { value: v, score: sig(v, 0.6) };
    },
  },
  // Structure
  {
    id: "market_structure",
    pillar: "structure",
    weight: 2,
    unit: "state",
    compute: ({ sc }, i) => {
      const { trend } = structureTrendAt(sc, i);
      const v = trend === "bullish" ? 1 : trend === "bearish" ? -1 : 0;
      return { value: v, score: 50 + 30 * v };
    },
  },
  {
    id: "high_52w",
    pillar: "structure",
    weight: 1.5,
    unit: "pct",
    compute: ({ candles }, i) => {
      if (i < 120) return null;
      let hi = -Infinity;
      for (let k = Math.max(0, i - 364); k <= i; k++) hi = Math.max(hi, candles[k]!.high);
      const v = (candles[i]!.close / hi - 1) * 100;
      return { value: v, score: lin(v, [[-80, 10], [-50, 25], [-30, 45], [-15, 65], [-5, 80], [0, 85]]) };
    },
  },
  {
    id: "reward_risk",
    pillar: "structure",
    weight: 1.5,
    unit: "ratio",
    compute: (r, i) => {
      if (i < 60) return null;
      const c = r.candles[i]!.close;
      const { supports, resistances } = levelsAt(r, i);
      const sup = supports[0];
      const res = resistances[0];
      // No resistance overhead = price discovery; no support underneath = nothing to lean on.
      if (sup === undefined) return { value: NaN, score: 35 };
      if (res === undefined) return { value: Infinity, score: 75 };
      const v = (res - c) / Math.max(c - sup, c * 0.002);
      return { value: v, score: lin(v, [[0.3, 15], [0.7, 35], [1, 50], [2, 70], [3, 82], [5, 90]]) };
    },
  },
  // Liquidity
  {
    id: "liquidity",
    pillar: "liquidity",
    weight: 1,
    unit: "usd",
    compute: ({ candles }, i) => {
      const xs: number[] = [];
      for (let k = Math.max(0, i - 29); k <= i; k++) xs.push(candles[k]!.quoteVolume ?? candles[k]!.close * candles[k]!.volume);
      const v = mean(xs);
      return v > 0 ? { value: v, score: lin(Math.log10(v), [[6, 20], [7, 45], [8, 70], [9, 90], [10, 100]]) } : null;
    },
  },
  // Sentiment (contrarian: fear is historically a better time to buy than greed)
  {
    id: "fear_greed",
    pillar: "sentiment",
    weight: 1,
    unit: "index",
    compute: (r, i) => {
      const v = r.fearGreed[i];
      return fin(v) ? { value: v, score: lin(v, [[0, 80], [20, 70], [45, 52], [55, 48], [75, 35], [90, 22], [100, 15]]) } : null;
    },
  },
  {
    id: "momentum_breadth",
    pillar: "momentum",
    weight: 1,
    unit: "count",
    compute: ({ sc }, i) => {
      if (i < 30) return null;
      // Share of up-closes in the last 30 days: persistent buying vs one big candle.
      let up = 0;
      for (let k = i - 29; k <= i; k++) if (sc.close[k]! > sc.close[k - 1]!) up++;
      return { value: up, score: lin(up, [[9, 15], [13, 35], [15, 50], [17, 65], [21, 88]]) };
    },
  },
];

// ── Rating ──────────────────────────────────────────────────────────────────

export interface MetricResult {
  id: string;
  pillar: PillarId;
  unit: MetricUnit;
  weight: number;
  value: number;
  score: number;
}

export interface PillarResult {
  id: PillarId;
  /** Share of the total (0..1) after renormalising over available pillars. */
  weight: number;
  score: number;
  metrics: MetricResult[];
}

export type Verdict = "STRONG_ACCUMULATE" | "ACCUMULATE" | "HOLD" | "REDUCE" | "AVOID";
export type Grade = "A+" | "A" | "B" | "C" | "D" | "F";

export interface Rating {
  time: number;
  price: number;
  score: number;
  grade: Grade;
  verdict: Verdict;
  pillars: PillarResult[];
  /** Share of the configured weight that had data (0..1). */
  coverage: number;
  /** How much the pillars agree with each other (0..1). */
  agreement: number;
  confidence: number;
}

export const VERDICT_THRESHOLDS = { strongAccumulate: 75, accumulate: 60, hold: 45, reduce: 30 } as const;

export function verdictOf(score: number): Verdict {
  if (score >= VERDICT_THRESHOLDS.strongAccumulate) return "STRONG_ACCUMULATE";
  if (score >= VERDICT_THRESHOLDS.accumulate) return "ACCUMULATE";
  if (score >= VERDICT_THRESHOLDS.hold) return "HOLD";
  if (score >= VERDICT_THRESHOLDS.reduce) return "REDUCE";
  return "AVOID";
}

export function gradeOf(score: number): Grade {
  if (score >= 85) return "A+";
  if (score >= 75) return "A";
  if (score >= 62) return "B";
  if (score >= 48) return "C";
  if (score >= 35) return "D";
  return "F";
}

/** Minimum history for a meaningful rating (EMA200 + a 20-bar slope). */
export const MIN_BARS = 230;

/** Rating at bar i (defaults to the last bar). Returns null with too little history. */
export function rateAt(r: RatingContext, i = r.candles.length - 1, weights: PillarWeights = DEFAULT_WEIGHTS): Rating | null {
  if (i < MIN_BARS - 1) return null;
  const byPillar = new Map<PillarId, MetricResult[]>();
  for (const m of METRICS) {
    const out = m.compute(r, i);
    if (!out || !Number.isFinite(out.score)) continue;
    const list = byPillar.get(m.pillar) ?? [];
    list.push({ id: m.id, pillar: m.pillar, unit: m.unit, weight: m.weight, value: out.value, score: Math.max(0, Math.min(100, out.score)) });
    byPillar.set(m.pillar, list);
  }
  const totalWeight = PILLAR_IDS.reduce((s, p) => s + Math.max(0, weights[p] ?? 0), 0);
  let used = 0;
  const raw: { id: PillarId; w: number; score: number; metrics: MetricResult[] }[] = [];
  for (const p of PILLAR_IDS) {
    const ms = byPillar.get(p);
    const w = Math.max(0, weights[p] ?? 0);
    if (!ms?.length || w === 0) continue;
    const mw = ms.reduce((s, m) => s + m.weight, 0);
    raw.push({ id: p, w, score: ms.reduce((s, m) => s + m.score * m.weight, 0) / mw, metrics: ms });
    used += w;
  }
  if (!used) return null;
  const score = raw.reduce((s, p) => s + p.score * p.w, 0) / used;
  const coverage = totalWeight ? used / totalWeight : 0;
  const agreement = raw.length > 1 ? Math.max(0, 1 - stdev(raw.map((p) => p.score)) / 30) : 0.5;
  return {
    time: r.candles[i]!.time,
    price: r.candles[i]!.close,
    score,
    grade: gradeOf(score),
    verdict: verdictOf(score),
    pillars: raw.map((p) => ({ id: p.id, weight: p.w / used, score: p.score, metrics: p.metrics })),
    coverage,
    agreement,
    confidence: Math.round(((coverage + agreement) / 2) * 100) / 100,
  };
}

export function rateCoin(input: RatingInput, weights?: PillarWeights): Rating | null {
  return rateAt(buildRatingContext(input), input.candles.length - 1, weights);
}
