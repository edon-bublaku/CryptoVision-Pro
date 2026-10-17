import { z } from "zod";

export interface FearGreedPoint {
  value: number;
  classification: string;
  time: number;
}

/** Crypto Fear & Greed index (alternative.me). */
export async function getFearGreed(limit = 30, signal?: AbortSignal): Promise<FearGreedPoint[]> {
  const res = await fetch(`https://api.alternative.me/fng/?limit=${limit}`, { signal });
  if (!res.ok) throw new Error(`Fear & Greed HTTP ${res.status}`);
  const j = z
    .object({ data: z.array(z.object({ value: z.string(), value_classification: z.string(), timestamp: z.string() })) })
    .parse(await res.json());
  return j.data.map((d) => ({ value: +d.value, classification: d.value_classification, time: +d.timestamp })).reverse();
}

export interface GlobalMarket {
  totalMarketCapUsd: number;
  totalVolumeUsd: number;
  btcDominance: number;
  ethDominance: number;
  marketCapChange24h: number;
}

/** CoinGecko global stats. Free tier rate-limits aggressively, so callers treat it as optional. */
export async function getGlobalMarket(signal?: AbortSignal): Promise<GlobalMarket> {
  const res = await fetch("https://api.coingecko.com/api/v3/global", { signal });
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  const j = z
    .object({
      data: z.object({
        total_market_cap: z.record(z.string(), z.number()),
        total_volume: z.record(z.string(), z.number()),
        market_cap_percentage: z.record(z.string(), z.number()),
        market_cap_change_percentage_24h_usd: z.number(),
      }),
    })
    .parse(await res.json());
  return {
    totalMarketCapUsd: j.data.total_market_cap.usd ?? 0,
    totalVolumeUsd: j.data.total_volume.usd ?? 0,
    btcDominance: j.data.market_cap_percentage.btc ?? 0,
    ethDominance: j.data.market_cap_percentage.eth ?? 0,
    marketCapChange24h: j.data.market_cap_change_percentage_24h_usd,
  };
}

/** Rough sector map for the most liquid coins; anything else is "Other". */
export const SECTORS: Record<string, string> = {
  BTC: "Store of Value", LTC: "Store of Value", BCH: "Store of Value",
  ETH: "L1", SOL: "L1", BNB: "L1", ADA: "L1", AVAX: "L1", DOT: "L1", TRX: "L1", NEAR: "L1", APT: "L1", SUI: "L1", SEI: "L1", TON: "L1", ATOM: "L1", ALGO: "L1", HBAR: "L1", ICP: "L1", XLM: "Payments", XRP: "Payments", TIA: "L1", INJ: "L1", KAS: "L1", EGLD: "L1", FTM: "L1", S: "L1",
  ARB: "L2", OP: "L2", POL: "L2", MATIC: "L2", STRK: "L2", IMX: "L2", MNT: "L2", ZK: "L2",
  UNI: "DeFi", AAVE: "DeFi", LINK: "Oracle", PYTH: "Oracle", MKR: "DeFi", CRV: "DeFi", LDO: "DeFi", PENDLE: "DeFi", JUP: "DeFi", RUNE: "DeFi", COMP: "DeFi", SNX: "DeFi", DYDX: "DeFi", ENA: "DeFi", ONDO: "RWA", CAKE: "DeFi", RAY: "DeFi",
  DOGE: "Meme", SHIB: "Meme", PEPE: "Meme", WIF: "Meme", BONK: "Meme", FLOKI: "Meme", TRUMP: "Meme", PENGU: "Meme", BOME: "Meme",
  FET: "AI", RENDER: "AI", TAO: "AI", WLD: "AI", AGIX: "AI", AI16Z: "AI", VIRTUAL: "AI", ARKM: "AI",
  FIL: "Storage", AR: "Storage", GRT: "Infra", ENS: "Infra",
  SAND: "Gaming", MANA: "Gaming", AXS: "Gaming", GALA: "Gaming",
};

export function sectorOf(base: string): string {
  return SECTORS[base] ?? "Other";
}
