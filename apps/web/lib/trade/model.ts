import Decimal from "decimal.js";
import type { BracketRequest } from "./schema";

/**
 * Order-ticket logic kept out of the components: sizing from risk, request building, deep links
 * from the analysis pages. The server re-checks everything; this only prepares what the user sees.
 */

export type TicketMarket = "spot" | "futures";

export interface Ticket {
  env: "testnet" | "live";
  market: TicketMarket;
  symbol: string;
  side: "LONG" | "SHORT";
  entryType: "MARKET" | "LIMIT";
  price: string;
  quantity: string;
  stopLoss: string;
  targets: { price: string; sizePct: string }[];
  leverage: string;
  marginType: "ISOLATED" | "CROSSED";
}

export const DEFAULT_TARGETS = [
  { price: "", sizePct: "40" },
  { price: "", sizePct: "40" },
  { price: "", sizePct: "20" },
];

const isNum = (s: string | null | undefined) => !!s && /^\d+(\.\d+)?$/.test(s.trim()) && Number(s) > 0;

/** A finite number as a plain decimal string (no exponent), at most `dp` decimals. */
export function decStr(v: number, dp = 8): string {
  return Number.isFinite(v) && v > 0 ? new Decimal(v).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP).toFixed() : "";
}

/**
 * Quantity that loses `riskPct` of `equity` at the stop, fees included (entry + exit at taker):
 *   q = equity·risk / (|entry − stop| + (entry + stop)·fee)
 * Floored to 8 decimals; the server floors again to the symbol's step, so the risk only shrinks.
 */
export function riskQuantity(i: { entry: number; stop: number; equity: number; riskPct: number; feeRate: number }): string {
  if (!(i.entry > 0 && i.stop > 0 && i.equity > 0 && i.riskPct > 0) || i.entry === i.stop) return "";
  const e = new Decimal(i.entry);
  const s = new Decimal(i.stop);
  const perUnit = e.minus(s).abs().plus(e.plus(s).times(Math.max(0, i.feeRate)));
  return new Decimal(i.equity).times(i.riskPct).div(100).div(perUnit).toDecimalPlaces(8, Decimal.ROUND_DOWN).toFixed();
}

/** Ticket → API request. Spot takes one target for its OCO; empty target rows are dropped. */
export function toRequest(t: Ticket): BracketRequest {
  const targets = t.targets.filter((x) => isNum(x.price) && Number(x.sizePct) > 0);
  const spot = t.market === "spot";
  return {
    env: t.env,
    market: t.market,
    symbol: t.symbol.trim().toUpperCase(),
    side: t.side,
    entryType: t.entryType,
    price: t.entryType === "LIMIT" && isNum(t.price) ? t.price.trim() : undefined,
    quantity: t.quantity.trim(),
    stopLoss: t.stopLoss.trim(),
    takeProfits: (spot ? targets.slice(0, 1).map((x) => ({ ...x, sizePct: "100" })) : targets.slice(0, 3)).map((x) => ({ price: x.price.trim(), sizePct: Math.min(100, Math.max(1, Math.round(Number(x.sizePct)))) })),
    leverage: spot ? undefined : Math.min(125, Math.max(1, Math.floor(Number(t.leverage) || 1))),
    marginType: spot ? undefined : t.marginType,
  };
}

/** What still blocks a preview, before asking the server. */
export function ticketProblems(t: Ticket): string[] {
  const out: string[] = [];
  if (!/^[A-Z0-9]{5,20}$/.test(t.symbol.trim().toUpperCase())) out.push("symbol");
  if (!isNum(t.quantity)) out.push("quantity");
  if (!isNum(t.stopLoss)) out.push("stopLoss");
  if (t.entryType === "LIMIT" && !isNum(t.price)) out.push("price");
  if (t.market === "spot" && t.side === "SHORT") out.push("spotShort");
  if (t.market === "spot" && !t.targets.some((x) => isNum(x.price))) out.push("target");
  return out;
}

/** 24 random alphanumerics: one per confirmation, so a repeated click can't send twice. */
export function newIntentId(): string {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => abc[b % abc.length]).join("");
}

export interface TradeLinkInput {
  market?: TicketMarket;
  symbol: string;
  side: "LONG" | "SHORT";
  entryType?: "MARKET" | "LIMIT";
  entry?: number;
  stopLoss: number;
  targets: { price: number; sizePct: number }[];
  leverage?: number;
}

/** Deep link that pre-fills the order ticket from a plan (/futures, signals, coin report). */
export function tradeLink(i: TradeLinkInput): string {
  const p = new URLSearchParams({ symbol: i.symbol, side: i.side, sl: decStr(i.stopLoss) });
  if (i.market) p.set("market", i.market);
  if (i.entryType) p.set("type", i.entryType);
  if (i.entry && i.entryType === "LIMIT") p.set("price", decStr(i.entry));
  i.targets.slice(0, 3).forEach((x, k) => {
    p.set(`tp${k + 1}`, decStr(x.price));
    p.set(`tp${k + 1}pct`, String(Math.round(x.sizePct)));
  });
  if (i.leverage) p.set("lev", String(Math.floor(i.leverage)));
  return `/trade?${p.toString()}`;
}

/** Reads a deep link back into ticket fields; anything malformed is ignored. */
export function ticketFromQuery(q: URLSearchParams): Partial<Ticket> {
  const out: Partial<Ticket> = {};
  const sym = q.get("symbol")?.toUpperCase();
  if (sym && /^[A-Z0-9]{5,20}$/.test(sym)) out.symbol = sym;
  const side = q.get("side");
  if (side === "LONG" || side === "SHORT") out.side = side;
  const market = q.get("market");
  if (market === "spot" || market === "futures") out.market = market;
  else if (out.side === "SHORT") out.market = "futures";
  const type = q.get("type");
  if (type === "MARKET" || type === "LIMIT") out.entryType = type;
  if (isNum(q.get("price"))) out.price = q.get("price")!;
  if (isNum(q.get("sl"))) out.stopLoss = q.get("sl")!;
  const targets = [1, 2, 3]
    .map((k) => ({ price: q.get(`tp${k}`) ?? "", sizePct: q.get(`tp${k}pct`) ?? "" }))
    .filter((x) => isNum(x.price))
    .map((x) => ({ price: x.price, sizePct: isNum(x.sizePct) ? x.sizePct : "" }));
  if (targets.length) out.targets = targets;
  const lev = Number(q.get("lev"));
  if (Number.isInteger(lev) && lev >= 1 && lev <= 125) out.leverage = String(lev);
  return out;
}
