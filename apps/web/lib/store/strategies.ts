"use client";

import type { CustomStrategyDef } from "@cv/signals";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface StrategiesState {
  saved: CustomStrategyDef[];
  save: (def: CustomStrategyDef) => void;
  remove: (id: string) => void;
}

/** User-defined strategies from the Strategy Builder (synced to the account as state key "strategies"). */
export const useStrategies = create<StrategiesState>()(
  persist(
    (set) => ({
      saved: [],
      save: (def) => set((s) => ({ saved: [...s.saved.filter((x) => x.id !== def.id), def] })),
      remove: (id) => set((s) => ({ saved: s.saved.filter((x) => x.id !== id) })),
    }),
    { name: "cv.strategies", version: 1, storage: createJSONStorage(() => localStorage) },
  ),
);
