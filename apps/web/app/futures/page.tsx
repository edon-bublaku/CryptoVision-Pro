"use client";

import type { Side, Timeframe, TradePlan } from "@cv/core";
import { baseAsset, formatCompact, formatPrice, formatQty, lastFinite, SIGNAL_TTL_BARS, TIMEFRAME_SECONDS } from "@cv/core";
import { universe } from "@cv/exchange";
import { buildTradePlan, futuresPlan, orderProblem, type FuturesPlan } from "@cv/risk";
import type { DerivativeEvent, MarketEvent, MarketEventKind } from "@cv/signals";
import { Activity, AlertTriangle, ArrowRightLeft, Bell, CandlestickChart, ClipboardList, Gauge, Loader2, LogIn, LogOut, Scale, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { BacktestBadge, FactorList } from "@/components/signals/signal-parts";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, PageHeader, Segmented, Select, Skeleton, Stat } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { ActionBadge, CoinIcon } from "@/components/ui/viz";
import { useLivePrices, useTickers } from "@/lib/data/hooks";
import { useFuturesData } from "@/lib/data/futures";
import { useT, type TKey } from "@/lib/i18n";
import { useAlerts } from "@/lib/store/alerts";
import { usePortfolio } from "@/lib/store/portfolio";
import { useSettings } from "@/lib/store/settings";
import { tradeLink } from "@/lib/trade/model";
import { cn, timeAgo } from "@/lib/utils";

const TFS: Timeframe[] = ["15m", "1h", "4h", "1d"];
const HOLDS = [8, 24, 72, 168];
type SideMode = "auto" | Side;
type EventGroup = "all" | "cross" | "structure" | "momentum" | "volume" | "pattern";

const GROUP: Record<MarketEventKind, Exclude<EventGroup, "all">> = {
  ema_20_50_cross: "cross",
  golden_cross: "cross",
  death_cross: "cross",
  price_ema200_cross: "cross",
  macd_signal_cross: "cross",
  macd_zero_cross: "cross",
  rsi_overbought: "momentum",
  rsi_oversold: "momentum",
  rsi_exit_overbought: "momentum",
  rsi_exit_oversold: "momentum",
  supertrend_flip: "structure",
  adx_trend_start: "momentum",
  bb_squeeze: "volume",
  bb_break: "volume",
  breakout_20: "structure",
  volume_spike: "volume",
  bos: "structure",
  choch: "structure",
  divergence: "momentum",
  hidden_divergence: "momentum",
  candle_pattern: "pattern",
};

const fmt = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: d }));
const usd = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v < 0 ? "−" : ""}$${fmt(Math.abs(v), 2)}`);

export default function FuturesPage() {
  return (
    <Suspense fallback={null}>
      <FuturesView />
    </Suspense>
  );
}

function FuturesView() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const rawSym = params.get("symbol")?.toUpperCase() ?? "";
  const symbol = /^[A-Z0-9]{2,20}USDT$/.test(rawSym) ? rawSym : "BTCUSDT";
  const tf = (TFS as string[]).includes(params.get("tf") ?? "") ? (params.get("tf") as Timeframe) : "4h";
  const go = (s: string, f: Timeframe) => router.replace(`/futures?symbol=${s}&tf=${f}`, { scroll: false });

  const settings = useSettings();
  const [sideMode, setSideMode] = useState<SideMode>("auto");
  const [hold, setHold] = useState(24);
  const [feePct, setFeePct] = useState("0.05");
  const [maxLev, setMaxLev] = useState(String(Math.max(settings.maxLeverage, 5)));
  const { data: tickers } = useTickers();
  const live = useLivePrices()[symbol];
  const options = useMemo(() => {
    const list = tickers ? universe(tickers, 120).map((x) => x.symbol) : [];
    return list.includes(symbol) ? list : [symbol, ...list];
  }, [tickers, symbol]);
  const data = useFuturesData(symbol, tf);
  const a = data.analysis?.analysis ?? null;
  const signal = a?.signal ?? null;

  // The plan follows the engine's side unless the user forces one; a forced side gets its own
  // stop (beyond the nearest support/resistance) and targets from the same risk rules.
  const plan: TradePlan | null = useMemo(() => {
    if (!a || !signal) return null;
    const engineSide = signal.plan?.side ?? null;
    const side = sideMode === "auto" ? engineSide : sideMode;
    if (!side) return null;
    if (signal.plan && side === engineSide) return signal.plan;
    const i = a.context.close.length - 1;
    const ev = a.evaluation;
    return buildTradePlan({
      side,
      entry: a.context.close[i]!,
      atr: a.context.atr[i]!,
      structuralStop: side === "LONG" ? ev.support : ev.resistance,
      nextLevel: side === "LONG" ? ev.resistance : ev.support,
    });
  }, [a, signal, sideMode]);

  const deriv = data.derivatives;
  const fp: FuturesPlan | null = useMemo(
    () =>
      plan
        ? futuresPlan({
            side: plan.side,
            entry: plan.entry,
            stopLoss: plan.stopLoss,
            targets: plan.takeProfits,
            equity: settings.equity,
            riskPct: settings.riskPct,
            maxLeverage: Math.min(125, Math.max(1, Number(maxLev) || 1)),
            takerFee: (Number(feePct) || 0) / 100,
            fundingRate: deriv?.fundingRate,
            fundingIntervalHours: deriv?.fundingIntervalHours,
            holdHours: hold,
            nextLevel: plan.side === "LONG" ? a?.evaluation.resistance : a?.evaluation.support,
          })
        : null,
    [plan, a, settings.equity, settings.riskPct, maxLev, feePct, deriv?.fundingRate, deriv?.fundingIntervalHours, hold],
  );

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 lg:p-8">
      <PageHeader
        icon={<Scale size={20} />}
        title={t("fut.title")}
        subtitle={t("fut.subtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2">
              <CoinIcon symbol={symbol} size={22} />
              <span className="sr-only">{t("common.symbol")}</span>
              <Select className="w-32" value={symbol} onChange={(e) => go(e.target.value, tf)}>
                {options.map((o) => (
                  <option key={o} value={o}>
                    {baseAsset(o)}
                  </option>
                ))}
              </Select>
            </label>
            <Segmented size="xs" value={tf} onChange={(v) => go(symbol, v)} options={TFS.map((x) => ({ value: x, label: x }))} />
          </div>
        }
      />

      <MarketStrip price={live?.price ?? a?.context.close.at(-1)} change={live && live.open ? ((live.price - live.open) / live.open) * 100 : undefined} deriv={deriv} />

      {data.isLoading || (!a && !data.error && data.candles.length === 0) ? (
        <div className="space-y-4">
          <p className="flex items-center gap-2 text-xs text-faint">
            <Loader2 size={12} className="animate-spin" /> {t("common.loading")}
          </p>
          <Skeleton className="h-64" />
        </div>
      ) : !a || !signal ? (
        <Card>
          <Empty title={data.error ? t("common.error") : t("fut.noData")} />
        </Card>
      ) : (
        <>
          <Card className="p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
              <Field label={t("fut.side")} group>
                <Segmented size="xs" value={sideMode} onChange={setSideMode} options={[{ value: "auto", label: t("fut.auto") }, { value: "LONG", label: "LONG" }, { value: "SHORT", label: "SHORT" }]} />
              </Field>
              <Field label={t("fut.hold")}>
                <Select value={hold} onChange={(e) => setHold(+e.target.value)}>
                  {HOLDS.map((h) => (
                    <option key={h} value={h}>
                      {t("fut.holdH", { h })}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("fut.maxLev")}>
                <Input inputMode="numeric" value={maxLev} onChange={(e) => setMaxLev(e.target.value)} />
              </Field>
              <Field label={t("fut.takerFee")}>
                <Input inputMode="decimal" value={feePct} onChange={(e) => setFeePct(e.target.value)} />
              </Field>
              <div className="text-xs text-muted">
                {t("fut.account", { equity: fmt(settings.equity, 0), risk: settings.riskPct })}{" "}
                <Link href="/settings" className="text-accent hover:underline">
                  {t("nav.settings")}
                </Link>
              </div>
            </div>
          </Card>

          <Decision signal={signal} plan={plan} fp={fp} derivEvents={data.derivEvents} sideMode={sideMode} gatePassed={signal.strategyId ? data.analysis?.gate[signal.strategyId] : undefined} />

          {plan && fp ? (
            <>
              <div className="grid gap-4 xl:grid-cols-2">
                <EntryCard plan={plan} fp={fp} tf={tf} />
                <LeverageCard fp={fp} />
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                <ExitCard plan={plan} fp={fp} tf={tf} />
                <CostsCard fp={fp} hold={hold} deriv={deriv} />
              </div>
              <ActionsBar symbol={symbol} plan={plan} fp={fp} livePrice={live?.price} />
            </>
          ) : (
            <Card>
              <Empty title={t("fut.noPlan")} />
            </Card>
          )}

          <div className="grid gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <EventsCard events={data.events} />
            <div className="space-y-4">
              <MetricsCard a={a} />
              <Card>
                <CardHeader title={t("fut.factors")} subtitle={t("fut.factorsSub", { score: signal.score })} />
                <div className="px-4 pb-4">
                  <FactorList factors={signal.factors} />
                </div>
              </Card>
            </div>
          </div>
        </>
      )}
      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-faint">
        <ShieldAlert size={12} className="mt-px shrink-0 text-warn" /> {t("fut.disclaimer")}
      </p>
    </div>
  );
}

/** "3h 12m" until a future timestamp (ms); "0m" once it has passed. */
function countdown(ms: number): string {
  const m = Math.max(0, Math.round((ms - Date.now()) / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

function MarketStrip({ price, change, deriv }: { price?: number; change?: number; deriv: ReturnType<typeof useFuturesData>["derivatives"] }) {
  const t = useT();
  const taker = deriv ? deriv.takerBuy24h / (deriv.takerBuy24h + deriv.takerSell24h || 1) : NaN;
  const per8h = deriv ? deriv.fundingRate * (8 / (deriv.fundingIntervalHours || 8)) * 100 : NaN;
  return (
    <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 lg:grid-cols-6">
      <Stat label={t("common.price")} value={price !== undefined ? formatPrice(price) : "—"} sub={change !== undefined ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}% 24h` : undefined} tone={change === undefined ? undefined : change >= 0 ? "bull" : "bear"} />
      <Stat
        label={t("fut.funding")}
        value={deriv ? `${(deriv.fundingRate * 100).toFixed(4)}%` : "—"}
        sub={deriv ? `${t("fut.every", { h: deriv.fundingIntervalHours })} · ${fmt(per8h * 3 * 365, 1)}%/${t("fut.year")} · ${t("fut.nextIn", { t: countdown(deriv.nextFundingTime) })}` : t("fut.noDeriv")}
        tone={deriv ? (deriv.fundingRate > 0 ? "bear" : "bull") : undefined}
      />
      <Stat label={t("fut.oi")} value={deriv ? `$${formatCompact(deriv.openInterestUsd)}` : "—"} sub={deriv && Number.isFinite(deriv.oiChange24hPct) ? `${deriv.oiChange24hPct >= 0 ? "+" : ""}${deriv.oiChange24hPct.toFixed(1)}% 24h` : undefined} />
      <Stat label={t("fut.lsRatio")} value={deriv ? fmt(deriv.longShortRatio, 2) : "—"} sub={t("fut.lsSub")} />
      <Stat label={t("fut.taker")} value={Number.isFinite(taker) ? `${(taker * 100).toFixed(1)}%` : "—"} sub={t("fut.takerSub")} tone={Number.isFinite(taker) ? (taker >= 0.5 ? "bull" : "bear") : undefined} />
      <Stat label={t("fut.avgFunding")} value={deriv ? `${(deriv.fundingAvg30 * 100).toFixed(4)}%` : "—"} sub={t("fut.avgFundingSub")} />
    </Card>
  );
}

function Decision({ signal, plan, fp, derivEvents, sideMode, gatePassed }: { signal: NonNullable<ReturnType<typeof useFuturesData>["analysis"]>["analysis"]["signal"]; plan: TradePlan | null; fp: FuturesPlan | null; derivEvents: DerivativeEvent[]; sideMode: SideMode; gatePassed?: boolean }) {
  const t = useT();
  const side = plan?.side;
  const manual = sideMode !== "auto" && sideMode !== signal.plan?.side;
  const active = signal.status === "ACTIVE" && !manual && signal.action !== "HOLD";
  const against = derivEvents.filter((e) => e.against === side);
  const reasons: string[] = [];
  if (manual) reasons.push(t("fut.why.manual"));
  if (!signal.strategyId) reasons.push(t("fut.why.noSetup"));
  if (gatePassed === false) reasons.push(t("fut.why.gate"));
  if (plan && plan.riskReward < 1.5) reasons.push(t("fut.why.rr", { rr: plan.riskReward }));
  if (side && signal.htfBias === (side === "LONG" ? "BEARISH" : "BULLISH")) reasons.push(t("fut.why.htf"));
  const verdict = active ? "enter" : signal.strategyId && !manual ? "wait" : "none";
  const tone = verdict === "enter" ? "border-bull/50 bg-bull-soft" : verdict === "wait" ? "border-warn/50 bg-warn-soft" : "border-line bg-panel-2";
  return (
    <Card className={cn("border p-4", tone)}>
      <div className="flex flex-wrap items-center gap-3">
        <ActionBadge action={signal.action} size="lg" />
        {side && <Badge tone={side === "LONG" ? "bull" : "bear"}>{side}</Badge>}
        <div className="min-w-0 flex-1">
          <div className="text-lg font-semibold">{t(`fut.verdict.${verdict}` as TKey)}</div>
          <div className="text-xs text-muted">
            {t("fut.scoreLine", { score: signal.score, conf: Math.round(signal.confidence * 100) })} · {t(`regime.${signal.regime}` as TKey)} · HTF {signal.htfBias}
            {signal.strategyId ? ` · ${t(`strategy.${signal.strategyId}` as TKey)}` : ""}
          </div>
        </div>
        {signal.strategyId && <BacktestBadge stats={signal.backtest} passed={gatePassed} />}
      </div>
      {(reasons.length > 0 || against.length > 0 || (fp && fp.warnings.length > 0)) && (
        <ul className="mt-3 space-y-1 text-xs">
          {reasons.map((r) => (
            <li key={r} className="flex items-start gap-1.5 text-muted">
              <AlertTriangle size={12} className="mt-px shrink-0 text-warn" /> {r}
            </li>
          ))}
          {against.map((e) => (
            <li key={e.kind} className="flex items-start gap-1.5 text-muted">
              <AlertTriangle size={12} className="mt-px shrink-0 text-warn" /> {t(`fut.dev.${e.kind}` as TKey)}
            </li>
          ))}
          {fp?.warnings.map((w) => (
            <li key={w} className="flex items-start gap-1.5 text-muted">
              <AlertTriangle size={12} className="mt-px shrink-0 text-warn" /> {t(`fut.warn.${w}` as TKey, { safe: fp.maxSafeLeverage })}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Row({ label, value, tone, sub }: { label: React.ReactNode; value: React.ReactNode; tone?: "bull" | "bear" | "warn"; sub?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line/50 px-4 py-2 text-sm last:border-0">
      <span className="text-muted">{label}</span>
      <span className="text-right">
        <span className={cn("num font-semibold", tone === "bull" && "text-bull", tone === "bear" && "text-bear", tone === "warn" && "text-warn")}>{value}</span>
        {sub && <span className="block text-[11px] text-faint">{sub}</span>}
      </span>
    </div>
  );
}

function EntryCard({ plan, fp, tf }: { plan: TradePlan; fp: FuturesPlan; tf: Timeframe }) {
  const t = useT();
  const long = plan.side === "LONG";
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><LogIn size={15} className="text-accent" /> {t("fut.entry")}</span>} subtitle={t("fut.entrySub")} />
      <Row label={t("plan.entryZone")} value={`${formatPrice(plan.entryZone[0])} – ${formatPrice(plan.entryZone[1])}`} sub={t("fut.entryHow", { side: plan.side })} />
      <Row label={t("fut.entryRef")} value={formatPrice(plan.entry)} />
      <Row label={t("common.quantity")} value={formatQty(fp.quantity)} sub={`${t("tools.notional")} ${usd(fp.notional)}`} />
      <Row label={t("plan.stop")} value={formatPrice(plan.stopLoss)} tone="bear" sub={`${long ? "−" : "+"}${fmt(fp.stopPct, 2)}% · ${t("fut.invalid", { tf })}`} />
      <Row label={t("fut.riskAtStop")} value={usd(fp.riskAmount)} tone="bear" sub={t("fut.riskPct", { pct: fmt(fp.riskPctActual, 2) })} />
      <Row label="R:R" value={`${fmt(plan.riskReward, 2)} · ${t("fut.net")} ${fmt(fp.rrNet, 2)}`} tone={fp.rrNet >= 1.5 ? "bull" : "warn"} />
    </Card>
  );
}

function LeverageCard({ fp }: { fp: FuturesPlan }) {
  const t = useT();
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><Gauge size={15} className="text-accent" /> {t("fut.lev")}</span>} subtitle={t("fut.levSub")} />
      <div className="grid grid-cols-3 gap-3 px-4 pb-3">
        <Stat label={t("fut.levRec")} value={`${fp.leverage}×`} sub={t("fut.levRecSub")} />
        <Stat label={t("fut.levSafe")} value={`${fp.maxSafeLeverage}×`} sub={t("fut.levSafeSub")} />
        <Stat label={t("fut.margin")} value={usd(fp.margin)} />
      </div>
      <div className="overflow-x-auto border-t border-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-[11px] tracking-wide text-muted uppercase">
              <th scope="col" className="px-4 py-2 text-left font-medium">{t("fut.mode")}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{t("tools.liq")}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{t("fut.distance")}</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">{t("fut.maxLoss")}</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-line/50 bg-bull-soft/40">
              <th scope="row" className="px-4 py-2 text-left font-semibold">
                Isolated <Badge tone="bull" className="ml-1">{t("fut.recommended")}</Badge>
              </th>
              <td className="num px-3 py-2 text-right text-bear">{formatPrice(fp.isolated.liquidation)}</td>
              <td className="num px-3 py-2 text-right">{fmt(fp.isolated.distancePct, 1)}%</td>
              <td className="num px-4 py-2 text-right">{usd(fp.isolated.maxLoss)}</td>
            </tr>
            <tr>
              <th scope="row" className="px-4 py-2 text-left font-semibold">Cross</th>
              <td className="num px-3 py-2 text-right text-bear">{fp.cross.liquidation !== null ? formatPrice(fp.cross.liquidation) : t("fut.noLiq")}</td>
              <td className="num px-3 py-2 text-right">{fp.cross.distancePct !== null ? `${fmt(fp.cross.distancePct, 1)}%` : "—"}</td>
              <td className="num px-4 py-2 text-right text-bear">{usd(fp.cross.maxLoss)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="px-4 py-3 text-xs leading-relaxed text-muted">{t("fut.modeWhy")}</p>
    </Card>
  );
}

function ExitCard({ plan, fp, tf }: { plan: TradePlan; fp: FuturesPlan; tf: Timeframe }) {
  const t = useT();
  const hours = Math.round((TIMEFRAME_SECONDS[tf] * SIGNAL_TTL_BARS * 2) / 3600);
  const rules: string[] = [
    t("fut.rule.stop", { price: formatPrice(plan.stopLoss), tf }),
    t("fut.rule.tp1", { price: formatPrice(plan.takeProfits[0]?.price ?? NaN), be: formatPrice(fp.breakeven) }),
    t("fut.rule.tp2", { price: formatPrice(plan.takeProfits[1]?.price ?? NaN), tp1: formatPrice(plan.takeProfits[0]?.price ?? NaN) }),
    t("fut.rule.tp3", { price: formatPrice(plan.takeProfits[2]?.price ?? NaN) }),
    t(plan.side === "LONG" ? "fut.rule.chochLong" : "fut.rule.chochShort"),
    t("fut.rule.funding"),
    t("fut.rule.time", { h: hours }),
    t("fut.rule.liq", { price: formatPrice(fp.isolated.liquidation) }),
  ];
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><LogOut size={15} className="text-accent" /> {t("fut.exit")}</span>} subtitle={t("fut.exitSub")} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-[11px] tracking-wide text-muted uppercase">
              <th scope="col" className="px-4 py-2 text-left font-medium">TP</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{t("common.price")}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{t("fut.close")}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">R</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">PnL</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">ROE</th>
            </tr>
          </thead>
          <tbody>
            {fp.targets.map((x, k) => (
              <tr key={k} className="border-b border-line/50">
                <th scope="row" className="px-4 py-2 text-left font-semibold">TP{k + 1}</th>
                <td className="num px-3 py-2 text-right text-bull">{formatPrice(x.price)}</td>
                <td className="num px-3 py-2 text-right">{x.sizePct}%</td>
                <td className="num px-3 py-2 text-right">{fmt(x.rr, 2)}</td>
                <td className="num px-3 py-2 text-right text-bull">{usd(x.pnl)}</td>
                <td className="num px-4 py-2 text-right">{fmt(x.roe, 1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ol className="list-decimal space-y-1 px-8 py-3 text-xs leading-relaxed text-muted">
        {rules.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ol>
    </Card>
  );
}

function CostsCard({ fp, hold, deriv }: { fp: FuturesPlan; hold: number; deriv: ReturnType<typeof useFuturesData>["derivatives"] }) {
  const t = useT();
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><Activity size={15} className="text-accent" /> {t("fut.costs")}</span>} subtitle={t("fut.costsSub")} />
      <Row label={t("fut.entryFee")} value={usd(fp.costs.entryFee)} />
      <Row label={t("fut.exitFee")} value={usd(fp.costs.exitFeeAtStop)} />
      <Row
        label={t("fut.fundingHold", { h: hold })}
        value={usd(fp.costs.fundingForHold)}
        tone={fp.costs.fundingForHold > 0 ? "bear" : fp.costs.fundingForHold < 0 ? "bull" : undefined}
        sub={deriv ? t(fp.funding.youPay ? "fut.youPay" : "fut.youReceive", { amt: usd(Math.abs(fp.funding.perInterval)), h: fp.funding.intervalHours }) : t("fut.noDeriv")}
      />
      <Row label={t("fut.breakeven")} value={formatPrice(fp.breakeven)} sub={t("fut.breakevenSub")} />
      <Row label={t("fut.fundingYear")} value={`${fmt(fp.funding.annualizedPct, 2)}%`} />
    </Card>
  );
}

function ActionsBar({ symbol, plan, fp, livePrice }: { symbol: string; plan: TradePlan; fp: FuturesPlan; livePrice?: number }) {
  const t = useT();
  const add = usePortfolio((s) => s.add);
  const placeOrder = usePortfolio((s) => s.placeOrder);
  const addAlert = useAlerts((s) => s.add);
  const [lo, hi] = plan.entryZone;
  const price = livePrice ?? plan.entry;
  const base = { symbol, side: plan.side, quantity: fp.quantity, stopLoss: plan.stopLoss, takeProfit: plan.takeProfits[1]?.price ?? plan.takeProfits[0]?.price, leverage: fp.leverage };
  const toPaper = () => {
    const order = { ...base, type: "LIMIT" as const, price: plan.entry };
    // Inside the zone (or when a limit would fill at once) enter at market; otherwise wait at the reference entry.
    if ((price >= lo && price <= hi) || orderProblem(order, price)) {
      add({ ...base, entry: price, paper: true, notes: `Futures ${fp.leverage}× isolated` });
      toast({ title: t("fut.paperDone"), body: `${symbol} ${plan.side} ${fp.leverage}×`, tone: "success" });
    } else {
      placeOrder({ ...order, note: `Futures ${fp.leverage}× isolated` });
      toast({ title: t("fut.orderDone"), body: `${symbol} LIMIT ${formatPrice(plan.entry)}`, tone: "success" });
    }
  };
  const alerts = () => {
    if (!(price >= lo && price <= hi)) {
      const above = price > hi;
      addAlert({ symbol, type: above ? "price_below" : "price_above", value: above ? hi : lo, once: true, note: t("plan.entryZone") });
    }
    addAlert({ symbol, type: plan.side === "LONG" ? "price_below" : "price_above", value: plan.stopLoss, once: true, note: "Stop-loss" });
    toast({ title: t("alerts.created"), body: symbol, tone: "success" });
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="primary" onClick={toPaper}>
        <ClipboardList size={14} /> {t("fut.toPaper", { lev: fp.leverage })}
      </Button>
      <Link href={tradeLink({ market: "futures", symbol, side: plan.side, entryType: price >= lo && price <= hi ? "MARKET" : "LIMIT", entry: plan.entry, stopLoss: plan.stopLoss, targets: plan.takeProfits, leverage: fp.leverage })}>
        <Button>
          <ArrowRightLeft size={14} /> {t("trade.toBinance")}
        </Button>
      </Link>
      <Button onClick={alerts}>
        <Bell size={14} /> {t("fut.toAlerts")}
      </Button>
      <Link href={`/chart?symbol=${symbol}`}>
        <Button variant="ghost">
          <CandlestickChart size={14} /> {t("compare.openChart", { coin: baseAsset(symbol) })}
        </Button>
      </Link>
    </div>
  );
}

function EventsCard({ events }: { events: MarketEvent[] }) {
  const t = useT();
  const lang = useSettings((s) => s.lang);
  const [group, setGroup] = useState<EventGroup>("all");
  const shown = events.filter((e) => group === "all" || GROUP[e.kind] === group).slice(0, 60);
  return (
    <Card>
      <CardHeader
        title={t("fut.events")}
        subtitle={t("fut.eventsSub")}
        right={<Segmented size="xs" value={group} onChange={setGroup} options={(["all", "cross", "structure", "momentum", "volume", "pattern"] as EventGroup[]).map((g) => ({ value: g, label: t(`fut.eg.${g}` as TKey) }))} />}
      />
      {shown.length === 0 ? (
        <Empty title="—" />
      ) : (
        <ul className="max-h-[640px] divide-y divide-line/50 overflow-y-auto focus-visible:outline-2 focus-visible:outline-accent" tabIndex={0} aria-label={t("fut.events")}>
          {shown.map((e, k) => (
            <li key={`${e.index}-${e.kind}-${k}`} className="flex items-center gap-3 px-4 py-2 text-sm">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", e.direction === "bullish" ? "bg-bull" : e.direction === "bearish" ? "bg-bear" : "bg-muted")} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{eventLabel(e, t)}</span>
                <span className="ml-2 text-[11px] text-faint">{t(`fut.eg.${GROUP[e.kind]}` as TKey)}</span>
              </span>
              <span className="num text-xs text-muted">{formatPrice(e.price)}</span>
              <span className="w-24 text-right text-[11px] text-faint">{timeAgo(e.time * 1000, lang)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function eventLabel(e: MarketEvent, t: ReturnType<typeof useT>): string {
  if (e.kind === "candle_pattern") return `${t(`pattern.${e.pattern}` as TKey)}`;
  const value = e.value !== undefined ? fmt(e.value, e.kind === "volume_spike" ? 1 : 0) : "";
  return t(`ev.${e.kind}.${e.direction}` as TKey, { v: value });
}

function MetricsCard({ a }: { a: NonNullable<ReturnType<typeof useFuturesData>["analysis"]>["analysis"] }) {
  const t = useT();
  const c = a.context;
  const i = c.close.length - 1;
  const close = c.close[i]!;
  const v = (s: readonly number[]) => lastFinite(s);
  const rel = (x: number) => (Number.isFinite(x) ? `${close >= x ? "↑" : "↓"} ${formatPrice(x)}` : "—");
  const ich = c.ichimoku;
  const cloudTop = Math.max(ich.spanA[i - 26] ?? NaN, ich.spanB[i - 26] ?? NaN);
  const cloudBot = Math.min(ich.spanA[i - 26] ?? NaN, ich.spanB[i - 26] ?? NaN);
  const rows: [string, string, "bull" | "bear" | undefined][] = [
    ["RSI 14", fmt(v(c.rsi), 1), v(c.rsi) >= 70 ? "bear" : v(c.rsi) <= 30 ? "bull" : undefined],
    ["Stoch RSI K / D", `${fmt(v(c.stochRsi.k), 0)} / ${fmt(v(c.stochRsi.d), 0)}`, undefined],
    ["MACD / signal", `${fmt(v(c.macd.macd), 4)} / ${fmt(v(c.macd.signal), 4)}`, v(c.macd.histogram) >= 0 ? "bull" : "bear"],
    ["ADX / +DI / −DI", `${fmt(v(c.adx.adx), 0)} / ${fmt(v(c.adx.plusDI), 0)} / ${fmt(v(c.adx.minusDI), 0)}`, v(c.adx.plusDI) >= v(c.adx.minusDI) ? "bull" : "bear"],
    ["EMA 20", rel(v(c.ema20)), close >= v(c.ema20) ? "bull" : "bear"],
    ["EMA 50", rel(v(c.ema50)), close >= v(c.ema50) ? "bull" : "bear"],
    ["EMA 200", rel(v(c.ema200)), close >= v(c.ema200) ? "bull" : "bear"],
    ["SuperTrend", c.supertrend.direction[i] === 1 ? "↑" : "↓", c.supertrend.direction[i] === 1 ? "bull" : "bear"],
    [t("fut.m.cloud"), Number.isFinite(cloudTop) ? (close > cloudTop ? t("fut.m.above") : close < cloudBot ? t("fut.m.below") : t("fut.m.inside")) : "—", close > cloudTop ? "bull" : close < cloudBot ? "bear" : undefined],
    ["ATR 14", `${formatPrice(v(c.atr))} (${fmt(v(c.atrPct), 2)}%)`, undefined],
    ["Bollinger %B / BW", `${fmt(v(c.bb.percentB), 2)} / ${fmt(v(c.bb.bandwidth), 3)}`, undefined],
    [t("fut.m.relVol"), `${fmt(v(c.relVol), 2)}×`, undefined],
    ["OBV vs EMA20", v(c.obv) >= v(c.obvEma) ? "↑" : "↓", v(c.obv) >= v(c.obvEma) ? "bull" : "bear"],
    ["CMF 20 / MFI 14", `${fmt(v(c.cmf), 2)} / ${fmt(v(c.mfi), 0)}`, v(c.cmf) >= 0 ? "bull" : "bear"],
    [t("fut.m.range20"), `${formatPrice(v(c.donchianLow))} – ${formatPrice(v(c.donchianHigh))}`, undefined],
    [t("fut.m.sr"), `${a.evaluation.support !== undefined ? formatPrice(a.evaluation.support) : "—"} / ${a.evaluation.resistance !== undefined ? formatPrice(a.evaluation.resistance) : "—"}`, undefined],
    [t("fut.m.structure"), t(`fut.m.trend.${c.structure.trend}` as TKey), c.structure.trend === "bullish" ? "bull" : c.structure.trend === "bearish" ? "bear" : undefined],
  ];
  return (
    <Card>
      <CardHeader title={t("fut.metrics")} subtitle={t("fut.metricsSub")} />
      <dl className="grid grid-cols-1 gap-x-4 px-4 pb-3 text-xs sm:grid-cols-2">
        {rows.map(([k, val, tone]) => (
          <div key={k} className="flex items-center justify-between gap-2 border-b border-line/40 py-1.5">
            <dt className="text-muted">{k}</dt>
            <dd className={cn("num text-right font-semibold", tone === "bull" && "text-bull", tone === "bear" && "text-bear")}>{val}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
