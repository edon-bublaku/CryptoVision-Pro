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

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.theme = theme;
    el.dataset.cb = colorblind ? "1" : "0";
    el.lang = lang;
  }, [theme, colorblind, lang]);

  // Everything is client-side (live data + local persistence), so render after mount to avoid
  // hydration mismatches with persisted state.
  return (
    <QueryClientProvider client={client}>
      {mounted ? (
        children
      ) : (
        <div className="flex h-screen items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-accent" />
        </div>
      )}
    </QueryClientProvider>
  );
}
