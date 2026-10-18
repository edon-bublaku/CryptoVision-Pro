import type { LeverageBracket } from "./api";
import { checkOrder, Dec, dec, type Market, roundPrice, roundQty, splitQuantity, type SymbolRules } from "./rules";
import { clientId } from "./signing";

/**
 * Turns a confirmed trade idea into the exact Binance requests, with every number rounded to the
 * symbol's filters and every rule checked first. Nothing here does I/O: the same plan is shown in
 * the confirmation dialog and then executed, so what the user confirms is what is sent.
 *
 * Every plan carries a stop-loss (CLAUDE.md §0.3):
 * - Spot: one OPOCO/OTOCO order list. The entry is a LIMIT (a market entry is a LIMIT capped at
 *   ask + slippage), and the take-profit/stop OCO is placed by Binance itself when it fills, so there
 *   is no moment with an unprotected position.
 * - Futures: entry, then a STOP_MARKET close-position order on the mark price, then reduce-only
 *   take-profits. If the stop can't be placed the executor closes or cancels the entry.
 */

export interface BracketInput {
  market: Market;
  symbol: string;
  side: "LONG" | "SHORT";
  entryType: "MARKET" | "LIMIT";
  /** LIMIT entry price. */
  price?: string;
  quantity: string;
  stopLoss: string;
  /** Up to three targets; spot uses exactly one (OCO). */
  takeProfits: { price: string; sizePct: number }[];
  leverage?: number;
  marginType?: "ISOLATED" | "CROSSED";
  /** Spot market entries: highest accepted fill above the best ask, in % (default 0.5). */
  maxSlippagePct?: number;
}

export interface MarketContext {
  rules: SymbolRules;
  /** Futures: mark price (what stops trigger on). Spot: average price (the percent-price reference). */
  refPrice: string;
  bid: string;
  ask: string;
  makerFee: string;
  takerFee: string;
  /** Account value the risk cap is measured against, in the quote asset. */
  equity: string;
  /** Spot: free quote balance. Futures: available balance. */
  available: string;
  /** Largest loss at the stop allowed, in % of equity. */
  maxRiskPct: number;
  brackets?: LeverageBracket[];
  dualSide?: boolean;
  /** Signed size of an existing futures position on the symbol. */
  positionAmt?: string;
}

export type PlanCode =
  | "spot_long_only"
  | "stop_wrong_side"
  | "stop_would_trigger"
  | "target_wrong_side"
  | "target_would_trigger"
  | "target_required"
  | "order_list_unsupported"
  | "insufficient_balance"
  | "insufficient_margin"
  | "leverage_required"
  | "leverage_above_bracket"
  | "liquidation_before_stop"
  | "position_exists"
  | "risk_above_cap"
  | "price_required"
  | `filter:${string}`
  // warnings
  | "limit_marketable"
  | "rr_low"
  | "no_target"
  | "high_leverage"
  | "fee_dust"
  | "target_merged";

export interface PlanIssue {
  code: PlanCode;
  /** Which order the issue belongs to (entry, stop, tp1…). */
  ref?: string;
}

export interface PlannedOrder {
  role: "margin_type" | "leverage" | "entry" | "stop" | "take_profit" | "order_list";
  method: "POST";
  path: string;
  params: Record<string, string>;
}

export interface BracketPlan {
  market: Market;
  symbol: string;
  side: "LONG" | "SHORT";
  entryType: "MARKET" | "LIMIT";
  /** Expected fill: the limit price, or the best opposite quote for a market entry. */
  entryPrice: string;
  /** Spot market entries: the capped limit price actually sent. */
  workingPrice?: string;
  quantity: string;
  stopLoss: string;
  targets: { price: string; quantity: string; sizePct: number }[];
  leverage?: number;
  marginType?: "ISOLATED" | "CROSSED";
  notional: string;
  margin?: string;
  maintMarginRate?: string;
  /** Estimated liquidation price (futures, this position alone); null when there is none. */
  liquidation?: string | null;
  entryFee: string;
  exitFeeAtStop: string;
  /**
   * Loss if the stop fills at its price: move + both fees, from the worst accepted entry (spot market
   * entries are capped at `workingPrice`). Slippage on the stop itself is extra.
   */
  riskAmount: string;
  riskPct: number;
  /** Net reward if every target fills. */
  reward: string;
  rr: number;
  spotList?: "opoco" | "otoco";
  orders: PlannedOrder[];
  errors: PlanIssue[];
  warnings: PlanIssue[];
}

const ROLE_REFS = ["tp1", "tp2", "tp3"] as const;

function bracketFor(brackets: LeverageBracket[] | undefined, notional: Dec): LeverageBracket | undefined {
  if (!brackets?.length) return undefined;
  return brackets.find((b) => notional.gte(b.notionalFloor) && notional.lt(b.notionalCap)) ?? brackets[brackets.length - 1];
}

/**
 * Binance USDⓈ-M liquidation price for a single position in one-way mode:
 *   LP = (WB + cum − s·q·E) / (q·MMR − s·q), s = +1 long / −1 short,
 * WB = isolated margin (isolated) or wallet balance (cross, other positions ignored).
 */
export function liquidationPrice(side: "LONG" | "SHORT", entry: Dec, qty: Dec, walletBalance: Dec, mmr: number, cum: number): Dec | null {
  const s = side === "LONG" ? 1 : -1;
  const den = qty.times(mmr).minus(qty.times(s));
  if (den.isZero()) return null;
  const lp = walletBalance.plus(cum).minus(qty.times(entry).times(s)).div(den);
  return lp.gt(0) ? lp : null;
}

export function planBracket(input: BracketInput, ctx: MarketContext, idPrefix: string): BracketPlan {
  const { rules } = ctx;
  const errors: PlanIssue[] = [];
  const warnings: PlanIssue[] = [];
  const err = (code: PlanCode, ref?: string) => errors.push(ref ? { code, ref } : { code });
  const warn = (code: PlanCode, ref?: string) => warnings.push(ref ? { code, ref } : { code });
  const long = input.side === "LONG";
  const dir = long ? 1 : -1;
  const entrySide = long ? "BUY" : "SELL";
  const exitSide = long ? "SELL" : "BUY";
  const spot = input.market === "spot";
  const isMarket = input.entryType === "MARKET";
  const taker = dec(ctx.takerFee);
  const maker = dec(ctx.makerFee);
  if (spot && !long) err("spot_long_only");

  // Entry price: the limit price (rounded so it never pays more / sells for less), or the best quote.
  let entry: Dec;
  let workingPrice: string | undefined;
  if (!isMarket) {
    if (!input.price || !dec(input.price).gt(0)) err("price_required");
    entry = dec(roundPrice(rules, input.price && dec(input.price).gt(0) ? input.price : ctx.refPrice, long ? "down" : "up"));
    if (long ? entry.gte(ctx.ask) : entry.lte(ctx.bid)) warn("limit_marketable");
    if (spot) workingPrice = entry.toFixed();
  } else {
    entry = dec(long ? ctx.ask : ctx.bid);
    if (spot) {
      const slip = Math.min(Math.max(input.maxSlippagePct ?? 0.5, 0.05), 5) / 100;
      workingPrice = roundPrice(rules, entry.times(1 + slip), "down");
    }
  }
  const marketQty = isMarket && !spot;
  const qty = dec(roundQty(rules, input.quantity, marketQty));
  const sl = dec(roundPrice(rules, input.stopLoss, "nearest"));
  const ref = dec(ctx.refPrice);

  if (!entry.minus(sl).times(dir).gt(0)) err("stop_wrong_side");
  // A stop already beyond the current price would fire the moment it is placed.
  if (!ref.minus(sl).times(dir).gt(0)) err("stop_would_trigger");

  // Targets.
  const tps = (spot ? input.takeProfits.slice(0, 1) : input.takeProfits.slice(0, 3)).filter((t) => dec(t.price).gt(0));
  if (spot && tps.length === 0) err("target_required");
  if (!spot && tps.length === 0) warn("no_target");
  const tpPrices = tps.map((t) => dec(roundPrice(rules, t.price, "nearest")));
  tpPrices.forEach((p, i) => {
    if (!p.minus(entry).times(dir).gt(0)) err("target_wrong_side", ROLE_REFS[i]);
    if (!p.minus(ref).times(dir).gt(0)) err("target_would_trigger", ROLE_REFS[i]);
  });
  const split = spot ? [qty.toFixed()] : splitQuantity(rules, qty.toFixed(), tps.map((t) => t.sizePct));
  const targets = tps
    .map((t, i) => ({ price: tpPrices[i]!.toFixed(), quantity: split[i] ?? "0", sizePct: t.sizePct }))
    .filter((t) => dec(t.quantity).gt(0));
  if (targets.length < tps.length) warn("target_merged");

  // Money.
  const notional = qty.times(entry);
  const entryFeeRate = isMarket || warnings.some((w) => w.code === "limit_marketable") ? taker : maker;
  const entryFee = notional.times(entryFeeRate);
  const exitFeeAtStop = qty.times(sl).times(taker);
  // Spot market entries can fill up to the capped working price: the risk is measured from there,
  // so the cap holds in the worst accepted case.
  const worstEntry = spot && isMarket && workingPrice ? dec(workingPrice) : entry;
  const riskAmount = qty.times(worstEntry.minus(sl).abs()).plus(qty.times(worstEntry).times(entryFeeRate)).plus(exitFeeAtStop);
  const tpFee = spot ? maker : taker;
  const reward = targets.reduce((a, t) => a.plus(dec(t.quantity).times(dec(t.price).minus(entry).times(dir))).minus(dec(t.quantity).times(t.price).times(tpFee)), dec(0)).minus(entryFee);
  const rr = riskAmount.gt(0) ? reward.div(riskAmount).toDecimalPlaces(4).toNumber() : 0;
  if (targets.length && rr < 1.5) warn("rr_low");
  const equity = dec(ctx.equity);
  const riskPct = equity.gt(0) ? riskAmount.div(equity).times(100).toDecimalPlaces(4).toNumber() : Infinity;
  if (riskPct > ctx.maxRiskPct) err("risk_above_cap");

  // Exchange filters for every order that will exist.
  const filt = (ref: string, issues: string[]) => issues.forEach((i) => err(`filter:${i}`, ref));
  const orders: PlannedOrder[] = [];
  const id = (s: string) => clientId(idPrefix, s);
  let margin: Dec | undefined;
  let liquidation: Dec | null | undefined;
  let mmrUsed: number | undefined;
  let spotList: BracketPlan["spotList"];

  if (spot) {
    filt("entry", checkOrder(rules, { side: "BUY", price: workingPrice, quantity: qty.toFixed(), refPrice: ctx.refPrice, band: true }));
    if (!(rules.ocoAllowed && rules.otoAllowed)) err("order_list_unsupported");
    spotList = rules.opoAllowed ? "opoco" : "otoco";
    // Without OPO the sell legs need a fixed quantity: the bought amount minus the commission Binance
    // deducts in the base asset. Paying fees in BNB leaves that difference as dust.
    const feeRate = Dec.max(maker, taker);
    const pendingQty = roundQty(rules, qty.times(dec(1).minus(feeRate)));
    if (spotList === "otoco") warn("fee_dust");
    const tp = targets[0];
    if (tp) filt("tp1", checkOrder(rules, { side: "SELL", price: tp.price, quantity: spotList === "otoco" ? pendingQty : qty.toFixed(), refPrice: ctx.refPrice, band: true }));
    filt("stop", checkOrder(rules, { side: "SELL", stopPrice: sl.toFixed(), quantity: spotList === "otoco" ? pendingQty : qty.toFixed(), refPrice: sl.toFixed(), market: true }));
    if (dec(ctx.available).lt(qty.times(workingPrice ?? entry))) err("insufficient_balance");
    const params: Record<string, string> = {
      symbol: rules.symbol,
      listClientOrderId: id("l"),
      newOrderRespType: "FULL",
      workingType: "LIMIT",
      workingSide: "BUY",
      workingClientOrderId: id("e"),
      workingPrice: workingPrice ?? entry.toFixed(),
      workingQuantity: qty.toFixed(),
      workingTimeInForce: "GTC",
      pendingSide: "SELL",
      pendingAboveType: "LIMIT_MAKER",
      pendingAboveClientOrderId: id("t1"),
      pendingAbovePrice: tp?.price ?? "0",
      pendingBelowType: "STOP_LOSS",
      pendingBelowClientOrderId: id("s"),
      pendingBelowStopPrice: sl.toFixed(),
    };
    if (spotList === "otoco") params.pendingQuantity = pendingQty;
    orders.push({ role: "order_list", method: "POST", path: `/api/v3/orderList/${spotList}`, params });
  } else {
    const lev = Math.floor(input.leverage ?? 0);
    if (!(lev >= 1 && lev <= 125)) err("leverage_required");
    const L = Math.max(1, Math.min(125, lev || 1));
    const br = bracketFor(ctx.brackets, notional);
    if (br && L > br.initialLeverage) err("leverage_above_bracket");
    if (L > 10) warn("high_leverage");
    mmrUsed = br?.maintMarginRatio ?? 0.005;
    margin = notional.div(L);
    if (margin.plus(entryFee).gt(ctx.available)) err("insufficient_margin");
    const mode = input.marginType ?? "ISOLATED";
    liquidation = liquidationPrice(input.side, entry, qty, mode === "ISOLATED" ? margin : equity, mmrUsed, br?.cum ?? 0);
    if (liquidation && !sl.minus(liquidation).times(dir).gt(0)) err("liquidation_before_stop");
    if (ctx.positionAmt && !dec(ctx.positionAmt).isZero()) err("position_exists");

    filt("entry", checkOrder(rules, { side: entrySide, price: isMarket ? undefined : entry.toFixed(), quantity: qty.toFixed(), refPrice: ctx.refPrice, market: isMarket, band: !isMarket }));
    filt("stop", checkOrder(rules, { side: exitSide, stopPrice: sl.toFixed(), quantity: qty.toFixed(), refPrice: sl.toFixed(), market: true, reduceOnly: true }));
    targets.forEach((t, i) => filt(ROLE_REFS[i]!, checkOrder(rules, { side: exitSide, stopPrice: t.price, quantity: t.quantity, refPrice: t.price, market: true, reduceOnly: true })));

    const hedge: Record<string, string> = ctx.dualSide ? { positionSide: input.side } : {};
    orders.push({ role: "margin_type", method: "POST", path: "/fapi/v1/marginType", params: { symbol: rules.symbol, marginType: mode } });
    orders.push({ role: "leverage", method: "POST", path: "/fapi/v1/leverage", params: { symbol: rules.symbol, leverage: String(L) } });
    orders.push({
      role: "entry",
      method: "POST",
      path: "/fapi/v1/order",
      params: {
        symbol: rules.symbol,
        side: entrySide,
        ...hedge,
        type: input.entryType,
        quantity: qty.toFixed(),
        ...(isMarket ? {} : { price: entry.toFixed(), timeInForce: "GTC" as string }),
        newClientOrderId: id("e"),
        newOrderRespType: "RESULT",
      },
    });
    // Close-position stop on the mark price: covers partial fills and survives the take-profits.
    orders.push({
      role: "stop",
      method: "POST",
      path: "/fapi/v1/algoOrder",
      params: {
        algoType: "CONDITIONAL",
        symbol: rules.symbol,
        side: exitSide,
        ...hedge,
        type: "STOP_MARKET",
        triggerPrice: sl.toFixed(),
        closePosition: "true",
        workingType: "MARK_PRICE",
        priceProtect: "true",
        clientAlgoId: id("s"),
      },
    });
    targets.forEach((t, i) =>
      orders.push({
        role: "take_profit",
        method: "POST",
        path: "/fapi/v1/algoOrder",
        params: {
          algoType: "CONDITIONAL",
          symbol: rules.symbol,
          side: exitSide,
          ...hedge,
          type: "TAKE_PROFIT_MARKET",
          triggerPrice: t.price,
          quantity: t.quantity,
          // reduceOnly can't be sent in hedge mode, where positionSide already prevents flips.
          ...(ctx.dualSide ? {} : { reduceOnly: "true" as string }),
          workingType: "MARK_PRICE",
          priceProtect: "true",
          clientAlgoId: id(`t${i + 1}`),
        },
      }),
    );
  }

  const q = (d: Dec, dp = 8) => d.toDecimalPlaces(dp).toFixed();
  return {
    market: input.market,
    symbol: rules.symbol,
    side: input.side,
    entryType: input.entryType,
    entryPrice: entry.toFixed(),
    workingPrice,
    quantity: qty.toFixed(),
    stopLoss: sl.toFixed(),
    targets,
    leverage: spot ? undefined : Math.max(1, Math.floor(input.leverage ?? 1)),
    marginType: spot ? undefined : (input.marginType ?? "ISOLATED"),
    notional: q(notional, 4),
    margin: margin ? q(margin, 4) : undefined,
    maintMarginRate: mmrUsed !== undefined ? String(mmrUsed) : undefined,
    liquidation: spot ? undefined : liquidation ? roundPrice(rules, liquidation, "nearest") : null,
    entryFee: q(entryFee, 6),
    exitFeeAtStop: q(exitFeeAtStop, 6),
    riskAmount: q(riskAmount, 4),
    riskPct,
    reward: q(reward, 4),
    rr,
    spotList,
    orders,
    errors,
    warnings,
  };
}
