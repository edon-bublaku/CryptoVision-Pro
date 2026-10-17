import Decimal from "decimal.js";
import type { Side, TakeProfit, TradePlan } from "@cv/core";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN });

export interface RiskConfig {
  /** Minimum stop distance in ATRs — tighter stops get hunted by noise. */
  minStopAtr: number;
  /** Buffer beyond the structural level, in ATRs. */
  stopBufferAtr: number;
  /** Hard cap on stop distance as % of entry. */
  maxStopPct: number;
  /** R multiples for TP1/TP2; TP3 is the runner. */
  targetsR: [number, number, number];
  targetSizes: [number, number, number];
  /** Signals below this R:R (to TP2) are downgraded to watch-list. */
  minRiskReward: number;
}

export const DEFAULT_RISK: RiskConfig = {
  minStopAtr: 1,
  stopBufferAtr: 0.5,
  maxStopPct: 8,
  targetsR: [1.5, 3, 5],
  targetSizes: [40, 40, 20],
  minRiskReward: 1.5,
};

export interface PlanInput {
  side: Side;
  entry: number;
  atr: number;
  /** Nearest swing low (long) / swing high (short) that invalidates the idea. */
  structuralStop?: number;
  /** Next opposing level (resistance for long, support for short); caps TP1 if closer. */
  nextLevel?: number;
  config?: Partial<RiskConfig>;
}

/**
 * Builds entry / stop / targets. The stop is the farther of the structural level (plus buffer)
 * and the ATR minimum, so noise alone should not trigger it; capped at `maxStopPct`.
 */
export function buildTradePlan(input: PlanInput): TradePlan | null {
  const cfg = { ...DEFAULT_RISK, ...input.config };
  const { side, entry, atr } = input;
  if (!(entry > 0) || !(atr > 0)) return null;
  const dir = side === "LONG" ? 1 : -1;
  const e = new Decimal(entry);
  const a = new Decimal(atr);

  const atrStop = e.minus(a.times(cfg.minStopAtr).times(dir));
  let stop = atrStop;
  if (input.structuralStop !== undefined && Number.isFinite(input.structuralStop)) {
    const structural = new Decimal(input.structuralStop).minus(a.times(cfg.stopBufferAtr).times(dir));
    // Use whichever is farther from entry, so the stop sits beyond both noise and structure.
    stop = dir === 1 ? Decimal.min(atrStop, structural) : Decimal.max(atrStop, structural);
  }
  const maxDist = e.times(cfg.maxStopPct).div(100);
  if (e.minus(stop).abs().gt(maxDist)) stop = e.minus(maxDist.times(dir));
  const risk = e.minus(stop).abs();
  if (risk.isZero()) return null;

  const takeProfits: TakeProfit[] = cfg.targetsR.map((r, i) => ({
    price: e.plus(risk.times(r).times(dir)).toNumber(),
    sizePct: cfg.targetSizes[i]!,
    rr: r,
  }));

  // A strong opposing level before TP1 makes the setup worse: pull TP1 in front of it.
  if (input.nextLevel !== undefined && Number.isFinite(input.nextLevel)) {
    const lvl = new Decimal(input.nextLevel);
    const tp1 = takeProfits[0]!;
    const beyondEntry = lvl.minus(e).times(dir).gt(0);
    if (beyondEntry && lvl.minus(new Decimal(tp1.price)).times(dir).lt(0)) {
      const adjusted = lvl.minus(a.times(0.1).times(dir));
      tp1.price = adjusted.toNumber();
      tp1.rr = adjusted.minus(e).abs().div(risk).toDecimalPlaces(2).toNumber();
    }
  }

  const weighted = takeProfits.reduce((s, tp) => s + (tp.rr * tp.sizePct) / 100, 0);
  const zoneHalf = a.times(0.25);
  return {
    side,
    entry,
    entryZone: [e.minus(zoneHalf).toNumber(), e.plus(zoneHalf).toNumber()],
    stopLoss: stop.toNumber(),
    takeProfits,
    riskReward: Math.round(weighted * 100) / 100,
    stopPct: risk.div(e).times(100).toDecimalPlaces(2).toNumber(),
    invalidation: stop.toString(),
  };
}

export interface SizingInput {
  equity: number;
  /** % of equity at risk if the stop is hit. */
  riskPct: number;
  entry: number;
  stopLoss: number;
  maxLeverage: number;
  /** Taker fee per side, e.g. 0.001 = 0.1%. */
  feeRate?: number;
  /** Maintenance margin rate for liquidation estimate. */
  maintenanceMargin?: number;
}

export interface PositionSize {
  quantity: number;
  notional: number;
  riskAmount: number;
  /** Fees for entry + stop exit. */
  fees: number;
  leverage: number;
  margin: number;
  liquidationPrice: number | null;
  /** True when maxLeverage forced a smaller position than the risk budget allowed. */
  cappedByLeverage: boolean;
}

/** size = equity × risk% / |entry − stop|, then capped by leverage. Fees are counted in the risk. */
export function positionSize(input: SizingInput): PositionSize | null {
  const { equity, riskPct, entry, stopLoss, maxLeverage } = input;
  if (!(equity > 0) || !(entry > 0) || !(riskPct > 0) || entry === stopLoss) return null;
  const fee = new Decimal(input.feeRate ?? 0.001);
  const eq = new Decimal(equity);
  const e = new Decimal(entry);
  const s = new Decimal(stopLoss);
  const budget = eq.times(riskPct).div(100);
  const perUnit = e.minus(s).abs().plus(e.plus(s).times(fee));
  let qty = budget.div(perUnit);
  const maxNotional = eq.times(Math.max(1, maxLeverage));
  let capped = false;
  if (qty.times(e).gt(maxNotional)) {
    qty = maxNotional.div(e);
    capped = true;
  }
  const notional = qty.times(e);
  const leverage = Decimal.max(1, notional.div(eq));
  const margin = notional.div(leverage);
  let liquidationPrice: number | null = null;
  if (leverage.gt(1)) {
    const mmr = new Decimal(input.maintenanceMargin ?? 0.005);
    const isLong = stopLoss < entry;
    const inv = new Decimal(1).div(leverage);
    liquidationPrice = (isLong ? e.times(new Decimal(1).minus(inv).plus(mmr)) : e.times(new Decimal(1).plus(inv).minus(mmr))).toNumber();
  }
  return {
    quantity: qty.toNumber(),
    notional: notional.toDecimalPlaces(2).toNumber(),
    riskAmount: qty.times(perUnit).toDecimalPlaces(2).toNumber(),
    fees: qty.times(e.plus(s)).times(fee).toDecimalPlaces(2).toNumber(),
    leverage: leverage.toDecimalPlaces(2).toNumber(),
    margin: margin.toDecimalPlaces(2).toNumber(),
    liquidationPrice,
    cappedByLeverage: capped,
  };
}

/**
 * Kelly fraction f* = W − (1 − W) / R where R = avgWin / avgLoss.
 * Returned at the given fraction (¼ Kelly default) and never negative.
 */
export function kellyFraction(winRate: number, avgWin: number, avgLoss: number, fraction = 0.25): number {
  if (!(avgLoss > 0) || !(avgWin > 0)) return 0;
  const r = avgWin / avgLoss;
  return Math.max(0, (winRate - (1 - winRate) / r) * fraction);
}

export type RiskProfile = "conservative" | "moderate" | "aggressive";

export const RISK_PROFILES: Record<RiskProfile, { riskPct: number; maxLeverage: number; maxPositions: number }> = {
  conservative: { riskPct: 0.5, maxLeverage: 1, maxPositions: 3 },
  moderate: { riskPct: 1, maxLeverage: 3, maxPositions: 5 },
  aggressive: { riskPct: 2, maxLeverage: 5, maxPositions: 8 },
};

/** PnL for a position, fees excluded. */
export function unrealizedPnl(side: Side, entry: number, price: number, quantity: number): { pnl: number; pct: number } {
  const d = new Decimal(price).minus(entry).times(side === "LONG" ? 1 : -1);
  return {
    pnl: d.times(quantity).toDecimalPlaces(2).toNumber(),
    pct: d.div(entry).times(100).toDecimalPlaces(2).toNumber(),
  };
}
