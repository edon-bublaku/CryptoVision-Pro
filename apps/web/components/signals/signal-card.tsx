"use client";

import { baseAsset, formatPrice } from "@cv/core";
import { positionSize } from "@cv/risk";
import { ArrowRightLeft, Bell, BriefcaseBusiness, CandlestickChart, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useT } from "@/lib/i18n";
import { useAlerts } from "@/lib/store/alerts";
import { usePortfolio } from "@/lib/store/portfolio";
import type { ScanRow } from "@/lib/store/scan";
import { useSettings } from "@/lib/store/settings";
import { tradeLink } from "@/lib/trade/model";
import { cn } from "@/lib/utils";
import { Badge, Button } from "../ui/primitives";
import { toast } from "../ui/toast";
import { ActionBadge, CoinIcon, Pct, ScoreBar, Sparkline } from "../ui/viz";
import { BacktestBadge, FactorList, HtfWarning, PlanTable } from "./signal-parts";

export function SignalCard({ row, defaultOpen }: { row: ScanRow; defaultOpen?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(!!defaultOpen);
  const s = row.signal;
  const settings = useSettings();
  const addPos = usePortfolio((x) => x.add);
  const addAlert = useAlerts((x) => x.add);
  const sid = s.strategyId;

  const addToPortfolio = () => {
    const p = s.plan;
    if (!p) return;
    const size = positionSize({ equity: settings.equity, riskPct: settings.riskPct, entry: p.entry, stopLoss: p.stopLoss, maxLeverage: settings.maxLeverage, feeRate: settings.feePct / 100 });
    addPos({ symbol: s.symbol, side: p.side, entry: p.entry, quantity: size?.quantity ?? 0, stopLoss: p.stopLoss, takeProfit: p.takeProfits[1]?.price, leverage: size?.leverage ?? 1, strategyId: sid, notes: `${s.timeframe} · ${sid ? t(`strategy.${sid}`) : t("strategy.none")} · ${s.score}` });
    toast({ title: t("signals.addPortfolio"), body: s.symbol, tone: "success" });
  };

  return (
    <div className={cn("rounded-xl border bg-panel transition-colors", s.status === "ACTIVE" ? "border-accent/40" : "border-line")}>
      <button className="flex w-full items-center gap-3 p-3 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <CoinIcon symbol={s.symbol} size={34} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold">{baseAsset(s.symbol)}</span>
            <span className="text-xs text-faint">{s.timeframe}</span>
            {s.status === "ACTIVE" && <Badge tone="accent">{t("status.ACTIVE")}</Badge>}
          </div>
          <div className="num mt-0.5 flex items-center gap-2 text-xs text-muted">
            {formatPrice(s.price)} <Pct value={row.snapshot.change24h} />
          </div>
        </div>
        <Sparkline values={row.snapshot.spark} width={90} height={30} className="hidden sm:block" />
        <div className="w-28 shrink-0 space-y-1 text-right">
          <ActionBadge action={s.action} />
          <ScoreBar score={s.score} />
        </div>
        <ChevronDown size={16} className={cn("shrink-0 text-faint transition-transform", open && "rotate-180")} />
      </button>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-3 py-2 text-[11px] text-muted">
        <span>
          {t("common.strategy")}: <b className="font-medium text-fg">{sid ? t(`strategy.${sid}`) : t("strategy.none")}</b>
        </span>
        <span>
          {t("common.regime")}: <b className="font-medium text-fg">{t(`regime.${s.regime}`)}</b>
        </span>
        <span>
          {t("common.confidence")}: <b className="num font-medium text-fg">{Math.round(s.confidence * 100)}%</b>
        </span>
        {s.plan && (
          <span>
            R:R <b className={cn("num font-medium", s.plan.riskReward >= 1.5 ? "text-bull" : "text-warn")}>{s.plan.riskReward}</b>
          </span>
        )}
        <span className="ml-auto">HTF: {t(`bias.${s.htfBias}`)}</span>
      </div>
      {open && (
        <div className="grid gap-4 border-t border-line p-4 lg:grid-cols-2">
          <div className="space-y-3">
            <h4 className="text-xs font-semibold tracking-wide text-muted uppercase">{t("plan.title")}</h4>
            <HtfWarning signal={s} />
            <PlanTable signal={s} />
            <div className="flex flex-wrap gap-2 pt-1">
              <Link href={`/chart?symbol=${s.symbol}&tf=${s.timeframe}`}>
                <Button size="xs" variant="primary">
                  <CandlestickChart size={13} /> {t("signals.openChart")}
                </Button>
              </Link>
              {s.plan && (
                <Button size="xs" onClick={addToPortfolio}>
                  <BriefcaseBusiness size={13} /> {t("signals.addPortfolio")}
                </Button>
              )}
              {s.plan && (
                <Link href={tradeTicket(s.symbol, s.price, s.plan)}>
                  <Button size="xs">
                    <ArrowRightLeft size={13} /> {t("trade.toBinance")}
                  </Button>
                </Link>
              )}
              {s.plan && (
                <Button
                  size="xs"
                  onClick={() => {
                    const p = s.plan!;
                    addAlert({ symbol: s.symbol, type: p.side === "LONG" ? "price_below" : "price_above", value: p.entryZone[p.side === "LONG" ? 1 : 0], once: true, note: `${t("plan.entryZone")} ${s.timeframe}` });
                    toast({ title: t("alerts.new"), body: s.symbol, tone: "success" });
                  }}
                >
                  <Bell size={13} /> {t("signals.createAlert")}
                </Button>
              )}
            </div>
            {sid && (
              <div className="pt-2">
                <h4 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">{t("signals.backtestOnCoin")}</h4>
                <BacktestBadge stats={s.backtest} passed={row.gate[sid]} />
                <p className="mt-2 text-[11px] text-faint">{t(`strategy.desc.${sid}`)}</p>
              </div>
            )}
          </div>
          <div>
            <h4 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">{t("factors.title")}</h4>
            <FactorList factors={s.factors} limit={14} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Pre-filled Binance order ticket: market inside the entry zone, a limit at the planned entry otherwise. */
function tradeTicket(symbol: string, price: number, p: NonNullable<ScanRow["signal"]["plan"]>) {
  const inZone = price >= p.entryZone[0] && price <= p.entryZone[1];
  return tradeLink({ symbol, side: p.side, entryType: inZone ? "MARKET" : "LIMIT", entry: p.entry, stopLoss: p.stopLoss, targets: p.takeProfits });
}
