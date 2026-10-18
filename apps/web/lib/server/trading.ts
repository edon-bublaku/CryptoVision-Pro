import "server-only";
import { getExchangeKey, getTradingSettings, type Db, type TradingSettingsRow, type User } from "@cv/db";
import {
  BinanceClient,
  BinanceError,
  bookTicker,
  type BracketPlan,
  dec,
  futuresBalance,
  futuresBrackets,
  futuresCommission,
  futuresDualSide,
  futuresMark,
  futuresPositions,
  type MarketContext,
  planBracket,
  spotAccountInfo,
  spotAvgPrice,
  symbolRules,
  type SymbolRules,
} from "@cv/exchange/trade";
import { decrypt, env } from "@cv/server";
import { randomBytes } from "node:crypto";
import { ZodError } from "zod";
import type { BracketRequest, PreviewResponse } from "../trade/schema";
import { HttpError } from "./http";

export type TradeEnv = "testnet" | "live";
export type TradeMarket = "spot" | "futures";

function testnetUrl(market: TradeMarket): string | undefined {
  const e = env();
  return market === "spot" ? e.BINANCE_TESTNET_SPOT_URL : e.BINANCE_TESTNET_FUTURES_URL;
}

/** Operator switch (TRADING env) first, then the user's own live switch. */
export function assertEnvAllowed(settings: TradingSettingsRow, tEnv: TradeEnv) {
  const mode = env().TRADING;
  if (mode === "off") throw new HttpError(403, "trading_disabled");
  if (tEnv === "live" && mode === "testnet") throw new HttpError(403, "live_disabled_by_operator");
  if (tEnv === "live" && !settings.liveEnabled) throw new HttpError(403, "live_not_enabled");
}

export function newClient(tEnv: TradeEnv, market: TradeMarket, apiKey: string, secret: string): BinanceClient {
  return new BinanceClient({ market, env: tEnv, apiKey, secret, baseUrl: tEnv === "testnet" ? testnetUrl(market) : undefined });
}

/** Builds a client from the user's stored (encrypted) key. The secret is decrypted only here. */
export async function clientFor(db: Db, user: User, tEnv: TradeEnv, market: TradeMarket): Promise<BinanceClient> {
  const row = await getExchangeKey(db, user.id, tEnv, market);
  if (!row) throw new HttpError(409, "no_keys", undefined, { env: tEnv, market });
  return newClient(tEnv, market, decrypt(row.apiKeyEnc), decrypt(row.secretEnc));
}

export async function tradingContext(db: Db, user: User) {
  return getTradingSettings(db, user.id);
}

/** Binance errors become 502s carrying Binance's own code and message for the UI. */
export function binanceHttpError(e: unknown): never {
  if (e instanceof HttpError) throw e;
  if (e instanceof BinanceError) {
    const auth = e.code === -2014 || e.code === -2015 || e.code === -1022 || e.status === 401;
    throw new HttpError(auth ? 401 : e.status === 429 || e.status === 418 ? 429 : 502, auth ? "binance_auth" : "binance_error", e.message, {
      binanceCode: e.code,
      binanceMsg: e.message,
      ...(e.retryAfterSec ? { retryAfter: e.retryAfterSec } : {}),
    });
  }
  // A response that doesn't match the documented shape: report it as Binance's, not the user's.
  if (e instanceof ZodError) throw new HttpError(502, "binance_unexpected", e.issues[0]?.message);
  throw e;
}

/** Everything a plan needs, fetched in parallel: filters, quotes, fees, balance, brackets, position mode. */
export async function marketContext(c: BinanceClient, symbol: string, maxRiskPct: number): Promise<{ ctx: MarketContext; rules: SymbolRules }> {
  const rules = await symbolRules(c, symbol);
  if (c.market === "spot") {
    const [book, avg, acct] = await Promise.all([bookTicker(c, symbol), spotAvgPrice(c, symbol), spotAccountInfo(c)]);
    const bal = (a: string) => acct.balances.find((b) => b.asset === a);
    const quote = bal(rules.quoteAsset);
    const base = bal(rules.baseAsset);
    const quoteTotal = dec(quote?.free ?? 0).plus(quote?.locked ?? 0);
    const baseTotal = dec(base?.free ?? 0).plus(base?.locked ?? 0);
    // Only the traded pair counts towards equity here, which makes the risk cap stricter, not looser.
    const equity = quoteTotal.plus(baseTotal.times(avg));
    return {
      rules,
      ctx: {
        rules,
        refPrice: avg,
        bid: book.bidPrice,
        ask: book.askPrice,
        makerFee: acct.commissionRates?.maker ?? "0.001",
        takerFee: acct.commissionRates?.taker ?? "0.001",
        equity: equity.toFixed(),
        available: quote?.free ?? "0",
        maxRiskPct,
      },
    };
  }
  const [book, mark, fees, balances, brackets, dualSide, positions] = await Promise.all([
    bookTicker(c, symbol),
    futuresMark(c, symbol),
    futuresCommission(c, symbol),
    futuresBalance(c),
    futuresBrackets(c, symbol),
    futuresDualSide(c),
    futuresPositions(c, symbol),
  ]);
  const usdt = balances.find((b) => b.asset === rules.quoteAsset);
  // Any open size counts: in hedge mode a long and a short of equal size would sum to zero.
  const positionAmt = positions.reduce((a, p) => a.plus(dec(p.positionAmt).abs()), dec(0)).toFixed();
  return {
    rules,
    ctx: {
      rules,
      refPrice: mark.markPrice,
      bid: book.bidPrice,
      ask: book.askPrice,
      makerFee: fees.maker,
      takerFee: fees.taker,
      equity: usdt?.balance ?? "0",
      available: usdt?.availableBalance ?? "0",
      maxRiskPct,
      brackets,
      dualSide,
      positionAmt,
    },
  };
}

/** Client order ids: "cv" + 20 hex characters, so every order of one intent shares a prefix. */
export function idPrefix(): string {
  return `cv${randomBytes(10).toString("hex")}`;
}

export function toPlanInput(r: BracketRequest) {
  return {
    market: r.market,
    symbol: r.symbol,
    side: r.side,
    entryType: r.entryType,
    price: r.price,
    quantity: r.quantity,
    stopLoss: r.stopLoss,
    takeProfits: r.takeProfits,
    leverage: r.leverage,
    marginType: r.marginType,
    maxSlippagePct: r.maxSlippagePct,
  };
}

export function previewOf(plan: BracketPlan, ctx: MarketContext): PreviewResponse {
  return {
    plan,
    context: {
      equity: ctx.equity,
      available: ctx.available,
      refPrice: ctx.refPrice,
      bid: ctx.bid,
      ask: ctx.ask,
      makerFee: ctx.makerFee,
      takerFee: ctx.takerFee,
      quoteAsset: ctx.rules.quoteAsset,
      maxRiskPct: ctx.maxRiskPct,
    },
  };
}

export async function buildPlan(c: BinanceClient, r: BracketRequest, maxRiskPct: number, prefix = "cvpreview") {
  const { ctx, rules } = await marketContext(c, r.symbol, maxRiskPct);
  return { plan: planBracket(toPlanInput(r), ctx, prefix), ctx, rules };
}
