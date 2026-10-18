"use client";

import { baseAsset, formatPrice, mean } from "@cv/core";
import { calibration, PILLAR_IDS, rateAt, stanceOf, WEIGHT_PRESETS, type PillarId, type PillarWeights, type PresetId, type Rating, type Verdict } from "@cv/rating";
import { ArrowDown, ArrowUp, Gauge as GaugeIcon, Loader2, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { scoreColor, VERDICT_TONE } from "@/components/rating/rating-view";
import { Badge, Button, Card, CardHeader, Empty, PageHeader, Segmented, Select, Skeleton, Stat } from "@/components/ui/primitives";
import { CoinIcon, Pct } from "@/components/ui/viz";
import { useUniverseContexts } from "@/lib/data/rating";
import { useT, type TKey } from "@/lib/i18n";
import { activeRatingWeights, useSettings } from "@/lib/store/settings";
import { cn } from "@/lib/utils";

const VERDICTS: Verdict[] = ["STRONG_ACCUMULATE", "ACCUMULATE", "HOLD", "REDUCE", "AVOID"];
const PRESETS: (PresetId | "custom")[] = ["balanced", "calibrated", "trend", "momentum", "conservative", "custom"];

interface Row {
  symbol: string;
  rating: Rating;
  ret30: number;
}

export default function RatingPage() {
  const t = useT();
  const s = useSettings();
  const weights = activeRatingWeights(s);
  const [size, setSize] = useState(30);
  const [filter, setFilter] = useState<Verdict | "all">("all");
  const [sort, setSort] = useState<{ key: "score" | PillarId | "ret30"; dir: 1 | -1 }>({ key: "score", dir: -1 });
  const [editing, setEditing] = useState(false);
  const { symbols, contexts, loaded } = useUniverseContexts(size);

  const rows = useMemo<Row[]>(
    () =>
      contexts
        .map(({ symbol, ctx }) => {
          const rating = rateAt(ctx, undefined, weights);
          const c = ctx.sc.close;
          return rating ? { symbol, rating, ret30: (c[c.length - 1]! / c[c.length - 31]! - 1) * 100 } : null;
        })
        .filter((r): r is Row => !!r),
    [contexts, weights],
  );

  const pillarOf = (r: Row, p: PillarId) => r.rating.pillars.find((x) => x.id === p)?.score ?? -1;
  const shown = useMemo(() => {
    const list = rows.filter((r) => filter === "all" || r.rating.verdict === filter);
    const val = (r: Row) => (sort.key === "score" ? r.rating.score : sort.key === "ret30" ? r.ret30 : pillarOf(r, sort.key));
    return list.sort((a, b) => (val(a) - val(b)) * sort.dir);
  }, [rows, filter, sort]);

  const counts = Object.fromEntries(VERDICTS.map((v) => [v, rows.filter((r) => r.rating.verdict === v).length])) as Record<Verdict, number>;
  const activePillars = PILLAR_IDS.filter((p) => (weights[p] ?? 0) > 0);
  const th = (key: typeof sort.key, label: string, title?: string) => (
    <th key={key} title={title} className="cursor-pointer px-2 py-2 text-right whitespace-nowrap hover:text-fg" onClick={() => setSort((x) => ({ key, dir: x.key === key ? (x.dir === 1 ? -1 : 1) : -1 }))}>
      {label} {sort.key === key && (sort.dir === 1 ? <ArrowUp size={10} className="inline" /> : <ArrowDown size={10} className="inline" />)}
    </th>
  );

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 p-4 lg:p-8">
      <PageHeader
        icon={<GaugeIcon size={20} />}
        title={t("ratingPage.title")}
        subtitle={t("ratingPage.subtitle")}
        actions={<Segmented value={size} onChange={setSize} options={[20, 30, 50].map((v) => ({ value: v, label: `${v} coin` }))} />}
      />

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">{t("rating.weights")}:</span>
          <Select aria-label={t("rating.weights")} className="w-auto" value={s.ratingPreset} onChange={(e) => s.set({ ratingPreset: e.target.value as PresetId | "custom" })}>
            {PRESETS.map((p) => (
              <option key={p} value={p}>
                {t(`rating.preset.${p}` as TKey)}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
            <SlidersHorizontal size={13} /> {t("ratingPage.editWeights")}
          </Button>
          <div className="ml-auto flex flex-wrap gap-1">
            <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
              {t("common.all")} · {rows.length}
            </FilterChip>
            {VERDICTS.map((v) => (
              <FilterChip key={v} active={filter === v} onClick={() => setFilter(v)}>
                {t(`rating.verdict.${v}` as TKey)} · {counts[v]}
              </FilterChip>
            ))}
          </div>
        </div>
        <p className="mt-2 text-[11px] text-faint">{t(`ratingPage.presetHint.${s.ratingPreset}` as TKey)}</p>
        {editing && <WeightsEditor weights={weights} onChange={(w) => s.set({ ratingPreset: "custom", ratingWeights: w })} />}
      </Card>

      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label={t("ratingPage.marketAvg")} value={mean(rows.map((r) => r.rating.score)).toFixed(0)} sub={t("ratingPage.marketAvgSub")} />
          <Stat label={t("ratingPage.positive")} value={`${counts.STRONG_ACCUMULATE + counts.ACCUMULATE} / ${rows.length}`} sub={t("ratingPage.positiveSub")} tone="bull" />
          <Stat label={t("ratingPage.negative")} value={`${counts.REDUCE + counts.AVOID} / ${rows.length}`} sub={t("ratingPage.negativeSub")} tone="bear" />
          {s.ratingPreset === "calibrated" ? (
            <Stat label={t("ratingPage.ic")} value={calibration.calibrated.outOfSample.calibratedIc.toFixed(3)} sub={t("ratingPage.icSubOos", { from: calibration.splitAt })} />
          ) : (
            <Stat label={t("ratingPage.ic")} value={calibration.ic.mean.toFixed(3)} sub={t(s.ratingPreset === "balanced" ? "ratingPage.icSub" : "ratingPage.icSubOther", { t: calibration.ic.tStat, n: calibration.ic.dates })} />
          )}
        </div>
      )}

      <Card>
        <CardHeader
          title={t("ratingPage.table")}
          subtitle={loaded < symbols.length ? t("ratingPage.loading", { n: loaded, total: symbols.length }) : t("ratingPage.tableSub")}
          right={loaded < symbols.length ? <Loader2 size={15} className="animate-spin text-muted" /> : undefined}
        />
        {!rows.length ? (
          loaded < symbols.length || !symbols.length ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }, (_, k) => (
                <Skeleton key={k} className="h-10" />
              ))}
            </div>
          ) : (
            <Empty title={t("rating.notEnough")} />
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[11px] tracking-wide text-muted uppercase">
                <tr className="border-b border-line">
                  <th className="px-3 py-2 text-left">Coin</th>
                  <th className="px-2 py-2 text-right">{t("markets.col.price")}</th>
                  {th("ret30", "30d")}
                  {th("score", "CV Rating")}
                  <th className="px-2 py-2 text-left">{t("ratingPage.verdict")}</th>
                  {activePillars.map((p) => th(p, t(`ratingPage.short.${p}` as TKey), `${t(`rating.pillar.${p}` as TKey)} · ${weights[p]}`))}
                  <th className="px-3 py-2 text-left">{t("ratingPage.action")}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.symbol} className="border-b border-line/60 hover:bg-panel-2">
                    <td className="px-3 py-2">
                      <Link href={`/chart?symbol=${r.symbol}`} className="flex items-center gap-2 font-semibold hover:text-accent">
                        <CoinIcon symbol={r.symbol} size={22} /> {baseAsset(r.symbol)}
                      </Link>
                    </td>
                    <td className="num px-2 text-right">{formatPrice(r.rating.price)}</td>
                    <td className="px-2 text-right">
                      <Pct value={r.ret30} digits={1} />
                    </td>
                    <td className="px-2">
                      <div className="flex items-center justify-end gap-2">
                        <span className="num rounded-md px-1.5 text-[11px] font-bold" style={{ color: scoreColor(r.rating.score) }}>
                          {r.rating.grade}
                        </span>
                        <span className="num w-8 text-right font-bold" style={{ color: scoreColor(r.rating.score) }}>
                          {Math.round(r.rating.score)}
                        </span>
                        <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-line sm:block">
                          <div className="h-full rounded-full" style={{ width: `${r.rating.score}%`, background: scoreColor(r.rating.score) }} />
                        </div>
                      </div>
                    </td>
                    <td className="px-2 whitespace-nowrap">
                      <Badge tone={VERDICT_TONE[r.rating.verdict]}>{t(`rating.verdict.${r.rating.verdict}` as TKey)}</Badge>
                    </td>
                    {activePillars.map((p) => {
                      const v = pillarOf(r, p);
                      return (
                        <td key={p} className="px-1 py-1 text-center">
                          {v < 0 ? (
                            <span className="text-faint">—</span>
                          ) : (
                            <span className="num inline-block w-9 rounded-md py-0.5 text-[11px] font-semibold" style={{ color: scoreColor(v), background: `color-mix(in oklab, ${scoreColor(v)} 14%, transparent)` }}>
                              {Math.round(v)}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-3 text-xs whitespace-nowrap text-muted">{t(`plan.stance.${stanceOf(r.rating)}` as TKey)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="text-[11px] leading-relaxed text-faint">
        {t("ratingPage.note", { from: calibration.from, to: calibration.to, coins: calibration.coins, obs: calibration.observations })}
      </p>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={active} className={cn("rounded-md border px-2 py-1 text-xs", active ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg")}>
      {children}
    </button>
  );
}

function WeightsEditor({ weights, onChange }: { weights: PillarWeights; onChange: (w: PillarWeights) => void }) {
  const t = useT();
  const total = PILLAR_IDS.reduce((a, p) => a + (weights[p] ?? 0), 0) || 1;
  return (
    <div className="mt-3 grid gap-x-6 gap-y-2 border-t border-line pt-3 sm:grid-cols-2 lg:grid-cols-4">
      {PILLAR_IDS.map((p) => (
        <label key={p} className="flex flex-col gap-1 text-xs">
          <span className="flex justify-between text-muted">
            {t(`rating.pillar.${p}` as TKey)}
            <span className="num text-fg">{Math.round(((weights[p] ?? 0) / total) * 100)}%</span>
          </span>
          <input type="range" min={0} max={40} step={1} value={weights[p] ?? 0} onChange={(e) => onChange({ ...weights, [p]: +e.target.value })} className="accent-[var(--accent)]" />
        </label>
      ))}
      <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
        {(["balanced", "trend", "momentum", "conservative"] as const).map((p) => (
          <Button key={p} size="xs" variant="ghost" onClick={() => onChange({ ...WEIGHT_PRESETS[p] })}>
            {t(`rating.preset.${p}` as TKey)}
          </Button>
        ))}
      </div>
    </div>
  );
}
