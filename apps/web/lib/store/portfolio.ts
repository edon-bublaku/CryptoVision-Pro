"use client";

import type { Side } from "@cv/core";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface Position {
  id: string;
  symbol: string;
  side: Side;
  entry: number;
  quantity: number;
  stopLoss?: number;
  takeProfit?: number;
  leverage: number;
  openedAt: number;
  notes?: string;
  strategyId?: string | null;
}

export interface ClosedTrade extends Position {
  exit: number;
  closedAt: number;
  pnl: number;
  /** PnL in multiples of the initial risk, when a stop was set. */
  r?: number;
}

interface PortfolioState {
  positions: Position[];
  closed: ClosedTrade[];
  add: (p: Omit<Position, "id" | "openedAt"> & { openedAt?: number }) => void;
  update: (id: string, patch: Partial<Position>) => void;
  remove: (id: string) => void;
  close: (id: string, exit: number) => void;
  removeClosed: (id: string) => void;
}

export const usePortfolio = create<PortfolioState>()(
  persist(
    (set, get) => ({
      positions: [],
      closed: [],
      add: (p) => set((s) => ({ positions: [...s.positions, { ...p, id: crypto.randomUUID(), openedAt: p.openedAt ?? Date.now() }] })),
      update: (id, patch) => set((s) => ({ positions: s.positions.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      remove: (id) => set((s) => ({ positions: s.positions.filter((p) => p.id !== id) })),
      close: (id, exit) => {
        const p = get().positions.find((x) => x.id === id);
        if (!p) return;
        const dir = p.side === "LONG" ? 1 : -1;
        const pnl = (exit - p.entry) * p.quantity * dir;
        const risk = p.stopLoss !== undefined ? Math.abs(p.entry - p.stopLoss) * p.quantity : undefined;
        set((s) => ({
          positions: s.positions.filter((x) => x.id !== id),
          closed: [{ ...p, exit, closedAt: Date.now(), pnl, r: risk ? pnl / risk : undefined }, ...s.closed],
        }));
      },
      removeClosed: (id) => set((s) => ({ closed: s.closed.filter((c) => c.id !== id) })),
    }),
    { name: "cv.portfolio", version: 1, storage: createJSONStorage(() => localStorage) },
  ),
);
