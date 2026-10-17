import type { Signal } from "@cv/core";
import { formatPrice } from "@cv/core";
import type { Level } from "@cv/indicators";
import { translate, type Lang } from "./i18n";

/**
 * Deterministic plain-language explanation of a signal. It only restates numbers computed by
 * the engine — it never invents its own.
 */
export function buildNarrative(signal: Signal, levels: Level[], lang: Lang): { summary: string[]; bull: string; bear: string } {
  const tr = (k: string, p?: Record<string, string | number>) => translate(lang, k, p);
  const out: string[] = [];
  const r = signal.regime;
  out.push(tr(r === "TRENDING_UP" ? "narr.trend.up" : r === "TRENDING_DOWN" ? "narr.trend.down" : r === "HIGH_VOLATILITY" ? "narr.trend.vol" : r === "LOW_LIQUIDITY" ? "narr.trend.liq" : "narr.trend.range"));

  const plan = signal.plan;
  if (signal.strategyId && plan) {
    out.push(
      tr("narr.setup", {
        strategy: tr(`strategy.${signal.strategyId}`),
        entry: formatPrice(plan.entry),
        stop: formatPrice(plan.stopLoss),
        stopPct: plan.stopPct,
        tp1: formatPrice(plan.takeProfits[0]?.price ?? NaN),
        tp2: formatPrice(plan.takeProfits[1]?.price ?? NaN),
        tp3: formatPrice(plan.takeProfits[2]?.price ?? NaN),
      }),
    );
  } else out.push(tr("narr.nosetup"));

  const side = plan?.side ?? (signal.score >= 50 ? "LONG" : "SHORT");
  const dir = side === "LONG" ? 1 : -1;
  const pros = signal.factors.filter((f) => Math.sign(f.score) === dir && Math.abs(f.score) >= 0.3).slice(0, 4);
  const cons = signal.factors.filter((f) => Math.sign(f.score) === -dir && Math.abs(f.score) >= 0.3).slice(0, 3);
  if (pros.length) out.push(tr("narr.pros", { list: pros.map((f) => tr(f.label).toLowerCase()).join(", ") }));
  if (cons.length) out.push(tr("narr.cons", { list: cons.map((f) => tr(f.label).toLowerCase()).join(", ") }));

  if (signal.htfBias !== "NEUTRAL") {
    const conflict = (signal.htfBias === "BULLISH" && side === "SHORT") || (signal.htfBias === "BEARISH" && side === "LONG");
    out.push(tr(conflict ? "narr.htf.conflict" : "narr.htf.agree"));
  }

  const price = signal.price;
  const supports = levels.filter((l) => l.price < price).sort((a, b) => b.price - a.price);
  const resistances = levels.filter((l) => l.price > price).sort((a, b) => a.price - b.price);
  const s1 = supports[0]?.price;
  const r1 = resistances[0]?.price;
  if (s1 !== undefined || r1 !== undefined) out.push(tr("narr.levels", { support: s1 !== undefined ? formatPrice(s1) : "—", resistance: r1 !== undefined ? formatPrice(r1) : "—" }));

  const bull = r1 !== undefined ? tr("narr.bull", { resistance: formatPrice(r1), target: formatPrice(resistances[1]?.price ?? r1 * 1.05) }) : "";
  const bear = s1 !== undefined ? tr("narr.bear", { support: formatPrice(s1), target: formatPrice(supports[1]?.price ?? s1 * 0.95) }) : "";
  return { summary: out, bull, bear };
}
