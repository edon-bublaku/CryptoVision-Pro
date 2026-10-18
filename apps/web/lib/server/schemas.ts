import { TIMEFRAMES } from "@cv/core";
import { z } from "zod";

const symbol = z.string().regex(/^[A-Z0-9]{2,20}$/);
const finite = z.number().finite();

export const credentials = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(10, "min 10 characters").max(200),
});

export const registerInput = credentials.extend({ name: z.string().trim().max(80).optional() });
export const loginInput = z.object({ email: z.string().trim().email(), password: z.string().min(1).max(200), code: z.string().trim().max(20).optional() });

export const drawingSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.string().min(1).max(32),
  points: z.array(z.object({ time: finite, price: finite })).max(5000),
  style: z.record(z.string(), z.unknown()),
  locked: z.boolean(),
  visible: z.boolean(),
  schemaVersion: z.number().int(),
  createdAt: finite,
  updatedAt: finite,
});

export const drawingsInput = z.object({ data: z.array(drawingSchema).max(500) });

const positionBase = z.object({
  id: z.string().uuid(),
  symbol,
  side: z.enum(["LONG", "SHORT"]),
  entry: finite.positive(),
  quantity: finite.nonnegative(),
  stopLoss: finite.positive().optional(),
  takeProfit: finite.positive().optional(),
  leverage: finite.min(1).max(125),
  openedAt: finite,
  notes: z.string().max(500).optional(),
  strategyId: z.string().max(64).nullable().optional(),
  paper: z.boolean().optional(),
});

export const portfolioInput = z.object({
  positions: z.array(positionBase).max(500),
  closed: z
    .array(positionBase.extend({ exit: finite.positive(), closedAt: finite, pnl: finite, r: finite.optional(), exitReason: z.enum(["MANUAL", "SL", "TP", "LIQ"]).optional() }))
    .max(2000),
});

export const alertSchema = z.object({
  id: z.string().uuid(),
  symbol,
  type: z.enum(["price_above", "price_below", "change_pct", "rsi_above", "rsi_below", "rating_above", "rating_below", "signal", "drawing"]),
  value: finite,
  timeframe: z.enum(TIMEFRAMES as [string, ...string[]]).optional(),
  drawingId: z.string().max(64).optional(),
  drawing: z.object({ id: z.string(), type: z.string(), points: z.array(z.object({ time: finite, price: finite })).max(10) }).optional(),
  once: z.boolean(),
  active: z.boolean(),
  createdAt: finite,
  note: z.string().max(200).optional(),
});

export const alertsInput = z.object({ alerts: z.array(alertSchema).max(200) });

export const stateKeys = ["settings", "screens", "strategies", "orders", "chartUi", "tracked"] as const;
export const stateInput = z.object({ value: z.unknown(), baseVersion: z.number().int().nullable() });
