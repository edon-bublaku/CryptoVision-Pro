"use client";

import type { Timeframe } from "@cv/core";
import { useCallback, useRef } from "react";
import { getFearGreed } from "@cv/exchange";
import { getTickers24h, universe } from "@cv/exchange";
import { useScan } from "./store/scan";
import { useSettings } from "./store/settings";
import type { ScanMessage, ScanRequest } from "../workers/scan.worker";

/** Runs a market scan in a Web Worker and stores the result (and tracks new ACTIVE signals). */
export function useScanner() {
  const workerRef = useRef<Worker | null>(null);
  const progress = useScan((s) => s.progress);

  const run = useCallback(async (timeframe: Timeframe, size?: number) => {
    const st = useScan.getState();
    if (st.progress) return;
    st.setProgress({ done: 0, total: 0 });
    try {
      const n = size ?? useSettings.getState().scanSize;
      const [tickers, fg] = await Promise.all([getTickers24h(), getFearGreed(1).catch(() => [])]);
      const coins = universe(tickers, n).map((t) => ({ symbol: t.symbol, change24h: t.priceChangePercent, quoteVolume: t.quoteVolume }));
      st.setProgress({ done: 0, total: coins.length });
      workerRef.current?.terminate();
      const worker = new Worker(new URL("../workers/scan.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.onmessage = (e: MessageEvent<ScanMessage>) => {
        const m = e.data;
        if (m.type === "progress") useScan.getState().setProgress({ done: m.done, total: m.total });
        else if (m.type === "done") {
          const rows = [...m.rows].sort((a, b) => Math.abs(b.signal.score - 50) * b.signal.confidence - Math.abs(a.signal.score - 50) * a.signal.confidence);
          useScan.getState().setResult(timeframe, rows);
          useScan.getState().track(rows.filter((r) => r.signal.status === "ACTIVE" && r.signal.plan).map((r) => r.signal));
          worker.terminate();
        } else {
          useScan.getState().setError(m.message);
          worker.terminate();
        }
      };
      worker.onerror = (e) => {
        useScan.getState().setError(e.message || "Worker error");
        worker.terminate();
      };
      worker.postMessage({ timeframe, coins, fearGreed: fg[fg.length - 1]?.value } satisfies ScanRequest);
    } catch (e) {
      useScan.getState().setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return { run, progress };
}
