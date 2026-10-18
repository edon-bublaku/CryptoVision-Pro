"use client";

import type { Candle } from "@cv/core";
import { closedOnly, getFearGreed, getKlines } from "@cv/exchange";
import { buildRatingContext, investmentPlan, rateAt, type InvestmentPlan, type Rating, type RatingContext } from "@cv/rating";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { activeRatingWeights, useSettings } from "../store/settings";

export const BENCH = "BTCUSDT";
/** Enough daily history for EMA200, the 52-week high and the 90-day metrics. */
export const RATING_BARS = 420;

export function useDaily(symbol: string) {
  return useQuery({
    queryKey: ["daily", symbol, RATING_BARS],
    queryFn: async ({ signal }): Promise<Candle[]> => closedOnly(await getKlines(symbol, "1d", RATING_BARS, undefined, signal)),
    staleTime: 15 * 60_000,
    enabled: !!symbol,
  });
}

export function useFearGreedHistory() {
  return useQuery({ queryKey: ["fng-history"], queryFn: ({ signal }) => getFearGreed(RATING_BARS, signal), staleTime: 60 * 60_000, retry: 1 });
}

export interface RatingView {
  rating: Rating | null;
  plan: InvestmentPlan | null;
  ctx: RatingContext | null;
  isLoading: boolean;
  error: unknown;
}

/** CV Rating + investment plan for one coin, with the user's weights and risk settings. */
export function useRating(symbol: string): RatingView {
  const coin = useDaily(symbol);
  const bench = useDaily(BENCH);
  const fg = useFearGreedHistory();
  const s = useSettings();
  const weights = activeRatingWeights(s);

  const ctx = useMemo(
    () => (coin.data && bench.data ? buildRatingContext({ candles: coin.data, bench: bench.data, fearGreed: fg.data ?? [], isBench: symbol === BENCH }) : null),
    [coin.data, bench.data, fg.data, symbol],
  );
  const rating = useMemo(() => (ctx ? rateAt(ctx, undefined, weights) : null), [ctx, weights]);
  const plan = useMemo(
    () => (ctx && rating ? investmentPlan(rating, ctx, { equity: s.equity, riskPct: s.riskPct, maxLeverage: s.maxLeverage, feeRate: s.feePct / 100, allowShort: s.allowShortPlans }) : null),
    [ctx, rating, s.equity, s.riskPct, s.maxLeverage, s.feePct, s.allowShortPlans],
  );
  return { rating, plan, ctx, isLoading: coin.isLoading || bench.isLoading, error: coin.error ?? bench.error };
}
