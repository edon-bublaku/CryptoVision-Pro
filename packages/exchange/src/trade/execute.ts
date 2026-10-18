import { parseFuturesOrder } from "./api";
import type { BracketPlan, PlannedOrder } from "./bracket";
import { BinanceError, type BinanceClient, describeError } from "./client";
import { dec, roundQty, splitQuantity, type SymbolRules } from "./rules";

/**
 * Sends a plan built by `planBracket` and reports every request separately. Orders are never
 * retried blindly: when Binance's answer is lost (timeout, 5xx) the order is looked up by its client
 * id first. If a futures stop-loss can't be placed, the entry is undone (closed at market or
 * cancelled), because a leveraged position without a stop is exactly what the platform refuses to
 * create.
 */

export interface StepResult {
  role: PlannedOrder["role"] | "revert" | "query" | "cancel" | "close";
  ok: boolean;
  path: string;
  params: Record<string, string>;
  response?: unknown;
  error?: { code: number; msg: string; unknown: boolean };
}

export type ExecStatus =
  /** Everything was accepted. */
  | "placed"
  /** Entry and stop are in place; at least one take-profit failed. */
  | "partial"
  /** Nothing was opened. */
  | "failed"
  /** The stop failed, so the entry was closed or cancelled. */
  | "reverted"
  /** A position may be open without a stop, or an order's state could not be confirmed. Check Binance now. */
  | "unknown";

export interface ExecResult {
  status: ExecStatus;
  steps: StepResult[];
  entry?: { orderId?: string; status?: string; executedQty?: string; avgPrice?: string };
}

const ALGO_FALLBACK_KEYS: Record<string, string> = { triggerPrice: "stopPrice", clientAlgoId: "newClientOrderId" };

/** The classic order endpoint, for venues that don't have the algo service yet. */
function asClassicOrder(o: PlannedOrder): PlannedOrder {
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(o.params)) if (k !== "algoType") params[ALGO_FALLBACK_KEYS[k] ?? k] = v;
  return { ...o, path: "/fapi/v1/order", params };
}

async function send(c: BinanceClient, o: Omit<PlannedOrder, "role"> & { role: StepResult["role"] }, steps: StepResult[]): Promise<{ ok: true; data: unknown } | { ok: false; error: BinanceError | Error }> {
  try {
    const data = await c.signed(o.method, o.path, o.params);
    steps.push({ role: o.role, ok: true, path: o.path, params: o.params, response: data });
    return { ok: true, data };
  } catch (e) {
    steps.push({ role: o.role, ok: false, path: o.path, params: o.params, error: describeError(e) });
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

const isUnknown = (e: Error) => e instanceof BinanceError && e.unknown;
const isMissingEndpoint = (e: Error) => e instanceof BinanceError && (e.status === 404 || e.code === -5000);

/** Looks an order up after a lost response; null when Binance says it doesn't exist. */
async function lookup(c: BinanceClient, path: string, params: Record<string, string>, steps: StepResult[]): Promise<unknown | null | undefined> {
  try {
    const data = await c.signed("GET", path, params);
    steps.push({ role: "query", ok: true, path, params, response: data });
    return data;
  } catch (e) {
    steps.push({ role: "query", ok: false, path, params, error: describeError(e) });
    // -2013: "Order does not exist."
    if (e instanceof BinanceError && (e.code === -2013 || e.code === -2011)) return null;
    return undefined;
  }
}

export async function executePlan(c: BinanceClient, plan: BracketPlan, rules: SymbolRules): Promise<ExecResult> {
  if (plan.errors.length) throw new Error("Refusing to execute a plan with errors");
  if (c.market !== plan.market) throw new Error("Client and plan markets differ");
  return plan.market === "spot" ? executeSpot(c, plan) : executeFutures(c, plan, rules);
}

async function executeSpot(c: BinanceClient, plan: BracketPlan): Promise<ExecResult> {
  const steps: StepResult[] = [];
  const list = plan.orders[0]!;
  const r = await send(c, list, steps);
  let data: unknown;
  if (r.ok) data = r.data;
  else {
    if (!isUnknown(r.error)) return { status: "failed", steps };
    const found = await lookup(c, "/api/v3/orderList", { origClientOrderId: list.params.listClientOrderId! }, steps);
    if (!found) return { status: found === null ? "failed" : "unknown", steps };
    data = found;
  }
  const reports = (data as { orderReports?: { clientOrderId?: string; orderId?: number; status?: string; executedQty?: string; cummulativeQuoteQty?: string }[] }).orderReports ?? [];
  const w = reports.find((o) => o.clientOrderId === list.params.workingClientOrderId);
  const avg = w && Number(w.executedQty) > 0 ? dec(w.cummulativeQuoteQty ?? "0").div(w.executedQty!).toFixed() : undefined;
  return { status: "placed", steps, entry: w ? { orderId: String(w.orderId ?? ""), status: w.status, executedQty: w.executedQty, avgPrice: avg } : undefined };
}

async function executeFutures(c: BinanceClient, plan: BracketPlan, rules: SymbolRules): Promise<ExecResult> {
  const steps: StepResult[] = [];
  const by = (role: PlannedOrder["role"]) => plan.orders.filter((o) => o.role === role);
  const symbol = plan.symbol;

  // 1–2. Margin mode and leverage. "No need to change margin type" (-4046) is success.
  const mt = await send(c, by("margin_type")[0]!, steps);
  if (!mt.ok && !(mt.error instanceof BinanceError && mt.error.code === -4046)) return { status: "failed", steps };
  if (!mt.ok) steps[steps.length - 1]!.ok = true;
  const lv = await send(c, by("leverage")[0]!, steps);
  if (!lv.ok) return { status: "failed", steps };

  // 3. Entry.
  const entryOrder = by("entry")[0]!;
  let entryRaw: unknown;
  const en = await send(c, entryOrder, steps);
  if (en.ok) entryRaw = en.data;
  else {
    if (!isUnknown(en.error)) return { status: "failed", steps };
    const found = await lookup(c, "/fapi/v1/order", { symbol, origClientOrderId: entryOrder.params.newClientOrderId! }, steps);
    if (!found) return { status: found === null ? "failed" : "unknown", steps };
    entryRaw = found;
  }
  const entry = parseFuturesOrder(entryRaw);
  const isMarket = plan.entryType === "MARKET";
  const filled = dec(entry.executedQty);
  const entryInfo = { orderId: String(entry.orderId), status: entry.status, executedQty: entry.executedQty, avgPrice: entry.avgPrice };
  // A market order that filled nothing (expired by price protection) leaves nothing to protect.
  if (isMarket && filled.isZero()) return { status: "failed", steps, entry: entryInfo };

  // 4. Stop-loss, mandatory.
  let stopOrder = by("stop")[0]!;
  let st = await send(c, stopOrder, steps);
  if (!st.ok && isMissingEndpoint(st.error)) {
    stopOrder = asClassicOrder(stopOrder);
    st = await send(c, stopOrder, steps);
  }
  if (!st.ok && isUnknown(st.error)) {
    const algo = stopOrder.path.endsWith("algoOrder");
    const found = await lookup(c, algo ? "/fapi/v1/algoOrder" : "/fapi/v1/order", algo ? { clientAlgoId: stopOrder.params.clientAlgoId! } : { symbol, origClientOrderId: stopOrder.params.newClientOrderId! }, steps);
    if (found) st = { ok: true, data: found };
  }
  if (!st.ok) {
    const reverted = await revert(c, plan, rules, entryOrder, isMarket ? filled.toFixed() : null, steps);
    return { status: reverted ? "reverted" : "unknown", steps, entry: entryInfo };
  }

  // 5. Take-profits on what actually filled (a market order can fill partially).
  let tps = by("take_profit");
  if (isMarket && filled.lt(plan.quantity) && tps.length) {
    const qtys = splitQuantity(rules, filled.toFixed(), plan.targets.map((t) => t.sizePct));
    tps = tps.map((o, i) => ({ ...o, params: { ...o.params, quantity: qtys[i] ?? "0" } })).filter((o) => dec(o.params.quantity!).gt(0));
  }
  let tpFailed = false;
  for (const tp of tps) {
    let o = tp;
    let r = await send(c, o, steps);
    if (!r.ok && isMissingEndpoint(r.error)) {
      o = asClassicOrder(o);
      r = await send(c, o, steps);
    }
    if (!r.ok) tpFailed = true;
  }
  return { status: tpFailed ? "partial" : "placed", steps, entry: entryInfo };
}

/** Undo the entry after a failed stop: cancel what is still open, close what filled. */
async function revert(c: BinanceClient, plan: BracketPlan, rules: SymbolRules, entryOrder: PlannedOrder, marketFilled: string | null, steps: StepResult[]): Promise<boolean> {
  let toClose = marketFilled;
  if (toClose === null) {
    const params = { symbol: plan.symbol, origClientOrderId: entryOrder.params.newClientOrderId! };
    try {
      const data = await c.signed("DELETE", "/fapi/v1/order", params);
      steps.push({ role: "revert", ok: true, path: "/fapi/v1/order", params, response: data });
      toClose = parseFuturesOrder(data).executedQty;
    } catch (e) {
      steps.push({ role: "revert", ok: false, path: "/fapi/v1/order", params, error: describeError(e) });
      return false;
    }
  }
  const qty = roundQty(rules, toClose, true);
  if (dec(qty).isZero()) return true;
  const hedge = entryOrder.params.positionSide;
  const params: Record<string, string> = {
    symbol: plan.symbol,
    side: plan.side === "LONG" ? "SELL" : "BUY",
    ...(hedge ? { positionSide: hedge } : { reduceOnly: "true" }),
    type: "MARKET",
    quantity: qty,
    newClientOrderId: `${entryOrder.params.newClientOrderId!.slice(0, -1)}x`,
    newOrderRespType: "RESULT",
  };
  try {
    const data = await c.signed("POST", "/fapi/v1/order", params);
    steps.push({ role: "revert", ok: true, path: "/fapi/v1/order", params, response: data });
    return dec(parseFuturesOrder(data).executedQty).gte(qty);
  } catch (e) {
    steps.push({ role: "revert", ok: false, path: "/fapi/v1/order", params, error: describeError(e) });
    return false;
  }
}

// ---------- management ----------

/** Cancels one order. Spot orders inside an order list cancel the whole list (Binance semantics). */
export async function cancelOrder(c: BinanceClient, o: { symbol: string; orderId?: number; algoId?: number; orderListId?: number }): Promise<unknown> {
  if (c.market === "spot") {
    if (o.orderListId !== undefined && o.orderListId >= 0) return c.signed("DELETE", "/api/v3/orderList", { symbol: o.symbol, orderListId: o.orderListId });
    return c.signed("DELETE", "/api/v3/order", { symbol: o.symbol, orderId: o.orderId });
  }
  if (o.algoId !== undefined) return c.signed("DELETE", "/fapi/v1/algoOrder", { algoId: o.algoId });
  return c.signed("DELETE", "/fapi/v1/order", { symbol: o.symbol, orderId: o.orderId });
}

/**
 * Closes a futures position at market (reduce-only), then removes the symbol's remaining orders.
 * The stop stays in place until the close is confirmed.
 */
export async function closeFuturesPosition(
  c: BinanceClient,
  rules: SymbolRules,
  p: { symbol: string; positionAmt: string; positionSide?: string },
  idPrefix: string,
): Promise<StepResult[]> {
  const steps: StepResult[] = [];
  const amt = dec(p.positionAmt);
  if (amt.isZero()) return steps;
  const hedge = p.positionSide && p.positionSide !== "BOTH";
  const params: Record<string, string> = {
    symbol: p.symbol,
    side: amt.gt(0) ? "SELL" : "BUY",
    ...(hedge ? { positionSide: p.positionSide! } : { reduceOnly: "true" }),
    type: "MARKET",
    quantity: roundQty(rules, amt.abs(), true),
    newClientOrderId: `${idPrefix}c`,
    newOrderRespType: "RESULT",
  };
  const r = await send(c, { role: "close", method: "POST", path: "/fapi/v1/order", params }, steps);
  if (!r.ok) return steps;
  for (const path of ["/fapi/v1/allOpenOrders", "/fapi/v1/algoOpenOrders"]) {
    try {
      const data = await c.signed("DELETE", path, { symbol: p.symbol });
      steps.push({ role: "cancel", ok: true, path, params: { symbol: p.symbol }, response: data });
    } catch (e) {
      // No open orders is not a failure.
      steps.push({ role: "cancel", ok: e instanceof BinanceError && (e.code === -2011 || e.status === 404), path, params: { symbol: p.symbol }, error: describeError(e) });
    }
  }
  return steps;
}

/** Cancels every open order on a symbol (kill switch). */
export async function cancelAllOrders(c: BinanceClient, symbol: string): Promise<StepResult[]> {
  const steps: StepResult[] = [];
  const paths = c.market === "spot" ? ["/api/v3/openOrders"] : ["/fapi/v1/allOpenOrders", "/fapi/v1/algoOpenOrders"];
  for (const path of paths) {
    try {
      const data = await c.signed("DELETE", path, { symbol });
      steps.push({ role: "cancel", ok: true, path, params: { symbol }, response: data });
    } catch (e) {
      steps.push({ role: "cancel", ok: e instanceof BinanceError && (e.code === -2011 || e.status === 404), path, params: { symbol }, error: describeError(e) });
    }
  }
  return steps;
}
