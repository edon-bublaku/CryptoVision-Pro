"use client";

import type { Candle, Timeframe } from "@cv/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { getKlines } from "@cv/exchange";
import { binanceStream, type KlineEvent } from "@cv/exchange";

export interface CandleFeed {
  candles: Candle[];
  /** Whether the last candle is still forming. */
  lastIsOpen: boolean;
  status: "loading" | "ready" | "error";
  error: string | null;
  /** Increments on every closed candle — use it to recompute analysis. */
  closedVersion: number;
  /** Increments on every tick. */
  tickVersion: number;
  loadingMore: boolean;
  loadMore: () => Promise<number>;
  reload: () => void;
}

/**
 * Historical klines + live kline stream for one symbol/timeframe, with gap-fill on reconnect
 * and backwards paging for lazy history.
 */
export function useCandles(symbol: string, tf: Timeframe, initial = 1000): CandleFeed {
  const [state, setState] = useState<Omit<CandleFeed, "loadMore" | "reload">>({
    candles: [],
    lastIsOpen: false,
    status: "loading",
    error: null,
    closedVersion: 0,
    tickVersion: 0,
    loadingMore: false,
  });
  const ref = useRef<Candle[]>([]);
  const exhausted = useRef(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (initial <= 0) return;
    const ac = new AbortController();
    ref.current = [];
    exhausted.current = false;
    setState((s) => ({ ...s, candles: [], status: "loading", error: null }));

    const applyTick = (c: Candle, closed: boolean) => {
      const arr = ref.current;
      const last = arr[arr.length - 1];
      if (last && c.time < last.time) return;
      if (last && last.time === c.time) arr[arr.length - 1] = c;
      else arr.push(c);
      setState((s) => ({
        ...s,
        candles: arr,
        lastIsOpen: !closed,
        tickVersion: s.tickVersion + 1,
        closedVersion: closed ? s.closedVersion + 1 : s.closedVersion,
      }));
    };

    const gapFill = async () => {
      try {
        const r = await getKlines(symbol, tf, 50, undefined, ac.signal);
        const arr = ref.current;
        const firstNew = r.candles[0];
        if (!firstNew) return;
        const keep = arr.filter((c) => c.time < firstNew.time);
        ref.current = [...keep, ...r.candles];
        setState((s) => ({ ...s, candles: ref.current, lastIsOpen: r.lastIsOpen, closedVersion: s.closedVersion + 1 }));
      } catch {
        /* next reconnect will retry */
      }
    };

    let unsub: (() => void) | null = null;
    let unsubRe: (() => void) | null = null;
    getKlines(symbol, tf, initial, undefined, ac.signal)
      .then((r) => {
        ref.current = r.candles;
        setState((s) => ({ ...s, candles: r.candles, lastIsOpen: r.lastIsOpen, status: "ready", closedVersion: s.closedVersion + 1 }));
        unsub = binanceStream.subscribe(`${symbol.toLowerCase()}@kline_${tf}`, (raw) => {
          const k = (raw as KlineEvent).k;
          applyTick({ time: k.t / 1000, open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v, quoteVolume: +k.q, takerBuyVolume: +k.V, trades: k.n }, k.x);
        });
        unsubRe = binanceStream.onReconnect(gapFill);
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setState((s) => ({ ...s, status: "error", error: e instanceof Error ? e.message : String(e) }));
      });
    return () => {
      ac.abort();
      unsub?.();
      unsubRe?.();
    };
  }, [symbol, tf, initial, nonce]);

  const loadMore = useCallback(async () => {
    if (exhausted.current || state.loadingMore) return 0;
    const oldest = ref.current[0];
    if (!oldest) return 0;
    setState((s) => ({ ...s, loadingMore: true }));
    try {
      const r = await getKlines(symbol, tf, 1000, oldest.time - 1);
      if (r.candles.length === 0) exhausted.current = true;
      ref.current = [...r.candles.filter((c) => c.time < oldest.time), ...ref.current];
      setState((s) => ({ ...s, candles: ref.current, loadingMore: false, closedVersion: s.closedVersion + 1 }));
      return r.candles.length;
    } catch {
      setState((s) => ({ ...s, loadingMore: false }));
      return 0;
    }
  }, [symbol, tf, state.loadingMore]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { ...state, loadMore, reload };
}
