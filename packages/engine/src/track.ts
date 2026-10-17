import type { TrackedSignal } from "./types";

const RANK: TrackedSignal["outcome"][] = ["pending", "open", "tp1", "tp2", "tp3"];

/** Replays candles after the signal: entry must trade first, then stop vs targets (stop wins ties). */
export function evaluateOutcome(tsig: TrackedSignal, after: { time: number; high: number; low: number; close: number }[], tfSec: number): TrackedSignal {
  const plan = tsig.signal.plan;
  if (!plan) return { ...tsig, outcome: "expired", updatedAt: Date.now() };
  const long = plan.side === "LONG";
  const risk = Math.abs(plan.entry - plan.stopLoss);
  let outcome: TrackedSignal["outcome"] = "pending";
  let best = 0;
  let stop = plan.stopLoss;
  for (const c of after) {
    if (outcome === "pending") {
      const touched = c.low <= plan.entryZone[1] && c.high >= plan.entryZone[0];
      if (!touched) {
        if ((c.time - tsig.signal.candleTime) / tfSec > 6) return { ...tsig, outcome: "expired", updatedAt: Date.now() };
        continue;
      }
      outcome = "open";
    }
    const adverse = long ? c.low <= stop : c.high >= stop;
    if (adverse) return { ...tsig, outcome: outcome === "open" ? "sl" : outcome, bestR: best, updatedAt: Date.now() };
    const fav = long ? c.high - plan.entry : plan.entry - c.low;
    best = Math.max(best, risk > 0 ? fav / risk : 0);
    const tps = plan.takeProfits;
    for (let k = tps.length - 1; k >= 0; k--) {
      const hit = long ? c.high >= tps[k]!.price : c.low <= tps[k]!.price;
      if (hit) {
        const o = (["tp1", "tp2", "tp3"] as const)[k]!;
        if (RANK.indexOf(o) > RANK.indexOf(outcome)) outcome = o;
        // After the first target the stop moves to breakeven, as the plan says.
        stop = plan.entry;
        break;
      }
    }
    if (outcome === "tp3") break;
  }
  return { ...tsig, outcome, bestR: best, updatedAt: Date.now() };
}
