import type { Candle } from "./types";
import { seededRandom } from "./math";

/**
 * Synthetic OHLCV random walk with regime changes, for deterministic tests.
 * Clearly not market data — never shown in the UI.
 */
export function syntheticCandles(n: number, seed = 1, start = 100): Candle[] {
  const rand = seededRandom(seed);
  const out: Candle[] = [];
  let price = start;
  let drift = 0;
  for (let i = 0; i < n; i++) {
    if (i % 150 === 0) drift = (rand() - 0.5) * 0.006;
    const vol = 0.01 + rand() * 0.015;
    const open = price;
    const close = Math.max(0.0001, open * (1 + drift + (rand() - 0.5) * vol * 2));
    const high = Math.max(open, close) * (1 + rand() * vol);
    const low = Math.min(open, close) * (1 - rand() * vol);
    const volume = 1000 + rand() * 4000;
    out.push({ time: 1_700_000_000 + i * 3600, open, high, low, close, volume, quoteVolume: volume * close, takerBuyVolume: volume * rand() });
    price = close;
  }
  return out;
}
