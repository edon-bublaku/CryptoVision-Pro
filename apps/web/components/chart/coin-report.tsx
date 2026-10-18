"use client";

import type { Candle, Timeframe } from "@cv/core";
import { formatCompact, formatPrice, lastFinite } from "@cv/core";
import { doubleTopsBottoms, recentCandlePatterns, rsi } from "@cv/indicators";
import { buildContext, trendScore } from "@cv/signals";
import { useQueries } from "@tanstack/react-query";
import { Bell, BriefcaseBusiness } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FullAnalysis } from "@cv/engine";
import { closedOnly, getKlines } from "@cv/exchange";
import { binanceStream, type AggTrade, type DepthEvent } from "@cv/exchange";
import { useT } from "@/lib/i18n";
import { buildNarrative } from "@/lib/narrative";
import { useAlerts } from "@/lib/store/alerts";
import { usePortfolio } from "@/lib/store/portfolio";
import { useSettings } from "@/lib/store/settings";
import { positionSize } from "@cv/risk";
import { cn } from "@/lib/utils";
import { BacktestBadge, FactorList, HtfWarning, PlanTable } from "../signals/signal-parts";
import { Badge, Button, Segmented, Skeleton } from "../ui/primitives";
import { toast } from "../ui/toast";
import { ActionBadge, Gauge } from "../ui/viz";
import { AiExplain, DerivativesPanel } from "./report-extras";
import { HistoricalEvidence, InvestmentPlanView, RatingSummary } from "../rating/rating-view";
import { useRating } from "@/lib/data/rating";

const MTF: Timeframe[] = ["15m", "1h", "4h", "1d", "1w"];

export function CoinReport({ symbol, timeframe, data }: { symbol: string; timeframe: Timeframe; data: { analysis: FullAnalysis | null; candles: Candle[] } }) {
  const t = useT();
  const [tab, setTab] = useState<"report" | "book" | "trades">("report");
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-line p-2">
        <Segmented
          value={tab}
          onChange={setTab}
          className="w-full [&>button]:flex-1"
          options={[
            { value: "report", label: t("chart.report") },
            { value: "book", label: t("chart.orderbook") },
            { value: "trades", label: t("chart.trades") },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "report" && <Report symbol={symbol} timeframe={timeframe} data={data} />}
        {tab === "book" && <OrderBook symbol={symbol} />}
        {tab === "trades" && <Trades symbol={symbol} />}
      </div>
    </div>
  );
}

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="border-b border-line px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-[11px] font-semibold tracking-wide text-muted uppercase">{title}</h4>
        {right}
      </div>
      {children}
    </section>
  );
}

/** Investment view on daily data: CV Rating, its evidence and the plan. Independent of the chart timeframe. */
function RatingSections({ symbol }: { symbol: string }) {
  const t = useT();
  const { rating, plan, isLoading } = useRating(symbol);
  if (isLoading)
    return (
      <div className="space-y-2 border-b border-line p-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-24" />
      </div>
    );
  if (!rating || !plan) return <p className="border-b border-line p-3 text-xs text-faint">{t("rating.notEnough")}</p>;
  return (
    <>
      <Section title={t("rating.title")} right={<span className="text-[10px] text-faint">1D · {t("rating.metricsCount", { n: rating.pillars.reduce((s, p) => s + p.metrics.length, 0) })}</span>}>
        <RatingSummary rating={rating} />
        <div className="mt-3">
          <HistoricalEvidence verdict={rating.verdict} />
        </div>
      </Section>
      <Section title={t("plan.investTitle")}>
        <InvestmentPlanView plan={plan} rating={rating} symbol={symbol} />
      </Section>
    </>
  );
}

function Report({ symbol, timeframe, data }: { symbol: string; timeframe: Timeframe; data: { analysis: FullAnalysis | null; candles: Candle[] } }) {
  const t = useT();
  const lang = useSettings((s) => s.lang);
  const settings = useSettings();
  const addPos = usePortfolio((s) => s.add);
  const addAlert = useAlerts((s) => s.add);
  const fa = data.analysis;

  if (!fa)
    return (
      <div className="space-y-3 p-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-40" />
        <Skeleton className="h-32" />
      </div>
    );
  const { signal } = fa.analysis;
  const narrative = buildNarrative(signal, fa.analysis.levels, lang);
  const sid = signal.strategyId;
  const patterns = recentCandlePatterns(data.candles, 3).filter((p) => p.direction !== "neutral");
  const charts = doubleTopsBottoms(data.candles);
  const ms = fa.analysis.context.structure;

  const addToPortfolio = () => {
    const p = signal.plan;
    if (!p) return;
    const size = positionSize({ equity: settings.equity, riskPct: settings.riskPct, entry: p.entry, stopLoss: p.stopLoss, maxLeverage: settings.maxLeverage, feeRate: settings.feePct / 100 });
    addPos({ symbol, side: p.side, entry: p.entry, quantity: size?.quantity ?? 0, stopLoss: p.stopLoss, takeProfit: p.takeProfits[1]?.price, leverage: size?.leverage ?? 1, strategyId: signal.strategyId, notes: `${timeframe} · ${sid ? t(`strategy.${sid}`) : t("strategy.none")} · score ${signal.score}` });
    toast({ title: t("signals.addPortfolio"), body: symbol, tone: "success" });
  };

  return (
    <div>
      <RatingSections symbol={symbol} />
      <Section title={t("chart.verdict")}>
        <div className="flex items-center gap-3">
          <Gauge value={signal.score} size={110} />
          <div className="min-w-0 flex-1 space-y-1.5">
            <ActionBadge action={signal.action} size="lg" />
            <div className="flex flex-wrap gap-1">
              <Badge tone={signal.status === "ACTIVE" ? "accent" : "neutral"}>{t(`status.${signal.status}`)}</Badge>
              <Badge>{t(`regime.${signal.regime}`)}</Badge>
            </div>
            <div className="text-xs text-muted">
              {t("common.confidence")}: <span className="num font-semibold text-fg">{Math.round(signal.confidence * 100)}%</span>
            </div>
            <div className="text-xs text-muted">
              {t("common.strategy")}: <span className="font-medium text-fg">{sid ? t(`strategy.${sid}`) : t("strategy.none")}</span>
            </div>
          </div>
        </div>
        <div className="mt-2 space-y-1">
          <HtfWarning signal={signal} />
        </div>
      </Section>

      <Section title={t("plan.title")}>
        <PlanTable signal={signal} compact />
        {signal.plan && (
          <div className="mt-3 flex gap-2">
            <Button size="xs" variant="secondary" onClick={addToPortfolio}>
              <BriefcaseBusiness size={13} /> {t("signals.addPortfolio")}
            </Button>
            <Button
              size="xs"
              variant="secondary"
              onClick={() => {
                const p = signal.plan!;
                addAlert({ symbol, type: p.side === "LONG" ? "price_below" : "price_above", value: p.entryZone[p.side === "LONG" ? 1 : 0], once: true, note: `${t("plan.entryZone")} ${timeframe}` });
                toast({ title: t("alerts.new"), body: `${symbol} ${t("plan.entryZone")}`, tone: "success" });
              }}
            >
              <Bell size={13} /> {t("signals.createAlert")}
            </Button>
          </div>
        )}
      </Section>

      <Section title={t("chart.narrative")}>
        <div className="space-y-1.5 text-[13px] leading-relaxed text-fg/90">
          {narrative.summary.map((s, i) => (
            <p key={i}>{s}</p>
          ))}
        </div>
        {(narrative.bull || narrative.bear) && (
          <div className="mt-2 grid gap-1.5 text-xs">
            {narrative.bull && (
              <p className="rounded-md bg-bull-soft px-2 py-1.5 text-bull">
                <b>{t("chart.scenarioBull")}:</b> {narrative.bull}
              </p>
            )}
            {narrative.bear && (
              <p className="rounded-md bg-bear-soft px-2 py-1.5 text-bear">
                <b>{t("chart.scenarioBear")}:</b> {narrative.bear}
              </p>
            )}
          </div>
        )}
      </Section>

      <Section title={t("ai.title")}>
        <AiExplain symbol={symbol} timeframe={timeframe} signal={signal} levels={fa.analysis.levels} backtest={sid ? fa.backtest.byStrategy[sid] : null} />
      </Section>

      <Section title={t("deriv.title")}>
        <DerivativesPanel symbol={symbol} />
      </Section>

      <Section title={t("signals.backtestOnCoin")} right={sid ? <span className="text-[10px] text-faint">{t(`strategy.${sid}`)}</span> : undefined}>
        {sid ? <BacktestBadge stats={fa.backtest.byStrategy[sid]} passed={fa.gate[sid]} /> : <AllStrategies fa={fa} />}
      </Section>

      <Section title={t("chart.mtf")}>
        <MtfMatrix symbol={symbol} />
      </Section>

      <Section title={t("factors.title")}>
        <FactorList factors={signal.factors} limit={18} />
      </Section>

      <Section title={t("chart.levels")}>
        <ul className="space-y-1 text-xs">
          {fa.analysis.levels.map((l, i) => (
            <li key={i} className="flex items-center justify-between">
              <span className={cn("font-medium", l.kind === "support" ? "text-bull" : "text-bear")}>
                {l.kind === "support" ? "S" : "R"} · {l.touches}×
              </span>
              <span className="num">{formatPrice(l.price)}</span>
              <span className="num w-14 text-right text-faint">{(((l.price - signal.price) / signal.price) * 100).toFixed(2)}%</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={`${t("chart.structure")} · ${t("chart.patterns")}`}>
        <div className="space-y-1.5 text-xs">
          <div className="flex justify-between">
            <span className="text-muted">Trend</span>
            <span className={cn("font-semibold", ms.trend === "bullish" ? "text-bull" : ms.trend === "bearish" ? "text-bear" : "text-muted")}>{ms.trend}</span>
          </div>
          {ms.events.slice(-3).reverse().map((e, i) => (
            <div key={i} className="flex justify-between">
              <span className={e.direction === "bullish" ? "text-bull" : "text-bear"}>
                {e.type} {e.direction}
              </span>
              <span className="num text-muted">{formatPrice(e.price)}</span>
            </div>
          ))}
          {charts.map((c, i) => (
            <div key={`c${i}`} className="flex justify-between">
              <span className={c.direction === "bullish" ? "text-bull" : "text-bear"}>
                {t(`pattern.${c.id}`)} {c.confirmed ? "✓" : "…"}
              </span>
              <span className="num text-muted">→ {formatPrice(c.target)}</span>
            </div>
          ))}
          {patterns.map((p, i) => (
            <div key={`p${i}`} className="flex justify-between">
              <span className={p.direction === "bullish" ? "text-bull" : "text-bear"}>{t(`pattern.${p.id}`)}</span>
              <span className="num text-muted">{Math.round(p.reliability * 100)}%</span>
            </div>
          ))}
        </div>
      </Section>
      <p className="px-3 py-3 text-[11px] text-faint">{t("disclaimer.short")}</p>
    </div>
  );
}

function AllStrategies({ fa }: { fa: FullAnalysis }) {
  const t = useT();
  const entries = Object.entries(fa.backtest.byStrategy);
  if (!entries.length) return <p className="text-xs text-muted">{t("signals.noBacktest")}</p>;
  return (
    <ul className="space-y-1 text-xs">
      {entries.map(([id, s]) => (
        <li key={id} className="flex items-center justify-between gap-2">
          <span className="truncate">{t(`strategy.${id}`)}</span>
          <span className="num text-muted">
            {s.trades}× · {(s.winRate * 100).toFixed(0)}% · <span className={s.profitFactor >= 1 ? "text-bull" : "text-bear"}>PF {Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : "∞"}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function MtfMatrix({ symbol }: { symbol: string }) {
  const t = useT();
  const qs = useQueries({
    queries: MTF.map((tf) => ({
      queryKey: ["klines", symbol, tf, 300],
      queryFn: async ({ signal }: { signal: AbortSignal }) => closedOnly(await getKlines(symbol, tf, 300, undefined, signal)),
      staleTime: 60_000,
    })),
  });
  const rows = useMemo(
    () =>
      qs.map((q, i) => {
        const cs = q.data;
        if (!cs || cs.length < 60) return { tf: MTF[i]!, score: null as number | null, rsi: NaN };
        const ctx = buildContext(cs);
        return { tf: MTF[i]!, score: trendScore(ctx, cs.length - 1), rsi: lastFinite(rsi(cs.map((c) => c.close))) };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qs.map((q) => q.dataUpdatedAt).join(",")],
  );
  return (
    <div className="grid grid-cols-5 gap-1">
      {rows.map((r) => {
        const s = r.score;
        const tone = s === null ? "" : s > 0.2 ? "bg-bull-soft text-bull" : s < -0.2 ? "bg-bear-soft text-bear" : "bg-panel-2 text-muted";
        return (
          <div key={r.tf} className={cn("rounded-md px-1 py-1.5 text-center", tone || "bg-panel-2")}>
            <div className="text-[10px] font-semibold">{r.tf}</div>
            {s === null ? <Skeleton className="mx-auto mt-1 h-3 w-8" /> : <div className="num text-xs font-bold">{s > 0.2 ? "▲" : s < -0.2 ? "▼" : "■"} {Math.round(50 + s * 50)}</div>}
            <div className="num text-[10px] opacity-70">RSI {Number.isFinite(r.rsi) ? r.rsi.toFixed(0) : "—"}</div>
          </div>
        );
      })}
      <div className="col-span-5 mt-1 text-[10px] text-faint">{t("mtf.trend")}: EMA · SuperTrend · ADX · MACD · Structure · Ichimoku</div>
    </div>
  );
}

function OrderBook({ symbol }: { symbol: string }) {
  const [book, setBook] = useState<{ bids: [number, number][]; asks: [number, number][] } | null>(null);
  const last = useRef(0);
  useEffect(() => {
    setBook(null);
    return binanceStream.subscribe(`${symbol.toLowerCase()}@depth20@100ms`, (raw) => {
      const now = performance.now();
      if (now - last.current < 250) return;
      last.current = now;
      const d = raw as DepthEvent;
      setBook({ bids: d.bids.map(([p, q]) => [+p, +q]), asks: d.asks.map(([p, q]) => [+p, +q]) });
    });
  }, [symbol]);
  if (!book) return <div className="space-y-1 p-3">{Array.from({ length: 16 }, (_, i) => <Skeleton key={i} className="h-4" />)}</div>;
  const asks = book.asks.slice(0, 15).reverse();
  const bids = book.bids.slice(0, 15);
  const max = Math.max(...[...asks, ...bids].map(([p, q]) => p * q));
  const spread = (book.asks[0]?.[0] ?? 0) - (book.bids[0]?.[0] ?? 0);
  const bidTotal = book.bids.reduce((s, [p, q]) => s + p * q, 0);
  const askTotal = book.asks.reduce((s, [p, q]) => s + p * q, 0);
  const imbalance = bidTotal / (bidTotal + askTotal || 1);
  const row = (side: "bid" | "ask") => ([p, q]: [number, number], i: number) => (
    <div key={`${side}${i}`} className="relative flex justify-between px-3 py-[2px] text-[11px]">
      <div className={cn("absolute inset-y-0 right-0", side === "bid" ? "bg-bull-soft" : "bg-bear-soft")} style={{ width: `${((p * q) / max) * 100}%` }} />
      <span className={cn("num relative", side === "bid" ? "text-bull" : "text-bear")}>{formatPrice(p)}</span>
      <span className="num relative text-muted">{q.toFixed(4)}</span>
      <span className="num relative w-16 text-right text-faint">{formatCompact(p * q)}</span>
    </div>
  );
  return (
    <div className="py-2">
      {asks.map(row("ask"))}
      <div className="num my-1 flex justify-between border-y border-line px-3 py-1.5 text-xs">
        <span className="text-muted">Spread {formatPrice(spread)}</span>
        <span className={imbalance >= 0.5 ? "text-bull" : "text-bear"}>Bid {(imbalance * 100).toFixed(0)}%</span>
      </div>
      {bids.map(row("bid"))}
    </div>
  );
}

function Trades({ symbol }: { symbol: string }) {
  const [trades, setTrades] = useState<AggTrade[]>([]);
  const buf = useRef<AggTrade[]>([]);
  useEffect(() => {
    setTrades([]);
    buf.current = [];
    const unsub = binanceStream.subscribe(`${symbol.toLowerCase()}@aggTrade`, (raw) => {
      buf.current = [raw as AggTrade, ...buf.current].slice(0, 60);
    });
    const id = setInterval(() => setTrades(buf.current), 300);
    return () => {
      unsub();
      clearInterval(id);
    };
  }, [symbol]);
  const buyVol = trades.filter((x) => !x.m).reduce((s, x) => s + +x.q * +x.p, 0);
  const sellVol = trades.filter((x) => x.m).reduce((s, x) => s + +x.q * +x.p, 0);
  return (
    <div className="py-2">
      <div className="num mb-1 flex justify-between px-3 text-[11px]">
        <span className="text-bull">Buy ${formatCompact(buyVol)}</span>
        <span className="text-bear">Sell ${formatCompact(sellVol)}</span>
      </div>
      {trades.map((x) => (
        <div key={x.a} className="num flex justify-between px-3 py-[2px] text-[11px]">
          <span className={x.m ? "text-bear" : "text-bull"}>{formatPrice(+x.p)}</span>
          <span className="text-muted">{(+x.q).toFixed(4)}</span>
          <span className="text-faint">{new Date(x.T).toLocaleTimeString()}</span>
        </div>
      ))}
    </div>
  );
}
