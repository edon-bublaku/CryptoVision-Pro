"use client";

import { formatCompact, formatPrice } from "@cv/core";
import { calibration, VERDICT_THRESHOLDS, type InvestmentPlan, type MetricResult, type PillarResult, type Rating, type Verdict } from "@cv/rating";
import { Bell, BellRing, ChevronDown, ClipboardList, History, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { useT, type TKey } from "@/lib/i18n";
import { useAlerts } from "@/lib/store/alerts";
import { usePortfolio } from "@/lib/store/portfolio";
import { useSettings } from "@/lib/store/settings";
import { cn } from "@/lib/utils";
import { Badge, Button } from "../ui/primitives";
import { toast } from "../ui/toast";
import { Gauge } from "../ui/viz";

export function scoreColor(score: number): string {
  if (score >= 70) return "var(--bull)";
  if (score >= 58) return "color-mix(in oklab, var(--bull) 65%, var(--warn))";
  if (score >= 45) return "var(--warn)";
  if (score >= 30) return "color-mix(in oklab, var(--bear) 65%, var(--warn))";
  return "var(--bear)";
}

export const VERDICT_TONE: Record<Verdict, "bull" | "bear" | "warn" | "neutral"> = {
  STRONG_ACCUMULATE: "bull",
  ACCUMULATE: "bull",
  HOLD: "warn",
  REDUCE: "bear",
  AVOID: "bear",
};

function ScoreBar({ score, className }: { score: number; className?: string }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-line", className)}>
      <div className="h-full rounded-full transition-[width]" style={{ width: `${Math.max(2, score)}%`, background: scoreColor(score) }} />
    </div>
  );
}

/** Human-readable raw value of a metric. */
export function formatMetric(m: Pick<MetricResult, "id" | "unit" | "value">, t: ReturnType<typeof useT>): string {
  const v = m.value;
  if (v === Infinity) return t("rating.v.noResistance");
  if (!Number.isFinite(v)) return "—";
  switch (m.id) {
    case "ema_alignment":
      return `${v}/4`;
    case "momentum_breadth":
      return `${v}/30`;
    case "supertrend":
      return v > 0 ? "↑" : "↓";
    case "rrg":
      return t(`markets.q.${["lagging", "improving", "weakening", "leading"][v]}` as TKey);
    case "market_structure":
      return t(v > 0 ? "rating.v.bullish" : v < 0 ? "rating.v.bearish" : "rating.v.neutral");
    case "obv_trend":
      return v > 0 ? "↑".repeat(v) : v < 0 ? "↓".repeat(-v) : "→";
    case "adx_trend":
      return `${Math.abs(v).toFixed(0)} ${v >= 0 ? "+DI" : "−DI"}`;
  }
  if (m.unit === "pct") return `${v >= 0 && m.id !== "volatility" && m.id !== "taker_buy" ? "+" : ""}${v.toFixed(1)}%`;
  if (m.unit === "usd") return `$${formatCompact(v)}`;
  if (m.unit === "index") return v.toFixed(0);
  return v.toFixed(2);
}

export function RatingSummary({ rating, compact = false, symbol }: { rating: Rating; compact?: boolean; symbol?: string }) {
  const t = useT();
  const preset = useSettings((s) => s.ratingPreset);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <Gauge value={rating.score} size={compact ? 110 : 130} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="num rounded-lg px-2 py-0.5 text-lg font-bold" style={{ color: scoreColor(rating.score), background: "color-mix(in oklab, currentColor 12%, transparent)" }}>
              {rating.grade}
            </span>
            <Badge tone={VERDICT_TONE[rating.verdict]}>{t(`rating.verdict.${rating.verdict}` as TKey)}</Badge>
          </div>
          <p className="text-xs leading-relaxed text-muted">{t(`rating.verdictHint.${rating.verdict}` as TKey)}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-faint">
            <span title={t("rating.confidenceHint")}>
              {t("rating.confidence")}: <b className="num text-muted">{Math.round(rating.confidence * 100)}%</b>
            </span>
            <span>
              {t("rating.coverage")}: <b className="num text-muted">{Math.round(rating.coverage * 100)}%</b>
            </span>
            <span>
              {t("rating.weights")}: <b className="text-muted">{t(`rating.preset.${preset}` as TKey)}</b>
            </span>
          </div>
          {symbol && <RatingAlertButton symbol={symbol} score={rating.score} />}
        </div>
      </div>
      <PillarList pillars={rating.pillars} />
    </div>
  );
}

/**
 * One-click rating alert: below "Accumulate" it watches for the upgrade, at or above it for a
 * drop under "Hold" (the exit warning).
 */
function RatingAlertButton({ symbol, score }: { symbol: string; score: number }) {
  const t = useT();
  const add = useAlerts((s) => s.add);
  const upgrade = score < VERDICT_THRESHOLDS.accumulate;
  const type = upgrade ? "rating_above" : "rating_below";
  const value = upgrade ? VERDICT_THRESHOLDS.accumulate : VERDICT_THRESHOLDS.hold;
  const exists = useAlerts((s) => s.alerts.some((a) => a.active && a.symbol === symbol && a.type === type && a.value === value));
  const label = t(upgrade ? "rating.alertAbove" : "rating.alertBelow", { v: value });
  return (
    <Button
      size="xs"
      variant="ghost"
      disabled={exists}
      className="-ml-2 h-auto min-h-7 max-w-full justify-start py-1 text-left whitespace-normal"
      onClick={() => {
        add({ symbol, type, value, once: true });
        toast({ title: t("alerts.created"), body: label, tone: "success" });
      }}
    >
      {exists ? <BellRing size={12} /> : <Bell size={12} />} {exists ? t("rating.alertSet") : label}
    </Button>
  );
}

function PillarList({ pillars }: { pillars: PillarResult[] }) {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-1">
      {pillars.map((p) => {
        const expanded = open === p.id;
        const mw = p.metrics.reduce((s, m) => s + m.weight, 0);
        return (
          <div key={p.id} className="rounded-lg border border-transparent hover:border-line">
            <button className="flex w-full items-center gap-2 px-2 py-1.5 text-left" onClick={() => setOpen(expanded ? null : p.id)} aria-expanded={expanded}>
              <span className="w-28 shrink-0 truncate text-xs font-medium">{t(`rating.pillar.${p.id}` as TKey)}</span>
              <span className="num w-9 shrink-0 text-right text-[10px] text-faint" title={t("rating.weight")}>
                {Math.round(p.weight * 100)}%
              </span>
              <ScoreBar score={p.score} className="flex-1" />
              <span className="num w-8 shrink-0 text-right text-xs font-semibold" style={{ color: scoreColor(p.score) }}>
                {Math.round(p.score)}
              </span>
              <ChevronDown size={13} className={cn("shrink-0 text-faint transition-transform", expanded && "rotate-180")} />
            </button>
            {expanded && (
              <div className="space-y-1 px-2 pb-2">
                {p.metrics.map((m) => (
                  <div key={m.id} className="grid grid-cols-[1fr_auto_44px_28px] items-center gap-2 text-[11px]" title={t(`rating.mh.${m.id}` as TKey)}>
                    <span className="truncate text-muted">{t(`rating.m.${m.id}` as TKey)}</span>
                    <span className="num text-right text-fg">{formatMetric(m, t)}</span>
                    <ScoreBar score={m.score} />
                    <span className="num text-right text-faint">{Math.round(m.score)}</span>
                  </div>
                ))}
                <p className="pt-1 text-[10px] text-faint">
                  {t("rating.metricWeights")}: {p.metrics.map((m) => `${t(`rating.m.${m.id}` as TKey)} ${Math.round((m.weight / mw) * 100)}%`).join(" · ")}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** What happened historically after this verdict, from `pnpm validate:rating`. */
export function HistoricalEvidence({ verdict }: { verdict: Verdict }) {
  const t = useT();
  const preset = useSettings((s) => s.ratingPreset);
  const pct = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
  const row =
    preset === "calibrated"
      ? calibration.calibrated.outOfSample.byVerdict.find((b) => b.verdict === verdict)
      : preset === "balanced"
        ? calibration.byVerdict.find((b) => b.verdict === verdict)
        : undefined;
  return (
    <div className="rounded-lg border border-line bg-panel-2 p-2.5 text-[11px] leading-relaxed text-muted">
      <div className="mb-1 flex items-center gap-1.5 font-semibold text-fg">
        <History size={12} /> {t("rating.history")}
      </div>
      {row && row.n >= 10 ? (
        <p>
          {t(preset === "calibrated" ? "rating.historyTextOos" : "rating.historyText", {
            n: row.n,
            days: calibration.horizonDays,
            mean: pct(row.meanFwd),
            median: pct(row.medianFwd),
            up: Math.round(row.positive * 100),
            btc: Math.round(row.beatBtc * 100),
            from: preset === "calibrated" ? calibration.splitAt : calibration.from,
            to: calibration.to,
          })}
        </p>
      ) : (
        <p>{t(row ? "rating.historyFew" : "rating.historyNone")}</p>
      )}
      <p className="mt-1 text-faint">{t("rating.historyCaveat")}</p>
    </div>
  );
}

function pctFrom(price: number, ref: number) {
  const v = (price / ref - 1) * 100;
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

export function InvestmentPlanView({ plan, rating, symbol }: { plan: InvestmentPlan; rating: Rating; symbol: string }) {
  const t = useT();
  const placeOrder = usePortfolio((s) => s.placeOrder);
  const addPosition = usePortfolio((s) => s.add);
  const addAlert = useAlerts((s) => s.add);
  const price = rating.price;
  const fp = (v: number) => formatPrice(v);
  const long = plan.side === "LONG";

  const toPaper = () => {
    const tp = plan.targets[1]?.price ?? plan.targets[0]?.price;
    for (const e of plan.entries) {
      const quantity = (plan.quantity * e.sizePct) / 100;
      const base = { symbol, side: plan.side!, quantity, stopLoss: plan.stopLoss, takeProfit: tp, leverage: Math.max(1, plan.leverage) };
      if (e.kind === "market") addPosition({ ...base, entry: price, paper: true, notes: `CV Rating ${Math.round(rating.score)} · ${e.sizePct}%` });
      else placeOrder({ ...base, type: e.kind === "stop" ? "STOP" : "LIMIT", price: e.price, note: `CV Rating ${Math.round(rating.score)} · ${e.sizePct}%` });
    }
    toast({ title: t("plan.toPaperDone"), body: `${symbol} · ${plan.entries.length}`, tone: "success" });
  };

  const toAlerts = () => {
    const below = long ? "price_below" : "price_above";
    const above = long ? "price_above" : "price_below";
    for (const e of plan.entries.filter((x) => x.kind !== "market")) addAlert({ symbol, type: below, value: e.price, once: true, note: t("plan.alertEntry") });
    if (plan.breakout) addAlert({ symbol, type: above, value: plan.breakout.price, once: true, note: t("plan.alertBreakout") });
    if (Number.isFinite(plan.stopLoss)) addAlert({ symbol, type: below, value: plan.stopLoss, once: true, note: t("plan.alertStop") });
    toast({ title: t("plan.alertsDone"), body: symbol, tone: "success" });
  };

  return (
    <div className="space-y-3 text-xs">
      <div className="rounded-lg p-2.5" style={{ background: `color-mix(in oklab, ${scoreColor(rating.score)} 12%, transparent)` }}>
        <div className="font-semibold" style={{ color: scoreColor(rating.score) }}>
          {t(`plan.stance.${plan.stance}` as TKey)}
          {plan.side === "SHORT" && " · SHORT"}
        </div>
        <p className="mt-0.5 leading-relaxed text-muted">{t(`plan.stanceHint.${plan.stance}` as TKey)}</p>
      </div>

      {plan.side ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Info label={t("plan.position")} value={`${plan.side} · ${plan.instrument === "spot" ? "Spot" : `Futures ${plan.leverage}×`}`} />
            <Info label={t("plan.horizon")} value={t("plan.horizonValue", { min: plan.horizonDays[0], max: plan.horizonDays[1] })} />
            <Info label={t("plan.size")} value={`${plan.quantity.toPrecision(4)} · $${formatCompact(plan.notional)}`} />
            <Info label={t("plan.riskBudget")} value={`$${plan.riskAmount.toFixed(2)} (${plan.riskPctOfEquity}%)`} tone="bear" />
          </div>

          <div>
            <h5 className="mb-1 text-[11px] font-semibold text-fg">{t("plan.whenBuy")}</h5>
            <table className="w-full">
              <tbody>
                {plan.entries.map((e, k) => (
                  <tr key={k} className="border-b border-line/50">
                    <td className="py-1 pr-1">
                      <Badge tone={e.kind === "market" ? "accent" : "neutral"}>{e.kind === "market" ? t("plan.now") : e.kind.toUpperCase()}</Badge>
                    </td>
                    <td className="num py-1 text-right font-medium">{fp(e.price)}</td>
                    <td className="num py-1 text-right text-faint">{e.kind === "market" ? "" : pctFrom(e.price, price)}</td>
                    <td className="num py-1 text-right font-semibold">{e.sizePct}%</td>
                    <td className="py-1 pl-2 text-[10px] text-faint">{t(e.reason as TKey)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-[11px] text-muted">
              {t("plan.avgEntry")}: <b className="num text-fg">{fp(plan.avgEntry)}</b>
              {plan.breakout && (
                <>
                  {" · "}
                  {t("plan.breakoutAlt")}: <b className="num text-fg">{fp(plan.breakout.price)}</b> ({pctFrom(plan.breakout.price, price)})
                </>
              )}
            </p>
          </div>

          <div>
            <h5 className="mb-1 text-[11px] font-semibold text-fg">{t("plan.whenSell")}</h5>
            <table className="w-full">
              <tbody>
                <tr className="border-b border-line/50">
                  <td className="py-1 text-bear">Stop-loss</td>
                  <td className="num py-1 text-right font-medium text-bear">{fp(plan.stopLoss)}</td>
                  <td className="num py-1 text-right text-faint">{pctFrom(plan.stopLoss, plan.avgEntry)}</td>
                  <td className="num py-1 text-right">100%</td>
                  <td className="num py-1 pl-2 text-right text-faint">−1R</td>
                </tr>
                {plan.targets.map((tg, k) => (
                  <tr key={k} className="border-b border-line/50">
                    <td className="py-1 text-bull">TP{k + 1}</td>
                    <td className="num py-1 text-right font-medium text-bull">{fp(tg.price)}</td>
                    <td className="num py-1 text-right text-faint">{pctFrom(tg.price, plan.avgEntry)}</td>
                    <td className="num py-1 text-right">{tg.sizePct}%</td>
                    <td className="num py-1 pl-2 text-right text-faint">{tg.rr.toFixed(1)}R</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-[11px] text-muted">
              {t("plan.weightedRR")}: <b className="num text-fg">{plan.rewardRisk.toFixed(2)}R</b>
            </p>
          </div>
        </>
      ) : null}

      <div>
        <h5 className="mb-1 text-[11px] font-semibold text-fg">{plan.side ? t("plan.exitRules") : t("plan.holderRules")}</h5>
        <ol className="list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-muted">
          {plan.exitRules.map((r, k) => (
            <li key={k}>
              {t(`plan.rule.${r.id}` as TKey, Object.fromEntries(Object.entries(r.params).map(([key, v]) => [key, key === "price" || key === "now" ? fp(v) : String(v)])))}
            </li>
          ))}
        </ol>
      </div>

      {plan.side && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={toPaper}>
            <ClipboardList size={13} /> {t("plan.toPaper")}
          </Button>
          <Button size="sm" variant="ghost" onClick={toAlerts}>
            <Bell size={13} /> {t("plan.toAlerts")}
          </Button>
        </div>
      )}
      <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-faint">
        <ShieldAlert size={11} className="mt-px shrink-0 text-warn" /> {t("plan.disclaimer")}
      </p>
    </div>
  );
}

function Info({ label, value, tone }: { label: string; value: string; tone?: "bear" }) {
  return (
    <div className="rounded-lg border border-line p-2">
      <div className="text-[10px] tracking-wide text-faint uppercase">{label}</div>
      <div className={cn("num mt-0.5 font-semibold", tone === "bear" && "text-bear")}>{value}</div>
    </div>
  );
}
