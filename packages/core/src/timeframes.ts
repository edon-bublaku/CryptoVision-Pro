import type { Timeframe } from "./types";

export const TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "1h", "4h", "1d", "1w"];

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
  "1w": 604800,
};

/** Timeframe used to confirm a signal on the given execution timeframe. */
export const HIGHER_TIMEFRAME: Record<Timeframe, Timeframe> = {
  "1m": "15m",
  "5m": "1h",
  "15m": "1h",
  "1h": "4h",
  "4h": "1d",
  "1d": "1w",
  "1w": "1w",
};

/** How many bars a signal stays valid before it expires. */
export const SIGNAL_TTL_BARS = 6;

/**
 * Aggregates candles into a higher timeframe by UTC buckets. The last bucket may be
 * incomplete; callers that need closed candles only should check `isClosed`.
 */
export function resample(candles: readonly { time: number; open: number; high: number; low: number; close: number; volume: number; quoteVolume?: number; takerBuyVolume?: number }[], bucketSeconds: number) {
  const out: { time: number; open: number; high: number; low: number; close: number; volume: number; quoteVolume: number; takerBuyVolume: number; lastIndex: number }[] = [];
  candles.forEach((c, idx) => {
    const t = Math.floor(c.time / bucketSeconds) * bucketSeconds;
    const cur = out[out.length - 1];
    if (cur && cur.time === t) {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
      cur.volume += c.volume;
      cur.quoteVolume += c.quoteVolume ?? c.volume * c.close;
      cur.takerBuyVolume += c.takerBuyVolume ?? 0;
      cur.lastIndex = idx;
    } else {
      out.push({ time: t, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume, quoteVolume: c.quoteVolume ?? c.volume * c.close, takerBuyVolume: c.takerBuyVolume ?? 0, lastIndex: idx });
    }
  });
  return out;
}
