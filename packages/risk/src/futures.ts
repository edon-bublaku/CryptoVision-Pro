import type { Side } from "@cv/core";
import Decimal from "decimal.js";

/**
 * Futures (perpetual swap) trade plan. The risk budget decides the position size; leverage only
 * decides how much margin backs it and where liquidation sits. So leverage is chosen last, as the
 * lowest value that keeps the margin within a share of the account, and never so high that the
 * liquidation price comes near the stop-loss. Numbers follow Binance/OKX USDT-margined linear
 * contracts (taker fees on entry and exit, funding every few hours, maintenance margin rate).
 */

export interface FuturesInput {
  side: Side;
  entry: number;
  stopLoss: number;
  /** Take-profit ladder; sizes in % of the position (should sum to 100). */
  targets: { price: number; sizePct: number }[];
  /** Account balance in USDT. */
  equity: number;
  /** % of the account lost if the stop is hit (fees and funding included). */
  riskPct: number;
  /** Highest leverage the user accepts. */
  maxLeverage: number;
  /** Maintenance margin rate (tier 1 ≈ 0.4–0.5%). */
  maintenanceMargin?: number;
  /** Taker fee per side (0.0005 = 0.05%). */
  takerFee?: number;
  /** Current funding rate per settlement (0.0001 = 0.01%). Positive: longs pay shorts. */
  fundingRate?: number;
  fundingIntervalHours?: number;
  /** Expected holding time, for the funding estimate. */
  holdHours?: number;
  /** Liquidation must be at least this many stop distances from entry. */
  liqBuffer?: number;
  /** Margin the position may lock, as a share of the account. */
  maxMarginShare?: number;
  /**
   * Next opposing level (resistance for a long, support for a short). As in `buildTradePlan`, the
   * net R:R only counts each target up to this level, where the move is most likely to stall.
   */
  nextLevel?: number;
}

export type FuturesWarning =
  | "leverage_capped_by_safety"
  | "risk_reduced_by_leverage"
  | "margin_heavy"
  | "funding_against"
  | "high_leverage"
  | "rr_low"
  | "cross_liq_near";

export interface FuturesTarget {
  price: number;
  sizePct: number;
  /** Gross reward/risk of this target, from entry and stop only. */
  rr: number;
  /** PnL of this tranche after its exit fee (entry fee and funding are in `costs`). */
  pnl: number;
  /** PnL of this tranche relative to its share of the margin, in %. */
  roe: number;
}

export interface FuturesPlan {
  side: Side;
  entry: number;
  stopLoss: number;
  quantity: number;
  notional: number;
  /** Recommended leverage (integer). */
  leverage: number;
  /** Highest leverage that keeps liquidation `liqBuffer` stop distances away. */
  maxSafeLeverage: number;
  margin: number;
  /** Loss at the stop: price move + fees + funding for the hold. */
  riskAmount: number;
  riskPctActual: number;
  stopPct: number;
  isolated: { liquidation: number; distancePct: number; maxLoss: number };
  /** Cross margin uses the whole balance: liquidation is farther, but the whole balance is at stake. */
  cross: { liquidation: number | null; distancePct: number | null; maxLoss: number };
  marginMode: "isolated";
  costs: { entryFee: number; exitFeeAtStop: number; fundingForHold: number };
  funding: { ratePerInterval: number; intervalHours: number; perInterval: number; annualizedPct: number; youPay: boolean };
  /** Price at which closing everything returns zero after fees and the hold's funding. */
  breakeven: number;
  targets: FuturesTarget[];
  /** Size-weighted net reward over net risk, targets capped at `nextLevel`. */
  rrNet: number;
  warnings: FuturesWarning[];
}

const D = (v: number) => new Decimal(v);
const num = (d: Decimal, dp = 8) => d.toDecimalPlaces(dp).toNumber();
const ok = (...xs: number[]) => xs.every((x) => Number.isFinite(x) && x > 0);

export function futuresPlan(i: FuturesInput): FuturesPlan | null {
  const mmr = i.maintenanceMargin ?? 0.005;
  const fee = D(i.takerFee ?? 0.0005);
  const buffer = i.liqBuffer ?? 1.5;
  const marginShare = i.maxMarginShare ?? 0.25;
  const rate = i.fundingRate ?? 0;
  const interval = i.fundingIntervalHours && i.fundingIntervalHours > 0 ? i.fundingIntervalHours : 8;
  const hold = i.holdHours ?? 24;
  if (!ok(i.entry, i.stopLoss, i.equity, i.riskPct, i.maxLeverage) || !(mmr >= 0 && mmr < 0.5) || !Number.isFinite(rate)) return null;
  const dir = i.side === "LONG" ? 1 : -1;
  const e = D(i.entry);
  const s = D(i.stopLoss);
  // The stop must sit on the losing side.
  if (!e.minus(s).times(dir).gt(0)) return null;
  const stopFrac = e.minus(s).abs().div(e);

  // Funding paid per unit over the hold (negative = received). Longs pay a positive rate.
  const settlements = Math.max(0, hold) / interval;
  const fundingPerUnit = e.times(rate).times(settlements).times(dir);
  const perUnitRisk = e.minus(s).abs().plus(e.plus(s).times(fee)).plus(Decimal.max(0, fundingPerUnit));
  let qty = D(i.equity).times(i.riskPct).div(100).div(perUnitRisk);

  // Liquidation (isolated) sits (1/L − mmr) from entry: keep it ≥ buffer × stop distance.
  const maxSafe = Math.max(1, Math.min(125, Math.floor(1 / (buffer * stopFrac.toNumber() + mmr))));
  const cap = Math.max(1, Math.min(Math.floor(i.maxLeverage), maxSafe));
  const warnings: FuturesWarning[] = [];
  if (maxSafe < Math.floor(i.maxLeverage)) warnings.push("leverage_capped_by_safety");
  // The whole position can't need more leverage than allowed: shrink it (the risk falls below budget).
  if (qty.times(e).gt(D(i.equity).times(cap))) {
    qty = D(i.equity).times(cap).div(e);
    warnings.push("risk_reduced_by_leverage");
  }
  const notional = qty.times(e);
  // Lowest leverage that keeps the margin within `marginShare` of the account.
  let leverage = Math.max(1, Math.ceil(num(notional.div(D(i.equity).times(marginShare)), 6)));
  if (leverage > cap) {
    leverage = cap;
    warnings.push("margin_heavy");
  }
  if (leverage > 10) warnings.push("high_leverage");
  const margin = notional.div(leverage);

  const inv = D(1).div(leverage);
  const liqIso = dir > 0 ? e.times(D(1).minus(inv).plus(mmr)) : e.times(D(1).plus(inv).minus(mmr));
  // Cross: the balance absorbs losses until equity + PnL = maintenance margin at the mark price.
  //   long:  W + (P − E)q = mmr·P·q  →  P = (E·q − W) / (q(1 − mmr))
  //   short: W + (E − P)q = mmr·P·q  →  P = (W + E·q) / (q(1 + mmr))
  const W = D(i.equity);
  const liqCrossRaw = dir > 0 ? e.times(qty).minus(W).div(qty.times(D(1).minus(mmr))) : W.plus(e.times(qty)).div(qty.times(D(1).plus(mmr)));
  const liqCross = liqCrossRaw.gt(0) ? liqCrossRaw : null;
  if (liqCross && liqCross.minus(s).times(dir).gte(0)) warnings.push("cross_liq_near");

  const entryFee = notional.times(fee);
  const exitFeeAtStop = qty.times(s).times(fee);
  const fundingForHold = qty.times(fundingPerUnit);
  if (fundingForHold.gt(0) && fundingForHold.gt(D(i.equity).times(i.riskPct).div(100).times(0.1))) warnings.push("funding_against");
  const riskAmount = qty.times(perUnitRisk);

  // Breakeven for the whole position after entry and exit fees and the hold's funding.
  const f = fee;
  const fu = fundingPerUnit;
  const breakeven = dir > 0 ? e.times(D(1).plus(f)).plus(fu).div(D(1).minus(f)) : e.times(D(1).minus(f)).minus(fu).div(D(1).plus(f));

  const risk = e.minus(s).abs();
  const totalPct = i.targets.reduce((a, t) => a + Math.max(0, t.sizePct), 0) || 100;
  const targets: FuturesTarget[] = i.targets
    .filter((t) => t.price > 0 && D(t.price).minus(e).times(dir).gt(0))
    .map((t) => {
      const share = D(Math.max(0, t.sizePct)).div(totalPct);
      const q = qty.times(share);
      const pnl = D(t.price).minus(e).times(dir).times(q).minus(q.times(t.price).times(fee));
      const m = margin.times(share);
      return {
        price: t.price,
        sizePct: t.sizePct,
        rr: num(D(t.price).minus(e).abs().div(risk), 4),
        pnl: num(pnl, 4),
        roe: m.gt(0) ? num(pnl.div(m).times(100), 2) : 0,
      };
    });
  const lvl = i.nextLevel !== undefined && Number.isFinite(i.nextLevel) && D(i.nextLevel).minus(e).times(dir).gt(0) ? D(i.nextLevel) : null;
  const capped = (price: number) => (lvl ? (dir > 0 ? Decimal.min(price, lvl) : Decimal.max(price, lvl)) : D(price));
  const reward = targets
    .reduce((a, t) => {
      const q = qty.times(D(Math.max(0, t.sizePct)).div(totalPct));
      const p = capped(t.price);
      return a.plus(p.minus(e).times(dir).times(q).minus(q.times(p).times(fee)));
    }, D(0))
    .minus(entryFee)
    .minus(fundingForHold);
  const rrNet = riskAmount.gt(0) ? num(reward.div(riskAmount), 4) : 0;
  if (rrNet < 1.5) warnings.push("rr_low");

  return {
    side: i.side,
    entry: i.entry,
    stopLoss: i.stopLoss,
    quantity: num(qty),
    notional: num(notional, 2),
    leverage,
    maxSafeLeverage: maxSafe,
    margin: num(margin, 2),
    riskAmount: num(riskAmount, 2),
    riskPctActual: num(riskAmount.div(i.equity).times(100), 4),
    stopPct: num(stopFrac.times(100), 4),
    isolated: { liquidation: num(Decimal.max(0, liqIso)), distancePct: num(liqIso.minus(e).abs().div(e).times(100), 4), maxLoss: num(margin.plus(entryFee), 2) },
    cross: {
      liquidation: liqCross ? num(liqCross) : null,
      distancePct: liqCross ? num(liqCross.minus(e).abs().div(e).times(100), 4) : null,
      maxLoss: num(W, 2),
    },
    marginMode: "isolated",
    costs: { entryFee: num(entryFee, 4), exitFeeAtStop: num(exitFeeAtStop, 4), fundingForHold: num(fundingForHold, 4) },
    funding: {
      ratePerInterval: rate,
      intervalHours: interval,
      perInterval: num(notional.times(rate).times(dir), 4),
      annualizedPct: num(D(rate).times(24 / interval).times(365).times(100), 4),
      youPay: rate * dir > 0,
    },
    breakeven: num(breakeven),
    targets,
    rrNet,
    warnings,
  };
}
