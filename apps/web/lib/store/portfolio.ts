"use client";

import type { Side } from "@cv/core";
import { closeResult, orderFillPrice, type ExitReason, type PaperOrder } from "@cv/risk";
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
  /** Paper-trading position: SL, TP and liquidation are executed automatically. */
  paper?: boolean;
}

export interface ClosedTrade extends Position {
  exit: number;
  closedAt: number;
  pnl: number;
  /** PnL in multiples of the initial risk, when a stop was set. */
  r?: number;
  exitReason?: ExitReason;
}

export type { PaperOrder };

interface PortfolioState {
  positions: Position[];
  closed: ClosedTrade[];
  /** Pending paper-trading orders (synced as state key "orders"). */
  orders: PaperOrder[];
  add: (p: Omit<Position, "id" | "openedAt"> & { openedAt?: number }) => void;
  update: (id: string, patch: Partial<Position>) => void;
  remove: (id: string) => void;
  close: (id: string, exit: number, reason?: ExitReason) => void;
  removeClosed: (id: string) => void;
  placeOrder: (o: Omit<PaperOrder, "id" | "createdAt">) => void;
  cancelOrder: (id: string) => void;
  /** Turns a triggered order into a paper position. The position reuses the order id, so two
   *  devices filling the same order converge on one position after sync. */
  fillOrder: (id: string, marketPrice: number) => Position | null;
}

export const usePortfolio = create<PortfolioState>()(
  persist(
    (set, get) => ({
      positions: [],
      closed: [],
      orders: [],
      add: (p) => set((s) => ({ positions: [...s.positions, { ...p, id: crypto.randomUUID(), openedAt: p.openedAt ?? Date.now() }] })),
      update: (id, patch) => set((s) => ({ positions: s.positions.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      remove: (id) => set((s) => ({ positions: s.positions.filter((p) => p.id !== id) })),
      close: (id, exit, reason = "MANUAL") => {
        const p = get().positions.find((x) => x.id === id);
        if (!p) return;
        const { pnl, r } = closeResult(p, exit, reason);
        set((s) => ({
          positions: s.positions.filter((x) => x.id !== id),
          closed: [{ ...p, exit, closedAt: Date.now(), pnl, r, exitReason: reason }, ...s.closed.filter((c) => c.id !== id)],
        }));
      },
      removeClosed: (id) => set((s) => ({ closed: s.closed.filter((c) => c.id !== id) })),
      placeOrder: (o) => set((s) => ({ orders: [...s.orders, { ...o, id: crypto.randomUUID(), createdAt: Date.now() }] })),
      cancelOrder: (id) => set((s) => ({ orders: s.orders.filter((o) => o.id !== id) })),
      fillOrder: (id, marketPrice) => {
        const o = get().orders.find((x) => x.id === id);
        if (!o || get().positions.some((p) => p.id === id)) return null;
        const pos: Position = {
          id: o.id,
          symbol: o.symbol,
          side: o.side,
          entry: orderFillPrice(o, marketPrice),
          quantity: o.quantity,
          stopLoss: o.stopLoss,
          takeProfit: o.takeProfit,
          leverage: o.leverage,
          openedAt: Date.now(),
          notes: o.note ? `${o.type} · ${o.note}` : o.type,
          paper: true,
        };
        set((s) => ({ orders: s.orders.filter((x) => x.id !== id), positions: [...s.positions, pos] }));
        return pos;
      },
    }),
    {
      name: "cv.portfolio",
      version: 2,
      storage: createJSONStorage(() => localStorage),
      migrate: (state, version) => {
        const s = state as Partial<PortfolioState>;
        return { ...s, orders: version < 2 ? [] : (s.orders ?? []) } as PortfolioState;
      },
    },
  ),
);
