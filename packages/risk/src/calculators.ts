import type { Side } from "@cv/core";
import Decimal from "decimal.js";

/**
 * Trader calculators (the /tools page). Pure, Decimal-based so the numbers on screen match
 * exactly what a broker statement would show. Invalid input returns null instead of NaN.
 */

const D = (v: number) => new Decimal(v);
const num = (d: Decimal, dp = 8) => d.toDecimalPlaces(dp).toNumber();
const pos = (...xs: number[]) => xs.every((x) => Number.isFinite(x) && x > 0);

// ── Average entry / DCA ─────────────────────────────────────────────────────

export interface Buy {
  price: number;
  /** Amount spent in quote currency (USDT). */
  amount: number;
}

export interface DcaResult {
  quantity: number;
  invested: number;
  avgPrice: number;
  fees: number;
  /** Price at which selling everything (paying the exit fee too) returns the money invested. */
  breakeven: number;
}

export function dca(buys: readonly Buy[], feeRate = 0.001): DcaResult | null {
  const valid = buys.filter((b) => pos(b.price, b.amount));
  if (!valid.length || !(feeRate >= 0 && feeRate < 0.5)) return null;
  const f = D(feeRate);
  let qty = D(0);
  let invested = D(0);
  let fees = D(0);
  for (const b of valid) {
    const fee = D(b.amount).times(f);
    fees = fees.plus(fee);
    invested = invested.plus(b.amount);
    qty = qty.plus(D(b.amount).minus(fee).div(b.price));
  }
  return {
    quantity: num(qty),
    invested: num(invested, 2),
    avgPrice: num(invested.div(qty)),
    fees: num(fees, 4),
    breakeven: num(invested.div(qty.times(D(1).minus(f)))),
  };
}

/**
 * Quantity to buy at `price` so that the position's average becomes `target`.
 * Null when the target can't be reached by buying at that price (it must lie between the two).
 */
export function quantityForTargetAverage(holdingQty: number, holdingAvg: number, price: number, target: number): number | null {
  if (!pos(holdingQty, holdingAvg, price, target)) return null;
  const lo = Math.min(holdingAvg, price);
  const hi = Math.max(holdingAvg, price);
  if (!(target > lo && target < hi)) return null;
  return num(D(holdingQty).times(D(holdingAvg).minus(target)).div(D(target).minus(price)));
}

// ── Leverage / liquidation ──────────────────────────────────────────────────

export interface LeverageInput {
  side: Side;
  entry: number;
  leverage: number;
  /** Margin put up, in quote currency. */
  margin: number;
  /** Maintenance margin rate (Binance-style tier 1 ≈ 0.4–0.5%). */
  maintenanceMargin?: number;
  /** Price to evaluate PnL at. */
  exit?: number;
  feeRate?: number;
}

export interface LeverageResult {
  notional: number;
  quantity: number;
  /** Isolated-margin estimate. */
  liquidation: number;
  /** Adverse move from entry to liquidation, in %. */
  distanceToLiquidationPct: number;
  pnl?: number;
  /** PnL relative to margin, in %. */
  roe?: number;
  fees: number;
}

export function leverageCalc(i: LeverageInput): LeverageResult | null {
  if (!pos(i.entry, i.leverage, i.margin) || i.leverage > 125) return null;
  const mmr = D(i.maintenanceMargin ?? 0.005);
  const notional = D(i.margin).times(i.leverage);
  const qty = notional.div(i.entry);
  const inv = D(1).div(i.leverage);
  const long = i.side === "LONG";
  const liq = long ? D(i.entry).times(D(1).minus(inv).plus(mmr)) : D(i.entry).times(D(1).plus(inv).minus(mmr));
  const fee = D(i.feeRate ?? 0.0005);
  const exit = i.exit !== undefined && i.exit > 0 ? D(i.exit) : null;
  const fees = notional.times(fee).plus(exit ? qty.times(exit).times(fee) : notional.times(fee));
  const out: LeverageResult = {
    notional: num(notional, 2),
    quantity: num(qty),
    liquidation: num(Decimal.max(0, liq)),
    distanceToLiquidationPct: num(liq.minus(i.entry).abs().div(i.entry).times(100), 4),
    fees: num(fees, 4),
  };
  if (exit) {
    const pnl = exit.minus(i.entry).times(qty).times(long ? 1 : -1).minus(fees);
    out.pnl = num(pnl, 4);
    out.roe = num(pnl.div(i.margin).times(100), 4);
  }
  return out;
}

// ── Risk : reward targets ───────────────────────────────────────────────────

export interface TargetsResult {
  risk: number;
  riskPct: number;
  targets: { r: number; price: number; movePct: number }[];
  /** Win rate needed to break even at each R multiple: 1 / (1 + R). */
  breakevenWinRate: { r: number; winRate: number }[];
}

export function rrTargets(side: Side, entry: number, stop: number, multiples: readonly number[] = [1, 1.5, 2, 3, 5]): TargetsResult | null {
  if (!pos(entry, stop) || entry === stop) return null;
  const dir = side === "LONG" ? 1 : -1;
  // The stop must be on the losing side.
  if ((stop - entry) * dir > 0) return null;
  const R = D(entry).minus(stop).abs();
  return {
    risk: num(R),
    riskPct: num(R.div(entry).times(100), 4),
    targets: multiples.map((m) => {
      const price = D(entry).plus(R.times(m).times(dir));
      return { r: m, price: num(price), movePct: num(price.minus(entry).div(entry).times(100), 4) };
    }),
    breakevenWinRate: multiples.map((m) => ({ r: m, winRate: num(D(1).div(D(1).plus(m)).times(100), 2) })),
  };
}

// ── Compounding / goals ─────────────────────────────────────────────────────

export interface CompoundInput {
  start: number;
  /** Return per period, in % (can be negative). */
  ratePct: number;
  periods: number;
  /** Added at the end of every period. */
  contribution?: number;
}

export function compound(i: CompoundInput): { balance: number; contributed: number; gain: number; path: number[] } | null {
  if (!(i.start >= 0) || !Number.isInteger(i.periods) || i.periods < 0 || i.periods > 1200 || !(i.ratePct > -100)) return null;
  const g = D(1).plus(D(i.ratePct).div(100));
  const c = D(i.contribution ?? 0);
  let bal = D(i.start);
  const path = [num(bal, 2)];
  for (let k = 0; k < i.periods; k++) {
    bal = bal.times(g).plus(c);
    path.push(num(bal, 2));
  }
  const contributed = D(i.start).plus(c.times(i.periods));
  return { balance: num(bal, 2), contributed: num(contributed, 2), gain: num(bal.minus(contributed), 2), path };
}

/** Return per period (in %) needed to grow `start` into `target` in `periods` periods. */
export function requiredRate(start: number, target: number, periods: number): number | null {
  if (!pos(start, target, periods)) return null;
  return num(D(target).div(start).pow(D(1).div(periods)).minus(1).times(100), 4);
}

/** Gain needed to get back to even after a loss: a 50% loss needs +100%. */
export function recoveryGain(lossPct: number): number | null {
  if (!(lossPct >= 0 && lossPct < 100)) return null;
  const l = D(lossPct).div(100);
  return num(l.div(D(1).minus(l)).times(100), 4);
}
