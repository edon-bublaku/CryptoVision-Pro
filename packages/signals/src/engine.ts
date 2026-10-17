import type { BacktestSummary, Candle, FactorResult, Signal, SignalAction, Timeframe } from "@cv/core";
import { clamp } from "@cv/core";
import { supportResistance, type Level } from "@cv/indicators";
import { buildTradePlan, DEFAULT_RISK, type RiskConfig } from "@cv/risk";
import { buildContext, lastSwingAt, type SeriesContext } from "./context";
import { aggregate, evaluateFactors, trendScore, type FactorEnv } from "./factors";
import { detectRegime, type RegimeInfo } from "./regime";
import { STRATEGIES, type Setup, type StrategyId } from "./strategies";

export interface EvaluateOptions {
  htfScore?: number;
  fearGreed?: number;
  derivativesBias?: number;
  risk?: Partial<RiskConfig>;
  /** Restrict to these strategies (backtest of a single strategy). */
  strategies?: StrategyId[];
  /** S/R levels known at this bar; computed if omitted. */
  levels?: Level[];
}

export interface Evaluation {
  index: number;
  regime: RegimeInfo;
  factors: FactorResult[];
  /** -1..1 */
  rawScore: number;
  /** 0..100 */
  score: number;
  setup: (Setup & { strategyId: StrategyId }) | null;
  support?: number;
  resistance?: number;
}

export const SCORE_THRESHOLDS = { strongBuy: 75, buy: 60, sell: 40, strongSell: 25 } as const;

export function actionFromScore(score: number): SignalAction {
  if (score >= SCORE_THRESHOLDS.strongBuy) return "STRONG_BUY";
  if (score >= SCORE_THRESHOLDS.buy) return "BUY";
  if (score <= SCORE_THRESHOLDS.strongSell) return "STRONG_SELL";
  if (score <= SCORE_THRESHOLDS.sell) return "SELL";
  return "HOLD";
}

function nearestLevels(levels: readonly Level[], price: number): { support?: number; resistance?: number } {
  let support: number | undefined;
  let resistance: number | undefined;
  for (const l of levels) {
    if (l.price < price && (support === undefined || l.price > support)) support = l.price;
    if (l.price > price && (resistance === undefined || l.price < resistance)) resistance = l.price;
  }
  return { support, resistance };
}

/** Evaluates bar `i` using only information available at its close. */
export function evaluateAt(ctx: SeriesContext, i: number, opts: EvaluateOptions = {}): Evaluation {
  const regime = detectRegime(ctx, i);
  const close = ctx.close[i]!;
  const levels = opts.levels ?? supportResistance(ctx.candles.slice(Math.max(0, i - 300), i + 1));
  const { support, resistance } = nearestLevels(levels, close);
  const env: FactorEnv = { regime: regime.regime, htfScore: opts.htfScore, fearGreed: opts.fearGreed, derivativesBias: opts.derivativesBias, support, resistance };
  const factors = evaluateFactors(ctx, i, env);
  const rawScore = aggregate(factors);
  const score = Math.round(50 + 50 * rawScore);

  let setup: Evaluation["setup"] = null;
  if (regime.regime !== "LOW_LIQUIDITY") {
    const allowed = opts.strategies ? STRATEGIES.filter((s) => opts.strategies!.includes(s.id)) : STRATEGIES;
    let best: Evaluation["setup"] = null;
    for (const s of allowed) {
      if (!s.regimes.includes(regime.regime)) continue;
      const found = s.detect(ctx, i);
      if (!found) continue;
      // Confluence must not contradict the setup.
      const agrees = found.side === "LONG" ? rawScore > -0.05 : rawScore < 0.05;
      if (!agrees) continue;
      if (!best || found.strength > best.strength) best = { ...found, strategyId: s.id };
    }
    setup = best;
  }
  return { index: i, regime, factors, rawScore, score, setup, support, resistance };
}

export interface AnalyzeInput {
  symbol: string;
  timeframe: Timeframe;
  /** Closed candles only — the forming candle would make the signal repaint. */
  candles: readonly Candle[];
  htfCandles?: readonly Candle[];
  fearGreed?: number;
  derivativesBias?: number;
  risk?: Partial<RiskConfig>;
  backtest?: BacktestSummary;
}

export interface Analysis {
  signal: Signal;
  evaluation: Evaluation;
  levels: Level[];
  context: SeriesContext;
}

export function htfTrendScore(htfCandles: readonly Candle[] | undefined): number | undefined {
  if (!htfCandles || htfCandles.length < 60) return undefined;
  const ctx = buildContext(htfCandles);
  return trendScore(ctx, htfCandles.length - 1);
}

/** Full analysis of the last closed candle → a Signal with a trade plan. */
export function analyze(input: AnalyzeInput): Analysis | null {
  const { candles } = input;
  if (candles.length < 60) return null;
  const ctx = buildContext(candles);
  const i = candles.length - 1;
  const htfScore = htfTrendScore(input.htfCandles);
  const levels = supportResistance(candles.slice(-300));
  const ev = evaluateAt(ctx, i, { htfScore, fearGreed: input.fearGreed, derivativesBias: input.derivativesBias, risk: input.risk, levels });
  const close = ctx.close[i]!;
  const atrV = ctx.atr[i]!;
  const htfBias = htfScore === undefined ? "NEUTRAL" : htfScore > 0.2 ? "BULLISH" : htfScore < -0.2 ? "BEARISH" : "NEUTRAL";
  const riskCfg = { ...DEFAULT_RISK, ...input.risk };

  // Direction: a confirmed setup wins; otherwise follow the confluence bias.
  const side = ev.setup?.side ?? (ev.rawScore >= 0 ? "LONG" : "SHORT");
  const structural =
    ev.setup?.structuralStop ?? (side === "LONG" ? lastSwingAt(ctx, i, "low")?.price : lastSwingAt(ctx, i, "high")?.price);
  const plan = buildTradePlan({
    side,
    entry: close,
    atr: atrV,
    structuralStop: structural,
    nextLevel: side === "LONG" ? ev.resistance : ev.support,
    config: input.risk,
  });

  let action = actionFromScore(ev.score);
  if (ev.setup) {
    // A confirmed setup upgrades a lukewarm score in its own direction.
    if (ev.setup.side === "LONG" && (action === "HOLD" || action === "SELL")) action = "BUY";
    if (ev.setup.side === "SHORT" && (action === "HOLD" || action === "BUY")) action = "SELL";
  }

  const directional = action !== "HOLD";
  const dirSign = side === "LONG" ? 1 : -1;
  const agreeWeight = ev.factors.reduce((s, f) => s + (Math.sign(f.score) === dirSign ? f.weight : 0), 0);
  const totalWeight = ev.factors.reduce((s, f) => s + f.weight, 0) || 1;
  const htfConflict = (htfBias === "BULLISH" && side === "SHORT") || (htfBias === "BEARISH" && side === "LONG");
  const regimeFit = ev.setup ? 1 : ev.regime.strength;
  let confidence =
    0.4 * (agreeWeight / totalWeight) + 0.25 * Math.abs(ev.rawScore) * 2 + 0.15 * regimeFit + 0.2 * (input.backtest && input.backtest.trades >= 10 ? input.backtest.winRate : 0.45);
  if (htfConflict) confidence *= 0.6;
  if (ev.regime.regime === "LOW_LIQUIDITY" || ev.regime.regime === "HIGH_VOLATILITY") confidence *= 0.7;
  confidence = clamp(confidence, 0, 0.95);

  const tradeable = !!ev.setup && !!plan && plan.riskReward >= riskCfg.minRiskReward && !htfConflict && directional;

  const signal: Signal = {
    id: `${input.symbol}-${input.timeframe}-${candles[i]!.time}`,
    symbol: input.symbol,
    timeframe: input.timeframe,
    action,
    score: ev.score,
    confidence: Math.round(confidence * 100) / 100,
    regime: ev.regime.regime,
    htfBias,
    strategyId: ev.setup?.strategyId ?? null,
    plan: directional ? plan : null,
    factors: [...ev.factors].sort((a, b) => Math.abs(b.score * b.weight) - Math.abs(a.score * a.weight)),
    price: close,
    candleTime: candles[i]!.time,
    createdAt: Date.now(),
    status: tradeable ? "ACTIVE" : "WATCH",
    backtest: input.backtest,
  };
  return { signal, evaluation: ev, levels, context: ctx };
}
