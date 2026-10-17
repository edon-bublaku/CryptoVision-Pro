"use client";

import type { BacktestSummary, FactorResult, Signal } from "@cv/core";
import { formatPrice } from "@cv/core";
import { positionSize } from "@cv/risk";
import { AlertTriangle, ShieldCheck, ShieldAlert } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useSettings } from "@/lib/store/settings";
import { cn } from "@/lib/utils";
import { GATE } from "@cv/engine";

export function PlanTable({ signal, compact }: { signal: Signal; compact?: boolean }) {
  const t = useT();
  const s = useSettings();
  const plan = signal.plan;
  if (!plan) return <p className="text-xs text-muted">{t("plan.noPlan")}</p>;
  const size = positionSize({ equity: s.equity, riskPct: s.riskPct, entry: plan.entry, stopLoss: plan.stopLoss, maxLeverage: s.maxLeverage, feeRate: s.feePct / 100 });
  const row = "flex items-center justify-between py-1";
  return (
    <div className="text-sm">
      <div className={cn("grid gap-x-6", compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2")}>
        <div>
          <div className={row}>
            <span className="text-muted">{t("plan.entry")}</span>
            <span className="num font-semibold">{formatPrice(plan.entry)}</span>
          </div>
          <div className={row}>
            <span className="text-muted">{t("plan.entryZone")}</span>
            <span className="num text-xs">
              {formatPrice(plan.entryZone[0])} – {formatPrice(plan.entryZone[1])}
            </span>
          </div>
          <div className={row}>
            <span className="text-bear">{t("plan.stop")}</span>
            <span className="num font-semibold text-bear">
              {formatPrice(plan.stopLoss)} <span className="text-xs font-normal">(−{plan.stopPct}%)</span>
            </span>
          </div>
          {plan.takeProfits.map((tp, i) => (
            <div key={i} className={row}>
              <span className="text-bull">
                TP{i + 1} <span className="text-xs text-muted">({tp.sizePct}%)</span>
              </span>
              <span className="num font-semibold text-bull">
                {formatPrice(tp.price)} <span className="text-xs font-normal text-muted">{tp.rr}R</span>
              </span>
            </div>
          ))}
          <div className={row}>
            <span className="text-muted">{t("plan.rr")}</span>
            <span className={cn("num font-semibold", plan.riskReward >= 1.5 ? "text-bull" : "text-warn")}>1 : {plan.riskReward}</span>
          </div>
        </div>
        {size && (
          <div className={cn(!compact && "sm:border-l sm:border-line sm:pl-6")}>
            <div className={row}>
              <span className="text-muted">{t("plan.size")}</span>
              <span className="num font-semibold">{size.quantity < 1 ? size.quantity.toPrecision(4) : size.quantity.toFixed(3)}</span>
            </div>
            <div className={row}>
              <span className="text-muted">{t("plan.notional")}</span>
              <span className="num">${size.notional.toLocaleString()}</span>
            </div>
            <div className={row}>
              <span className="text-muted">{t("plan.risk")}</span>
              <span className="num text-bear">
                ${size.riskAmount.toLocaleString()} ({s.riskPct}%)
              </span>
            </div>
            <div className={row}>
              <span className="text-muted">{t("plan.leverage")}</span>
              <span className="num">{size.leverage}×</span>
            </div>
            {size.liquidationPrice !== null && (
              <div className={row}>
                <span className="text-muted">{t("plan.liq")}</span>
                <span className="num text-warn">{formatPrice(size.liquidationPrice)}</span>
              </div>
            )}
            <div className={row}>
              <span className="text-muted">{t("plan.fees")}</span>
              <span className="num">${size.fees.toLocaleString()}</span>
            </div>
            {size.cappedByLeverage && <p className="mt-1 text-[11px] text-warn">{t("plan.capped")}</p>}
          </div>
        )}
      </div>
      <p className="mt-2 text-[11px] text-faint">{t("plan.afterTp1")}</p>
    </div>
  );
}

export function FactorList({ factors, limit = 12 }: { factors: FactorResult[]; limit?: number }) {
  const t = useT();
  return (
    <ul className="space-y-1.5">
      {factors.slice(0, limit).map((f) => (
        <li key={f.id} className="flex items-center gap-2 text-xs">
          <span className={cn("h-2 w-2 shrink-0 rounded-full", f.score > 0.1 ? "bg-bull" : f.score < -0.1 ? "bg-bear" : "bg-faint")} />
          <span className="min-w-0 flex-1">
            <span className="font-medium text-fg">{t(f.label)}</span>
            <span className="num ml-1.5 text-faint">{f.explanation}</span>
          </span>
          <span className="relative h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-line" title={`${f.score.toFixed(2)} × ${f.weight}`}>
            <span className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
            <span className={cn("absolute inset-y-0", f.score >= 0 ? "bg-bull" : "bg-bear")} style={{ left: f.score >= 0 ? "50%" : `${50 + f.score * 50}%`, width: `${Math.abs(f.score) * 50}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function BacktestBadge({ stats, passed }: { stats?: BacktestSummary; passed?: boolean }) {
  const t = useT();
  if (!stats || stats.trades === 0) return <p className="text-xs text-muted">{t("signals.noBacktest")}</p>;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-2 text-center">
        <Mini label={t("backtest.trades")} value={String(stats.trades)} />
        <Mini label={t("backtest.winRate")} value={`${(stats.winRate * 100).toFixed(0)}%`} />
        <Mini label="PF" value={Number.isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : "∞"} tone={stats.profitFactor >= 1 ? "bull" : "bear"} />
        <Mini label={t("backtest.totalReturn")} value={`${stats.totalReturnPct >= 0 ? "+" : ""}${stats.totalReturnPct.toFixed(1)}%`} tone={stats.totalReturnPct >= 0 ? "bull" : "bear"} />
      </div>
      <div className={cn("flex items-start gap-1.5 rounded-md px-2 py-1.5 text-[11px]", passed ? "bg-bull-soft text-bull" : "bg-warn-soft text-warn")}>
        {passed ? <ShieldCheck size={13} className="mt-px shrink-0" /> : <ShieldAlert size={13} className="mt-px shrink-0" />}
        <span>{passed ? `PF ≥ ${GATE.minProfitFactor} · ≥ ${GATE.minTrades} trade` : t("signals.gated")}</span>
      </div>
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: "bull" | "bear" }) {
  return (
    <div className="rounded-md bg-panel-2 px-1 py-1.5">
      <div className="truncate text-[10px] text-muted">{label}</div>
      <div className={cn("num text-sm font-semibold", tone === "bull" && "text-bull", tone === "bear" && "text-bear")}>{value}</div>
    </div>
  );
}

export function HtfWarning({ signal }: { signal: Signal }) {
  const t = useT();
  const side = signal.plan?.side;
  const conflict = (signal.htfBias === "BULLISH" && side === "SHORT") || (signal.htfBias === "BEARISH" && side === "LONG");
  if (!conflict) return null;
  return (
    <div className="flex items-center gap-1.5 rounded-md bg-warn-soft px-2 py-1 text-[11px] text-warn">
      <AlertTriangle size={12} /> {t("signals.htfConflict")}
    </div>
  );
}
