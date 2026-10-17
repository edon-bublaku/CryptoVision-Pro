import type { Candle, Ticker, Timeframe } from "@cv/core";
import { TIMEFRAME_SECONDS } from "@cv/core";
import { z } from "zod";

/**
 * Public market-data endpoints. `data-api.binance.vision` serves only public data and is
 * reachable from regions where api.binance.com is geo-blocked, so it goes first.
 */
const REST_HOSTS = ["https://data-api.binance.vision", "https://api.binance.com", "https://api1.binance.com"];
export const WS_HOSTS = ["wss://data-stream.binance.vision", "wss://stream.binance.com:9443"];

let preferredHost = 0;

const klineRow = z.tuple([
  z.number(),
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.number(),
  z.string(),
  z.number(),
  z.string(),
  z.string(),
  z.string(),
]);

const tickerSchema = z.object({
  symbol: z.string(),
  lastPrice: z.string(),
  priceChangePercent: z.string(),
  highPrice: z.string(),
  lowPrice: z.string(),
  volume: z.string(),
  quoteVolume: z.string(),
});

const depthSchema = z.object({
  lastUpdateId: z.number(),
  bids: z.array(z.tuple([z.string(), z.string()])),
  asks: z.array(z.tuple([z.string(), z.string()])),
});

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/** GET with host fallback and exponential backoff on 429/5xx. */
async function get(path: string, signal?: AbortSignal): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < REST_HOSTS.length * 2; attempt++) {
    const hostIdx = (preferredHost + Math.floor(attempt / 2)) % REST_HOSTS.length;
    try {
      const res = await fetch(`${REST_HOSTS[hostIdx]}${path}`, { signal, cache: "no-store" });
      if (res.status === 429 || res.status === 418 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
        await sleep(500 * 2 ** (attempt % 2) + Math.random() * 250);
        continue;
      }
      if (res.status === 451 || res.status === 403) {
        lastErr = new Error(`HTTP ${res.status} (restricted)`);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      preferredHost = hostIdx;
      return await res.json();
    } catch (e) {
      if (signal?.aborted) throw e;
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Network error");
}

export function parseKline(r: z.infer<typeof klineRow>): Candle {
  return {
    time: r[0] / 1000,
    open: +r[1],
    high: +r[2],
    low: +r[3],
    close: +r[4],
    volume: +r[5],
    quoteVolume: +r[7],
    trades: r[8],
    takerBuyVolume: +r[9],
  };
}

export interface KlineResult {
  candles: Candle[];
  /** Whether the last candle is still forming (its close time is in the future). */
  lastIsOpen: boolean;
}

export async function getKlines(symbol: string, tf: Timeframe, limit = 500, endTimeSec?: number, signal?: AbortSignal): Promise<KlineResult> {
  const q = new URLSearchParams({ symbol, interval: tf, limit: String(Math.min(1000, limit)) });
  if (endTimeSec) q.set("endTime", String(Math.floor(endTimeSec * 1000)));
  const raw = z.array(klineRow).parse(await get(`/api/v3/klines?${q}`, signal));
  const candles = raw.map(parseKline);
  const last = candles[candles.length - 1];
  const lastIsOpen = !!last && (last.time + TIMEFRAME_SECONDS[tf]) * 1000 > Date.now();
  return { candles, lastIsOpen };
}

/** Fetches more than 1000 candles by paging backwards. */
export async function getKlinesDeep(symbol: string, tf: Timeframe, total: number, signal?: AbortSignal): Promise<KlineResult> {
  const first = await getKlines(symbol, tf, Math.min(1000, total), undefined, signal);
  const out = [...first.candles];
  while (out.length < total) {
    const oldest = out[0];
    if (!oldest) break;
    const page = await getKlines(symbol, tf, Math.min(1000, total - out.length), oldest.time - 1, signal);
    if (page.candles.length === 0) break;
    out.unshift(...page.candles);
  }
  return { candles: out, lastIsOpen: first.lastIsOpen };
}

/** Closed candles only: the live forming bar would make signals repaint. */
export function closedOnly(k: KlineResult): Candle[] {
  return k.lastIsOpen ? k.candles.slice(0, -1) : k.candles;
}

const EXCLUDED_BASES = new Set(["USDC", "FDUSD", "TUSD", "BUSD", "USDP", "DAI", "EUR", "EURI", "AEUR", "XUSD", "USD1", "PAXG", "WBTC", "WBETH", "BFUSD", "RLUSD", "USDE", "U", "USDS", "PYUSD", "FRAX", "LUSD", "USTC", "EURC"]);

export function isTradableUsdt(symbol: string): boolean {
  if (!symbol.endsWith("USDT")) return false;
  const base = symbol.slice(0, -4);
  if (EXCLUDED_BASES.has(base)) return false;
  if (/(UP|DOWN|BULL|BEAR)$/.test(base) && base.length > 4) return false;
  return true;
}

export async function getTickers24h(signal?: AbortSignal): Promise<Ticker[]> {
  const raw = z.array(tickerSchema).parse(await get(`/api/v3/ticker/24hr`, signal));
  return raw
    .filter((t) => isTradableUsdt(t.symbol))
    .map((t) => ({
      symbol: t.symbol,
      lastPrice: +t.lastPrice,
      priceChangePercent: +t.priceChangePercent,
      highPrice: +t.highPrice,
      lowPrice: +t.lowPrice,
      volume: +t.volume,
      quoteVolume: +t.quoteVolume,
    }))
    .filter((t) => t.lastPrice > 0);
}

/** Top-N liquid USDT pairs (CLAUDE.md §3.2: volume > $5M, no stables / leveraged tokens). */
export function universe(tickers: Ticker[], n: number, minQuoteVolume = 5_000_000): Ticker[] {
  return [...tickers]
    .filter((t) => t.quoteVolume >= minQuoteVolume && !looksPegged(t))
    .sort((a, b) => b.quoteVolume - a.quoteVolume)
    .slice(0, n);
}

/** Unlisted stablecoins: price pinned near $1 with almost no daily range. */
function looksPegged(t: Ticker): boolean {
  return Math.abs(t.lastPrice - 1) < 0.02 && t.lowPrice > 0 && (t.highPrice - t.lowPrice) / t.lowPrice < 0.01;
}

export interface OrderBook {
  bids: [number, number][];
  asks: [number, number][];
}

export async function getDepth(symbol: string, limit = 20, signal?: AbortSignal): Promise<OrderBook> {
  const d = depthSchema.parse(await get(`/api/v3/depth?symbol=${symbol}&limit=${limit}`, signal));
  return { bids: d.bids.map(([p, q]) => [+p, +q]), asks: d.asks.map(([p, q]) => [+p, +q]) };
}

export async function getExchangeSymbols(signal?: AbortSignal): Promise<string[]> {
  const raw = z
    .object({ symbols: z.array(z.object({ symbol: z.string(), status: z.string(), quoteAsset: z.string() })) })
    .parse(await get(`/api/v3/exchangeInfo?permissions=SPOT`, signal));
  return raw.symbols.filter((s) => s.status === "TRADING" && s.quoteAsset === "USDT" && isTradableUsdt(s.symbol)).map((s) => s.symbol);
}

/** Runs async tasks with bounded concurrency so we stay well inside Binance's weight limits. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<(R | Error)[]> {
  const out: (R | Error)[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i]!, i);
      } catch (e) {
        out[i] = e instanceof Error ? e : new Error(String(e));
      }
    }
  });
  await Promise.all(workers);
  return out;
}
