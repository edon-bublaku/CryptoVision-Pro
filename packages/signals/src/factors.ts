import type { FactorCategory, FactorResult, MarketRegime } from "@cv/core";
import { clamp } from "@cv/core";
import { candlePatternsAt } from "@cv/indicators";
import { structureTrendAt, type SeriesContext } from "./context";

export interface FactorEnv {
  regime: MarketRegime;
  /** -1..1 trend score of the higher timeframe, if known. */
  htfScore?: number;
  /** Fear & Greed index 0..100, if known. */
  fearGreed?: number;
  /** Contrarian derivatives positioning bias -1..1 (funding, long/short, OI), live only. */
  derivativesBias?: number;
  /** Nearest support / resistance known at this bar. */
  support?: number;
  resistance?: number;
}

type FactorFn = (ctx: SeriesContext, i: number, env: FactorEnv) => Omit<FactorResult, "id" | "category" | "weight"> | null;

interface FactorDef {
  id: string;
  category: FactorCategory;
  weight: number;
  fn: FactorFn;
}

const fin = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v);
const f2 = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));

/**
 * Factor library. Each returns a score in [-1, 1] plus a translation key (`label`)
 * and a short human explanation with the actual numbers that produced it.
 */
export const FACTORS: FactorDef[] = [
  {
    id: "ema_stack",
    category: "trend",
    weight: 1.5,
    fn: (ctx, i) => {
      const c = ctx.close[i]!;
      const [a, b, d] = [ctx.ema20[i], ctx.ema50[i], ctx.ema200[i]];
      if (!fin(a) || !fin(b) || !fin(d)) return null;
      let s = 0;
      s += c > a ? 0.25 : -0.25;
      s += a > b ? 0.25 : -0.25;
      s += b > d ? 0.25 : -0.25;
      s += c > d ? 0.25 : -0.25;
      return { score: s, label: "factor.ema_stack", explanation: `Close ${f2(c)} · EMA20 ${f2(a)} · EMA50 ${f2(b)} · EMA200 ${f2(d)}` };
    },
  },
  {
    id: "supertrend",
    category: "trend",
    weight: 1,
    fn: (ctx, i) => {
      const d = ctx.supertrend.direction[i];
      if (!d) return null;
      const flipped = ctx.supertrend.direction[i - 1] !== d;
      return { score: d * (flipped ? 1 : 0.7), label: d > 0 ? "factor.supertrend_up" : "factor.supertrend_down", explanation: `SuperTrend(10,3) ${f2(ctx.supertrend.line[i]!)}${flipped ? " · flip" : ""}` };
    },
  },
  {
    id: "adx_dmi",
    category: "trend",
    weight: 1,
    fn: (ctx, i) => {
      const a = ctx.adx.adx[i];
      const p = ctx.adx.plusDI[i];
      const m = ctx.adx.minusDI[i];
      if (!fin(a) || !fin(p) || !fin(m)) return null;
      const strength = a < 18 ? 0 : clamp((a - 18) / 22, 0.2, 1);
      return { score: Math.sign(p - m) * strength, label: "factor.adx_dmi", explanation: `ADX ${f2(a)} · +DI ${f2(p)} · −DI ${f2(m)}` };
    },
  },
  {
    id: "ichimoku",
    category: "trend",
    weight: 0.8,
    fn: (ctx, i) => {
      const d = ctx.ichimoku.displacement;
      const sa = ctx.ichimoku.spanA[i - d];
      const sb = ctx.ichimoku.spanB[i - d];
      const t = ctx.ichimoku.tenkan[i];
      const k = ctx.ichimoku.kijun[i];
      if (!fin(sa) || !fin(sb) || !fin(t) || !fin(k)) return null;
      const c = ctx.close[i]!;
      const top = Math.max(sa, sb);
      const bot = Math.min(sa, sb);
      let s = c > top ? 0.6 : c < bot ? -0.6 : 0;
      s += t > k ? 0.4 : t < k ? -0.4 : 0;
      return { score: s, label: "factor.ichimoku", explanation: `Cloud ${f2(bot)}–${f2(top)} · Tenkan ${f2(t)} / Kijun ${f2(k)}` };
    },
  },
  {
    id: "rsi",
    category: "momentum",
    weight: 1.2,
    fn: (ctx, i, env) => {
      const r = ctx.rsi[i];
      const p = ctx.rsi[i - 2];
      if (!fin(r) || !fin(p)) return null;
      const rising = r > p;
      let s: number;
      if (r < 30) s = rising ? 0.7 : 0.3;
      else if (r > 70) s = rising ? -0.3 : -0.7;
      else if (env.regime === "TRENDING_UP") s = r >= 45 ? 0.4 : r >= 38 ? (rising ? 0.6 : 0.1) : -0.2;
      else if (env.regime === "TRENDING_DOWN") s = r <= 55 ? -0.4 : r <= 62 ? (rising ? -0.1 : -0.6) : 0.2;
      else s = ((r - 50) / 20) * (rising ? 0.5 : 0.3);
      return { score: clamp(s, -1, 1), label: "factor.rsi", explanation: `RSI(14) ${f2(r)} ${rising ? "↑" : "↓"}` };
    },
  },
  {
    id: "macd",
    category: "momentum",
    weight: 1,
    fn: (ctx, i) => {
      const h = ctx.macd.histogram[i];
      const hp = ctx.macd.histogram[i - 1];
      const m = ctx.macd.macd[i];
      if (!fin(h) || !fin(hp) || !fin(m)) return null;
      const cross = Math.sign(h) !== Math.sign(hp);
      let s = h > 0 ? 0.5 : -0.5;
      s += h > hp ? 0.3 : -0.3;
      if (cross) s += h > 0 ? 0.2 : -0.2;
      return { score: clamp(s, -1, 1), label: cross ? (h > 0 ? "factor.macd_cross_up" : "factor.macd_cross_down") : "factor.macd", explanation: `MACD ${f2(m)} · hist ${f2(h)}` };
    },
  },
  {
    id: "stoch_rsi",
    category: "momentum",
    weight: 0.6,
    fn: (ctx, i) => {
      const k = ctx.stochRsi.k[i];
      const d = ctx.stochRsi.d[i];
      const kp = ctx.stochRsi.k[i - 1];
      const dp = ctx.stochRsi.d[i - 1];
      if (!fin(k) || !fin(d) || !fin(kp) || !fin(dp)) return null;
      const crossUp = kp <= dp && k > d;
      const crossDown = kp >= dp && k < d;
      let s = 0;
      if (crossUp && k < 30) s = 0.9;
      else if (crossDown && k > 70) s = -0.9;
      else if (k < 20) s = 0.3;
      else if (k > 80) s = -0.3;
      else s = k > d ? 0.2 : -0.2;
      return { score: s, label: "factor.stoch_rsi", explanation: `StochRSI K ${f2(k)} / D ${f2(d)}` };
    },
  },
  {
    id: "obv",
    category: "volume",
    weight: 0.8,
    fn: (ctx, i) => {
      const o = ctx.obv[i];
      const e = ctx.obvEma[i];
      const o5 = ctx.obv[i - 5];
      if (!fin(o) || !fin(e) || !fin(o5)) return null;
      const s = (o > e ? 0.5 : -0.5) + (o > o5 ? 0.3 : -0.3);
      return { score: s, label: "factor.obv", explanation: `OBV ${o > e ? ">" : "<"} EMA20(OBV)` };
    },
  },
  {
    id: "cmf",
    category: "volume",
    weight: 0.7,
    fn: (ctx, i) => {
      const v = ctx.cmf[i];
      if (!fin(v)) return null;
      return { score: clamp(v * 4, -1, 1), label: "factor.cmf", explanation: `CMF(20) ${f2(v)}` };
    },
  },
  {
    id: "volume_confirmation",
    category: "volume",
    weight: 0.7,
    fn: (ctx, i) => {
      const rv = ctx.relVol[i];
      if (!fin(rv)) return null;
      const c = ctx.candles[i]!;
      const dir = Math.sign(c.close - c.open);
      if (rv < 1.2 || dir === 0) return { score: 0, label: "factor.volume_normal", explanation: `Vol ${f2(rv)}× avg` };
      return { score: dir * clamp((rv - 1) / 1.5, 0.2, 1), label: dir > 0 ? "factor.volume_buying" : "factor.volume_selling", explanation: `Vol ${f2(rv)}× avg` };
    },
  },
  {
    id: "market_structure",
    category: "structure",
    weight: 1.2,
    fn: (ctx, i) => {
      const { trend, lastEvent } = structureTrendAt(ctx, i);
      if (!lastEvent) return null;
      const age = i - lastEvent.index;
      const fresh = age <= 10;
      const base = trend === "bullish" ? 0.6 : -0.6;
      const bonus = fresh ? (lastEvent.type === "CHOCH" ? 0.4 : 0.25) : 0;
      return {
        score: clamp(base + Math.sign(base) * bonus, -1, 1),
        label: `factor.structure_${lastEvent.type.toLowerCase()}_${lastEvent.direction}`,
        explanation: `${lastEvent.type} ${lastEvent.direction} @ ${f2(lastEvent.price)} (${age} bars)`,
      };
    },
  },
  {
    id: "sr_proximity",
    category: "structure",
    weight: 0.9,
    fn: (ctx, i, env) => {
      const c = ctx.close[i]!;
      const a = ctx.atr[i];
      if (!fin(a)) return null;
      const ds = env.support !== undefined ? (c - env.support) / a : Infinity;
      const dr = env.resistance !== undefined ? (env.resistance - c) / a : Infinity;
      if (!Number.isFinite(ds) && !Number.isFinite(dr)) return null;
      let s = 0;
      if (ds < 1) s += 0.6 * (1 - ds);
      if (dr < 1) s -= 0.6 * (1 - dr);
      return {
        score: clamp(s, -1, 1),
        label: "factor.sr_proximity",
        explanation: `S ${env.support !== undefined ? f2(env.support) : "—"} · R ${env.resistance !== undefined ? f2(env.resistance) : "—"}`,
      };
    },
  },
  {
    id: "divergence",
    category: "momentum",
    weight: 1,
    fn: (ctx, i) => {
      let last;
      for (const d of ctx.rsiDivergences) {
        if (d.confirmedAt > i) break;
        if (i - d.confirmedAt <= 8) last = d;
      }
      if (!last) return null;
      const s = (last.direction === "bullish" ? 1 : -1) * (last.type === "regular" ? 0.8 : 0.6);
      return { score: s, label: `factor.divergence_${last.type}_${last.direction}`, explanation: `RSI ${f2(last.from.osc)} → ${f2(last.to.osc)}` };
    },
  },
  {
    id: "candle_pattern",
    category: "structure",
    weight: 0.6,
    fn: (ctx, i) => {
      const pats = [...candlePatternsAt(ctx.candles, i, ctx.atr[i]), ...candlePatternsAt(ctx.candles, i - 1, ctx.atr[i - 1]).map((p) => ({ ...p, reliability: p.reliability * 0.6 }))].filter(
        (p) => p.direction !== "neutral",
      );
      if (pats.length === 0) return null;
      const best = pats.reduce((a, b) => (b.reliability > a.reliability ? b : a));
      return { score: (best.direction === "bullish" ? 1 : -1) * best.reliability, label: `pattern.${best.id}`, explanation: `${best.id.replace(/_/g, " ")}` };
    },
  },
  {
    id: "smc_zone",
    category: "structure",
    weight: 0.8,
    fn: (ctx, i) => {
      const c = ctx.candles[i]!;
      for (const z of [...ctx.orderBlocks, ...ctx.fvgs]) {
        if (z.createdIndex >= i || i - z.createdIndex > 80) continue;
        if (z.mitigatedIndex !== undefined && z.mitigatedIndex < i) continue;
        const inside = c.low <= z.top && c.high >= z.bottom;
        if (!inside) continue;
        const respected = z.direction === "bullish" ? c.close > z.bottom : c.close < z.top;
        if (!respected) continue;
        return { score: z.direction === "bullish" ? 0.7 : -0.7, label: `factor.zone_${z.direction}`, explanation: `${f2(z.bottom)}–${f2(z.top)}` };
      }
      return null;
    },
  },
  {
    id: "bollinger",
    category: "volatility",
    weight: 0.6,
    fn: (ctx, i, env) => {
      const pb = ctx.bb.percentB[i];
      if (!fin(pb)) return null;
      let s: number;
      if (env.regime === "RANGING") s = clamp((0.5 - pb) * 1.6, -1, 1);
      else if (env.regime === "TRENDING_UP") s = pb > 0.5 ? 0.4 : pb < 0 ? -0.3 : 0.1;
      else if (env.regime === "TRENDING_DOWN") s = pb < 0.5 ? -0.4 : pb > 1 ? 0.3 : -0.1;
      else s = 0;
      return { score: s, label: "factor.bollinger", explanation: `%B ${f2(pb)} · BW ${f2((ctx.bb.bandwidth[i] ?? 0) * 100)}%` };
    },
  },
  {
    id: "htf_trend",
    category: "trend",
    weight: 1.5,
    fn: (_ctx, _i, env) => {
      if (env.htfScore === undefined) return null;
      return { score: clamp(env.htfScore, -1, 1), label: "factor.htf_trend", explanation: `HTF ${env.htfScore >= 0 ? "+" : ""}${env.htfScore.toFixed(2)}` };
    },
  },
  {
    id: "fear_greed",
    category: "sentiment",
    weight: 0.4,
    fn: (_ctx, _i, env) => {
      const fg = env.fearGreed;
      if (fg === undefined) return null;
      // Contrarian: extreme fear has historically been a better time to accumulate than extreme greed.
      const s = fg <= 20 ? 0.6 : fg <= 35 ? 0.25 : fg >= 80 ? -0.6 : fg >= 65 ? -0.25 : 0;
      return { score: s, label: "factor.fear_greed", explanation: `Fear & Greed ${fg}` };
    },
  },
  {
    id: "derivatives",
    category: "derivatives",
    weight: 0.6,
    fn: (_ctx, _i, env) => {
      const b = env.derivativesBias;
      if (b === undefined || !Number.isFinite(b)) return null;
      return { score: b, label: "factor.derivatives", explanation: `Funding / L-S bias ${b >= 0 ? "+" : ""}${b.toFixed(2)}` };
    },
  },
];

export function evaluateFactors(ctx: SeriesContext, i: number, env: FactorEnv): FactorResult[] {
  const out: FactorResult[] = [];
  for (const f of FACTORS) {
    const r = f.fn(ctx, i, env);
    if (r) out.push({ id: f.id, category: f.category, weight: f.weight, ...r, score: clamp(r.score, -1, 1) });
  }
  return out;
}

/** Weighted mean of factor scores, -1..1. */
export function aggregate(factors: readonly FactorResult[]): number {
  let num = 0;
  let den = 0;
  for (const f of factors) {
    num += f.score * f.weight;
    den += f.weight;
  }
  return den === 0 ? 0 : num / den;
}

/** Fast trend-only score (-1..1) used for higher-timeframe confirmation. */
export function trendScore(ctx: SeriesContext, i: number): number {
  const env: FactorEnv = { regime: "RANGING" };
  const ids = new Set(["ema_stack", "supertrend", "adx_dmi", "macd", "market_structure", "ichimoku"]);
  const fs = FACTORS.filter((f) => ids.has(f.id))
    .map((f) => {
      const r = f.fn(ctx, i, env);
      return r ? { ...r, id: f.id, category: f.category, weight: f.weight } : null;
    })
    .filter((x): x is FactorResult => x !== null);
  return aggregate(fs);
}
