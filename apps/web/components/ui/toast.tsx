"use client";

import { Bell, CheckCircle2, AlertTriangle, X } from "lucide-react";
import { create } from "zustand";
import { cn } from "@/lib/utils";

interface Toast {
  id: string;
  title: string;
  body?: string;
  tone: "info" | "success" | "warn";
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, "id">) => void;
  dismiss: (id: string) => void;
}

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = crypto.randomUUID();
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), 6000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export const toast = (t: Omit<Toast, "id">) => useToasts.getState().push(t);

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed right-4 bottom-20 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2 lg:bottom-4" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto flex items-start gap-3 rounded-xl border border-line bg-panel p-3 shadow-2xl">
          <div className={cn("mt-0.5", t.tone === "success" && "text-bull", t.tone === "warn" && "text-warn", t.tone === "info" && "text-accent")}>
            {t.tone === "success" ? <CheckCircle2 size={18} /> : t.tone === "warn" ? <AlertTriangle size={18} /> : <Bell size={18} />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{t.title}</p>
            {t.body && <p className="mt-0.5 text-xs text-muted">{t.body}</p>}
          </div>
          <button onClick={() => dismiss(t.id)} className="text-faint hover:text-fg" aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
