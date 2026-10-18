"use client";

import type { Candle } from "@cv/core";
import { closedOnly, getFearGreed, getKlines, universe } from "@cv/exchange";
import { buildRatingContext, investmentPlan, rateAt, recommend, type InvestmentPlan, type Rating, type RatingContext, type Recommendation } from "@cv/rating";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { activeRatingWeights, useSettings } from "../store/settings";
import { useTickers } from "./hooks";

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

/** Context cache shared by every page, keyed by coin and data version: re-weighting never rebuilds. */
const ctxCache = new Map<string, { at: number; fg: number; ctx: RatingContext }>();

/**
 * Daily history and rating contexts for the top `size` coins by volume (BTC always included),
 * loaded in parallel and cached; `loaded`/`total` drive progress UI.
 */
export function useUniverseContexts(size: number) {
  const { data: tickers } = useTickers();
  const fg = useFearGreedHistory();
  const symbols = useMemo(() => {
    if (!tickers) return [];
    const top = universe(tickers, size).map((x) => x.symbol);
    return top.includes(BENCH) ? top : [BENCH, ...top.slice(0, size - 1)];
  }, [tickers, size]);
  const queries = useQueries({
    queries: symbols.map((sym) => ({
      queryKey: ["daily", sym, RATING_BARS],
      queryFn: async ({ signal }: { signal: AbortSignal }): Promise<Candle[]> => closedOnly(await getKlines(sym, "1d", RATING_BARS, undefined, signal)),
      staleTime: 15 * 60_000,
    })),
  });
  const bench = queries[symbols.indexOf(BENCH)]?.data;
  const version = queries.map((q) => q.dataUpdatedAt).join(",");
  const contexts = useMemo(() => {
    const out: { symbol: string; ctx: RatingContext }[] = [];
    if (!bench) return out;
    symbols.forEach((sym, k) => {
      const q = queries[k];
      if (!q?.data) return;
      const hit = ctxCache.get(sym);
      if (hit && hit.at === q.dataUpdatedAt && hit.fg === fg.dataUpdatedAt) return out.push({ symbol: sym, ctx: hit.ctx });
      const ctx = buildRatingContext({ candles: q.data, bench, fearGreed: fg.data ?? [], isBench: sym === BENCH });
      ctxCache.set(sym, { at: q.dataUpdatedAt, fg: fg.dataUpdatedAt, ctx });
      out.push({ symbol: sym, ctx });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, symbols.join(","), fg.dataUpdatedAt, bench]);
  return { symbols, contexts, loaded: queries.filter((q) => q.data).length, total: symbols.length };
}

/** The recommender, recomputed when data, weights or risk settings change. */
export function useRecommendation(size: number, maxPositions: number) {
  const s = useSettings();
  const weights = activeRatingWeights(s);
  const { contexts, loaded, total } = useUniverseContexts(size);
  const rec = useMemo<Recommendation | null>(() => {
    const bench = contexts.find((c) => c.symbol === BENCH);
    if (!bench || contexts.length < 5) return null;
    return recommend(contexts, bench, { maxPositions, weights, plan: { equity: s.equity, riskPct: s.riskPct, maxLeverage: 1, feeRate: s.feePct / 100 } });
  }, [contexts, maxPositions, weights, s.equity, s.riskPct, s.feePct]);
  return { rec, loaded, total };
}
