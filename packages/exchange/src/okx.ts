import { z } from "zod";

/**
 * OKX public derivatives data (perpetual swaps). Binance and Bybit futures endpoints are
 * geo-blocked in several regions, OKX's public endpoints are not and send CORS headers.
 */
const BASE = "https://www.okx.com";

const envelope = z.object({ code: z.string(), msg: z.string().optional(), data: z.unknown() });

async function okx<T extends z.ZodTypeAny>(path: string, schema: T, signal?: AbortSignal): Promise<z.infer<T>> {
  const res = await fetch(`${BASE}${path}`, { signal });
  if (!res.ok) throw new Error(`OKX HTTP ${res.status}`);
  const j = envelope.parse(await res.json());
  if (j.code !== "0") throw new Error(`OKX error ${j.code}: ${j.msg ?? ""}`);
  return schema.parse(j.data);
}

const rows = z.array(z.array(z.string()));

export interface DerivativesSnapshot {
  instId: string;
  /** Current period funding rate (0.0001 = 0.01% per 8h). */
  fundingRate: number;
  nextFundingTime: number;
  /** Average funding over the last 30 periods (~10 days). */
  fundingAvg30: number;
  openInterestUsd: number;
  /** Open interest change over the last 24h, %. */
  oiChange24hPct: number;
  /** Ratio of long accounts to short accounts (top of OKX). */
  longShortRatio: number;
  longShortHistory: { time: number; ratio: number }[];
  oiHistory: { time: number; oiUsd: number; volumeUsd: number }[];
  /** Taker buy / sell volume over the last 24h (USD). */
  takerBuy24h: number;
  takerSell24h: number;
  updatedAt: number;
}

/** BTCUSDT → BTC-USDT-SWAP / BTC. */
export function okxIds(symbol: string): { instId: string; ccy: string } {
  const ccy = symbol.replace(/USDT$/, "");
  return { instId: `${ccy}-USDT-SWAP`, ccy };
}

export async function getDerivatives(symbol: string, signal?: AbortSignal): Promise<DerivativesSnapshot> {
  const { instId, ccy } = okxIds(symbol);
  const [funding, fundingHist, oi, ls, oiVol, taker] = await Promise.all([
    okx(`/api/v5/public/funding-rate?instId=${instId}`, z.array(z.object({ fundingRate: z.string(), fundingTime: z.string() })), signal),
    okx(`/api/v5/public/funding-rate-history?instId=${instId}&limit=30`, z.array(z.object({ fundingRate: z.string() })), signal),
    okx(`/api/v5/public/open-interest?instType=SWAP&instId=${instId}`, z.array(z.object({ oiUsd: z.string() })), signal),
    okx(`/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=${ccy}&period=1H`, rows, signal),
    okx(`/api/v5/rubik/stat/contracts/open-interest-volume?ccy=${ccy}&period=1H`, rows, signal),
    okx(`/api/v5/rubik/stat/taker-volume?ccy=${ccy}&instType=CONTRACTS&period=1H`, rows, signal),
  ]);
  const f = funding[0];
  if (!f) throw new Error(`No OKX swap for ${symbol}`);
  // Rubik series come newest-first.
  const oiHistory = oiVol.map((r) => ({ time: +r[0]!, oiUsd: +r[1]!, volumeUsd: +r[2]! })).reverse();
  const lsHistory = ls.map((r) => ({ time: +r[0]!, ratio: +r[1]! })).reverse();
  const lastOi = oiHistory[oiHistory.length - 1]?.oiUsd ?? NaN;
  const oi24 = oiHistory[oiHistory.length - 25]?.oiUsd ?? oiHistory[0]?.oiUsd ?? NaN;
  const takerDay = taker.slice(0, 24);
  const hist = fundingHist.map((x) => +x.fundingRate);
  return {
    instId,
    fundingRate: +f.fundingRate,
    nextFundingTime: +f.fundingTime,
    fundingAvg30: hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : NaN,
    openInterestUsd: oi[0] ? +oi[0].oiUsd : lastOi,
    oiChange24hPct: Number.isFinite(lastOi) && Number.isFinite(oi24) && oi24 > 0 ? ((lastOi - oi24) / oi24) * 100 : NaN,
    longShortRatio: lsHistory[lsHistory.length - 1]?.ratio ?? NaN,
    longShortHistory: lsHistory,
    oiHistory,
    takerSell24h: takerDay.reduce((s, r) => s + +r[1]!, 0),
    takerBuy24h: takerDay.reduce((s, r) => s + +r[2]!, 0),
    updatedAt: Date.now(),
  };
}

/**
 * Contrarian reading of crowd positioning: extreme positive funding and a long-heavy crowd
 * are fuel for long squeezes (bearish), and vice versa. Returns -1..1.
 */
export function derivativesBias(d: Pick<DerivativesSnapshot, "fundingRate" | "longShortRatio" | "oiChange24hPct">): number {
  let s = 0;
  const fr = d.fundingRate * 100; // in % per period
  if (fr > 0.05) s -= 0.5;
  else if (fr > 0.02) s -= 0.25;
  else if (fr < -0.02) s += 0.5;
  else if (fr < 0) s += 0.2;
  if (d.longShortRatio > 2.5) s -= 0.3;
  else if (d.longShortRatio < 0.8) s += 0.3;
  // Rising OI with crowded positioning amplifies the squeeze risk.
  if (Number.isFinite(d.oiChange24hPct) && d.oiChange24hPct > 8) s *= 1.3;
  return Math.max(-1, Math.min(1, s));
}
