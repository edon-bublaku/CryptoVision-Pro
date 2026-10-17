import type { Signal } from "@cv/core";

/** Indicator snapshot per coin, used by the screener. */
export interface Snapshot {
  price: number;
  change24h: number;
  quoteVolume: number;
  rsi: number;
  adx: number;
  macdHist: number;
  percentB: number;
  bbWidthPctl: number;
  relVol: number;
  atrPct: number;
  stochK: number;
  distEma20: number;
  distEma50: number;
  distEma200: number;
  distHigh20: number;
  distLow20: number;
  trendScore: number;
  /** Last 60 closes for sparklines. */
  spark: number[];
}

export interface ScanRow {
  symbol: string;
  signal: Signal;
  snapshot: Snapshot;
  /** Strategy id → passed the per-coin backtest gate. */
  gate: Record<string, boolean>;
}

export interface TrackedSignal {
  signal: Signal;
  outcome: "pending" | "open" | "tp1" | "tp2" | "tp3" | "sl" | "expired";
  /** Max favourable R reached. */
  bestR: number;
  updatedAt: number;
}

