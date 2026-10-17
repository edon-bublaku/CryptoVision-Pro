"use client";

import { derivativesBias, getDerivatives, type DerivativesSnapshot } from "@cv/exchange";
import { useQuery } from "@tanstack/react-query";

export type Derivatives = DerivativesSnapshot & { bias: number };

/** Server proxy first (shared Redis cache); straight to OKX when running without a backend. */
async function fetchDerivatives(symbol: string, signal?: AbortSignal): Promise<Derivatives | null> {
  try {
    const res = await fetch(`/api/derivatives?symbol=${symbol}`, { signal });
    if (res.ok) return (await res.json()) as Derivatives;
    if (res.status === 404 || res.status === 400) return null;
  } catch {
    /* fall through to direct */
  }
  try {
    const d = await getDerivatives(symbol, signal);
    return { ...d, bias: derivativesBias(d) };
  } catch {
    return null;
  }
}

export function useDerivatives(symbol: string) {
  return useQuery({ queryKey: ["deriv", symbol], queryFn: ({ signal }) => fetchDerivatives(symbol, signal), staleTime: 60_000, refetchInterval: 120_000, retry: 0 });
}
