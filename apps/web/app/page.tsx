"use client";

import type { Ticker } from "@cv/core";
import { baseAsset, formatCompact, formatPrice } from "@cv/core";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Flame, Loader2, RefreshCw, Snowflake, Star, Zap } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo } from "react";
import { Badge, Button, Card, CardHeader, Empty, Skeleton } from "@/components/ui/primitives";
import { ActionBadge, CoinIcon, Gauge, Pct, ScoreBar, Sparkline } from "@/components/ui/viz";
import { universe } from "@cv/exchange";
import { useTickers } from "@/lib/data/hooks";
import { getFearGreed, getGlobalMarket, sectorOf } from "@cv/exchange";
import { useT } from "@/lib/i18n";
import { useScan } from "@/lib/store/scan";
import { useSettings } from "@/lib/store/settings";
import { useScanner } from "@/lib/use-scanner";
import { useSignalRows } from "@/lib/use-signal-rows";
import { useAuth } from "@/lib/store/auth";
import { cn, timeAgo } from "@/lib/utils";

export default function Dashboard() {
  const t = useT();
  const lang = useSettings((s) => s.lang);
  const defaultTf = useSettings((s) => s.defaultTf);
  const { data: tickers, isLoading } = useTickers();
  const fg = useQuery({ queryKey: ["fng"], queryFn: ({ signal }) => getFearGreed(30, signal), staleTime: 30 * 60_000, retry: 1 });
  const global = useQuery({ queryKey: ["global"], queryFn: ({ signal }) => getGlobalMarket(signal), staleTime: 10 * 60_000, retry: 1 });
  const localTf = useScan((s) => s.timeframe);
  const { rows, scannedAt, timeframe, source } = useSignalRows(localTf);
  const { run, progress } = useScanner();
  const authReady = useAuth((s) => s.ready);

  // First visit: populate signals automatically (unless the server already has a scan).
  useEffect(() => {
    if (authReady && !scannedAt && !progress) void run(defaultTf, 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady]);

  const liquid = useMemo(() => (tickers ? universe(tickers, 100, 2_000_000) : []), [tickers]);
  const btc = tickers?.find((x) => x.symbol === "BTCUSDT");
  const eth = tickers?.find((x) => x.symbol === "ETHUSDT");
  const adv = liquid.filter((x) => x.priceChangePercent > 0).length;
  const fgNow = fg.data?.[fg.data.length - 1];

  const top = useMemo(
    () =>
      [...rows]
        .filter((r) => r.signal.action !== "HOLD")
        .sort((a, b) => Number(b.signal.status === "ACTIVE") - Number(a.signal.status === "ACTIVE") || Math.abs(b.signal.score - 50) * b.signal.confidence - Math.abs(a.signal.score - 50) * a.signal.confidence)
        .slice(0, 8),
    [rows],
  );

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-4 lg:p-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <PriceCard ticker={btc} />
        <PriceCard ticker={eth} />
        <Card className="p-4">
          <div className="text-[11px] font-medium tracking-wide text-muted uppercase">{t("dash.mcap")}</div>
          {global.data ? (
            <>
              <div className="num mt-1 text-lg font-semibold">${formatCompact(global.data.totalMarketCapUsd)}</div>
              <div className="flex items-center gap-2 text-xs">
                <Pct value={global.data.marketCapChange24h} />
                <span className="text-muted">
                  {t("dash.dominance")} <b className="num text-fg">{global.data.btcDominance.toFixed(1)}%</b>
                </span>
              </div>
            </>
          ) : global.isError ? (
            <div className="mt-1 text-xs text-faint">CoinGecko —</div>
          ) : (
            <Skeleton className="mt-2 h-8" />
          )}
        </Card>
        <Card className="p-4">
          <div className="text-[11px] font-medium tracking-wide text-muted uppercase">{t("dash.breadth")}</div>
          {liquid.length ? (
            <>
              <div className="num mt-1 text-lg font-semibold">
                <span className="text-bull">{adv}</span> / <span className="text-bear">{liquid.length - adv}</span>
              </div>
              <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-bear">
                <div className="bg-bull" style={{ width: `${(adv / liquid.length) * 100}%` }} />
              </div>
              <div className="mt-1 text-[11px] text-muted">
                {t("dash.advancers")} / {t("dash.decliners")} · top {liquid.length}
              </div>
            </>
          ) : (
            <Skeleton className="mt-2 h-8" />
          )}
        </Card>
        <Card className="col-span-2 flex items-center justify-around gap-2 p-3 lg:col-span-1">
          {fgNow ? (
            <>
              <Gauge value={fgNow.value} size={104} label={t("dash.fearGreed")} sub={fgNow.classification} />
              <Sparkline values={(fg.data ?? []).map((x) => x.value)} width={70} height={40} className="lg:hidden xl:block" />
            </>
          ) : (
            <Skeleton className="h-20 w-full" />
          )}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <Zap size={15} className="text-accent" /> {t("dash.topSignals")}
              </span>
            }
            subtitle={scannedAt ? `${timeframe} · ${timeAgo(scannedAt, lang)} · ${t(`signals.source.${source}`)}` : undefined}
            right={
              <div className="flex gap-2">
                <Button size="xs" onClick={() => run(defaultTf)} disabled={!!progress}>
                  {progress ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  {progress ? `${progress.done}/${progress.total || "…"}` : t("signals.scan")}
                </Button>
                <Link href="/signals">
                  <Button size="xs" variant="ghost">
                    {t("dash.viewAll")} <ArrowRight size={12} />
                  </Button>
                </Link>
              </div>
            }
          />
          {top.length === 0 ? (
            progress ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 5 }, (_, i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
              </div>
            ) : (
              <Empty icon={<Zap size={26} />} title={t("signals.notScanned")} />
            )
          ) : (
            <div className="divide-y divide-line">
              {top.map((r) => (
                <Link key={r.symbol} href={`/chart?symbol=${r.symbol}&tf=${r.signal.timeframe}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-panel-2/60">
                  <CoinIcon symbol={r.symbol} size={30} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold">{baseAsset(r.symbol)}</span>
                      {r.signal.status === "ACTIVE" && <Badge tone="accent">{t("status.ACTIVE")}</Badge>}
                    </div>
                    <div className="truncate text-xs text-muted">{r.signal.strategyId ? t(`strategy.${r.signal.strategyId}`) : t(`regime.${r.signal.regime}`)}</div>
                  </div>
                  <Sparkline values={r.snapshot.spark} width={80} height={26} className="hidden sm:block" />
                  <div className="hidden w-28 text-right text-xs md:block">
                    {r.signal.plan && (
                      <>
                        <div className="num">
                          {formatPrice(r.signal.plan.entry)} → <span className="text-bull">{formatPrice(r.signal.plan.takeProfits[1]?.price ?? NaN)}</span>
                        </div>
                        <div className="num text-bear">SL {formatPrice(r.signal.plan.stopLoss)}</div>
                      </>
                    )}
                  </div>
                  <div className="w-28 space-y-1 text-right">
                    <ActionBadge action={r.signal.action} />
                    <ScoreBar score={r.signal.score} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Movers title={t("dash.gainers")} icon={<Flame size={15} className="text-bull" />} list={[...liquid].sort((a, b) => b.priceChangePercent - a.priceChangePercent).slice(0, 6)} loading={isLoading} />
          <Movers title={t("dash.losers")} icon={<Snowflake size={15} className="text-bear" />} list={[...liquid].sort((a, b) => a.priceChangePercent - b.priceChangePercent).slice(0, 6)} loading={isLoading} />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title={t("dash.heatmap")} subtitle="Top 48 · 24h" />
          <Heatmap list={liquid.slice(0, 48)} />
        </Card>
        <div className="space-y-4">
          <Watchlist tickers={tickers} />
          <Sectors list={liquid} />
        </div>
      </div>
      <p className="pb-4 text-center text-[11px] text-faint">{t("disclaimer.long")}</p>
    </div>
  );
}

function PriceCard({ ticker }: { ticker?: Ticker }) {
  if (!ticker)
    return (
      <Card className="p-4">
        <Skeleton className="h-12" />
      </Card>
    );
  return (
    <Link href={`/chart?symbol=${ticker.symbol}`}>
      <Card className="p-4 transition-colors hover:border-line-strong">
        <div className="flex items-center gap-2">
          <CoinIcon symbol={ticker.symbol} size={20} />
          <span className="text-[11px] font-medium tracking-wide text-muted uppercase">{baseAsset(ticker.symbol)}</span>
        </div>
        <div className="num mt-1 text-lg font-semibold">{formatPrice(ticker.lastPrice)}</div>
        <div className="flex items-center gap-2 text-xs">
          <Pct value={ticker.priceChangePercent} />
          <span className="num text-faint">V ${formatCompact(ticker.quoteVolume)}</span>
        </div>
      </Card>
    </Link>
  );
}

function Movers({ title, icon, list, loading }: { title: string; icon: React.ReactNode; list: Ticker[]; loading: boolean }) {
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2">{icon} {title}</span>} />
      <div className="divide-y divide-line/60">
        {loading
          ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="m-2 h-7" />)
          : list.map((x) => (
              <Link key={x.symbol} href={`/chart?symbol=${x.symbol}`} className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-panel-2/60">
                <CoinIcon symbol={x.symbol} size={22} />
                <span className="flex-1 font-medium">{baseAsset(x.symbol)}</span>
                <span className="num text-muted">{formatPrice(x.lastPrice)}</span>
                <Pct value={x.priceChangePercent} className="w-16 text-right font-semibold" />
              </Link>
            ))}
      </div>
    </Card>
  );
}

function Heatmap({ list }: { list: Ticker[] }) {
  if (!list.length) return <Skeleton className="m-4 h-64" />;
  return (
    <div className="flex flex-wrap gap-1 p-3">
      {list.map((x) => {
        const c = Math.max(-8, Math.min(8, x.priceChangePercent));
        const alpha = 0.18 + (Math.abs(c) / 8) * 0.7;
        const grow = Math.sqrt(x.quoteVolume / 1e6);
        return (
          <Link
            key={x.symbol}
            href={`/chart?symbol=${x.symbol}`}
            className="flex min-h-14 min-w-[72px] flex-col items-center justify-center rounded-md px-1 py-2 text-center transition-transform hover:scale-[1.03]"
            style={{ flexGrow: grow, flexBasis: `${Math.max(72, grow * 6)}px`, background: `color-mix(in oklab, ${c >= 0 ? "var(--bull)" : "var(--bear)"} ${Math.round(alpha * 100)}%, var(--panel-2))` }}
            title={`${x.symbol} ${x.priceChangePercent.toFixed(2)}%`}
          >
            <span className="text-xs font-bold text-white drop-shadow">{baseAsset(x.symbol)}</span>
            <span className="num text-[11px] font-semibold text-white/90">
              {x.priceChangePercent >= 0 ? "+" : ""}
              {x.priceChangePercent.toFixed(2)}%
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function Watchlist({ tickers }: { tickers?: Ticker[] }) {
  const t = useT();
  const watch = useSettings((s) => s.watchlist);
  const toggle = useSettings((s) => s.toggleWatch);
  const rows = useSignalRows(useScan((s) => s.timeframe)).rows;
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><Star size={15} className="text-warn" /> {t("dash.watchlist")}</span>} />
      {watch.length === 0 ? (
        <Empty title={t("dash.emptyWatchlist")} />
      ) : (
        <div className="divide-y divide-line/60">
          {watch.map((sym) => {
            const x = tickers?.find((k) => k.symbol === sym);
            const sig = rows.find((r) => r.symbol === sym)?.signal;
            return (
              <div key={sym} className="flex items-center gap-2 px-4 py-2 text-sm">
                <button onClick={() => toggle(sym)} className="text-warn" aria-label="unwatch">
                  <Star size={13} fill="currentColor" />
                </button>
                <Link href={`/chart?symbol=${sym}`} className="flex-1 font-medium hover:text-accent">
                  {baseAsset(sym)}
                </Link>
                {sig && <ActionBadge action={sig.action} />}
                <span className="num w-24 text-right">{x ? formatPrice(x.lastPrice) : "—"}</span>
                <Pct value={x?.priceChangePercent ?? NaN} className="w-16 text-right" />
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function Sectors({ list }: { list: Ticker[] }) {
  const t = useT();
  const sectors = useMemo(() => {
    const m = new Map<string, { sum: number; n: number; vol: number }>();
    for (const x of list) {
      const s = sectorOf(baseAsset(x.symbol));
      const cur = m.get(s) ?? { sum: 0, n: 0, vol: 0 };
      cur.sum += x.priceChangePercent * x.quoteVolume;
      cur.vol += x.quoteVolume;
      cur.n++;
      m.set(s, cur);
    }
    return [...m.entries()].map(([name, v]) => ({ name, change: v.vol ? v.sum / v.vol : 0, n: v.n })).sort((a, b) => b.change - a.change);
  }, [list]);
  const max = Math.max(1, ...sectors.map((s) => Math.abs(s.change)));
  return (
    <Card>
      <CardHeader title={t("dash.sectors")} subtitle="24h, volume-weighted" />
      <div className="space-y-1.5 p-4">
        {sectors.map((s) => (
          <div key={s.name} className="flex items-center gap-2 text-xs">
            <span className="w-28 truncate">{s.name}</span>
            <div className="relative h-2 flex-1 rounded-full bg-line">
              <div className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
              <div className={cn("absolute inset-y-0 rounded-full", s.change >= 0 ? "bg-bull" : "bg-bear")} style={{ left: s.change >= 0 ? "50%" : `${50 - (Math.abs(s.change) / max) * 50}%`, width: `${(Math.abs(s.change) / max) * 50}%` }} />
            </div>
            <Pct value={s.change} className="w-14 text-right" />
          </div>
        ))}
      </div>
    </Card>
  );
}
