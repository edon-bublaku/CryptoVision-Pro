"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { DRAWING_SCHEMA_VERSION, type Drawing } from "../chart/drawing-types";

type Snapshot = Drawing[];

interface DrawingsState {
  bySymbol: Record<string, Drawing[]>;
  /** Undo / redo stacks per symbol (not persisted). */
  past: Record<string, Snapshot[]>;
  future: Record<string, Snapshot[]>;
  selectedId: string | null;
  select: (id: string | null) => void;
  /** Replace drawings for a symbol, recording an undo step. */
  commit: (symbol: string, next: Drawing[]) => void;
  /** Replace without an undo step (live drag preview). */
  replace: (symbol: string, next: Drawing[]) => void;
  /** Record the current state as an undo step (call before a drag starts). */
  checkpoint: (symbol: string) => void;
  undo: (symbol: string) => void;
  redo: (symbol: string) => void;
}

const LIMIT = 100;

export const useDrawings = create<DrawingsState>()(
  persist(
    (set, get) => ({
      bySymbol: {},
      past: {},
      future: {},
      selectedId: null,
      select: (id) => set({ selectedId: id }),
      commit: (symbol, next) => {
        const cur = get().bySymbol[symbol] ?? [];
        set((s) => ({
          bySymbol: { ...s.bySymbol, [symbol]: next },
          past: { ...s.past, [symbol]: [...(s.past[symbol] ?? []), cur].slice(-LIMIT) },
          future: { ...s.future, [symbol]: [] },
        }));
      },
      replace: (symbol, next) => set((s) => ({ bySymbol: { ...s.bySymbol, [symbol]: next } })),
      checkpoint: (symbol) => {
        const cur = get().bySymbol[symbol] ?? [];
        set((s) => ({ past: { ...s.past, [symbol]: [...(s.past[symbol] ?? []), cur].slice(-LIMIT) }, future: { ...s.future, [symbol]: [] } }));
      },
      undo: (symbol) => {
        const past = get().past[symbol] ?? [];
        if (!past.length) return;
        const prev = past[past.length - 1]!;
        const cur = get().bySymbol[symbol] ?? [];
        set((s) => ({
          bySymbol: { ...s.bySymbol, [symbol]: prev },
          past: { ...s.past, [symbol]: past.slice(0, -1) },
          future: { ...s.future, [symbol]: [cur, ...(s.future[symbol] ?? [])] },
          selectedId: null,
        }));
      },
      redo: (symbol) => {
        const fut = get().future[symbol] ?? [];
        if (!fut.length) return;
        const next = fut[0]!;
        const cur = get().bySymbol[symbol] ?? [];
        set((s) => ({
          bySymbol: { ...s.bySymbol, [symbol]: next },
          past: { ...s.past, [symbol]: [...(s.past[symbol] ?? []), cur] },
          future: { ...s.future, [symbol]: fut.slice(1) },
          selectedId: null,
        }));
      },
    }),
    {
      name: "cv.drawings",
      version: DRAWING_SCHEMA_VERSION,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ bySymbol: s.bySymbol }),
    },
  ),
);
