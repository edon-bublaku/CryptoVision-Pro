/** Unix time in seconds (UTC), the unit Lightweight Charts expects. */
export type UnixSeconds = number;

export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w";

export interface Candle {
  time: UnixSeconds;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Quote-asset volume (USDT); used for liquidity filters. */
  quoteVolume?: number;
  /** Taker buy base volume; lets us approximate delta / CVD. */
  takerBuyVolume?: number;
  trades?: number;
}

export interface Ticker {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  quoteVolume: number;
}

export type MarketRegime =
  | "TRENDING_UP"
  | "TRENDING_DOWN"
  | "RANGING"
  | "HIGH_VOLATILITY"
  | "LOW_LIQUIDITY";

export type Side = "LONG" | "SHORT";

export type SignalAction = "STRONG_BUY" | "BUY" | "HOLD" | "SELL" | "STRONG_SELL";

export type FactorCategory =
  | "trend"
  | "momentum"
  | "volatility"
  | "volume"
  | "structure"
  | "sentiment"
  | "derivatives";

export interface FactorResult {
  id: string;
  category: FactorCategory;
  /** -1 (strongly bearish) .. +1 (strongly bullish) */
  score: number;
  weight: number;
  /** Translation key + params so the UI can render it in any language. */
  label: string;
  explanation: string;
}

export interface TakeProfit {
  price: number;
  /** Share of the position closed at this target, 0..100 */
  sizePct: number;
  rr: number;
}

export interface TradePlan {
  side: Side;
  entry: number;
  entryZone: [number, number];
  stopLoss: number;
  takeProfits: TakeProfit[];
  riskReward: number;
  /** Distance to stop as % of entry. */
  stopPct: number;
  invalidation: string;
}

export interface BacktestSummary {
  trades: number;
  winRate: number;
  profitFactor: number;
  expectancyR: number;
  maxDrawdownPct: number;
  totalReturnPct: number;
}

export type SignalStatus = "ACTIVE" | "WATCH";

export interface Signal {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  action: SignalAction;
  /** 0..100, 50 = neutral */
  score: number;
  /** 0..1 */
  confidence: number;
  regime: MarketRegime;
  /** Higher-timeframe bias used for confirmation. */
  htfBias: "BULLISH" | "BEARISH" | "NEUTRAL";
  strategyId: string | null;
  plan: TradePlan | null;
  factors: FactorResult[];
  price: number;
  /** Close time of the candle the signal was computed on. */
  candleTime: UnixSeconds;
  createdAt: number;
  status: SignalStatus;
  backtest?: BacktestSummary;
}
