import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../client";
import { exchangeKeys, tradeIntents, tradingSettings, type ExchangeKeyRow, type TradeIntentRow, type TradingSettingsRow } from "../schema";

export type TradeEnv = "testnet" | "live";
export type TradeMarket = "spot" | "futures";

export async function listExchangeKeys(db: Db, userId: string): Promise<ExchangeKeyRow[]> {
  return db.select().from(exchangeKeys).where(eq(exchangeKeys.userId, userId));
}

export async function getExchangeKey(db: Db, userId: string, env: TradeEnv, market: TradeMarket): Promise<ExchangeKeyRow | undefined> {
  const [row] = await db
    .select()
    .from(exchangeKeys)
    .where(and(eq(exchangeKeys.userId, userId), eq(exchangeKeys.env, env), eq(exchangeKeys.market, market)))
    .limit(1);
  return row;
}

export async function putExchangeKey(db: Db, row: Omit<ExchangeKeyRow, "createdAt">) {
  const { userId, env, market, ...rest } = row;
  await db
    .insert(exchangeKeys)
    .values({ ...row, createdAt: new Date() })
    .onConflictDoUpdate({ target: [exchangeKeys.userId, exchangeKeys.env, exchangeKeys.market], set: { ...rest, createdAt: new Date() } });
  return { userId, env, market };
}

export async function deleteExchangeKey(db: Db, userId: string, env: TradeEnv, market: TradeMarket) {
  await db.delete(exchangeKeys).where(and(eq(exchangeKeys.userId, userId), eq(exchangeKeys.env, env), eq(exchangeKeys.market, market)));
}

const DEFAULT_SETTINGS = { liveEnabled: false, liveEnabledAt: null, killSwitch: false, maxRiskPct: 2 };

export async function getTradingSettings(db: Db, userId: string): Promise<TradingSettingsRow> {
  const [row] = await db.select().from(tradingSettings).where(eq(tradingSettings.userId, userId)).limit(1);
  return row ?? { userId, ...DEFAULT_SETTINGS, updatedAt: new Date(0) };
}

export async function updateTradingSettings(db: Db, userId: string, patch: Partial<Omit<TradingSettingsRow, "userId" | "updatedAt">>): Promise<TradingSettingsRow> {
  const [row] = await db
    .insert(tradingSettings)
    .values({ userId, ...DEFAULT_SETTINGS, ...patch, updatedAt: new Date() })
    .onConflictDoUpdate({ target: tradingSettings.userId, set: { ...patch, updatedAt: new Date() } })
    .returning();
  return row!;
}

/**
 * Claims an intent id. The unique index makes this the idempotency guard: a second submit of the
 * same intent gets the existing row back (`created: false`) and must not send anything.
 */
export async function beginIntent(
  db: Db,
  i: Pick<TradeIntentRow, "userId" | "intentId" | "env" | "market" | "symbol" | "action" | "request">,
): Promise<{ created: boolean; row: TradeIntentRow }> {
  const [row] = await db
    .insert(tradeIntents)
    .values({ ...i, status: "pending" })
    .onConflictDoNothing({ target: [tradeIntents.userId, tradeIntents.intentId] })
    .returning();
  if (row) return { created: true, row };
  const [existing] = await db
    .select()
    .from(tradeIntents)
    .where(and(eq(tradeIntents.userId, i.userId), eq(tradeIntents.intentId, i.intentId)))
    .limit(1);
  return { created: false, row: existing! };
}

export async function finishIntent(db: Db, id: string, status: string, steps: unknown[]) {
  await db.update(tradeIntents).set({ status, steps, updatedAt: new Date() }).where(eq(tradeIntents.id, id));
}

export async function listIntents(db: Db, userId: string, limit = 50): Promise<TradeIntentRow[]> {
  return db.select().from(tradeIntents).where(eq(tradeIntents.userId, userId)).orderBy(desc(tradeIntents.createdAt)).limit(limit);
}
