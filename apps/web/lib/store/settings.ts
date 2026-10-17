"use client";

import type { Timeframe } from "@cv/core";
import { RISK_PROFILES, type RiskProfile } from "@cv/risk";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type ChartType = "candles" | "heikin" | "bars" | "line" | "area";

export interface ChartPrefs {
  type: ChartType;
  log: boolean;
  /** Enabled indicator ids, see lib/chart/indicators.ts */
  indicators: string[];
  /** Enabled auto-analysis overlays */
  overlays: string[];
  magnet: boolean;
  layout: 1 | 2 | 4;
}

export interface SettingsState {
  lang: "sq" | "en";
  theme: "dark" | "light";
  colorblind: boolean;
  riskProfile: RiskProfile;
  equity: number;
  riskPct: number;
  maxLeverage: number;
  maxPositions: number;
  feePct: number;
  defaultTf: Timeframe;
  scanSize: number;
  watchlist: string[];
  telegram: { token: string; chatId: string };
  disclaimerAccepted: boolean;
  chart: ChartPrefs;
  set: (patch: Partial<Omit<SettingsState, "set" | "setChart" | "applyProfile" | "toggleWatch">>) => void;
  setChart: (patch: Partial<ChartPrefs>) => void;
  applyProfile: (p: RiskProfile) => void;
  toggleWatch: (symbol: string) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      lang: "sq",
      theme: "dark",
      colorblind: false,
      riskProfile: "moderate",
      equity: 10_000,
      riskPct: 1,
      maxLeverage: 3,
      maxPositions: 5,
      feePct: 0.1,
      defaultTf: "4h",
      scanSize: 40,
      watchlist: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"],
      telegram: { token: "", chatId: "" },
      disclaimerAccepted: false,
      chart: {
        type: "candles",
        log: false,
        indicators: ["ema20", "ema50", "ema200", "volume", "rsi"],
        overlays: ["levels", "signal", "structure"],
        magnet: true,
        layout: 1,
      },
      set: (patch) => set(patch),
      setChart: (patch) => set((s) => ({ chart: { ...s.chart, ...patch } })),
      applyProfile: (p) => set({ riskProfile: p, ...RISK_PROFILES[p] }),
      toggleWatch: (symbol) =>
        set((s) => ({ watchlist: s.watchlist.includes(symbol) ? s.watchlist.filter((x) => x !== symbol) : [...s.watchlist, symbol] })),
    }),
    { name: "cv.settings", version: 1, storage: createJSONStorage(() => localStorage) },
  ),
);
