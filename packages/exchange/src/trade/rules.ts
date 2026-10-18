import Decimal from "decimal.js";
import { z } from "zod";

/**
 * Exchange filters decide whether Binance accepts an order at all, so every price and quantity is
 * rounded and checked here, in Decimal, before anything is sent. Rounding is never left to
 * floating point or to the exchange: a quantity is always floored to the step (never more than the
 * user confirmed), and prices are rounded in the direction the caller asks for.
 */

export type Market = "spot" | "futures";
export type TradeEnv = "testnet" | "live";

export const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -40, toExpPos: 40 });
export type Dec = Decimal;
export const dec = (v: Decimal.Value) => new Dec(v);

export interface SymbolRules {
  market: Market;
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  tickSize: string;
  minPrice: string;
  maxPrice: string;
  stepSize: string;
  minQty: string;
  maxQty: string;
  /** MARKET orders; equal to the LOT_SIZE values when the symbol has no separate market filter. */
  marketStepSize: string;
  marketMinQty: string;
  marketMaxQty: string;
  minNotional: string;
  applyMinToMarket: boolean;
  maxNotional: string | null;
  /** Futures PERCENT_PRICE: limit price must stay within mark × [down, up]. */
  percentPrice: { up: string; down: string } | null;
  /** Spot PERCENT_PRICE_BY_SIDE, relative to the average price. */
  percentPriceBySide: { bidUp: string; bidDown: string; askUp: string; askDown: string } | null;
  ocoAllowed: boolean;
  otoAllowed: boolean;
  opoAllowed: boolean;
}

const num = z.union([z.string(), z.number()]).transform(String);
const filter = z.object({ filterType: z.string() }).catchall(z.unknown());
const symbolSchema = z.object({
  symbol: z.string(),
  status: z.string(),
  baseAsset: z.string(),
  quoteAsset: z.string(),
  ocoAllowed: z.boolean().optional(),
  otoAllowed: z.boolean().optional(),
  opoAllowed: z.boolean().optional(),
  contractType: z.string().optional(),
  filters: z.array(filter),
});
export const exchangeInfoSchema = z.object({ symbols: z.array(symbolSchema) });

function field(f: Record<string, unknown> | undefined, k: string, fallback = "0"): string {
  const v = f?.[k];
  return v === undefined || v === null ? fallback : num.parse(v);
}

/** Parses one `exchangeInfo` symbol (spot or USDⓈ-M futures) into the rules used for validation. */
export function parseSymbolRules(market: Market, raw: unknown): SymbolRules {
  const s = symbolSchema.parse(raw);
  const by = (t: string) => s.filters.find((f) => f.filterType === t) as Record<string, unknown> | undefined;
  const price = by("PRICE_FILTER");
  const lot = by("LOT_SIZE");
  const mlot = by("MARKET_LOT_SIZE");
  const notional = by("NOTIONAL");
  const minNotional = by("MIN_NOTIONAL");
  const pp = by("PERCENT_PRICE");
  const ppSide = by("PERCENT_PRICE_BY_SIDE");
  const lotStep = field(lot, "stepSize");
  // A MARKET_LOT_SIZE with stepSize 0 means "not configured": LOT_SIZE applies.
  const mStep = mlot && dec(field(mlot, "stepSize")).gt(0) ? field(mlot, "stepSize") : lotStep;
  let min = "0";
  let applyMin = true;
  let max: string | null = null;
  if (market === "futures") min = field(minNotional, "notional");
  else if (notional) {
    min = field(notional, "minNotional");
    applyMin = notional.applyMinToMarket !== false;
    const m = field(notional, "maxNotional", "");
    max = m && dec(m).gt(0) ? m : null;
  } else if (minNotional) {
    min = field(minNotional, "minNotional");
    applyMin = minNotional.applyToMarket !== false;
  }
  return {
    market,
    symbol: s.symbol,
    status: s.status,
    baseAsset: s.baseAsset,
    quoteAsset: s.quoteAsset,
    tickSize: field(price, "tickSize"),
    minPrice: field(price, "minPrice"),
    maxPrice: field(price, "maxPrice"),
    stepSize: lotStep,
    minQty: field(lot, "minQty"),
    maxQty: field(lot, "maxQty"),
    marketStepSize: mStep,
    marketMinQty: mlot ? field(mlot, "minQty") : field(lot, "minQty"),
    marketMaxQty: mlot && dec(field(mlot, "maxQty")).gt(0) ? field(mlot, "maxQty") : field(lot, "maxQty"),
    minNotional: min,
    applyMinToMarket: applyMin,
    maxNotional: max,
    percentPrice: market === "futures" && pp ? { up: field(pp, "multiplierUp"), down: field(pp, "multiplierDown") } : null,
    percentPriceBySide: ppSide
      ? { bidUp: field(ppSide, "bidMultiplierUp"), bidDown: field(ppSide, "bidMultiplierDown"), askUp: field(ppSide, "askMultiplierUp"), askDown: field(ppSide, "askMultiplierDown") }
      : null,
    // Futures order lists don't exist; the flags only matter on spot.
    ocoAllowed: s.ocoAllowed ?? false,
    otoAllowed: s.otoAllowed ?? false,
    opoAllowed: s.opoAllowed ?? false,
  };
}

/** Number of decimals a step implies ("0.00100000" → 3), so output strings carry no float noise. */
export function stepDecimals(step: string): number {
  const d = dec(step);
  return d.isZero() ? 8 : d.decimalPlaces();
}

export type Rounding = "down" | "up" | "nearest";

function toStep(value: Decimal.Value, step: string, mode: Rounding): Dec {
  const v = dec(value);
  const s = dec(step);
  if (s.isZero()) return v;
  const units = v.div(s);
  const n = mode === "down" ? units.floor() : mode === "up" ? units.ceil() : units.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return n.times(s);
}

/** Price on the tick grid, as the exact string sent to Binance. */
export function roundPrice(rules: SymbolRules, price: Decimal.Value, mode: Rounding = "nearest"): string {
  return toStep(price, rules.tickSize, mode).toFixed(stepDecimals(rules.tickSize));
}

/** Quantity floored to the step: never more than requested. */
export function roundQty(rules: SymbolRules, qty: Decimal.Value, market = false): string {
  const step = market ? rules.marketStepSize : rules.stepSize;
  const q = toStep(qty, step, "down");
  return (q.isNegative() ? dec(0) : q).toFixed(stepDecimals(step));
}

export type RuleIssue =
  | "symbol_not_trading"
  | "qty_below_min"
  | "qty_above_max"
  | "qty_step"
  | "price_below_min"
  | "price_above_max"
  | "price_tick"
  | "notional_below_min"
  | "notional_above_max"
  | "price_out_of_band";

export interface OrderCheck {
  side: "BUY" | "SELL";
  /** Limit price, or the trigger price of a stop/take-profit. */
  price?: string;
  stopPrice?: string;
  quantity: string;
  /** Executes at market (MARKET, STOP_MARKET, TAKE_PROFIT_MARKET, spot STOP_LOSS). */
  market?: boolean;
  /** Futures reduce-only/close orders are exempt from the minimum notional. */
  reduceOnly?: boolean;
  /** Price used for notional when the order has none (market), and for the percent-price band. */
  refPrice: string;
  /** Apply PERCENT_PRICE bands (only for prices that rest on the book). */
  band?: boolean;
}

function onGrid(value: string, step: string): boolean {
  const s = dec(step);
  return s.isZero() || dec(value).mod(s).isZero();
}

/** Every filter Binance would apply to this order, evaluated locally. Empty = accepted. */
export function checkOrder(rules: SymbolRules, o: OrderCheck): RuleIssue[] {
  const out: RuleIssue[] = [];
  if (rules.status !== "TRADING") out.push("symbol_not_trading");
  const q = dec(o.quantity);
  const min = dec(o.market ? rules.marketMinQty : rules.minQty);
  const max = dec(o.market ? rules.marketMaxQty : rules.maxQty);
  if (q.lte(0) || q.lt(min)) out.push("qty_below_min");
  if (max.gt(0) && q.gt(max)) out.push("qty_above_max");
  if (!onGrid(o.quantity, o.market ? rules.marketStepSize : rules.stepSize)) out.push("qty_step");
  for (const p of [o.price, o.stopPrice]) {
    if (p === undefined) continue;
    if (dec(rules.minPrice).gt(0) && dec(p).lt(rules.minPrice)) out.push("price_below_min");
    if (dec(rules.maxPrice).gt(0) && dec(p).gt(rules.maxPrice)) out.push("price_above_max");
    if (!onGrid(p, rules.tickSize)) out.push("price_tick");
  }
  const px = dec(o.market ? o.refPrice : (o.price ?? o.refPrice));
  const notional = px.times(q);
  const minApplies = !(o.market && !rules.applyMinToMarket) && !(rules.market === "futures" && o.reduceOnly);
  if (minApplies && notional.lt(rules.minNotional)) out.push("notional_below_min");
  if (rules.maxNotional && !o.market && notional.gt(rules.maxNotional)) out.push("notional_above_max");
  if (o.band && o.price) {
    const ref = dec(o.refPrice);
    const p = dec(o.price);
    if (rules.percentPrice) {
      if (p.gt(ref.times(rules.percentPrice.up)) || p.lt(ref.times(rules.percentPrice.down))) out.push("price_out_of_band");
    } else if (rules.percentPriceBySide) {
      const b = rules.percentPriceBySide;
      const [up, down] = o.side === "BUY" ? [b.bidUp, b.bidDown] : [b.askUp, b.askDown];
      if (p.gt(ref.times(up)) || p.lt(ref.times(down))) out.push("price_out_of_band");
    }
  }
  return [...new Set(out)];
}

/**
 * Splits a position across take-profits by percentage on the lot grid. Every tranche is floored
 * except the last, which takes the remainder so the total equals the position exactly. Tranches
 * below the minimum quantity are merged into the next one (or the previous, for the last).
 */
export function splitQuantity(rules: SymbolRules, total: string, pcts: number[]): string[] {
  const t = dec(total);
  if (pcts.length === 0 || t.lte(0)) return [];
  const sum = pcts.reduce((a, p) => a + Math.max(0, p), 0) || 1;
  const parts: Dec[] = [];
  let used = dec(0);
  pcts.forEach((p, i) => {
    const q = i === pcts.length - 1 ? t.minus(used) : dec(roundQty(rules, t.times(Math.max(0, p)).div(sum)));
    parts.push(q);
    used = used.plus(q);
  });
  const min = dec(rules.minQty);
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i]!.lt(min) || parts[i]!.isZero()) {
      parts[i + 1] = parts[i + 1]!.plus(parts[i]!);
      parts[i] = dec(0);
    }
  }
  const last = parts.length - 1;
  if (last > 0 && parts[last]!.lt(min)) {
    let j = last - 1;
    while (j > 0 && parts[j]!.isZero()) j--;
    parts[j] = parts[j]!.plus(parts[last]!);
    parts[last] = dec(0);
  }
  const d = stepDecimals(rules.stepSize);
  return parts.map((p) => p.toFixed(d));
}
