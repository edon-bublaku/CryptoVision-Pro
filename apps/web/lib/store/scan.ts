"use client";

import type { Signal, Timeframe } from "@cv/core";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type { Snapshot, ScanRow, TrackedSignal } from "@cv/engine";
import type { ScanRow, TrackedSignal } from "@cv/engine";

interface ScanState {
  timeframe: Timeframe;
  rows: ScanRow[];
  scannedAt: number | null;
  progress: { done: number; total: number } | null;
  error: string | null;
  tracked: TrackedSignal[];
  setResult: (tf: Timeframe, rows: ScanRow[]) => void;
  setProgress: (p: ScanState["progress"]) => void;
  setError: (e: string | null) => void;
  track: (signals: Signal[]) => void;
  updateTracked: (t: TrackedSignal[]) => void;
}

export const useScan = create<ScanState>()(
  persist(
    (set, get) => ({
      timeframe: "4h",
      rows: [],
      scannedAt: null,
      progress: null,
      error: null,
      tracked: [],
      setResult: (timeframe, rows) => set({ timeframe, rows, scannedAt: Date.now(), progress: null, error: null }),
      setProgress: (progress) => set({ progress }),
      setError: (error) => set({ error, progress: null }),
      track: (signals) => {
        const known = new Set(get().tracked.map((t) => t.signal.id));
        const fresh = signals.filter((s) => !known.has(s.id)).map((signal) => ({ signal, outcome: "pending" as const, bestR: 0, updatedAt: Date.now() }));
        if (fresh.length) set((s) => ({ tracked: [...fresh, ...s.tracked].slice(0, 500) }));
      },
      updateTracked: (tracked) => set({ tracked }),
    }),
    {
      name: "cv.scan",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ timeframe: s.timeframe, rows: s.rows, scannedAt: s.scannedAt, tracked: s.tracked }),
    },
  ),
);
