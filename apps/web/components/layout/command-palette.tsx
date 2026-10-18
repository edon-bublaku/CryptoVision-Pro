"use client";

import { baseAsset, formatPrice } from "@cv/core";
import { Contrast, CornerDownLeft, Languages, Moon, Search, Star, Sun, type LucideIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTickers } from "@/lib/data/hooks";
import { translate, useT } from "@/lib/i18n";
import { useChartUi } from "@/lib/store/chart-ui";
import { useSettings } from "@/lib/store/settings";
import { cn } from "@/lib/utils";
import { Modal } from "../ui/primitives";
import { CoinIcon, Pct } from "../ui/viz";
import { NAV_ITEMS } from "./nav";

type Entry =
  | { kind: "page"; id: string; label: string; icon: LucideIcon; hint: string; run: () => void }
  | { kind: "action"; id: string; label: string; icon: LucideIcon; run: () => void }
  | { kind: "coin"; id: string; symbol: string; price: number; change: number; run: () => void };

/** Accent-insensitive, case-insensitive "all words appear" match. */
function matches(haystack: string, query: string): boolean {
  const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const h = norm(haystack);
  return norm(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => h.includes(w));
}

/**
 * Ctrl/⌘+K: jump to any page, run quick actions (theme, language, palette, watchlist) or open any
 * coin's chart. Arrow keys + Enter, or click.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const path = usePathname();
  const { data } = useTickers();
  const s = useSettings();
  const activePanel = useChartUi((x) => x.activePanel);
  const setPanel = useChartUi((x) => x.setPanel);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
    }
  }, [open]);

  const entries = useMemo<Entry[]>(() => {
    const go = (href: string) => () => {
      onClose();
      router.push(href);
    };
    const other = s.lang === "sq" ? "en" : "sq";
    const pages: Entry[] = NAV_ITEMS.map((n) => ({
      kind: "page",
      id: `page:${n.href}`,
      label: t(n.key),
      icon: n.icon,
      hint: `${translate(other, n.key)} ${n.keywords ?? ""}`,
      run: go(n.href),
    }));
    const current = path?.startsWith("/chart") ? new URLSearchParams(typeof window !== "undefined" ? window.location.search : "").get("symbol") : null;
    const actions: Entry[] = [
      { kind: "action", id: "theme", label: t(s.theme === "dark" ? "cmd.themeLight" : "cmd.themeDark"), icon: s.theme === "dark" ? Sun : Moon, run: () => s.set({ theme: s.theme === "dark" ? "light" : "dark" }) },
      { kind: "action", id: "lang", label: t("cmd.language"), icon: Languages, run: () => s.set({ lang: other }) },
      { kind: "action", id: "cb", label: t(s.colorblind ? "cmd.colorblindOff" : "cmd.colorblindOn"), icon: Contrast, run: () => s.set({ colorblind: !s.colorblind }) },
      ...(current ? [{ kind: "action" as const, id: "watch", label: `${t(s.watchlist.includes(current) ? "cmd.unwatch" : "cmd.watch")} ${baseAsset(current)}`, icon: Star, run: () => s.toggleWatch(current) }] : []),
    ];
    const coins: Entry[] = [...(data ?? [])]
      .sort((a, b) => b.quoteVolume - a.quoteVolume)
      .map((c) => ({
        kind: "coin",
        id: `coin:${c.symbol}`,
        symbol: c.symbol,
        price: c.lastPrice,
        change: c.priceChangePercent,
        run: () => {
          onClose();
          if (path?.startsWith("/chart")) setPanel(activePanel, { symbol: c.symbol });
          router.push(`/chart?symbol=${c.symbol}`);
        },
      }));
    return [...pages, ...actions, ...coins];
  }, [data, s, t, path, router, onClose, activePanel, setPanel]);

  const results = useMemo(() => {
    const query = q.trim();
    if (!query) return [...entries.filter((e) => e.kind !== "coin"), ...entries.filter((e) => e.kind === "coin").slice(0, 8)];
    const upper = query.toUpperCase();
    const coins = entries
      .filter((e): e is Extract<Entry, { kind: "coin" }> => e.kind === "coin" && e.symbol.includes(upper.replace(/\s/g, "")))
      .sort((a, b) => Number(b.symbol.startsWith(upper)) - Number(a.symbol.startsWith(upper)))
      .slice(0, 12);
    const rest = entries.filter((e) => e.kind !== "coin" && matches(`${e.label} ${e.kind === "page" ? e.hint : ""}`, query));
    // A query that looks like a ticker puts coins first.
    return /^[a-z0-9]{2,10}$/i.test(query) && coins.length ? [...coins, ...rest] : [...rest, ...coins];
  }, [entries, q]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${idx}"]`)?.scrollIntoView({ block: "nearest" });
  }, [idx]);

  const section = (e: Entry) => (e.kind === "page" ? t("cmd.pages") : e.kind === "action" ? t("cmd.actions") : t("cmd.coins"));

  return (
    <Modal open={open} onClose={onClose} title={t("cmd.title")}>
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls="cmd-list"
          aria-activedescendant={results[idx] ? `cmd-${idx}` : undefined}
          aria-label={t("cmd.placeholder")}
          value={q}
          placeholder={t("cmd.placeholder")}
          onChange={(e) => {
            setQ(e.target.value);
            setIdx(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIdx((i) => Math.min(results.length - 1, i + 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setIdx((i) => Math.max(0, i - 1));
            }
            if (e.key === "Enter") results[idx]?.run();
          }}
          className="h-11 w-full rounded-xl border border-line bg-panel-2 pr-3 pl-9 text-sm outline-none focus:border-accent"
        />
      </div>
      <ul id="cmd-list" role="listbox" ref={listRef} className="mt-3 max-h-[55vh] overflow-y-auto">
        {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-faint">{t("cmd.empty")}</li>}
        {results.map((e, i) => {
          const first = i === 0 || section(results[i - 1]!) !== section(e);
          return (
            <li key={e.id} role="presentation">
              {first && <div className="px-2.5 pt-2 pb-1 text-[10px] font-semibold tracking-wide text-faint uppercase">{section(e)}</div>}
              <button
                id={`cmd-${i}`}
                role="option"
                aria-selected={i === idx}
                data-idx={i}
                onClick={e.run}
                onMouseEnter={() => setIdx(i)}
                className={cn("flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left", i === idx && "bg-panel-2")}
              >
                {e.kind === "coin" ? (
                  <>
                    <CoinIcon symbol={e.symbol} size={26} />
                    <span className="flex-1">
                      <span className="text-sm font-semibold">{baseAsset(e.symbol)}</span>
                      <span className="text-xs text-faint">/USDT</span>
                    </span>
                    <span className="num text-sm">{formatPrice(e.price)}</span>
                    <Pct value={e.change} className="w-16 text-right text-xs" />
                  </>
                ) : (
                  <>
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-panel-2 text-muted">
                      <e.icon size={15} />
                    </span>
                    <span className="flex-1 text-sm">{e.label}</span>
                  </>
                )}
                {i === idx && <CornerDownLeft size={13} className="text-faint" />}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 hidden text-[11px] text-faint sm:block">{t("cmd.hint")}</p>
    </Modal>
  );
}
