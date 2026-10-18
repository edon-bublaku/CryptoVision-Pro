import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
/** Prices and quantities are stored as NUMERIC and returned as strings (CLAUDE.md §0.5). */
const money = (name: string) => numeric(name, { precision: 38, scale: 18 });

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name"),
    passwordHash: text("password_hash").notNull(),
    /** AES-256-GCM encrypted TOTP secret (base32), see apps/web/lib/server/crypto.ts. */
    totpSecret: text("totp_secret"),
    totpEnabled: boolean("totp_enabled").notNull().default(false),
    /** SHA-256 hashes of unused recovery codes. */
    recoveryCodes: jsonb("recovery_codes").$type<string[]>().notNull().default([]),
    telegramChatId: text("telegram_chat_id"),
    emailAlerts: boolean("email_alerts").notNull().default(false),
    locale: text("locale").notNull().default("sq"),
    failedLogins: integer("failed_logins").notNull().default(0),
    lockedUntil: ts("locked_until"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    lastLoginAt: ts("last_login_at"),
  },
  (t) => [uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 of the opaque session token; the raw token only ever lives in the cookie. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/** Small per-user JSON documents: settings, saved screens, chart layout, watchlist. */
export const userState = pgTable(
  "user_state",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    version: integer("version").notNull().default(1),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

export const drawings = pgTable(
  "drawings",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    /** Drawing[] validated with Zod on the way in (schemaVersion inside each item). */
    data: jsonb("data").$type<unknown[]>().notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.symbol] })],
);

export const positions = pgTable(
  "positions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    side: text("side", { enum: ["LONG", "SHORT"] }).notNull(),
    entry: money("entry").notNull(),
    quantity: money("quantity").notNull(),
    stopLoss: money("stop_loss"),
    takeProfit: money("take_profit"),
    leverage: numeric("leverage", { precision: 10, scale: 2 }).notNull().default("1"),
    strategyId: text("strategy_id"),
    notes: text("notes"),
    openedAt: ts("opened_at").notNull().defaultNow(),
    /** Null while open. */
    exit: money("exit"),
    closedAt: ts("closed_at"),
    pnl: money("pnl"),
    r: doublePrecision("r"),
    /** Simulated position from a paper-trading order (SL/TP/liquidation executed automatically). */
    paper: boolean("paper").notNull().default(false),
    exitReason: text("exit_reason", { enum: ["MANUAL", "SL", "TP", "LIQ"] }),
  },
  (t) => [index("positions_user_idx").on(t.userId, t.closedAt)],
);

export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    type: text("type", { enum: ["price_above", "price_below", "change_pct", "rsi_above", "rsi_below", "rating_above", "rating_below", "signal", "drawing"] }).notNull(),
    value: money("value").notNull(),
    timeframe: text("timeframe"),
    /** For drawing alerts: the line geometry at creation time. */
    drawing: jsonb("drawing").$type<{ id: string; type: string; points: { time: number; price: number }[]; log?: boolean } | null>(),
    once: boolean("once").notNull().default(true),
    active: boolean("active").notNull().default(true),
    lastSide: smallint("last_side"),
    note: text("note"),
    createdAt: ts("created_at").notNull().defaultNow(),
    triggeredAt: ts("triggered_at"),
  },
  (t) => [index("alerts_active_idx").on(t.active, t.symbol), index("alerts_user_idx").on(t.userId)],
);

export const alertEvents = pgTable(
  "alert_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    alertId: uuid("alert_id").references(() => alerts.id, { onDelete: "set null" }),
    symbol: text("symbol").notNull(),
    message: text("message").notNull(),
    channels: jsonb("channels").$type<string[]>().notNull().default([]),
    read: boolean("read").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("alert_events_user_idx").on(t.userId, t.createdAt)],
);

export const pushSubscriptions = pgTable("push_subscriptions", {
  endpoint: text("endpoint").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  keys: jsonb("keys").$type<{ p256dh: string; auth: string }>().notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Every signal produced by a server scan (not per user). */
export const signals = pgTable(
  "signals",
  {
    id: text("id").primaryKey(),
    scanId: integer("scan_id"),
    symbol: text("symbol").notNull(),
    timeframe: text("timeframe").notNull(),
    action: text("action").notNull(),
    status: text("status").notNull(),
    score: integer("score").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    strategyId: text("strategy_id"),
    candleTime: ts("candle_time").notNull(),
    signal: jsonb("signal").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    gate: jsonb("gate").$type<Record<string, boolean>>().notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("signals_tf_scan_idx").on(t.timeframe, t.scanId), index("signals_status_idx").on(t.status, t.createdAt)],
);

export const scans = pgTable("scans", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  timeframe: text("timeframe").notNull(),
  startedAt: ts("started_at").notNull().defaultNow(),
  finishedAt: ts("finished_at"),
  coins: integer("coins").notNull().default(0),
  active: integer("active").notNull().default(0),
  failed: jsonb("failed").$type<string[]>().notNull().default([]),
});

/** Public track record: ACTIVE signals followed to TP/SL by the worker. */
export const trackedSignals = pgTable("tracked_signals", {
  signalId: text("signal_id")
    .primaryKey()
    .references(() => signals.id, { onDelete: "cascade" }),
  outcome: text("outcome", { enum: ["pending", "open", "tp1", "tp2", "tp3", "sl", "expired"] }).notNull(),
  bestR: doublePrecision("best_r").notNull().default(0),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** OHLCV history (TimescaleDB hypertable when the extension is available). */
export const candles = pgTable(
  "candles",
  {
    exchange: text("exchange").notNull().default("binance"),
    symbol: text("symbol").notNull(),
    timeframe: text("timeframe").notNull(),
    time: ts("time").notNull(),
    open: money("open").notNull(),
    high: money("high").notNull(),
    low: money("low").notNull(),
    close: money("close").notNull(),
    volume: money("volume").notNull(),
    quoteVolume: money("quote_volume"),
    takerBuyVolume: money("taker_buy_volume"),
  },
  (t) => [primaryKey({ columns: [t.exchange, t.symbol, t.timeframe, t.time] })],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    ip: text("ip"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("audit_user_idx").on(t.userId, t.createdAt)],
);

/**
 * Binance API keys (ADR 0012). Key and secret are AES-256-GCM encrypted with the server key and are
 * never sent back to the browser; only the last four characters of the key are shown.
 */
export const exchangeKeys = pgTable(
  "exchange_keys",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    env: text("env", { enum: ["testnet", "live"] }).notNull(),
    market: text("market", { enum: ["spot", "futures"] }).notNull(),
    apiKeyEnc: text("api_key_enc").notNull(),
    secretEnc: text("secret_enc").notNull(),
    keyHint: text("key_hint").notNull(),
    /** What Binance reported for the key when it was verified (live: /sapi/v1/account/apiRestrictions). */
    permissions: jsonb("permissions").$type<Record<string, boolean>>().notNull().default({}),
    verifiedAt: ts("verified_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.env, t.market] })],
);

/** Server-enforced trading switches: live trading is off until enabled with password and 2FA. */
export const tradingSettings = pgTable("trading_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  liveEnabled: boolean("live_enabled").notNull().default(false),
  liveEnabledAt: ts("live_enabled_at"),
  /** Blocks every new order (cancelling and closing still work). */
  killSwitch: boolean("kill_switch").notNull().default(false),
  /** Largest loss at the stop per order, in % of the account. */
  maxRiskPct: doublePrecision("max_risk_pct").notNull().default(2),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/**
 * Every confirmed trading action, keyed by the client's intent id: a repeated submit (double click,
 * retry after a lost response) returns the stored result instead of sending orders twice.
 */
export const tradeIntents = pgTable(
  "trade_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    intentId: text("intent_id").notNull(),
    env: text("env", { enum: ["testnet", "live"] }).notNull(),
    market: text("market", { enum: ["spot", "futures"] }).notNull(),
    symbol: text("symbol").notNull(),
    action: text("action", { enum: ["bracket", "cancel", "close", "cancel_all"] }).notNull(),
    status: text("status").notNull(),
    request: jsonb("request").$type<Record<string, unknown>>().notNull(),
    steps: jsonb("steps").$type<unknown[]>().notNull().default([]),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("trade_intents_user_intent_idx").on(t.userId, t.intentId), index("trade_intents_user_idx").on(t.userId, t.createdAt)],
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type PositionRow = typeof positions.$inferSelect;
export type AlertRow = typeof alerts.$inferSelect;
export type AlertEventRow = typeof alertEvents.$inferSelect;
export type SignalRow = typeof signals.$inferSelect;
export type ExchangeKeyRow = typeof exchangeKeys.$inferSelect;
export type TradingSettingsRow = typeof tradingSettings.$inferSelect;
export type TradeIntentRow = typeof tradeIntents.$inferSelect;
