"use client";

import type { Timeframe } from "@cv/core";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Tool } from "../chart/drawing-types";

export interface PanelConfig {
  symbol: string;
  timeframe: Timeframe;
}

interface ChartUiState {
  tool: Tool;
  /** Keep the tool selected after finishing a drawing. */
  stayInTool: boolean;
  panels: PanelConfig[];
  activePanel: number;
  drawingsHidden: boolean;
  replay: { active: boolean; index: number; playing: boolean };
  setTool: (t: Tool) => void;
  setStay: (v: boolean) => void;
  setPanel: (i: number, patch: Partial<PanelConfig>) => void;
  setActivePanel: (i: number) => void;
  setDrawingsHidden: (v: boolean) => void;
  setReplay: (patch: Partial<ChartUiState["replay"]>) => void;
}

export const useChartUi = create<ChartUiState>()(
  persist(
    (set) => ({
      tool: "cursor",
      stayInTool: false,
      panels: [
        { symbol: "BTCUSDT", timeframe: "4h" },
        { symbol: "ETHUSDT", timeframe: "4h" },
        { symbol: "SOLUSDT", timeframe: "1h" },
        { symbol: "BNBUSDT", timeframe: "1d" },
      ],
      activePanel: 0,
      drawingsHidden: false,
      replay: { active: false, index: 0, playing: false },
      setTool: (tool) => set({ tool }),
      setStay: (stayInTool) => set({ stayInTool }),
      setPanel: (i, patch) => set((s) => ({ panels: s.panels.map((p, k) => (k === i ? { ...p, ...patch } : p)) })),
      setActivePanel: (activePanel) => set({ activePanel }),
      setDrawingsHidden: (drawingsHidden) => set({ drawingsHidden }),
      setReplay: (patch) => set((s) => ({ replay: { ...s.replay, ...patch } })),
    }),
    {
      name: "cv.chart-ui",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ panels: s.panels, activePanel: s.activePanel, stayInTool: s.stayInTool }),
    },
  ),
);
