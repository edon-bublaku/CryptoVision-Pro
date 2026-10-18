import type { Side } from "@cv/core";
import Decimal from "decimal.js";

/**
 * Paper trading: pending LIMIT/STOP orders and automatic SL / TP / liquidation exits, driven by
 * live prices. Pure functions so the browser engine and tests share the exact same rules.
 *
 * Fill model (conservative):
 * - LIMIT fills at the limit price, or better if price gapped through it.
 * - STOP becomes a market order when touched and fills at the observed price (slippage included).
 * - Stop-loss and liquidation exits fill at the observed price; take-profit (a limit) at its level.
 */

export type OrderType = "LIMIT" | "STOP";
export type ExitReason = "MANUAL" | "SL" | "TP" | "LIQ";

export interface PaperOrder {
  id: string;
  symbol: string;
  side: Side;
  type: OrderType;
  price: number;
  quantity: number;
  stopLoss?: number;
  takeProfit?: number;
  leverage: number;
  createdAt: number;
  /** Cancelled automatically after this time (ms). */
  expiresAt?: number;
  note?: string;
}

export interface PaperPosition {
  side: Side;
  entry: number;
  quantity: number;
  stopLoss?: number;
  takeProfit?: number;
  leverage: number;
}

export function orderTriggered(o: Pick<PaperOrder, "side" | "type" | "price">, price: number): boolean {
  const buy = o.side === "LONG";
  if (o.type === "LIMIT") return buy ? price <= o.price : price >= o.price;
  return buy ? price >= o.price : price <= o.price;
}

export function orderFillPrice(o: Pick<PaperOrder, "side" | "type" | "price">, price: number): number {
  if (o.type === "STOP") return price;
  return o.side === "LONG" ? Math.min(o.price, price) : Math.max(o.price, price);
}

/** Validates an order against the current price so it doesn't fill instantly by mistake. */
export function orderProblem(o: Pick<PaperOrder, "side" | "type" | "price" | "stopLoss" | "takeProfit" | "quantity">, lastPrice: number): string | null {
  if (!(o.quantity > 0)) return "quantity";
  if (!(o.price > 0)) return "price";
  if (orderTriggered(o, lastPrice)) return o.type === "LIMIT" ? "limitWouldFill" : "stopWouldFill";
  const long = o.side === "LONG";
  if (o.stopLoss !== undefined && (long ? o.stopLoss >= o.price : o.stopLoss <= o.price)) return "stopSide";
  if (o.takeProfit !== undefined && (long ? o.takeProfit <= o.price : o.takeProfit >= o.price)) return "targetSide";
  return null;
}

/** Isolated-margin liquidation estimate (maintenance margin 0.5%); null without leverage. */
export function liquidationPrice(p: Pick<PaperPosition, "side" | "entry" | "leverage">, maintenanceMargin = 0.005): number | null {
  if (!(p.leverage > 1)) return null;
  // At 1/leverage ≤ maintenance margin the position would be liquidated on entry: callers cap leverage.
  const inv = new Decimal(1).div(p.leverage);
  const e = new Decimal(p.entry);
  const mmr = new Decimal(maintenanceMargin);
  return (p.side === "LONG" ? e.times(new Decimal(1).minus(inv).plus(mmr)) : e.times(new Decimal(1).plus(inv).minus(mmr))).toNumber();
}

/** First exit the price has reached, checked in the order a real exchange would hit them. */
export function exitHit(p: PaperPosition, price: number): { reason: Exclude<ExitReason, "MANUAL">; price: number } | null {
  const long = p.side === "LONG";
  const liq = liquidationPrice(p);
  // A stop beyond the liquidation price never gets the chance to fill.
  const stopFirst = p.stopLoss !== undefined && (liq === null || (long ? p.stopLoss > liq : p.stopLoss < liq));
  if (stopFirst && (long ? price <= p.stopLoss! : price >= p.stopLoss!)) return { reason: "SL", price };
  if (liq !== null && (long ? price <= liq : price >= liq)) return { reason: "LIQ", price: liq };
  if (p.takeProfit !== undefined && (long ? price >= p.takeProfit : price <= p.takeProfit)) return { reason: "TP", price: p.takeProfit };
  return null;
}

/** Realised PnL (and R when a stop was set); a liquidation loses the whole margin. */
export function closeResult(p: PaperPosition, exit: number, reason: ExitReason): { pnl: number; r?: number } {
  const dir = p.side === "LONG" ? 1 : -1;
  const q = new Decimal(p.quantity);
  let pnl = new Decimal(exit).minus(p.entry).times(q).times(dir);
  // Isolated margin: no exit can lose more than the margin put up.
  if (p.leverage > 1) pnl = Decimal.max(pnl, new Decimal(p.entry).times(q).div(p.leverage).neg());
  if (reason === "LIQ") pnl = Decimal.min(pnl, new Decimal(p.entry).times(q).div(p.leverage).neg());
  const risk = p.stopLoss !== undefined ? new Decimal(p.entry).minus(p.stopLoss).abs().times(q) : null;
  return { pnl: pnl.toNumber(), r: risk && !risk.isZero() ? pnl.div(risk).toNumber() : undefined };
}
