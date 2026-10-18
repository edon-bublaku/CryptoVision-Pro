"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSettings } from "@/lib/store/settings";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 2, refetchOnWindowFocus: false, staleTime: 30_000 } },
      }),
  );
  const [mounted, setMounted] = useState(false);
  const theme = useSettings((s) => s.theme);
  const colorblind = useSettings((s) => s.colorblind);
  const lang = useSettings((s) => s.lang);
  const reduceMotion = useSettings((s) => s.reduceMotion);
  const compact = useSettings((s) => s.compact);

  useEffect(() => {
    setMounted(true);
    // Service worker powers web push and the offline shell (production only, to keep dev HMR clean).
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.theme = theme;
    el.dataset.cb = colorblind ? "1" : "0";
    el.lang = lang;
    el.dataset.motion = reduceMotion ? "reduce" : "auto";
    el.dataset.density = compact ? "compact" : "normal";
  }, [theme, colorblind, lang, reduceMotion, compact]);

  // Everything is client-side (live data + local persistence), so render after mount to avoid
  // hydration mismatches with persisted state.
  return (
    <QueryClientProvider client={client}>
      {mounted ? (
        children
      ) : (
        <div className="bg-app flex h-screen items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" className="h-12 w-12 animate-pulse" />
        </div>
      )}
    </QueryClientProvider>
  );
}
