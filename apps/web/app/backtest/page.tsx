"use client";

import type { Candle, Timeframe } from "@cv/core";
import { formatPrice, TIMEFRAMES } from "@cv/core";
import type { BacktestResult } from "@cv/backtest";
import { STRATEGY_IDS, type StrategyId } from "@cv/signals";
import { FlaskConical, Loader2, Play, ShieldAlert } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { EquityChart } from "@/components/backtest/equity-chart";
import { ChartPanel } from "@/components/chart/chart-panel";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, Select, Stat, Switch } from "@/components/ui/primitives";
import { useTickers } from "@/lib/data/hooks";
import { useT } from "@/lib/i18n";
import { useSettings } from "@/lib/store/settings";
import { cn } from "@/lib/utils";
import type { BacktestMessage, BacktestRequest } from "@/workers/backtest.worker";

const pct = (v: number, d = 2) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;
const pf = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "∞");

export default function BacktestPage() {
  const t = useT();
  const settings = useSettings();
  const { data: tickers } = useTickers();
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [tf, setTf] = useState<Timeframe>("4h");
  const [bars, setBars] = useState(2000);
  const [strategies, setStrategies] = useState<StrategyId[]>([...STRATEGY_IDS]);
  const [riskPct, setRiskPct] = useState(settings.riskPct);
  const [fee, setFee] = useState(settings.feePct);
  const [slip, setSlip] = useState(0.05);
  const [allowShort, setAllowShort] = useState(true);
  const [htfFilter, setHtfFilter] = useState(true);
  const [state, setState] = useState<{ status: "idle" | "running" | "done" | "error"; result?: BacktestResult; candles?: Candle[]; error?: string; phase?: string }>({ status: "idle" });
  const workerRef = useRef<Worker | null>(null);
  const symbols = useMemo(() => [...(tickers ?? [])].sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, 150).map((x) => x.symbol), [tickers]);

  const run = () => {
    workerRef.current?.terminate();
    const w = new Worker(new URL("../../workers/backtest.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = w;
    setState({ status: "running", phase: "fetch" });
    w.onmessage = (e: MessageEvent<BacktestMessage>) => {
      const m = e.data;
      if (m.type === "fetched") setState((s) => ({ ...s, phase: `${m.bars} bars` }));
      else if (m.type === "done") {
        setState({ status: "done", result: m.result, candles: m.candles });
        w.terminate();
      } else {
        setState({ status: "error", error: m.message });
        w.terminate();
      }
    };
    w.postMessage({
      symbol: symbol.toUpperCase(),
      timeframe: tf,
      bars,
      config: { strategies, riskPct, feeRate: fee / 100, slippageAtr: slip, allowShort, htfFilter, initialEquity: settings.equity, maxLeverage: settings.maxLeverage },
    } satisfies BacktestRequest);
  };

  const r = state.result;
  const m = r?.metrics;
  const bh = state.candles && r && r.equity.length ? (() => {
    const first = state.candles.find((c) => c.time === r.equity[0]!.time);
    const last = state.candles[state.candles.length - 1];
    return first && last ? ((last.close - first.close) / first.close) * 100 : NaN;
  })() : NaN;

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-4 lg:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <FlaskConical size={20} className="text-accent" /> {t("backtest.title")}
        </h1>
        <p className="mt-1 text-sm text-muted">{t("backtest.subtitle")}</p>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
          <Field label={t("common.symbol")}>
            <Input list="bt-symbols" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
            <datalist id="bt-symbols">
              {symbols.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
          <Field label={t("common.timeframe")}>
            <Select value={tf} onChange={(e) => setTf(e.target.value as Timeframe)}>
              {TIMEFRAMES.filter((x) => x !== "1m").map((x) => (
                <option key={x}>{x}</option>
              ))}
            </Select>
          </Field>
          <Field label={t("backtest.bars")}>
            <Select value={bars} onChange={(e) => setBars(+e.target.value)}>
              {[1000, 2000, 3000, 5000].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("backtest.riskPct")}>
            <Input type="number" step="0.25" min="0.1" max="5" value={riskPct} onChange={(e) => setRiskPct(+e.target.value)} />
          </Field>
          <Field label={t("backtest.fee")}>
            <Input type="number" step="0.01" min="0" value={fee} onChange={(e) => setFee(+e.target.value)} />
          </Field>
          <Field label={t("backtest.slippage")}>
            <Input type="number" step="0.01" min="0" value={slip} onChange={(e) => setSlip(+e.target.value)} />
          </Field>
          <div className="col-span-2 flex flex-col justify-end gap-2">
            <Switch checked={allowShort} onChange={setAllowShort} label={t("backtest.allowShort")} />
            <Switch checked={htfFilter} onChange={setHtfFilter} label={t("backtest.htf")} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <span className="text-xs text-muted">{t("backtest.strategies")}:</span>
          {STRATEGY_IDS.map((id) => (
            <button
              key={id}
              title={t(`strategy.desc.${id}`)}
              onClick={() => setStrategies((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
              className={cn("rounded-md border px-2 py-1 text-xs", strategies.includes(id) ? "border-accent bg-accent-soft text-accent" : "border-line text-muted")}
            >
              {t(`strategy.${id}`)}
            </button>
          ))}
          <Button variant="primary" size="md" className="ml-auto" onClick={run} disabled={state.status === "running" || strategies.length === 0}>
            {state.status === "running" ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
            {state.status === "running" ? `${t("backtest.running")} ${state.phase ?? ""}` : t("backtest.run")}
          </Button>
        </div>
      </Card>

      <div className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn-soft p-3 text-xs text-warn">
        <ShieldAlert size={15} className="mt-px shrink-0" /> {t("backtest.honesty")}
      </div>

      {state.status === "error" && <Card className="p-4 text-sm text-bear">{state.error}</Card>}
      {!r && state.status !== "running" && (
        <Card>
          <Empty icon={<FlaskConical size={28} />} title={t("backtest.empty")} />
        </Card>
      )}

      {r && m && state.candles && (
        <>
          <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4 lg:grid-cols-8">
            <Stat label={t("backtest.totalReturn")} value={pct(m.totalReturnPct)} tone={m.totalReturnPct >= 0 ? "bull" : "bear"} sub={`${t("backtest.buyHold")} ${Number.isFinite(bh) ? pct(bh) : "—"}`} />
            <Stat label={t("backtest.trades")} value={m.trades} sub={`L ${m.longTrades} · S ${m.shortTrades}`} />
            <Stat label={t("backtest.winRate")} value={`${(m.winRate * 100).toFixed(1)}%`} sub={`avg W ${m.avgWinR.toFixed(2)}R · L ${m.avgLossR.toFixed(2)}R`} />
            <Stat label={t("backtest.profitFactor")} value={pf(m.profitFactor)} tone={m.profitFactor >= 1 ? "bull" : "bear"} />
            <Stat label={t("backtest.expectancy")} value={`${m.expectancyR.toFixed(2)}R`} tone={m.expectancyR >= 0 ? "bull" : "bear"} />
            <Stat label={t("backtest.maxDD")} value={pct(m.maxDrawdownPct)} tone="bear" sub={`${t("backtest.maxLosses")}: ${m.maxConsecutiveLosses}`} />
            <Stat label="Sharpe / Sortino" value={`${m.sharpe.toFixed(2)} / ${m.sortino.toFixed(2)}`} sub={`Calmar ${m.calmar.toFixed(2)}`} />
            <Stat label={t("backtest.exposure")} value={`${m.exposurePct.toFixed(0)}%`} sub={`CAGR ${pct(m.cagrPct, 1)}`} />
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader title={t("backtest.equity")} subtitle={`${t("backtest.drawdown")} ↓`} />
              <EquityChart equity={r.equity} candles={state.candles} initial={settings.equity} />
            </Card>
            <Card className="flex flex-col">
              <CardHeader title={`${symbol} · ${tf} · ${t("backtest.trades")}`} />
              <div className="h-[360px]">
                <ChartPanel symbol={symbol} timeframe={tf} staticCandles={state.candles} trades={r.trades} readOnly />
              </div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader title={t("backtest.byStrategy")} />
              <table className="w-full text-sm">
                <tbody>
                  {Object.entries(r.byStrategy).map(([id, s]) => (
                    <tr key={id} className="border-b border-line/60">
                      <td className="px-4 py-2">{t(`strategy.${id}`)}</td>
                      <td className="num px-2 text-right text-muted">{s.trades}×</td>
                      <td className="num px-2 text-right">{(s.winRate * 100).toFixed(0)}%</td>
                      <td className={cn("num px-4 text-right font-semibold", s.profitFactor >= 1 ? "text-bull" : "text-bear")}>PF {pf(s.profitFactor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card>
              <CardHeader title={t("backtest.walkForward")} />
              <table className="w-full text-sm">
                <tbody>
                  {r.walkForward.map((s, i) => (
                    <tr key={i} className="border-b border-line/60">
                      <td className="num px-4 py-2 text-xs text-muted">{new Date(s.from * 1000).toLocaleDateString()}</td>
                      <td className="num px-2 text-right text-muted">{s.trades}×</td>
                      <td className="num px-2 text-right">{(s.winRate * 100).toFixed(0)}%</td>
                      <td className={cn("num px-4 text-right font-semibold", s.totalReturnPct >= 0 ? "text-bull" : "text-bear")}>{pct(s.totalReturnPct, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-4 py-2 text-[11px] text-faint">
                {r.walkForward.filter((s) => s.profitFactor > 1).length}/{r.walkForward.length} PF &gt; 1
              </p>
            </Card>
            <Card>
              <CardHeader title={t("backtest.monteCarlo")} />
              {r.monteCarlo.runs > 0 ? (
                <div className="grid grid-cols-2 gap-4 p-4">
                  <Stat label="P5" value={pct(r.monteCarlo.returnP5, 1)} tone={r.monteCarlo.returnP5 >= 0 ? "bull" : "bear"} />
                  <Stat label="P50" value={pct(r.monteCarlo.returnP50, 1)} tone={r.monteCarlo.returnP50 >= 0 ? "bull" : "bear"} />
                  <Stat label="P95" value={pct(r.monteCarlo.returnP95, 1)} tone={r.monteCarlo.returnP95 >= 0 ? "bull" : "bear"} />
                  <Stat label="DD P95" value={pct(r.monteCarlo.maxDrawdownP95, 1)} tone="bear" />
                  <div className="col-span-2">
                    <Badge tone={r.monteCarlo.probabilityOfLoss > 0.5 ? "bear" : "bull"}>
                      {t("backtest.pLoss")}: {(r.monteCarlo.probabilityOfLoss * 100).toFixed(0)}%
                    </Badge>
                  </div>
                </div>
              ) : (
                <Empty title={t("signals.noBacktest")} />
              )}
            </Card>
          </div>

          <Card>
            <CardHeader title={`${t("backtest.trades")} (${r.trades.length})`} />
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-panel text-[11px] tracking-wide text-muted uppercase">
                  <tr className="border-b border-line">
                    <th className="px-4 py-2 text-left">{t("common.date")}</th>
                    <th className="px-2 py-2 text-left">{t("common.side")}</th>
                    <th className="px-2 py-2 text-left">{t("common.strategy")}</th>
                    <th className="px-2 py-2 text-right">{t("plan.entry")}</th>
                    <th className="px-2 py-2 text-right">Exit</th>
                    <th className="px-2 py-2 text-left">Exit</th>
                    <th className="px-2 py-2 text-right">R</th>
                    <th className="px-4 py-2 text-right">PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {[...r.trades].reverse().map((tr, i) => (
                    <tr key={i} className="border-b border-line/60">
                      <td className="num px-4 py-1.5 text-xs text-muted">{new Date(tr.entryTime * 1000).toLocaleString()}</td>
                      <td className="px-2">
                        <Badge tone={tr.side === "LONG" ? "bull" : "bear"}>{tr.side}</Badge>
                      </td>
                      <td className="px-2 text-xs">{t(`strategy.${tr.strategyId}`)}</td>
                      <td className="num px-2 text-right">{formatPrice(tr.entryPrice)}</td>
                      <td className="num px-2 text-right">{formatPrice(tr.exitPrice)}</td>
                      <td className="px-2 text-xs text-muted">{t(`backtest.exit.${tr.exitReason}`)}</td>
                      <td className={cn("num px-2 text-right font-semibold", tr.rMultiple >= 0 ? "text-bull" : "text-bear")}>{tr.rMultiple.toFixed(2)}</td>
                      <td className={cn("num px-4 text-right", tr.pnl >= 0 ? "text-bull" : "text-bear")}>{tr.pnl >= 0 ? "+" : ""}{tr.pnl.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
