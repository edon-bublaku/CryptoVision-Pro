import { z } from "zod";
import type { Market, TradeEnv } from "./rules";
import { type Params, sign, toQuery } from "./signing";

/**
 * Signed REST client for Binance Spot and USDⓈ-M Futures, server side only (the secret never
 * leaves the server). Live hosts are fixed; only testnet hosts can be overridden, so a stray
 * environment variable can never point real-money orders somewhere else.
 */

export const BASE_URLS: Record<Market, Record<TradeEnv, string>> = {
  spot: { live: "https://api.binance.com", testnet: "https://testnet.binance.vision" },
  futures: { live: "https://fapi.binance.com", testnet: "https://testnet.binancefuture.com" },
};

const TIME_PATH: Record<Market, string> = { spot: "/api/v3/time", futures: "/fapi/v1/time" };

export class BinanceError extends Error {
  constructor(
    /** Binance error code (negative), or 0 when the body carried none. */
    public code: number,
    message: string,
    public status: number,
    /**
     * The request may or may not have been executed (timeout, network error, HTTP 5xx). Orders in
     * this state must be looked up by client id before anything else is done.
     */
    public unknown = false,
    public retryAfterSec?: number,
  ) {
    super(message);
    this.name = "BinanceError";
  }
}

export interface ClientOptions {
  market: Market;
  env: TradeEnv;
  apiKey: string;
  secret: string;
  /** Testnet only (tests and self-hosted mocks). Ignored for live. */
  baseUrl?: string;
  fetch?: typeof fetch;
  recvWindow?: number;
  timeoutMs?: number;
  now?: () => number;
}

const offsets = new Map<string, { offset: number; at: number }>();
const OFFSET_TTL = 10 * 60_000;

const errorBody = z.object({ code: z.number(), msg: z.string() });

export class BinanceClient {
  readonly market: Market;
  readonly env: TradeEnv;
  readonly baseUrl: string;
  /** Last reported request weight (x-mbx-used-weight-1m), for monitoring. */
  usedWeight: number | null = null;
  private readonly key: string;
  private readonly secret: string;
  private readonly f: typeof fetch;
  private readonly recvWindow: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(o: ClientOptions) {
    this.market = o.market;
    this.env = o.env;
    this.baseUrl = (o.env === "testnet" && o.baseUrl ? o.baseUrl : BASE_URLS[o.market][o.env]).replace(/\/$/, "");
    this.key = o.apiKey;
    this.secret = o.secret;
    this.f = o.fetch ?? fetch;
    this.recvWindow = o.recvWindow ?? 5000;
    this.timeoutMs = o.timeoutMs ?? 10_000;
    this.now = o.now ?? Date.now;
  }

  /** Server time minus local time, refreshed every 10 minutes and after a -1021 rejection. */
  private async offset(force = false): Promise<number> {
    const cached = offsets.get(this.baseUrl);
    if (!force && cached && this.now() - cached.at < OFFSET_TTL) return cached.offset;
    const t0 = this.now();
    const body = (await this.raw("GET", TIME_PATH[this.market], "", false)) as { serverTime?: number };
    const t1 = this.now();
    if (typeof body.serverTime !== "number") throw new BinanceError(0, "Invalid server time response", 0);
    const offset = Math.round(body.serverTime - (t0 + t1) / 2);
    offsets.set(this.baseUrl, { offset, at: t1 });
    return offset;
  }

  private async raw(method: string, path: string, query: string, withKey: boolean): Promise<unknown> {
    const url = `${this.baseUrl}${path}${query ? `?${query}` : ""}`;
    let res: Response;
    try {
      res = await this.f(url, {
        method,
        headers: withKey ? { "X-MBX-APIKEY": this.key } : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
        cache: "no-store",
      });
    } catch (e) {
      // A GET can be retried by the caller; anything else may have reached the matching engine.
      throw new BinanceError(0, `Network error: ${e instanceof Error ? e.message : String(e)}`, 0, method !== "GET");
    }
    const w = res.headers.get("x-mbx-used-weight-1m");
    if (w) this.usedWeight = Number(w);
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (res.ok) return data;
    const err = errorBody.safeParse(data);
    const retry = Number(res.headers.get("retry-after") ?? "") || undefined;
    // 5xx: "the execution status is UNKNOWN and could have been a success" (Binance docs).
    const unknown = res.status >= 500 && method !== "GET";
    throw new BinanceError(err.success ? err.data.code : 0, err.success ? err.data.msg : `HTTP ${res.status}`, res.status, unknown, retry);
  }

  /** Unsigned market-data request. */
  async public<T = unknown>(path: string, params: Params = {}): Promise<T> {
    return (await this.raw("GET", path, toQuery(params), false)) as T;
  }

  /** Signed request (TRADE / USER_DATA). Retries once only when Binance rejected the timestamp. */
  async signed<T = unknown>(method: "GET" | "POST" | "DELETE", path: string, params: Params = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const ts = this.now() + (await this.offset(attempt > 0));
      const q = toQuery({ ...params, recvWindow: this.recvWindow, timestamp: ts });
      try {
        return (await this.raw(method, path, `${q}&signature=${sign(q, this.secret)}`, true)) as T;
      } catch (e) {
        // -1021: timestamp outside recvWindow. The request was rejected before execution, so a
        // retry with a fresh clock offset is safe even for orders.
        if (e instanceof BinanceError && e.code === -1021 && attempt === 0) continue;
        throw e;
      }
    }
  }
}

/** Short, user-facing description of a Binance error. */
export function describeError(e: unknown): { code: number; msg: string; unknown: boolean } {
  if (e instanceof BinanceError) return { code: e.code, msg: e.message, unknown: e.unknown };
  return { code: 0, msg: e instanceof Error ? e.message : String(e), unknown: false };
}

/** Clears cached clock offsets (tests). */
export function resetClockOffsets() {
  offsets.clear();
}
