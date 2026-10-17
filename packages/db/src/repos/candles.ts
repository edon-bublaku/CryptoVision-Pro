import type { Candle } from "@cv/core";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import type { Db } from "../client";
import { candles } from "../schema";

/** Idempotent upsert: re-ingesting the same bar (e.g. the forming one) just overwrites it. */
export async function upsertCandles(db: Db, symbol: string, timeframe: string, rows: Candle[], exchange = "binance") {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((c) => ({
      exchange,
      symbol,
      timeframe,
      time: new Date(c.time * 1000),
      open: String(c.open),
      high: String(c.high),
      low: String(c.low),
      close: String(c.close),
      volume: String(c.volume),
      quoteVolume: c.quoteVolume !== undefined ? String(c.quoteVolume) : null,
      takerBuyVolume: c.takerBuyVolume !== undefined ? String(c.takerBuyVolume) : null,
    }));
    await db
      .insert(candles)
      .values(chunk)
      .onConflictDoUpdate({
        target: [candles.exchange, candles.symbol, candles.timeframe, candles.time],
        set: { open: sql`excluded.open`, high: sql`excluded.high`, low: sql`excluded.low`, close: sql`excluded.close`, volume: sql`excluded.volume`, quoteVolume: sql`excluded.quote_volume`, takerBuyVolume: sql`excluded.taker_buy_volume` },
      });
  }
}

export async function getCandles(db: Db, symbol: string, timeframe: string, from?: Date, to?: Date, exchange = "binance"): Promise<Candle[]> {
  const conds = [eq(candles.exchange, exchange), eq(candles.symbol, symbol), eq(candles.timeframe, timeframe)];
  if (from) conds.push(gte(candles.time, from));
  if (to) conds.push(lte(candles.time, to));
  const rows = await db.select().from(candles).where(and(...conds)).orderBy(asc(candles.time));
  return rows.map((r) => ({
    time: r.time.getTime() / 1000,
    open: +r.open,
    high: +r.high,
    low: +r.low,
    close: +r.close,
    volume: +r.volume,
    quoteVolume: r.quoteVolume !== null ? +r.quoteVolume : undefined,
    takerBuyVolume: r.takerBuyVolume !== null ? +r.takerBuyVolume : undefined,
  }));
}
