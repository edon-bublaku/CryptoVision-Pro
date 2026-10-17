"use client";

import type { Snapshot } from "@cv/engine";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type Metric = keyof Omit<Snapshot, "spark">;
export interface Rule {
  metric: Metric;
  op: ">" | "<";
  value: number;
}

export interface SavedScansState {
  saved: { name: string; rules: Rule[] }[];
  save: (name: string, rules: Rule[]) => void;
  remove: (name: string) => void;
}

export const useSavedScans = create<SavedScansState>()(
  persist(
    (set) => ({
      saved: [],
      save: (name, rules) => set((s) => ({ saved: [...s.saved.filter((x) => x.name !== name), { name, rules }] })),
      remove: (name) => set((s) => ({ saved: s.saved.filter((x) => x.name !== name) })),
    }),
    { name: "cv.screens", storage: createJSONStorage(() => localStorage) },
  ),
);
