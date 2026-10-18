import { z } from "zod";
import { BinanceError, type BinanceClient } from "./client";
import { exchangeInfoSchema, parseSymbolRules, type SymbolRules } from "./rules";

/** Typed Binance endpoints used by the trading flow. Every response is validated with Zod. */

const n = z.union([z.string(), z.number()]).transform(String);
const nOpt = n.optional();

// ---------- shared ----------

const rulesCache = new Map<string, { at: number; rules: Map<string, SymbolRules> }>();
const RULES_TTL = 10 * 60_000;

/** Symbol filters, cached per host for 10 minutes (they change rarely; Binance asks clients to cache). */
export async function symbolRules(c: BinanceClient, symbol: string): Promise<SymbolRules> {
  const key = `${c.baseUrl}:${c.market}`;
  let entry = rulesCache.get(key);
  if (!entry || Date.now() - entry.at > RULES_TTL) {
    entry = { at: Date.now(), rules: new Map() };
    rulesCache.set(key, entry);
  }
  if (!entry.rules.has(symbol)) {
    // Spot: one symbol per request (the full list is large). Futures: the list is small, take it all.
    const path = c.market === "spot" ? "/api/v3/exchangeInfo" : "/fapi/v1/exchangeInfo";
    const raw = exchangeInfoSchema.parse(await c.public(path, c.market === "spot" ? { symbol } : {}));
    for (const s of raw.symbols) {
      if (c.market === "futures" && s.contractType && s.contractType !== "PERPETUAL") continue;
      entry.rules.set(s.symbol, parseSymbolRules(c.market, s));
    }
  }
  const r = entry.rules.get(symbol);
  if (!r) throw new BinanceError(-1121, "Invalid symbol.", 400);
  return r;
}

export function resetRulesCache() {
  rulesCache.clear();
}

const book = z.object({ bidPrice: n, askPrice: n });
export async function bookTicker(c: BinanceClient, symbol: string) {
  return book.parse(await c.public(c.market === "spot" ? "/api/v3/ticker/bookTicker" : "/fapi/v1/ticker/bookTicker", { symbol }));
}

// ---------- spot ----------

const spotAccount = z.object({
  canTrade: z.boolean(),
  commissionRates: z.object({ maker: n, taker: n }).optional(),
  balances: z.array(z.object({ asset: z.string(), free: n, locked: n })),
});
export type SpotAccount = z.infer<typeof spotAccount>;
export async function spotAccountInfo(c: BinanceClient): Promise<SpotAccount> {
  return spotAccount.parse(await c.signed("GET", "/api/v3/account", { omitZeroBalances: true }));
}

export async function spotAvgPrice(c: BinanceClient, symbol: string): Promise<string> {
  return z.object({ price: n }).parse(await c.public("/api/v3/avgPrice", { symbol })).price;
}

const spotOrder = z.object({
  symbol: z.string(),
  orderId: z.number(),
  orderListId: z.number().optional(),
  clientOrderId: z.string(),
  price: n,
  origQty: n,
  executedQty: n,
  status: z.string(),
  type: z.string(),
  side: z.string(),
  stopPrice: nOpt,
  time: z.number().optional(),
});
export type SpotOrder = z.infer<typeof spotOrder>;
export async function spotOpenOrders(c: BinanceClient, symbol?: string): Promise<SpotOrder[]> {
  return z.array(spotOrder).parse(await c.signed("GET", "/api/v3/openOrders", symbol ? { symbol } : {}));
}

/** Key permissions (live only: the `/sapi` API doesn't exist on the spot testnet). */
const restrictions = z.object({
  ipRestrict: z.boolean(),
  enableWithdrawals: z.boolean(),
  enableReading: z.boolean(),
  enableSpotAndMarginTrading: z.boolean(),
  enableFutures: z.boolean(),
  enableInternalTransfer: z.boolean().optional(),
  permitsUniversalTransfer: z.boolean().optional(),
  enableMargin: z.boolean().optional(),
});
export type ApiRestrictions = z.infer<typeof restrictions>;
export async function apiRestrictions(c: BinanceClient): Promise<ApiRestrictions> {
  return restrictions.parse(await c.signed("GET", "/sapi/v1/account/apiRestrictions"));
}

// ---------- futures ----------

const futBalance = z.array(z.object({ asset: z.string(), balance: n, crossUnPnl: n.optional(), availableBalance: n }));
export async function futuresBalance(c: BinanceClient) {
  return futBalance.parse(await c.signed("GET", "/fapi/v2/balance"));
}

const futPosition = z.object({
  symbol: z.string(),
  positionAmt: n,
  entryPrice: n,
  markPrice: n,
  unRealizedProfit: n,
  liquidationPrice: n,
  leverage: nOpt,
  marginType: z.string().optional(),
  isolatedMargin: nOpt,
  positionSide: z.string().optional(),
  notional: nOpt,
  breakEvenPrice: nOpt,
});
export type FuturesPosition = z.infer<typeof futPosition>;
export async function futuresPositions(c: BinanceClient, symbol?: string): Promise<FuturesPosition[]> {
  const all = z.array(futPosition).parse(await c.signed("GET", "/fapi/v2/positionRisk", symbol ? { symbol } : {}));
  return all.filter((p) => Number(p.positionAmt) !== 0);
}

const futOrder = z.object({
  symbol: z.string(),
  orderId: z.number(),
  clientOrderId: z.string(),
  price: n,
  origQty: n,
  executedQty: n,
  avgPrice: nOpt,
  status: z.string(),
  type: z.string(),
  side: z.string(),
  positionSide: z.string().optional(),
  reduceOnly: z.boolean().optional(),
  closePosition: z.boolean().optional(),
  stopPrice: nOpt,
  time: z.number().optional(),
  updateTime: z.number().optional(),
});
export type FuturesOrder = z.infer<typeof futOrder>;
export const parseFuturesOrder = (raw: unknown) => futOrder.parse(raw);
export async function futuresOpenOrders(c: BinanceClient, symbol?: string): Promise<FuturesOrder[]> {
  return z.array(futOrder).parse(await c.signed("GET", "/fapi/v1/openOrders", symbol ? { symbol } : {}));
}

const algoOrder = z.object({
  algoId: z.number(),
  clientAlgoId: z.string(),
  symbol: z.string(),
  side: z.string(),
  positionSide: z.string().optional(),
  orderType: z.string(),
  quantity: nOpt,
  triggerPrice: nOpt,
  price: nOpt,
  algoStatus: z.string().optional(),
  closePosition: z.boolean().optional(),
  reduceOnly: z.boolean().optional(),
  createTime: z.number().optional(),
});
export type AlgoOrder = z.infer<typeof algoOrder>;
export async function futuresOpenAlgoOrders(c: BinanceClient, symbol?: string): Promise<AlgoOrder[]> {
  try {
    const raw = await c.signed("GET", "/fapi/v1/openAlgoOrders", symbol ? { symbol } : {});
    // Some deployments wrap the list; accept both shapes.
    const list = Array.isArray(raw) ? raw : (z.object({ orders: z.array(z.unknown()) }).safeParse(raw).data?.orders ?? []);
    return z.array(algoOrder).parse(list);
  } catch (e) {
    if (e instanceof BinanceError && e.status === 404) return [];
    throw e;
  }
}

export async function futuresDualSide(c: BinanceClient): Promise<boolean> {
  return z.object({ dualSidePosition: z.boolean() }).parse(await c.signed("GET", "/fapi/v1/positionSide/dual")).dualSidePosition;
}

const bracket = z.object({ initialLeverage: z.number(), notionalCap: z.number(), notionalFloor: z.number(), maintMarginRatio: z.number(), cum: z.number() });
export type LeverageBracket = z.infer<typeof bracket>;
const bracketsEntry = z.object({ symbol: z.string(), brackets: z.array(bracket) });
export async function futuresBrackets(c: BinanceClient, symbol: string): Promise<LeverageBracket[]> {
  const raw = await c.signed("GET", "/fapi/v1/leverageBracket", { symbol });
  // The endpoint returns an object for one symbol on some versions and a one-element array on others.
  const parsed = Array.isArray(raw) ? z.array(bracketsEntry).parse(raw).find((b) => b.symbol === symbol) : bracketsEntry.parse(raw);
  return parsed?.brackets ?? [];
}

export async function futuresCommission(c: BinanceClient, symbol: string) {
  const r = z.object({ makerCommissionRate: n, takerCommissionRate: n }).parse(await c.signed("GET", "/fapi/v1/commissionRate", { symbol }));
  return { maker: r.makerCommissionRate, taker: r.takerCommissionRate };
}

export async function futuresMark(c: BinanceClient, symbol: string) {
  return z.object({ markPrice: n, lastFundingRate: n }).parse(await c.public("/fapi/v1/premiumIndex", { symbol }));
}
