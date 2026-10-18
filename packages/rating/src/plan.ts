import type { Side } from "@cv/core";
import Decimal from "decimal.js";
import { extremeAt, lastSwingAt } from "@cv/signals";
import { levelsAt, type Rating, type RatingContext } from "./rating";
import { fin } from "./score";

/**
 * Turns a rating into a concrete, rule-based investment plan on daily data: whether to act, which
 * position (spot / futures, size from the risk budget), a 3-step entry ladder with an optional breakout
 * entry, a stop, three exits, and the conditions that should make you sell. Deterministic and causal.
 */

export type Stance = "accumulate" | "buy_dips" | "wait" | "reduce" | "exit";

export interface PlanSettings {
  equity: number;
  /** % of equity at risk if the stop is hit. */
  riskPct: number;
  maxLeverage: number;
  /** Fee per fill (0.001 = 0.1%). */
  feeRate: number;
  /** Offer a short plan when the rating is very weak (futures only). */
  allowShort?: boolean;
}

export interface Tranche {
  kind: "market" | "limit" | "stop";
  price: number;
  /** Share of the planned quantity, 0..100. */
  sizePct: number;
  /** i18n key explaining where the level comes from. */
  reason: string;
}

export interface Target {
  price: number;
  sizePct: number;
  rr: number;
  reason: string;
}

export interface ExitRule {
  id: "stop_close" | "breakeven" | "trailing" | "rating_reduce" | "rating_exit" | "ema50_close" | "time_stop" | "sell_now" | "sell_into_strength" | "hard_stop" | "re_entry";
  params: Record<string, number>;
}

export interface InvestmentPlan {
  stance: Stance;
  side: Side | null;
  instrument: "spot" | "futures";
  leverage: number;
  horizonDays: [number, number];
  entries: Tranche[];
  breakout: Tranche | null;
  avgEntry: number;
  stopLoss: number;
  quantity: number;
  notional: number;
  riskAmount: number;
  riskPctOfEquity: number;
  targets: Target[];
  rewardRisk: number;
  exitRules: ExitRule[];
  atr: number;
  supports: number[];
  resistances: number[];
}

export function stanceOf(r: Rating): Stance {
  if (r.score >= 70) return "accumulate";
  if (r.score >= 58) return "buy_dips";
  if (r.score >= 45) return "wait";
  if (r.score >= 30) return "reduce";
  return "exit";
}

const D = (v: number) => new Decimal(v);

export function investmentPlan(rating: Rating, r: RatingContext, s: PlanSettings, i = r.candles.length - 1): InvestmentPlan {
  const { sc } = r;
  const c = sc.close[i]!;
  const atr = fin(sc.atr[i]) ? sc.atr[i]! : c * 0.03;
  const rsi = sc.rsi[i] ?? 50;
  const ema20 = sc.ema20[i]!;
  const ema50 = sc.ema50[i]!;
  const { supports, resistances } = levelsAt(r, i);
  const stance = stanceOf(rating);
  const trend = rating.pillars.find((p) => p.id === "trend")?.score ?? 50;
  const risk = rating.pillars.find((p) => p.id === "risk")?.score ?? 50;

  const longIdea = stance === "accumulate" || stance === "buy_dips" || stance === "wait";
  const shortIdea = !longIdea && !!s.allowShort && rating.score < 35 && trend < 35;
  const dir = longIdea ? 1 : shortIdea ? -1 : 0;
  const base = { stance, atr, supports, resistances, horizonDays: [14, 90] as [number, number] };

  if (dir === 0) {
    // Holders: how to get out. No new position.
    const exitRules: ExitRule[] = [
      { id: "sell_now", params: { pct: stance === "exit" ? 100 : 50 } },
      ...(resistances[0] !== undefined ? [{ id: "sell_into_strength" as const, params: { price: resistances[0] } }] : []),
      { id: "hard_stop", params: { price: (supports[0] ?? c - 2 * atr) - 0.5 * atr } },
      { id: "re_entry", params: { rating: 58 } },
    ];
    return { ...base, side: null, instrument: "spot", leverage: 1, entries: [], breakout: null, avgEntry: c, stopLoss: NaN, quantity: 0, notional: 0, riskAmount: 0, riskPctOfEquity: 0, targets: [], rewardRisk: NaN, exitRules };
  }

  // Candidate pullback levels on the favourable side, at least half an ATR away from price.
  const away = (p: number) => (dir > 0 ? p < c - 0.5 * atr : p > c + 0.5 * atr);
  // Recent swing / 20-day extreme give nearer levels than the long-term pivots when price trends away.
  const swing = lastSwingAt(sc, i, dir > 0 ? "low" : "high", 60)?.price;
  const extreme = extremeAt(sc, i, 20, dir > 0 ? "low" : "high");
  const pool = [...(dir > 0 ? supports : resistances), ema20, ema50, swing ?? NaN, extreme].filter((p) => fin(p) && away(p));
  const levels = [...new Set(pool.map((p) => +p.toPrecision(10)))].sort((a, b) => (dir > 0 ? b - a : a - b));
  const next = (from: number) => from - dir * 1.5 * atr;

  const extended = dir > 0 ? rsi > 70 || c - ema20 > 2 * atr : rsi < 30 || ema20 - c > 2 * atr;
  const entries: Tranche[] = [];
  if (stance === "accumulate" && dir > 0) {
    entries.push({ kind: "market", price: c, sizePct: extended ? 20 : 40, reason: extended ? "plan.reason.marketSmall" : "plan.reason.market" });
    const l1 = levels[0] ?? next(c);
    const l2 = levels[1] ?? next(l1);
    entries.push({ kind: "limit", price: l1, sizePct: extended ? 45 : 35, reason: levels[0] !== undefined ? "plan.reason.level" : "plan.reason.atr" });
    entries.push({ kind: "limit", price: l2, sizePct: extended ? 35 : 25, reason: levels[1] !== undefined ? "plan.reason.level" : "plan.reason.atr" });
  } else {
    const l1 = levels[0] ?? next(c);
    const l2 = levels[1] ?? next(l1);
    const l3 = levels[2] ?? next(l2);
    entries.push({ kind: "limit", price: l1, sizePct: 40, reason: levels[0] !== undefined ? "plan.reason.level" : "plan.reason.atr" });
    entries.push({ kind: "limit", price: l2, sizePct: 35, reason: levels[1] !== undefined ? "plan.reason.level" : "plan.reason.atr" });
    entries.push({ kind: "limit", price: l3, sizePct: 25, reason: levels[2] !== undefined ? "plan.reason.level" : "plan.reason.atr" });
  }
  // Normalise to exactly 100%.
  const totalPct = entries.reduce((a, e) => a + e.sizePct, 0);
  entries.forEach((e) => (e.sizePct = Math.round((e.sizePct / totalPct) * 100)));
  entries[entries.length - 1]!.sizePct += 100 - entries.reduce((a, e) => a + e.sizePct, 0);

  // Breakout alternative: a stop order just beyond the nearest level on the other side, if it is close.
  const over = dir > 0 ? resistances[0] : supports[0];
  const breakout: Tranche | null =
    over !== undefined && Math.abs(over / c - 1) < 0.15 ? { kind: "stop", price: over + dir * 0.25 * atr, sizePct: 100, reason: "plan.reason.breakout" } : null;

  // Stop beyond the deepest entry: one ATR, or just past the next level if that is close.
  const deepest = entries.reduce((m, e) => (dir > 0 ? Math.min(m, e.price) : Math.max(m, e.price)), c);
  const beyond = (dir > 0 ? supports : resistances).find((p) => (dir > 0 ? p < deepest - 0.25 * atr : p > deepest + 0.25 * atr));
  let stop = deepest - dir * atr;
  if (beyond !== undefined && Math.abs(deepest - beyond) <= 1.5 * atr) stop = beyond - dir * 0.25 * atr;
  // Never more than 3.5 ATR beyond the deepest entry (and a long stop stays above zero).
  if (dir > 0) stop = Math.max(stop, deepest - 3.5 * atr, deepest * 0.5);
  else stop = Math.min(stop, deepest + 3.5 * atr);

  const avg = entries.reduce((a, e) => a.plus(D(e.price).times(e.sizePct)), D(0)).div(100);
  const perUnit = avg.minus(stop).abs().plus(avg.plus(stop).times(s.feeRate));
  const riskBudget = D(s.equity).times(s.riskPct).div(100);
  let qty = perUnit.gt(0) ? riskBudget.div(perUnit) : D(0);
  // Volatile coins or a weak risk pillar: spot only (no leverage), otherwise cap by max leverage.
  const maxLev = dir < 0 ? Math.max(1, Math.min(s.maxLeverage, 2)) : risk < 40 ? 1 : Math.max(1, s.maxLeverage);
  const cap = D(s.equity).times(maxLev).div(avg);
  if (qty.gt(cap)) qty = cap;
  const notional = qty.times(avg);
  const leverage = Decimal.max(1, notional.div(s.equity));
  const riskAmount = qty.times(perUnit);
  const R = avg.minus(stop).abs().toNumber();
  const a = avg.toNumber();

  const farther = (dir > 0 ? resistances : supports).filter((p) => (dir > 0 ? p >= a + R : p <= a - R));
  const tp1 = farther[0] ?? a + dir * 1.5 * R;
  const tp2 = farther.find((p) => Math.abs(p - a) >= Math.abs(tp1 - a) + R) ?? a + dir * Math.max(3 * R, Math.abs(tp1 - a) + R);
  const tp3 = a + dir * Math.max(5 * R, Math.abs(tp2 - a) + 1.5 * R);
  const rrOf = (p: number) => Math.abs(p - a) / R;
  const targets: Target[] = [
    { price: tp1, sizePct: 40, rr: rrOf(tp1), reason: farther[0] !== undefined ? "plan.reason.level" : "plan.reason.rMultiple" },
    { price: tp2, sizePct: 30, rr: rrOf(tp2), reason: farther.includes(tp2) ? "plan.reason.level" : "plan.reason.rMultiple" },
    { price: tp3, sizePct: 30, rr: rrOf(tp3), reason: "plan.reason.trailing" },
  ];
  const rewardRisk = targets.reduce((acc, t) => acc + t.rr * t.sizePct, 0) / 100;

  // Chandelier exit: 3 ATR from the best close of the last 22 days.
  const recent = sc.close.slice(Math.max(0, i - 21), i + 1);
  const chandelier = dir > 0 ? Math.max(...recent) - 3 * atr : Math.min(...recent) + 3 * atr;

  const exitRules: ExitRule[] = [
    { id: "stop_close", params: { price: stop } },
    { id: "breakeven", params: { price: a } },
    { id: "trailing", params: { mult: 3, now: chandelier } },
    ...(dir > 0 ? [{ id: "rating_reduce" as const, params: { below: 45 } }, { id: "rating_exit" as const, params: { below: 30 } }] : [{ id: "rating_exit" as const, params: { below: 55 } }]),
    ...(fin(ema50) && (dir > 0 ? c > ema50 : c < ema50) ? [{ id: "ema50_close" as const, params: { price: ema50 } }] : []),
    { id: "time_stop", params: { days: 45 } },
  ];

  return {
    ...base,
    side: dir > 0 ? "LONG" : "SHORT",
    instrument: leverage.gt(1) || dir < 0 ? "futures" : "spot",
    leverage: leverage.toDecimalPlaces(2).toNumber(),
    entries,
    breakout,
    avgEntry: a,
    stopLoss: stop,
    quantity: qty.toNumber(),
    notional: notional.toDecimalPlaces(2).toNumber(),
    riskAmount: riskAmount.toDecimalPlaces(2).toNumber(),
    riskPctOfEquity: riskAmount.div(s.equity).times(100).toDecimalPlaces(2).toNumber(),
    targets,
    rewardRisk,
    exitRules,
  };
}
