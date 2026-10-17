"use client";

import { formatPrice } from "@cv/core";
import { Activity, Bell, BriefcaseBusiness, CandlestickChart, FlaskConical, Gauge, LayoutDashboard, Radar, Search, Settings, ShieldAlert, Wifi, WifiOff, Zap } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useStreamStatus, useTickers } from "@/lib/data/hooks";
import { useT } from "@/lib/i18n";
import { useAlerts } from "@/lib/store/alerts";
import { useChartUi } from "@/lib/store/chart-ui";
import { useSettings } from "@/lib/store/settings";
import { cn } from "@/lib/utils";
import { AlertEngine } from "./alert-engine";
import { Button, Input, Modal } from "../ui/primitives";
import { Toaster } from "../ui/toast";
import { CoinIcon, Pct } from "../ui/viz";

const NAV = [
  { href: "/", key: "nav.dashboard", icon: LayoutDashboard },
  { href: "/chart", key: "nav.chart", icon: CandlestickChart },
  { href: "/signals", key: "nav.signals", icon: Zap },
  { href: "/screener", key: "nav.screener", icon: Radar },
  { href: "/backtest", key: "nav.backtest", icon: FlaskConical },
  { href: "/portfolio", key: "nav.portfolio", icon: BriefcaseBusiness },
  { href: "/alerts", key: "nav.alerts", icon: Bell },
  { href: "/settings", key: "nav.settings", icon: Settings },
] as const;

const MOBILE_NAV = ["/", "/chart", "/signals", "/portfolio", "/alerts"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useT();
  const path = usePathname();
  const [searchOpen, setSearchOpen] = useState(false);
  const accepted = useSettings((s) => s.disclaimerAccepted);
  const set = useSettings((s) => s.set);
  const lang = useSettings((s) => s.lang);
  const unread = useAlerts((s) => s.history.filter((h) => !h.read).length);
  const status = useStreamStatus();
  const isChart = path?.startsWith("/chart");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const active = (href: string) => (href === "/" ? path === "/" : path?.startsWith(href));

  return (
    <div className="flex h-[100dvh] overflow-hidden">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-line bg-panel lg:flex">
        <Link href="/" className="flex items-center gap-2.5 px-4 py-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" className="h-8 w-8" />
          <div>
            <div className="text-sm font-bold tracking-tight">CryptoVision Pro</div>
            <div className="text-[10px] text-muted">{t("app.tagline")}</div>
          </div>
        </Link>
        <nav className="flex-1 space-y-0.5 px-2" aria-label="Main">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors", active(n.href) ? "bg-accent-soft text-accent" : "text-muted hover:bg-panel-2 hover:text-fg")}
            >
              <n.icon size={17} />
              {t(n.key)}
              {n.href === "/alerts" && unread > 0 && <span className="ml-auto rounded-full bg-bear px-1.5 text-[10px] font-bold text-white">{unread}</span>}
            </Link>
          ))}
        </nav>
        <div className="space-y-2 border-t border-line p-3">
          <div className="flex items-start gap-2 rounded-lg bg-warn-soft p-2 text-[11px] leading-snug text-warn">
            <ShieldAlert size={14} className="mt-px shrink-0" />
            {t("disclaimer.short")}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel px-3">
          <Link href="/" className="lg:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.svg" alt="CryptoVision Pro" className="h-7 w-7" />
          </Link>
          <button onClick={() => setSearchOpen(true)} className="flex h-8 w-full max-w-xs items-center gap-2 rounded-md border border-line bg-panel-2 px-2.5 text-sm text-faint hover:border-line-strong">
            <Search size={15} />
            <span className="flex-1 text-left">{t("nav.search")}</span>
            <kbd className="hidden rounded border border-line px-1 text-[10px] sm:inline">Ctrl K</kbd>
          </button>
          <TickerTape />
          <div className="ml-auto flex items-center gap-1">
            <span className={cn("hidden items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium sm:flex", status === "live" ? "text-bull" : status === "reconnecting" ? "text-warn" : "text-faint")} title="Binance WebSocket">
              {status === "live" ? <Wifi size={13} /> : status === "idle" ? <Activity size={13} /> : <WifiOff size={13} />}
              {status === "live" ? t("common.live") : status === "reconnecting" ? t("common.reconnecting") : status === "connecting" ? "…" : t("common.offline")}
            </span>
            <Link href="/alerts" className="relative rounded-md p-2 text-muted hover:bg-panel-2 hover:text-fg" aria-label={t("nav.alerts")}>
              <Bell size={17} />
              {unread > 0 && <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-bear" />}
            </Link>
            <button className="rounded-md px-2 py-1 text-xs font-bold text-muted hover:bg-panel-2 hover:text-fg" onClick={() => set({ lang: lang === "sq" ? "en" : "sq" })} aria-label={t("settings.language")}>
              {lang === "sq" ? "SQ" : "EN"}
            </button>
          </div>
        </header>

        <main className={cn("min-h-0 flex-1", isChart ? "overflow-hidden" : "overflow-y-auto pb-20 lg:pb-0")}>{children}</main>

        <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-panel/95 backdrop-blur lg:hidden" aria-label="Mobile">
          {NAV.filter((n) => MOBILE_NAV.includes(n.href)).map((n) => (
            <Link key={n.href} href={n.href} className={cn("flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium", active(n.href) ? "text-accent" : "text-muted")}>
              <n.icon size={19} />
              {t(n.key)}
            </Link>
          ))}
        </nav>
      </div>

      <SymbolSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
      <Modal open={!accepted} onClose={() => {}} title={t("disclaimer.title")}>
        <div className="space-y-4">
          <div className="flex gap-3 rounded-lg bg-warn-soft p-3 text-warn">
            <Gauge size={20} className="shrink-0" />
            <p className="text-sm font-medium">{t("disclaimer.short")}</p>
          </div>
          <p className="text-sm leading-relaxed text-muted">{t("disclaimer.long")}</p>
          <Button variant="primary" size="md" className="w-full" onClick={() => set({ disclaimerAccepted: true })}>
            {t("disclaimer.accept")}
          </Button>
        </div>
      </Modal>
      <AlertEngine />
      <Toaster />
    </div>
  );
}

function TickerTape() {
  const { data } = useTickers();
  const watch = useSettings((s) => s.watchlist);
  const items = useMemo(() => (data ? watch.map((w) => data.find((d) => d.symbol === w)).filter((x): x is NonNullable<typeof x> => !!x).slice(0, 6) : []), [data, watch]);
  return (
    <div className="hidden min-w-0 flex-1 items-center gap-4 overflow-hidden px-2 xl:flex">
      {items.map((x) => (
        <Link key={x.symbol} href={`/chart?symbol=${x.symbol}`} className="flex shrink-0 items-center gap-1.5 text-xs hover:opacity-80">
          <span className="font-semibold">{x.symbol.replace("USDT", "")}</span>
          <span className="num">{formatPrice(x.lastPrice)}</span>
          <Pct value={x.priceChangePercent} className="text-[11px]" />
        </Link>
      ))}
    </div>
  );
}

function SymbolSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const path = usePathname();
  const { data } = useTickers();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const activePanel = useChartUi((s) => s.activePanel);
  const setPanel = useChartUi((s) => s.setPanel);
  const results = useMemo(() => {
    const list = [...(data ?? [])].sort((a, b) => b.quoteVolume - a.quoteVolume);
    const query = q.trim().toUpperCase();
    return (query ? list.filter((x) => x.symbol.includes(query)).sort((a, b) => Number(b.symbol.startsWith(query)) - Number(a.symbol.startsWith(query))) : list).slice(0, 40);
  }, [data, q]);

  useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
    }
  }, [open]);

  const pick = (symbol: string) => {
    onClose();
    if (path?.startsWith("/chart")) setPanel(activePanel, { symbol });
    router.push(`/chart?symbol=${symbol}`);
  };

  return (
    <Modal open={open} onClose={onClose} title={t("nav.search")}>
      <Input
        autoFocus
        value={q}
        placeholder="BTC, ETH, SOL…"
        onChange={(e) => {
          setQ(e.target.value);
          setIdx(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setIdx((i) => Math.min(results.length - 1, i + 1));
          if (e.key === "ArrowUp") setIdx((i) => Math.max(0, i - 1));
          if (e.key === "Enter" && results[idx]) pick(results[idx]!.symbol);
        }}
      />
      <ul className="mt-3 max-h-[50vh] overflow-y-auto">
        {results.map((r, i) => (
          <li key={r.symbol}>
            <button onClick={() => pick(r.symbol)} onMouseEnter={() => setIdx(i)} className={cn("flex w-full items-center gap-3 rounded-md px-2 py-2 text-left", i === idx && "bg-panel-2")}>
              <CoinIcon symbol={r.symbol} size={26} />
              <span className="flex-1">
                <span className="text-sm font-semibold">{r.symbol.replace("USDT", "")}</span>
                <span className="text-xs text-faint">/USDT</span>
              </span>
              <span className="num text-sm">{formatPrice(r.lastPrice)}</span>
              <Pct value={r.priceChangePercent} className="w-16 text-right text-xs" />
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
