"use client";

import type { Timeframe } from "@cv/core";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type AlertType = "price_above" | "price_below" | "change_pct" | "rsi_above" | "rsi_below" | "rating_above" | "rating_below" | "signal" | "drawing";

export interface Alert {
  id: string;
  symbol: string;
  type: AlertType;
  value: number;
  timeframe?: Timeframe;
  /** For drawing alerts: the drawing to evaluate. */
  drawingId?: string;
  once: boolean;
  active: boolean;
  createdAt: number;
  note?: string;
  /** Last observed side relative to the level, for cross detection. */
  lastSide?: -1 | 1;
}

export interface AlertEvent {
  id: string;
  alertId: string;
  symbol: string;
  message: string;
  time: number;
  read: boolean;
}

interface AlertsState {
  alerts: Alert[];
  history: AlertEvent[];
  add: (a: Omit<Alert, "id" | "createdAt" | "active"> & { active?: boolean }) => void;
  update: (id: string, patch: Partial<Alert>) => void;
  remove: (id: string) => void;
  log: (e: Omit<AlertEvent, "id" | "time" | "read">) => void;
  markAllRead: () => void;
  clearHistory: () => void;
}

export const useAlerts = create<AlertsState>()(
  persist(
    (set) => ({
      alerts: [],
      history: [],
      add: (a) => set((s) => ({ alerts: [{ ...a, active: a.active ?? true, id: crypto.randomUUID(), createdAt: Date.now() }, ...s.alerts] })),
      update: (id, patch) => set((s) => ({ alerts: s.alerts.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),
      remove: (id) => set((s) => ({ alerts: s.alerts.filter((a) => a.id !== id) })),
      log: (e) => set((s) => ({ history: [{ ...e, id: crypto.randomUUID(), time: Date.now(), read: false }, ...s.history].slice(0, 200) })),
      markAllRead: () => set((s) => ({ history: s.history.map((h) => ({ ...h, read: true })) })),
      clearHistory: () => set({ history: [] }),
    }),
    { name: "cv.alerts", version: 1, storage: createJSONStorage(() => localStorage) },
  ),
);
