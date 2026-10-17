"use client";

import { formatPrice } from "@cv/core";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  BriefcaseBusiness,
  CandlestickChart,
  ChevronsLeft,
  ChevronsRight,
  Cloud,
  CloudOff,
  FlaskConical,
  LayoutDashboard,
  Loader2,
  LogIn,
  LogOut,
  Moon,
  Radar,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sun,
  UserRound,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStreamStatus, useTickers } from "@/lib/data/hooks";
import { useT } from "@/lib/i18n";
import { useAlerts } from "@/lib/store/alerts";
import { useAuth } from "@/lib/store/auth";
import { useChartUi } from "@/lib/store/chart-ui";
import { useSettings } from "@/lib/store/settings";
import { cn } from "@/lib/utils";
import { AlertEngine } from "./alert-engine";
import { EventsBridge, SyncManager } from "./sync-manager";
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
/** Full-bleed pages render without the app chrome. */
const BARE = ["/welcome", "/login", "/register"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useT();
  const path = usePathname() ?? "/";
  const [searchOpen, setSearchOpen] = useState(false);
  const accepted = useSettings((s) => s.disclaimerAccepted);
  const set = useSettings((s) => s.set);
  const lang = useSettings((s) => s.lang);
  const theme = useSettings((s) => s.theme);
  const [collapsed, setCollapsed] = useState(false);
  const unread = useAlerts((s) => s.history.filter((h) => !h.read).length);
  const status = useStreamStatus();
  const init = useAuth((s) => s.init);
  const qc = useQueryClient();
  const isChart = path.startsWith("/chart");
  const bare = BARE.some((b) => path.startsWith(b));

  useEffect(() => {
    void init();
    try {
      setCollapsed(localStorage.getItem("cv.sidebar") === "1");
    } catch {
      /* private mode */
    }
  }, [init]);

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

  const onScan = useCallback((tf: string) => void qc.invalidateQueries({ queryKey: ["server-signals", tf] }), [qc]);
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("cv.sidebar", c ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !c;
    });
  };

  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  if (bare)
    return (
      <div className="bg-app min-h-[100dvh]">
        {children}
        <Toaster />
        <SyncManager />
      </div>
    );

  return (
    <div className="bg-app flex h-[100dvh] overflow-hidden">
      <aside className={cn("glass hidden shrink-0 flex-col border-r border-line transition-[width] duration-200 lg:flex", collapsed ? "w-[72px]" : "w-60")}>
        <Link href="/" className={cn("flex items-center gap-3 px-4 py-5", collapsed && "justify-center px-0")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" className="h-9 w-9 drop-shadow-[0_6px_16px_rgba(123,140,255,0.45)]" />
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold tracking-tight">
                CryptoVision <span className="gradient-text">Pro</span>
              </div>
              <div className="truncate text-[10.5px] text-muted">{t("app.tagline")}</div>
            </div>
          )}
        </Link>
        <nav className="flex-1 space-y-1 px-3" aria-label="Main">
          {NAV.map((n) => {
            const on = active(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                title={collapsed ? t(n.key) : undefined}
                className={cn(
                  "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                  collapsed && "justify-center px-0",
                  on ? "bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] text-fg" : "text-muted hover:bg-panel-2 hover:text-fg",
                )}
              >
                {on && <span className="brand-gradient absolute top-2 bottom-2 left-0 w-[3px] rounded-full" />}
                <n.icon size={18} className={cn(on && "text-accent")} />
                {!collapsed && <span className="truncate">{t(n.key)}</span>}
                {n.href === "/alerts" && unread > 0 && (
                  <span className={cn("rounded-full bg-bear px-1.5 text-[10px] font-bold text-white", collapsed ? "absolute top-1 right-2" : "ml-auto")}>{unread}</span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="space-y-2 p-3">
          {!collapsed && (
            <div className="flex items-start gap-2 rounded-xl border border-warn/20 bg-warn-soft p-2.5 text-[11px] leading-snug text-warn">
              <ShieldAlert size={14} className="mt-px shrink-0" />
              {t("disclaimer.short")}
            </div>
          )}
          <button onClick={toggleCollapsed} className="flex w-full items-center justify-center gap-2 rounded-xl py-2 text-xs text-faint hover:bg-panel-2 hover:text-fg" aria-label="Toggle sidebar">
            {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass z-30 flex h-14 shrink-0 items-center gap-2 border-b border-line px-3 lg:px-4">
          <Link href="/" className="lg:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.svg" alt="CryptoVision Pro" className="h-8 w-8" />
          </Link>
          <button onClick={() => setSearchOpen(true)} className="flex h-9 w-full max-w-xs items-center gap-2 rounded-xl border border-line bg-panel-2 px-3 text-sm text-faint transition-colors hover:border-line-strong hover:text-muted">
            <Search size={15} />
            <span className="flex-1 truncate text-left">{t("nav.search")}</span>
            <kbd className="hidden rounded-md border border-line px-1.5 text-[10px] sm:inline">Ctrl K</kbd>
          </button>
          <TickerTape />
          <div className="ml-auto flex items-center gap-1">
            <span
              className={cn("hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium sm:flex", status === "live" ? "text-bull" : status === "reconnecting" ? "text-warn" : "text-faint")}
              title="Binance WebSocket"
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", status === "live" ? "live-dot bg-bull" : status === "reconnecting" ? "bg-warn" : "bg-faint")} />
              {status === "live" ? t("common.live") : status === "reconnecting" ? t("common.reconnecting") : status === "connecting" ? "…" : t("common.offline")}
            </span>
            <SyncBadge />
            <button className="rounded-lg p-2 text-muted hover:bg-panel-2 hover:text-fg" onClick={() => set({ theme: theme === "dark" ? "light" : "dark" })} aria-label={t("settings.theme")}>
              {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <Link href="/alerts" className="relative rounded-lg p-2 text-muted hover:bg-panel-2 hover:text-fg" aria-label={t("nav.alerts")}>
              <Bell size={17} />
              {unread > 0 && <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-bear" />}
            </Link>
            <button className="rounded-lg px-2 py-1 text-xs font-bold text-muted hover:bg-panel-2 hover:text-fg" onClick={() => set({ lang: lang === "sq" ? "en" : "sq" })} aria-label={t("settings.language")}>
              {lang === "sq" ? "SQ" : "EN"}
            </button>
            <UserMenu />
          </div>
        </header>

        <main className={cn("min-h-0 flex-1", isChart ? "overflow-hidden" : "overflow-y-auto pb-24 lg:pb-0")}>{children}</main>

        <nav className="glass fixed inset-x-0 bottom-0 z-40 flex border-t border-line pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Mobile">
          {NAV.filter((n) => MOBILE_NAV.includes(n.href)).map((n) => (
            <Link key={n.href} href={n.href} className={cn("flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium", active(n.href) ? "text-accent" : "text-muted")}>
              <n.icon size={19} />
              {t(n.key)}
            </Link>
          ))}
        </nav>
      </div>

      <SymbolSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
      <Modal open={!accepted} onClose={() => {}} title={t("disclaimer.title")}>
        <div className="space-y-4">
          <div className="flex gap-3 rounded-2xl border border-warn/25 bg-warn-soft p-3.5 text-warn">
            <ShieldAlert size={20} className="shrink-0" />
            <p className="text-sm font-medium">{t("disclaimer.short")}</p>
          </div>
          <p className="text-sm leading-relaxed text-muted">{t("disclaimer.long")}</p>
          <Button variant="primary" size="md" className="w-full" onClick={() => set({ disclaimerAccepted: true })}>
            {t("disclaimer.accept")}
          </Button>
        </div>
      </Modal>
      <AlertEngine />
      <SyncManager />
      <EventsBridge onScan={onScan} />
      <Toaster />
    </div>
  );
}

function SyncBadge() {
  const t = useT();
  const user = useAuth((s) => s.user);
  const sync = useAuth((s) => s.syncStatus);
  if (!user) return null;
  return (
    <span className={cn("hidden items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium md:flex", sync === "error" ? "text-bear" : "text-muted")} title={t(`sync.${sync}`)}>
      {sync === "syncing" ? <Loader2 size={13} className="animate-spin" /> : sync === "error" ? <CloudOff size={13} /> : <Cloud size={13} />}
      {t(`sync.${sync}`)}
    </span>
  );
}

function UserMenu() {
  const t = useT();
  const router = useRouter();
  const { user, health, ready, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, []);
  if (!ready || !health?.db) return null;
  if (!user)
    return (
      <Link href="/login" className="ml-1">
        <Button size="sm" variant="primary">
          <LogIn size={14} /> <span className="hidden sm:inline">{t("auth.login")}</span>
        </Button>
      </Link>
    );
  const initials = (user.name ?? user.email).slice(0, 2).toUpperCase();
  return (
    <div ref={ref} className="relative ml-1">
      <button onClick={() => setOpen(!open)} className="brand-gradient flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold text-[#060911]" aria-label={t("nav.account")}>
        {initials}
      </button>
      {open && (
        <div className="animate-fade-up absolute right-0 mt-2 w-64 rounded-2xl border border-line bg-panel-solid p-1.5 shadow-2xl">
          <div className="px-3 py-2">
            <div className="truncate text-sm font-semibold">{user.name ?? user.email}</div>
            <div className="truncate text-xs text-muted">{user.email}</div>
            <div className={cn("mt-1.5 inline-flex items-center gap-1 text-[11px]", user.totpEnabled ? "text-bull" : "text-warn")}>
              {user.totpEnabled ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />} {user.totpEnabled ? t("account.2faOn") : t("account.2faOff")}
            </div>
          </div>
          <div className="my-1 h-px bg-line" />
          <Link href="/account" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-panel-2">
            <UserRound size={15} /> {t("nav.account")}
          </Link>
          <button
            onClick={async () => {
              setOpen(false);
              await logout();
              router.push("/");
            }}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-bear hover:bg-bear-soft"
          >
            <LogOut size={15} /> {t("auth.logout")}
          </button>
        </div>
      )}
    </div>
  );
}

function TickerTape() {
  const { data } = useTickers();
  const watch = useSettings((s) => s.watchlist);
  const items = useMemo(() => (data ? watch.map((w) => data.find((d) => d.symbol === w)).filter((x): x is NonNullable<typeof x> => !!x).slice(0, 8) : []), [data, watch]);
  if (!items.length) return <div className="hidden flex-1 xl:block" />;
  const row = items.map((x) => (
    <Link key={x.symbol} href={`/chart?symbol=${x.symbol}`} className="flex shrink-0 items-center gap-1.5 px-3 text-xs hover:opacity-80">
      <span className="font-semibold">{x.symbol.replace("USDT", "")}</span>
      <span className="num">{formatPrice(x.lastPrice)}</span>
      <Pct value={x.priceChangePercent} className="text-[11px]" />
    </Link>
  ));
  return (
    <div className="hidden min-w-0 flex-1 overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)] xl:block">
      <div className="marquee flex w-max">
        {row}
        {row.map((r) => ({ ...r, key: `${r.key}-dup` }))}
      </div>
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
            <button onClick={() => pick(r.symbol)} onMouseEnter={() => setIdx(i)} className={cn("flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left", i === idx && "bg-panel-2")}>
              <CoinIcon symbol={r.symbol} size={28} />
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
