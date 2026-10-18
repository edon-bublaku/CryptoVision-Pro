import { z } from "zod";

/**
 * Request contracts of the trading API (ADR 0012), shared by the order ticket and the route
 * handlers. Prices and quantities travel as decimal strings so nothing is rounded by floats on the
 * way; the server rounds them to the symbol's filters with Decimal.
 */

export const decimalStr = z
  .string()
  .trim()
  .regex(/^\d{1,20}(\.\d{1,20})?$/, "decimal");

export const tradeEnv = z.enum(["testnet", "live"]);
export const tradeMarket = z.enum(["spot", "futures"]);
export const tradeSymbol = z.string().regex(/^[A-Z0-9]{5,20}$/);
/** Client-generated per confirmation; the same id never sends orders twice. */
export const intentId = z.string().regex(/^[A-Za-z0-9]{16,32}$/);

export const bracketRequest = z.object({
  env: tradeEnv,
  market: tradeMarket,
  symbol: tradeSymbol,
  side: z.enum(["LONG", "SHORT"]),
  entryType: z.enum(["MARKET", "LIMIT"]),
  price: decimalStr.optional(),
  quantity: decimalStr,
  stopLoss: decimalStr,
  takeProfits: z.array(z.object({ price: decimalStr, sizePct: z.number().min(1).max(100) })).max(3),
  leverage: z.number().int().min(1).max(125).optional(),
  marginType: z.enum(["ISOLATED", "CROSSED"]).optional(),
  maxSlippagePct: z.number().min(0.05).max(5).optional(),
});
export type BracketRequest = z.infer<typeof bracketRequest>;

export const orderRequest = bracketRequest.extend({ intentId });

export const keyInput = z.object({
  env: tradeEnv,
  /** Live keys cover both markets on Binance; testnet spot and futures keys are separate. */
  market: z.enum(["spot", "futures", "both"]),
  apiKey: z.string().trim().regex(/^[A-Za-z0-9]{16,128}$/, "api_key"),
  secret: z.string().trim().regex(/^[A-Za-z0-9]{16,128}$/, "secret"),
  /** Required for live keys. */
  password: z.string().max(200).optional(),
});

export const cancelRequest = z.object({
  env: tradeEnv,
  market: tradeMarket,
  symbol: tradeSymbol,
  intentId,
  orderId: z.number().int().optional(),
  algoId: z.number().int().optional(),
  orderListId: z.number().int().optional(),
  /** Cancel every open order on the symbol. */
  all: z.boolean().optional(),
});

export const closeRequest = z.object({ env: tradeEnv, symbol: tradeSymbol, intentId, positionSide: z.enum(["BOTH", "LONG", "SHORT"]).optional() });

export const settingsPatch = z.object({
  killSwitch: z.boolean().optional(),
  maxRiskPct: z.number().min(0.1).max(2).optional(),
  live: z.union([z.object({ enabled: z.literal(true), password: z.string().min(1).max(200), code: z.string().regex(/^\d{6}$/) }), z.object({ enabled: z.literal(false) })]).optional(),
});

// ---------- responses ----------

export interface KeyInfo {
  env: "testnet" | "live";
  market: "spot" | "futures";
  keyHint: string;
  permissions: Record<string, boolean>;
  verifiedAt: string | null;
}

export interface TradingSettings {
  liveEnabled: boolean;
  killSwitch: boolean;
  maxRiskPct: number;
  totpEnabled: boolean;
  mode: "on" | "testnet" | "off";
}

export interface PlanIssue {
  code: string;
  ref?: string;
}

export interface Plan {
  market: "spot" | "futures";
  symbol: string;
  side: "LONG" | "SHORT";
  entryType: "MARKET" | "LIMIT";
  entryPrice: string;
  workingPrice?: string;
  quantity: string;
  stopLoss: string;
  targets: { price: string; quantity: string; sizePct: number }[];
  leverage?: number;
  marginType?: "ISOLATED" | "CROSSED";
  notional: string;
  margin?: string;
  maintMarginRate?: string;
  liquidation?: string | null;
  entryFee: string;
  exitFeeAtStop: string;
  riskAmount: string;
  riskPct: number;
  reward: string;
  rr: number;
  spotList?: "opoco" | "otoco";
  orders: { role: string; path: string; params: Record<string, string> }[];
  errors: PlanIssue[];
  warnings: PlanIssue[];
}

export interface PreviewResponse {
  plan: Plan;
  context: { equity: string; available: string; refPrice: string; bid: string; ask: string; makerFee: string; takerFee: string; quoteAsset: string; maxRiskPct: number };
}

export interface StepResult {
  role: string;
  ok: boolean;
  path: string;
  params: Record<string, string>;
  response?: unknown;
  error?: { code: number; msg: string; unknown: boolean };
}

export interface OrderResponse {
  status: "placed" | "partial" | "failed" | "reverted" | "unknown" | "rejected" | "pending";
  steps: StepResult[];
  entry?: { orderId?: string; status?: string; executedQty?: string; avgPrice?: string };
  plan?: Plan;
  /** True when this intent had already been submitted; nothing was sent again. */
  replay?: boolean;
}

export interface AccountResponse {
  env: "testnet" | "live";
  market: "spot" | "futures";
  balances: { asset: string; free: string; locked: string; total: string }[];
  positions: {
    symbol: string;
    side: "LONG" | "SHORT";
    positionSide: string;
    quantity: string;
    entryPrice: string;
    markPrice: string;
    pnl: string;
    liquidationPrice: string;
    leverage?: string;
    marginType?: string;
    breakEvenPrice?: string;
  }[];
  orders: {
    kind: "order" | "algo";
    symbol: string;
    id: number;
    listId?: number;
    clientId: string;
    side: string;
    type: string;
    price: string;
    triggerPrice?: string;
    quantity: string;
    filled: string;
    status: string;
    reduceOnly?: boolean;
    closePosition?: boolean;
    time?: number;
  }[];
  dualSide?: boolean;
  usedWeight: number | null;
}

export interface IntentInfo {
  id: string;
  env: "testnet" | "live";
  market: "spot" | "futures";
  symbol: string;
  action: string;
  status: string;
  request: Record<string, unknown>;
  steps: StepResult[];
  createdAt: string;
}
