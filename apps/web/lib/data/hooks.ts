"use client";

import type { Ticker } from "@cv/core";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { getTickers24h } from "./binance";
import { binanceStream, type MiniTicker, type StreamStatus } from "./stream";

/** Live prices from the all-market mini-ticker stream, merged into one shared store. */
interface LiveState {
  prices: Record<string, { price: number; open: number; quoteVolume: number; high: number; low: number }>;
  apply: (batch: MiniTicker[]) => void;
}

export const useLive = create<LiveState>((set) => ({
  prices: {},
  apply: (batch) =>
    set((s) => {
      const next = { ...s.prices };
      for (const m of batch) next[m.s] = { price: +m.c, open: +m.o, quoteVolume: +m.q, high: +m.h, low: +m.l };
      return { prices: next };
    }),
}));

let liveRefs = 0;
let liveUnsub: (() => void) | null = null;
let pending: MiniTicker[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

/** Subscribe to `!miniTicker@arr` while any component needs live prices (ref-counted, 1 Hz flush). */
export function useLivePrices() {
  useEffect(() => {
    liveRefs++;
    if (!liveUnsub) {
      liveUnsub = binanceStream.subscribe("!miniTicker@arr", (raw) => {
        pending.push(...(raw as MiniTicker[]));
      });
      flushTimer = setInterval(() => {
        if (!pending.length) return;
        const batch = pending;
        pending = [];
        useLive.getState().apply(batch);
      }, 1000);
    }
    return () => {
      liveRefs--;
      if (liveRefs === 0) {
        liveUnsub?.();
        liveUnsub = null;
        if (flushTimer) clearInterval(flushTimer);
        flushTimer = null;
      }
    };
  }, []);
  return useLive((s) => s.prices);
}

/** 24h tickers for all tradable USDT pairs, with live prices overlaid. */
export function useTickers(): { data: Ticker[] | undefined; isLoading: boolean; error: unknown; refetch: () => void } {
  const q = useQuery({ queryKey: ["tickers24h"], queryFn: ({ signal }) => getTickers24h(signal), staleTime: 60_000, refetchInterval: 120_000 });
  const live = useLivePrices();
  const data = q.data?.map((t) => {
    const l = live[t.symbol];
    if (!l) return t;
    return { ...t, lastPrice: l.price, priceChangePercent: l.open ? ((l.price - l.open) / l.open) * 100 : t.priceChangePercent, quoteVolume: l.quoteVolume || t.quoteVolume, highPrice: l.high, lowPrice: l.low };
  });
  return { data, isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch() };
}

export function useStreamStatus(): StreamStatus {
  const [s, setS] = useState<StreamStatus>(binanceStream.status);
  useEffect(() => binanceStream.onStatus(setS), []);
  return s;
}
