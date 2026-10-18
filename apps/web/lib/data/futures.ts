"use client";

import type { Candle, Timeframe } from "@cv/core";
import { HIGHER_TIMEFRAME } from "@cv/core";
import { fullAnalysis, type FullAnalysis } from "@cv/engine";
import { closedOnly, getFearGreed, getKlines } from "@cv/exchange";
import { derivativeEvents, marketEvents, type DerivativeEvent, type MarketEvent } from "@cv/signals";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useDerivatives, type Derivatives } from "./derivatives";

export interface FuturesData {
  candles: Candle[];
  analysis: FullAnalysis | null;
  events: MarketEvent[];
  derivatives: Derivatives | null;
  derivEvents: DerivativeEvent[];
  isLoading: boolean;
  error: unknown;
}

/**
 * Everything the futures page needs for one symbol/timeframe: the same full analysis the chart
 * runs (signal, plan, backtest gate), the event log, and perpetual-swap positioning.
 */
export function useFuturesData(symbol: string, tf: Timeframe): FuturesData {
  const klines = useQuery({
    queryKey: ["klines", symbol, tf, 1000],
    queryFn: async ({ signal }) => closedOnly(await getKlines(symbol, tf, 1000, undefined, signal)),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  const htf = HIGHER_TIMEFRAME[tf];
  const htfQuery = useQuery({
    queryKey: ["klines", symbol, htf, 300],
    queryFn: async ({ signal }) => closedOnly(await getKlines(symbol, htf, 300, undefined, signal)),
    enabled: htf !== tf,
    staleTime: 5 * 60_000,
  });
  const fg = useQuery({ queryKey: ["fng"], queryFn: ({ signal }) => getFearGreed(30, signal), staleTime: 30 * 60_000, retry: 1 });
  const deriv = useDerivatives(symbol);

  const candles = useMemo(() => klines.data ?? [], [klines.data]);
  const analysis = useMemo(
    () =>
      candles.length >= 220
        ? fullAnalysis({ symbol, timeframe: tf, candles, htfCandles: htfQuery.data, fearGreed: fg.data?.[fg.data.length - 1]?.value, derivativesBias: deriv.data?.bias ?? undefined })
        : null,
    [candles, htfQuery.data, fg.data, deriv.data?.bias, symbol, tf],
  );
  const events = useMemo(() => (analysis ? marketEvents(analysis.analysis.context, { bars: 300 }) : []), [analysis]);
  const d = deriv.data ?? null;
  const derivEvents = useMemo(() => {
    if (!d) return [];
    const total = d.takerBuy24h + d.takerSell24h;
    return derivativeEvents({ fundingRate: d.fundingRate, fundingIntervalHours: d.fundingIntervalHours, oiChange24hPct: d.oiChange24hPct, longShortRatio: d.longShortRatio, takerBuyShare: total > 0 ? d.takerBuy24h / total : undefined });
  }, [d]);
  return { candles, analysis, events, derivatives: d, derivEvents, isLoading: klines.isLoading, error: klines.error };
}
