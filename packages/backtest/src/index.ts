import type { BacktestSummary, Candle, Side, Timeframe } from "@cv/core";
import { bucketStart, HIGHER_TIMEFRAME, resample, seededRandom, TIMEFRAME_SECONDS } from "@cv/core";
import { buildTradePlan, type RiskConfig } from "@cv/risk";
import { supportResistance, type Level } from "@cv/indicators";
import { buildContext, evaluateAt, trendScore, type Strategy, type StrategyId } from "@cv/signals";

export interface BacktestConfig {
  strategies?: StrategyId[];
  /** User-defined strategies (built with `buildCustomStrategy`); pass `strategies: []` to test them alone. */
  custom?: Strategy[];
  initialEquity?: number;
  /** % of equity risked per trade. */
  riskPct?: number;
  /** Taker fee per fill (0.001 = 0.1%). */
  feeRate?: number;
  /** Adverse slippage per fill, in ATRs. */
  slippageAtr?: number;
  maxLeverage?: number;
  /** Close the trade after this many bars if no target or stop was hit. */
  maxBarsInTrade?: number;
  allowShort?: boolean;
  risk?: Partial<RiskConfig>;
  timeframe?: Timeframe;
  /** Skip setups against the higher-timeframe trend, exactly like live ACTIVE signals. Default true. */
  htfFilter?: boolean;
}

export type ExitReason = "STOP" | "BREAKEVEN" | "TRAIL" | "TARGET" | "TIME" | "END";

export interface Fill {
  index: number;
  time: number;
  price: number;
  qty: number;
  kind: "ENTRY" | "TP1" | "TP2" | "TP3" | ExitReason;
}

export interface Trade {
  side: Side;
  strategyId: StrategyId;
  entryIndex: number;
  entryTime: number;
  entryPrice: number;
  initialStop: number;
  targets: number[];
  exitIndex: number;
  exitTime: number;
  /** Quantity-weighted average exit. */
  exitPrice: number;
  qty: number;
  pnl: number;
  pnlPct: number;
  rMultiple: number;
  fees: number;
  exitReason: ExitReason;
  barsHeld: number;
  fills: Fill[];
}

export interface Metrics extends BacktestSummary {
  finalEquity: number;
  cagrPct: number;
  sharpe: number;
  sortino: number;
  calmar: number;
  avgWinR: number;
  avgLossR: number;
  bestTradePct: number;
  worstTradePct: number;
  exposurePct: number;
  avgBarsHeld: number;
  longTrades: number;
  shortTrades: number;
  maxConsecutiveLosses: number;
}

export interface BacktestResult {
  trades: Trade[];
  equity: { time: number; equity: number; drawdownPct: number }[];
  metrics: Metrics;
  byStrategy: Record<string, BacktestSummary>;
  monteCarlo: MonteCarloResult;
  walkForward: WalkForwardSegment[];
}

interface OpenPosition {
  side: Side;
  strategyId: StrategyId;
  entryIndex: number;
  entryPrice: number;
  initialStop: number;
  stop: number;
  targets: { price: number; sizePct: number; hit: boolean }[];
  qtyTotal: number;
  qtyOpen: number;
  riskAmount: number;
  realized: number;
  fees: number;
  fills: Fill[];
}

const WARMUP = 210;

/**
 * Event-driven, bar-by-bar backtest that reuses the live signal engine (`evaluateAt`).
 * Signals are taken at a bar's close and filled at the next bar's open. When stop and target
 * are both inside one bar we assume the stop was hit first (pessimistic).
 */
export function runBacktest(candles: readonly Candle[], config: BacktestConfig = {}): BacktestResult {
  const cfg = {
    initialEquity: 10_000,
    riskPct: 1,
    feeRate: 0.001,
    slippageAtr: 0.05,
    maxLeverage: 3,
    maxBarsInTrade: 120,
    allowShort: true,
    ...config,
  };
  const ctx = buildContext(candles);
  const tf = cfg.timeframe ?? inferTimeframe(candles);
  const htfScoreAt = cfg.htfFilter === false ? () => undefined : buildHtfScorer(candles, tf);
  const trades: Trade[] = [];
  const equityCurve: BacktestResult["equity"] = [];
  let equity = cfg.initialEquity;
  let peak = equity;
  let pos: OpenPosition | null = null;
  let pending: { side: Side; strategyId: StrategyId; stop: number; plan: NonNullable<ReturnType<typeof buildTradePlan>> } | null = null;
  let barsInMarket = 0;
  // S/R levels move slowly; refreshing them every few bars keeps the backtest fast without look-ahead.
  let levels: Level[] = [];
  let levelsAt = -Infinity;

  // Slippage scales with the ATR known when the order is sent: the previous bar's for fills at
  // this bar's open (using this bar's ATR would peek at its high/low), this bar's for fills at its close.
  const slip = (i: number) => (Number.isFinite(ctx.atr[i]) ? ctx.atr[i]! * cfg.slippageAtr : 0);

  const closeQty = (p: OpenPosition, i: number, price: number, qty: number, kind: Fill["kind"]) => {
    const dir = p.side === "LONG" ? 1 : -1;
    const fee = price * qty * cfg.feeRate;
    p.realized += (price - p.entryPrice) * qty * dir - fee;
    p.fees += fee;
    p.qtyOpen -= qty;
    p.fills.push({ index: i, time: candles[i]!.time, price, qty, kind });
  };

  const finalize = (p: OpenPosition, i: number, reason: ExitReason) => {
    const exits = p.fills.filter((f) => f.kind !== "ENTRY");
    const exitQty = exits.reduce((s, f) => s + f.qty, 0);
    const exitPrice = exitQty > 0 ? exits.reduce((s, f) => s + f.price * f.qty, 0) / exitQty : p.entryPrice;
    equity += p.realized;
    trades.push({
      side: p.side,
      strategyId: p.strategyId,
      entryIndex: p.entryIndex,
      entryTime: candles[p.entryIndex]!.time,
      entryPrice: p.entryPrice,
      initialStop: p.initialStop,
      targets: p.targets.map((t) => t.price),
      exitIndex: i,
      exitTime: candles[i]!.time,
      exitPrice,
      qty: p.qtyTotal,
      pnl: p.realized,
      pnlPct: (p.realized / (equity - p.realized)) * 100,
      rMultiple: p.riskAmount > 0 ? p.realized / p.riskAmount : 0,
      fees: p.fees,
      exitReason: reason,
      barsHeld: i - p.entryIndex + 1,
      fills: p.fills,
    });
  };

  for (let i = WARMUP; i < candles.length; i++) {
    const c = candles[i]!;

    // 1. Fill the order decided at the previous close.
    if (pending && !pos) {
      const dir = pending.side === "LONG" ? 1 : -1;
      const fillPrice = c.open + dir * slip(i - 1);
      const riskPerUnit = (fillPrice - pending.stop) * dir;
      if (riskPerUnit > 0) {
        let qty = (equity * cfg.riskPct) / 100 / riskPerUnit;
        qty = Math.min(qty, (equity * cfg.maxLeverage) / fillPrice);
        const fee = fillPrice * qty * cfg.feeRate;
        // Targets keep their R multiples relative to the actual fill.
        const targets = pending.plan.takeProfits.map((tp) => ({ price: fillPrice + dir * riskPerUnit * tp.rr, sizePct: tp.sizePct, hit: false }));
        pos = {
          side: pending.side,
          strategyId: pending.strategyId,
          entryIndex: i,
          entryPrice: fillPrice,
          initialStop: pending.stop,
          stop: pending.stop,
          targets,
          qtyTotal: qty,
          qtyOpen: qty,
          riskAmount: qty * riskPerUnit,
          realized: -fee,
          fees: fee,
          fills: [{ index: i, time: c.time, price: fillPrice, qty, kind: "ENTRY" }],
        };
      }
      pending = null;
    }

    // 2. Manage the open position on this bar.
    if (pos) {
      barsInMarket++;
      const p: OpenPosition = pos;
      const long = p.side === "LONG";
      const stopHit = long ? c.low <= p.stop : c.high >= p.stop;
      if (stopHit) {
        const gapPrice = long ? Math.min(p.stop, c.open) : Math.max(p.stop, c.open);
        // After TP2 the stop trails at TP1, after TP1 it sits at breakeven.
        const reason: ExitReason = p.targets[1]!.hit ? "TRAIL" : p.targets[0]!.hit ? "BREAKEVEN" : "STOP";
        closeQty(p, i, gapPrice - (long ? 1 : -1) * slip(i - 1), p.qtyOpen, reason);
        finalize(p, i, reason);
        pos = null;
      } else {
        for (let t = 0; t < p.targets.length; t++) {
          const tp = p.targets[t]!;
          if (tp.hit) continue;
          const reached = long ? c.high >= tp.price : c.low <= tp.price;
          if (!reached) break;
          tp.hit = true;
          const isLast = t === p.targets.length - 1;
          const qty = isLast ? p.qtyOpen : Math.min(p.qtyOpen, (p.qtyTotal * tp.sizePct) / 100);
          closeQty(p, i, tp.price, qty, (["TP1", "TP2", "TP3"] as const)[t] ?? "TARGET");
          // Lock in: breakeven after TP1, TP1 after TP2.
          if (t === 0) p.stop = p.entryPrice;
          if (t === 1) p.stop = p.targets[0]!.price;
        }
        if (p.qtyOpen <= p.qtyTotal * 1e-9) {
          finalize(p, i, "TARGET");
          pos = null;
        } else if (i - p.entryIndex + 1 >= cfg.maxBarsInTrade) {
          closeQty(p, i, c.close - (long ? 1 : -1) * slip(i), p.qtyOpen, "TIME");
          finalize(p, i, "TIME");
          pos = null;
        }
      }
    }

    // 3. Look for a new setup at this close.
    if (!pos && !pending && i < candles.length - 1) {
      const htfScore = htfScoreAt(i);
      if (i - levelsAt >= 5) {
        levels = supportResistance(candles.slice(Math.max(0, i - 300), i + 1));
        levelsAt = i;
      }
      const ev = evaluateAt(ctx, i, { strategies: cfg.strategies, custom: cfg.custom, htfScore, levels });
      const htfConflict = htfScore !== undefined && ev.setup && (ev.setup.side === "LONG" ? htfScore < -0.2 : htfScore > 0.2);
      if (ev.setup && !htfConflict && (cfg.allowShort || ev.setup.side === "LONG")) {
        const plan = buildTradePlan({
          side: ev.setup.side,
          entry: c.close,
          atr: ctx.atr[i]!,
          structuralStop: ev.setup.structuralStop,
          nextLevel: ev.setup.side === "LONG" ? ev.resistance : ev.support,
          config: cfg.risk,
        });
        const minRR = cfg.risk?.minRiskReward ?? 1.5;
        if (plan && plan.riskReward >= minRR) pending = { side: ev.setup.side, strategyId: ev.setup.strategyId, stop: plan.stopLoss, plan };
      }
    }

    // 4. Mark to market.
    let mtm = equity;
    if (pos) mtm += pos.realized + (c.close - pos.entryPrice) * pos.qtyOpen * (pos.side === "LONG" ? 1 : -1);
    peak = Math.max(peak, mtm);
    equityCurve.push({ time: c.time, equity: mtm, drawdownPct: peak > 0 ? ((mtm - peak) / peak) * 100 : 0 });
  }

  if (pos) {
    const i = candles.length - 1;
    closeQty(pos, i, candles[i]!.close - (pos.side === "LONG" ? 1 : -1) * slip(i), pos.qtyOpen, "END");
    finalize(pos, i, "END");
    const lastPoint = equityCurve[equityCurve.length - 1];
    if (lastPoint) {
      lastPoint.equity = equity;
      lastPoint.drawdownPct = peak > 0 ? Math.min(0, ((equity - peak) / peak) * 100) : 0;
    }
  }

  const metrics = computeMetrics(trades, equityCurve, cfg.initialEquity, tf, barsInMarket);
  const byStrategy: Record<string, BacktestSummary> = {};
  for (const id of new Set(trades.map((t) => t.strategyId))) byStrategy[id] = summarize(trades.filter((t) => t.strategyId === id), cfg.initialEquity);
  return {
    trades,
    equity: equityCurve,
    metrics,
    byStrategy,
    monteCarlo: monteCarlo(trades, cfg.initialEquity),
    walkForward: walkForward(trades, candles, cfg.initialEquity, 4),
  };
}

/**
 * Higher-timeframe trend score as known at bar i: only HTF buckets that closed before bar i's
 * bucket are used, so the filter cannot see the future.
 */
function buildHtfScorer(candles: readonly Candle[], tf: Timeframe): (i: number) => number | undefined {
  const htf = HIGHER_TIMEFRAME[tf];
  if (htf === tf) return () => undefined;
  const bucket = TIMEFRAME_SECONDS[htf];
  const htfCandles = resample(candles, bucket);
  const htfCtx = buildContext(htfCandles);
  const scores = htfCandles.map((_, k) => (k >= 60 ? trendScore(htfCtx, k) : undefined));
  const bucketIndex = new Map(htfCandles.map((c, k) => [c.time, k]));
  return (i) => {
    const k = bucketIndex.get(bucketStart(candles[i]!.time, bucket));
    if (k === undefined) return undefined;
    // The bucket containing bar i is complete only if bar i is its last bar.
    const closedK = htfCandles[k]!.lastIndex === i && candles[i]!.time + TIMEFRAME_SECONDS[tf] >= htfCandles[k]!.time + bucket ? k : k - 1;
    return closedK >= 0 ? scores[closedK] : undefined;
  };
}

function inferTimeframe(candles: readonly Candle[]): Timeframe {
  const dt = candles.length > 1 ? candles[1]!.time - candles[0]!.time : 3600;
  const tfs = Object.entries(TIMEFRAME_SECONDS) as [Timeframe, number][];
  return tfs.reduce((best, cur) => (Math.abs(cur[1] - dt) < Math.abs(best[1] - dt) ? cur : best))[0];
}

/** Win rate, profit factor and expectancy for a list of trades. */
export function summarize(trades: readonly Trade[], initialEquity: number): BacktestSummary {
  const wins = trades.filter((t) => t.pnl > 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0));
  let eq = initialEquity;
  let peak = eq;
  let maxDd = 0;
  for (const t of trades) {
    eq += t.pnl;
    peak = Math.max(peak, eq);
    maxDd = Math.min(maxDd, ((eq - peak) / peak) * 100);
  }
  return {
    trades: trades.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    profitFactor: grossLoss === 0 ? (grossWin > 0 ? Infinity : 0) : grossWin / grossLoss,
    expectancyR: trades.length ? trades.reduce((s, t) => s + t.rMultiple, 0) / trades.length : 0,
    maxDrawdownPct: maxDd,
    totalReturnPct: ((eq - initialEquity) / initialEquity) * 100,
  };
}

function computeMetrics(trades: Trade[], curve: BacktestResult["equity"], initialEquity: number, tf: Timeframe, barsInMarket: number): Metrics {
  const base = summarize(trades, initialEquity);
  const finalEquity = curve.length ? curve[curve.length - 1]!.equity : initialEquity;
  const maxDd = curve.reduce((m, p) => Math.min(m, p.drawdownPct), 0);
  const barsPerYear = (365 * 86400) / TIMEFRAME_SECONDS[tf];
  const years = curve.length / barsPerYear;
  const totalReturn = finalEquity / initialEquity;
  const cagr = years > 0 && totalReturn > 0 ? (Math.pow(totalReturn, 1 / years) - 1) * 100 : 0;
  const rets: number[] = [];
  for (let k = 1; k < curve.length; k++) rets.push(curve[k]!.equity / curve[k - 1]!.equity - 1);
  const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
  const sd = Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1));
  const downside = Math.sqrt(rets.reduce((s, r) => s + Math.min(0, r) ** 2, 0) / Math.max(1, rets.length - 1));
  const wins = trades.filter((t) => t.rMultiple > 0);
  const losses = trades.filter((t) => t.rMultiple <= 0);
  let streak = 0;
  let maxStreak = 0;
  for (const t of trades) {
    streak = t.pnl <= 0 ? streak + 1 : 0;
    maxStreak = Math.max(maxStreak, streak);
  }
  return {
    ...base,
    maxDrawdownPct: maxDd,
    totalReturnPct: (totalReturn - 1) * 100,
    finalEquity,
    cagrPct: cagr,
    sharpe: sd > 0 ? (mean / sd) * Math.sqrt(barsPerYear) : 0,
    sortino: downside > 0 ? (mean / downside) * Math.sqrt(barsPerYear) : 0,
    calmar: maxDd < 0 ? cagr / Math.abs(maxDd) : 0,
    avgWinR: wins.length ? wins.reduce((s, t) => s + t.rMultiple, 0) / wins.length : 0,
    avgLossR: losses.length ? losses.reduce((s, t) => s + t.rMultiple, 0) / losses.length : 0,
    bestTradePct: trades.length ? Math.max(...trades.map((t) => t.pnlPct)) : 0,
    worstTradePct: trades.length ? Math.min(...trades.map((t) => t.pnlPct)) : 0,
    exposurePct: curve.length ? (barsInMarket / curve.length) * 100 : 0,
    avgBarsHeld: trades.length ? trades.reduce((s, t) => s + t.barsHeld, 0) / trades.length : 0,
    longTrades: trades.filter((t) => t.side === "LONG").length,
    shortTrades: trades.filter((t) => t.side === "SHORT").length,
    maxConsecutiveLosses: maxStreak,
  };
}

export interface MonteCarloResult {
  runs: number;
  /** Percentiles of final return % across bootstrapped trade sequences. */
  returnP5: number;
  returnP50: number;
  returnP95: number;
  maxDrawdownP50: number;
  /** 95th-percentile worst drawdown: plan for this, not the backtest's single path. */
  maxDrawdownP95: number;
  probabilityOfLoss: number;
}

/** Bootstrap resampling of trade returns to estimate the range of outcomes. */
export function monteCarlo(trades: readonly Trade[], initialEquity: number, runs = 1000, seed = 42): MonteCarloResult {
  if (trades.length < 5) return { runs: 0, returnP5: 0, returnP50: 0, returnP95: 0, maxDrawdownP50: 0, maxDrawdownP95: 0, probabilityOfLoss: 0 };
  const rand = seededRandom(seed);
  const rets = trades.map((t) => t.pnlPct / 100);
  const finals: number[] = [];
  const dds: number[] = [];
  for (let r = 0; r < runs; r++) {
    let eq = initialEquity;
    let peak = eq;
    let dd = 0;
    for (let k = 0; k < rets.length; k++) {
      eq *= 1 + rets[Math.floor(rand() * rets.length)]!;
      peak = Math.max(peak, eq);
      dd = Math.min(dd, (eq - peak) / peak);
    }
    finals.push((eq / initialEquity - 1) * 100);
    dds.push(dd * 100);
  }
  finals.sort((a, b) => a - b);
  dds.sort((a, b) => a - b);
  const pct = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;
  return {
    runs,
    returnP5: pct(finals, 0.05),
    returnP50: pct(finals, 0.5),
    returnP95: pct(finals, 0.95),
    maxDrawdownP50: pct(dds, 0.5),
    maxDrawdownP95: pct(dds, 0.05),
    probabilityOfLoss: finals.filter((f) => f < 0).length / runs,
  };
}

export interface WalkForwardSegment extends BacktestSummary {
  from: number;
  to: number;
}

/**
 * Splits history into consecutive out-of-sample windows. Rules are fixed (not re-optimised per
 * window), so this measures stability: an edge that only exists in one window is not an edge.
 */
export function walkForward(trades: readonly Trade[], candles: readonly Candle[], initialEquity: number, segments: number): WalkForwardSegment[] {
  const start = Math.min(WARMUP, candles.length - 1);
  const span = (candles.length - start) / segments;
  const out: WalkForwardSegment[] = [];
  for (let s = 0; s < segments; s++) {
    const a = Math.floor(start + s * span);
    const b = Math.floor(start + (s + 1) * span) - 1;
    if (a >= candles.length || b < a) continue;
    const seg = trades.filter((t) => t.entryIndex >= a && t.entryIndex <= b);
    out.push({ ...summarize(seg, initialEquity), from: candles[a]!.time, to: candles[Math.min(b, candles.length - 1)]!.time });
  }
  return out;
}
