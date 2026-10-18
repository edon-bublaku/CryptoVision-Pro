"use client";

import { baseAsset, formatCompact, formatPrice } from "@cv/core";
import { calibration, type Pick, type Recommendation, type Regime } from "@cv/rating";
import { ClipboardList, Loader2, ShieldAlert, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { scoreColor, VERDICT_TONE } from "@/components/rating/rating-view";
import { Badge, Button, Card, CardHeader, Empty, PageHeader, Segmented, Skeleton, Stat } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { CoinIcon } from "@/components/ui/viz";
import { useRecommendation } from "@/lib/data/rating";
import { useT, type TKey } from "@/lib/i18n";
import { usePortfolio } from "@/lib/store/portfolio";
import { useSettings } from "@/lib/store/settings";
import { cn } from "@/lib/utils";

const REGIME_COLOR: Record<Regime, string> = { risk_on: "var(--bull)", neutral: "var(--warn)", risk_off: "var(--bear)" };
const PICK_COLORS = ["#7b8cff", "#22d3ee", "#34d399", "#f5b041", "#f472b6", "#a78bfa", "#fb923c", "#84cc16", "#60a5fa", "#e879f9"];

export default function RecommendationsPage() {
  const t = useT();
  const equity = useSettings((s) => s.equity);
  const [size, setSize] = useState(40);
  const [maxPositions, setMaxPositions] = useState(6);
  const { rec, loaded, total } = useRecommendation(size, maxPositions);
  const placeOrder = usePortfolio((s) => s.placeOrder);
  const addPosition = usePortfolio((s) => s.add);

  const toPaper = () => {
    if (!rec) return;
    let n = 0;
    for (const p of rec.picks) {
      const plan = p.plan;
      if (!plan?.side) continue;
      // Allocation decides the size here (portfolio weight), the plan decides where and when.
      const quantity = (p.weight * equity) / plan.avgEntry;
      const tp = plan.targets[1]?.price ?? plan.targets[0]?.price;
      for (const e of plan.entries) {
        const base = { symbol: p.symbol, side: plan.side, quantity: (quantity * e.sizePct) / 100, stopLoss: plan.stopLoss, takeProfit: tp, leverage: 1 };
        if (e.kind === "market") addPosition({ ...base, entry: p.rating.price, paper: true, notes: `CV · ${Math.round(p.weight * 100)}%` });
        else placeOrder({ ...base, type: e.kind === "stop" ? "STOP" : "LIMIT", price: e.price, note: `CV · ${Math.round(p.weight * 100)}%` });
        n++;
      }
    }
    toast({ title: t("rec.paperDone"), body: `${rec.picks.length} coin · ${n}`, tone: "success" });
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 lg:p-8">
      <PageHeader
        icon={<Sparkles size={20} />}
        title={t("rec.title")}
        subtitle={t("rec.subtitle")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Segmented value={maxPositions} onChange={setMaxPositions} options={[3, 5, 6, 8, 10].map((v) => ({ value: v, label: `${v} coin`, title: t("rec.maxPositions") }))} />
            <Segmented value={size} onChange={setSize} options={[30, 40, 60].map((v) => ({ value: v, label: `Top ${v}`, title: t("rec.universe") }))} />
          </div>
        }
      />

      {!rec ? (
        <div className="space-y-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-64" />
          <p className="flex items-center gap-2 text-sm text-muted">
            <Loader2 size={14} className="animate-spin" /> {t("ratingPage.loading", { n: loaded, total })}
          </p>
        </div>
      ) : (
        <>
          <RegimeBanner rec={rec} />
          <Allocation rec={rec} equity={equity} />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold tracking-tight">{t("rec.picks", { n: rec.picks.length })}</h2>
            {rec.picks.length > 0 && (
              <Button size="sm" onClick={toPaper}>
                <ClipboardList size={14} /> {t("rec.toPaper")}
              </Button>
            )}
          </div>
          {rec.picks.length === 0 ? (
            <Card>
              <Empty icon={<ShieldAlert size={26} />} title={t("rec.none")}>
                {t("rec.noneHint")}
              </Empty>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {rec.picks.map((p, k) => (
                <PickCard key={p.symbol} pick={p} color={PICK_COLORS[k % PICK_COLORS.length]!} equity={equity} />
              ))}
            </div>
          )}

          <Excluded rec={rec} />
          <History />
        </>
      )}

      <p className="flex items-start gap-2 text-[11px] leading-relaxed text-faint">
        <ShieldAlert size={13} className="mt-px shrink-0 text-warn" /> {t("rec.disclaimer")}
      </p>
    </div>
  );
}

function RegimeBanner({ rec }: { rec: Recommendation }) {
  const t = useT();
  const m = rec.market;
  const color = REGIME_COLOR[m.regime];
  return (
    <Card className="overflow-hidden">
      <div className="grid gap-4 p-4 md:grid-cols-[1.3fr_1fr]">
        <div className="flex items-start gap-3">
          <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 0 6px color-mix(in oklab, ${color} 18%, transparent)` }} />
          <div>
            <div className="text-xs tracking-wide text-muted uppercase">{t("rec.regime")}</div>
            <div className="text-xl font-semibold" style={{ color }}>
              {t(`rec.regime.${m.regime}` as TKey)}
            </div>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted">{t(`rec.regimeHint.${m.regime}` as TKey)}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-2 lg:grid-cols-4">
          <Stat label={t("rec.exposure")} value={`${Math.round(m.exposure * 100)}%`} sub={t("rec.exposureSub")} />
          <Stat label={t("rec.btcVsEma")} value={`${m.btcEma200Distance >= 0 ? "+" : ""}${m.btcEma200Distance.toFixed(1)}%`} tone={m.btcAboveEma200 ? "bull" : "bear"} />
          <Stat label={t("rec.breadth")} value={`${Math.round(m.breadth * 100)}%`} sub={t("rec.breadthSub")} tone={m.breadth >= 0.5 ? "bull" : m.breadth < 0.35 ? "bear" : undefined} />
          <Stat label={t("ratingPage.marketAvg")} value={m.avgScore.toFixed(0)} sub={`${m.rated} coin`} />
        </div>
      </div>
    </Card>
  );
}

function Allocation({ rec, equity }: { rec: Recommendation; equity: number }) {
  const t = useT();
  const parts = [...rec.picks.map((p, k) => ({ label: baseAsset(p.symbol), w: p.weight, color: PICK_COLORS[k % PICK_COLORS.length]! })), { label: t("rec.cash"), w: rec.cash, color: "var(--line-strong)" }];
  return (
    <Card>
      <CardHeader title={t("rec.allocation")} subtitle={t("rec.allocationSub", { equity: formatCompact(equity) })} />
      <div className="space-y-3 px-4 pb-4">
        <div className="flex h-4 w-full overflow-hidden rounded-full bg-line">
          {parts.map((p) => (
            <div key={p.label} title={`${p.label} ${(p.w * 100).toFixed(1)}%`} style={{ width: `${p.w * 100}%`, background: p.color }} />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
          {parts.map((p) => (
            <span key={p.label} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />
              <b className="font-medium">{p.label}</b>
              <span className="num text-muted">
                {(p.w * 100).toFixed(1)}% · ${formatCompact(p.w * equity)}
              </span>
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}

function PickCard({ pick, color, equity }: { pick: Pick; color: string; equity: number }) {
  const t = useT();
  const plan = pick.plan;
  const r = pick.rating;
  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center gap-3">
        <CoinIcon symbol={pick.symbol} size={34} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold">{baseAsset(pick.symbol)}</span>
            <Badge tone={VERDICT_TONE[r.verdict]}>{t(`rating.verdict.${r.verdict}` as TKey)}</Badge>
          </div>
          <div className="num text-xs text-muted">{formatPrice(r.price)}</div>
        </div>
        <div className="text-right">
          <div className="num text-2xl leading-none font-bold" style={{ color: scoreColor(r.score) }}>
            {Math.round(r.score)}
          </div>
          <div className="num text-[11px] font-semibold" style={{ color: scoreColor(r.score) }}>
            {r.grade}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        <span className="text-muted">{t("rec.weight")}</span>
        <b className="num">{(pick.weight * 100).toFixed(1)}%</b>
        <span className="num text-muted">· ${formatCompact(pick.weight * equity)}</span>
        <span className="num ml-auto text-faint">vol {pick.vol30.toFixed(0)}%</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {pick.strengths.map((p) => (
          <span key={p} className="rounded-md bg-bull-soft px-1.5 py-0.5 text-[11px] text-bull">
            + {t(`rating.pillar.${p}` as TKey)}
          </span>
        ))}
        {pick.watch && <span className="rounded-md bg-warn-soft px-1.5 py-0.5 text-[11px] text-warn">! {t(`rating.pillar.${pick.watch}` as TKey)}</span>}
      </div>

      {plan?.side && (
        <div className="mt-3 space-y-1 rounded-lg border border-line p-2.5 text-xs">
          <div className="font-medium">{t(`plan.stance.${plan.stance}` as TKey)}</div>
          <Row label={t("rec.buy")} value={plan.entries.map((e) => `${e.kind === "market" ? t("plan.now") : formatPrice(e.price)} (${e.sizePct}%)`).join(" · ")} />
          <Row label="Stop-loss" value={formatPrice(plan.stopLoss)} tone="bear" />
          <Row label="TP1 / TP2" value={`${formatPrice(plan.targets[0]!.price)} / ${formatPrice(plan.targets[1]!.price)}`} tone="bull" />
          <Row label="R:R" value={`${plan.rewardRisk.toFixed(2)}R`} />
        </div>
      )}
      <Link href={`/chart?symbol=${pick.symbol}`} className="mt-3 text-xs font-medium text-accent hover:underline">
        {t("rec.openPlan")} →
      </Link>
    </Card>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "bull" | "bear" }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className={cn("num text-right", tone === "bull" && "text-bull", tone === "bear" && "text-bear")}>{value}</span>
    </div>
  );
}

function Excluded({ rec }: { rec: Recommendation }) {
  const t = useT();
  const shown = rec.excluded.filter((e) => e.reason !== "no_data" && e.reason !== "low_score");
  const weak = rec.excluded.filter((e) => e.reason === "low_score").length;
  return (
    <Card>
      <CardHeader title={t("rec.excluded")} subtitle={t("rec.excludedSub", { weak })} />
      <div className="flex flex-wrap gap-2 px-4 pb-4">
        {shown.length === 0 && <span className="text-xs text-faint">—</span>}
        {shown.map((e) => (
          <span key={e.symbol} className="rounded-lg border border-line px-2 py-1 text-xs">
            <b>{baseAsset(e.symbol)}</b> <span className="num text-muted">{e.score?.toFixed(0)}</span> ·{" "}
            <span className="text-muted">{t(`rec.reason.${e.reason}` as TKey, { with: e.with ? baseAsset(e.with) : "", rho: e.rho?.toFixed(2) ?? "" })}</span>
          </span>
        ))}
      </div>
    </Card>
  );
}

const SERIES = [
  { key: "strategy", color: "var(--accent)" },
  { key: "btc", color: "#f5b041" },
  { key: "topN", color: "var(--bear)" },
  { key: "equal", color: "var(--faint)" },
] as const;

function History() {
  const t = useT();
  const pf = calibration.portfolio;
  const pct = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
  const W = 640;
  const H = 220;
  const all = SERIES.flatMap((s) => pf[s.key].curve);
  const max = Math.max(1, ...all);
  const min = Math.min(1, ...all);
  // One point per period end, plus the starting value.
  const x = (k: number) => (k / Math.max(1, pf.times.length)) * (W - 40) + 4;
  const y = (v: number) => 8 + (1 - (Math.log(v) - Math.log(min)) / (Math.log(max) - Math.log(min) || 1)) * (H - 24);
  return (
    <Card>
      <CardHeader title={t("rec.history")} subtitle={t("rec.historySub", { from: pf.from, to: pf.to, n: pf.periods, fee: (pf.feePerSide * 100).toFixed(1) })} />
      <div className="grid gap-4 px-4 pb-4 lg:grid-cols-[1.4fr_1fr]">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={t("rec.history")}>
          <line x1={0} x2={W} y1={y(1)} y2={y(1)} stroke="var(--line-strong)" strokeDasharray="4 4" />
          {SERIES.map((s) => (
            <polyline key={s.key} fill="none" stroke={s.color} strokeWidth={s.key === "strategy" ? 2.4 : 1.4} strokeLinejoin="round" points={[1, ...pf[s.key].curve].map((v, k) => `${x(k)},${y(v)}`).join(" ")} />
          ))}
          {SERIES.map((s) => {
            const last = pf[s.key].curve[pf[s.key].curve.length - 1]!;
            return (
              <text key={s.key} x={W - 34} y={y(last) + 4} fontSize={10.5} fill={s.color} fontWeight={600}>
                {pct(last - 1)}
              </text>
            );
          })}
        </svg>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] tracking-wide text-muted uppercase">
              <tr className="border-b border-line">
                <th className="py-1.5 text-left" />
                <th className="py-1.5 text-right">{t("rec.col.total")}</th>
                <th className="py-1.5 text-right">CAGR</th>
                <th className="py-1.5 text-right">Max DD</th>
                <th className="py-1.5 text-right">Sharpe</th>
              </tr>
            </thead>
            <tbody>
              {SERIES.map((s) => {
                const m = pf[s.key];
                return (
                  <tr key={s.key} className="border-b border-line/50">
                    <td className="py-1.5">
                      <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
                      {t(`rec.series.${s.key}` as TKey)}
                    </td>
                    <td className={cn("num text-right", m.totalReturn >= 0 ? "text-bull" : "text-bear")}>{pct(m.totalReturn)}</td>
                    <td className="num text-right">{pct(m.cagr)}</td>
                    <td className="num text-right text-bear">{pct(m.maxDrawdown)}</td>
                    <td className="num text-right">{m.sharpe.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            {t("rec.historyNote", { exposure: Math.round(pf.avgExposure * 100), picks: pf.avgPicks, beat: Math.round(pf.beatBtcShare * 100) })}
          </p>
        </div>
      </div>
    </Card>
  );
}
