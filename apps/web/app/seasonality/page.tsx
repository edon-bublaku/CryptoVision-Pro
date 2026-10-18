"use client";

import { seasonality, type BucketStats, type Seasonality } from "@cv/analytics";
import { baseAsset } from "@cv/core";
import { closedOnly, getKlinesDeep, universe } from "@cv/exchange";
import { useQuery } from "@tanstack/react-query";
import { CalendarRange, Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo } from "react";
import { Card, CardHeader, Empty, PageHeader, Select, Skeleton, Stat } from "@/components/ui/primitives";
import { CoinIcon } from "@/components/ui/viz";
import { useTickers } from "@/lib/data/hooks";
import { useT, type TKey } from "@/lib/i18n";
import { useSettings } from "@/lib/store/settings";
import { cn, shortDate } from "@/lib/utils";

/** About eight years of daily candles: enough for every coin's full Binance history in most cases. */
const BARS = 3000;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

const fmtPct = (v: number, d = 1) => (Number.isFinite(v) ? `${v > 0 ? "+" : ""}${v.toFixed(d)}%` : "—");

/** Green/red fill whose strength follows |ret|, saturating at `clip`%. */
function heat(ret: number, clip = 40): string {
  if (!Number.isFinite(ret)) return "transparent";
  // Capped so the cell text keeps ≥ 4.5:1 contrast in both themes.
  const k = Math.round(Math.min(1, Math.abs(ret) / clip) * 34) + 6;
  return `color-mix(in oklab, ${ret >= 0 ? "var(--bull)" : "var(--bear)"} ${k}%, var(--panel-2))`;
}

export default function SeasonalityPage() {
  return (
    <Suspense fallback={null}>
      <SeasonalityView />
    </Suspense>
  );
}

function SeasonalityView() {
  const t = useT();
  const router = useRouter();
  const raw = useSearchParams().get("symbol")?.toUpperCase() ?? "";
  const symbol = /^[A-Z0-9]{2,20}USDT$/.test(raw) ? raw : "BTCUSDT";
  const { data: tickers } = useTickers();
  const options = useMemo(() => {
    const list = tickers ? universe(tickers, 120).map((x) => x.symbol) : [];
    return list.includes(symbol) ? list : [symbol, ...list];
  }, [tickers, symbol]);

  const q = useQuery({
    queryKey: ["daily-deep", symbol, BARS],
    queryFn: async ({ signal }) => closedOnly(await getKlinesDeep(symbol, "1d", BARS, signal)),
    staleTime: 60 * 60_000,
  });
  const s = useMemo(() => (q.data ? seasonality(q.data) : null), [q.data]);

  return (
    <div className="mx-auto max-w-[1300px] space-y-5 p-4 lg:p-8">
      <PageHeader
        icon={<CalendarRange size={20} />}
        title={t("season.title")}
        subtitle={t("season.subtitle")}
        actions={
          <label className="flex items-center gap-2">
            <CoinIcon symbol={symbol} size={24} />
            <span className="sr-only">{t("common.symbol")}</span>
            <Select className="w-40" value={symbol} onChange={(e) => router.replace(`/seasonality?symbol=${e.target.value}`, { scroll: false })}>
              {options.map((o) => (
                <option key={o} value={o}>
                  {baseAsset(o)}
                </option>
              ))}
            </Select>
          </label>
        }
      />

      {q.isLoading ? (
        <div className="space-y-4">
          <p className="flex items-center gap-2 text-xs text-faint">
            <Loader2 size={12} className="animate-spin" /> {t("season.loading")}
          </p>
          <Skeleton className="h-72" />
        </div>
      ) : q.error ? (
        <p className="rounded-lg bg-bear-soft p-3 text-sm text-bear">{t("common.error")}</p>
      ) : !s ? (
        <Card>
          <Empty title={t("season.noData")} />
        </Card>
      ) : (
        <Body s={s} symbol={symbol} />
      )}
      <p className="text-[11px] leading-relaxed text-faint">{t("season.note")}</p>
    </div>
  );
}

function Body({ s, symbol }: { s: Seasonality; symbol: string }) {
  const t = useT();
  const lang = useSettings((x) => x.lang);
  const years = (s.last - s.first) / (365 * 86_400);
  return (
    <>
      <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label={t("season.history")} value={`${years.toFixed(1)} ${t("season.years")}`} sub={`${shortDate(s.first, lang, true)} → ${shortDate(s.last, lang, true)}`} />
        <Stat label={t("season.upDays")} value={`${(s.daily.upDays * 100).toFixed(1)}%`} />
        <Stat label={t("season.vol")} value={`${(s.daily.stdev * Math.sqrt(365)).toFixed(0)}%`} sub={`σ ${s.daily.stdev.toFixed(2)}% / ${t("season.day")}`} />
        <Stat label={t("season.best")} value={fmtPct(s.daily.best?.ret ?? NaN)} tone="bull" sub={s.daily.best ? shortDate(s.daily.best.time, lang, true) : undefined} />
        <Stat label={t("season.worst")} value={fmtPct(s.daily.worst?.ret ?? NaN)} tone="bear" sub={s.daily.worst ? shortDate(s.daily.worst.time, lang, true) : undefined} />
        <Stat label={t("season.streaks")} value={`${s.streaks.up} / ${s.streaks.down}`} sub={t("season.streaksSub")} />
      </Card>

      <Card>
        <CardHeader title={t("season.heatmap", { coin: baseAsset(symbol) })} subtitle={t("season.heatmapSub")} />
        <MonthHeatmap s={s} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("season.weekday")} subtitle={t("season.weekdaySub")} />
          <BucketBars rows={s.byWeekday} labels={WEEKDAYS.map((w) => t(`journal.wd.${w}` as TKey))} digits={2} />
        </Card>
        <Card>
          <CardHeader title={t("season.distribution")} subtitle={t("season.distributionSub")} />
          <Histogram s={s} />
        </Card>
      </div>

      <Card>
        <CardHeader title={t("season.drawdowns")} subtitle={t("season.drawdownsSub")} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-[11px] tracking-wide text-muted uppercase">
                <th scope="col" className="px-4 py-2 text-left font-medium">{t("season.dd.peak")}</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">{t("season.dd.trough")}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{t("season.dd.depth")}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{t("season.dd.fall")}</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">{t("season.dd.recovery")}</th>
              </tr>
            </thead>
            <tbody>
              {s.drawdowns.map((d) => (
                <tr key={d.peakTime} className="border-b border-line/50">
                  <td className="num px-4 py-2 text-xs">{shortDate(d.peakTime, lang, true)}</td>
                  <td className="num px-3 py-2 text-xs">{shortDate(d.troughTime, lang, true)}</td>
                  <td className="num px-3 py-2 text-right text-xs font-semibold text-bear">{d.depth.toFixed(1)}%</td>
                  <td className="num px-3 py-2 text-right text-xs">{t("season.days", { n: d.fallDays })}</td>
                  <td className="num px-4 py-2 text-right text-xs">
                    {d.recoveryTime ? t("season.days", { n: d.recoveryDays }) : <span className="text-warn">{t("season.notRecovered", { n: d.recoveryDays })}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function MonthHeatmap({ s }: { s: Seasonality }) {
  const t = useT();
  const cell = (year: number, month: number) => s.months.find((m) => m.year === year && m.month === month);
  const footer: [TKey, (b: BucketStats) => string][] = [
    ["season.avg", (b) => fmtPct(b.mean)],
    ["season.median", (b) => fmtPct(b.median)],
    ["season.positive", (b) => (b.count ? `${Math.round(b.positive * 100)}%` : "—")],
  ];
  return (
    <div className="overflow-x-auto px-4 pb-4">
      <table className="w-full min-w-[760px] border-separate border-spacing-[3px] text-[11px]">
        <thead>
          <tr className="text-muted">
            <th scope="col" className="w-14 text-left font-medium">{t("season.year")}</th>
            {MONTHS.map((m) => (
              <th scope="col" key={m} className="font-medium">
                {t(`season.m.${m}` as TKey)}
              </th>
            ))}
            <th scope="col" className="font-semibold">{t("season.total")}</th>
          </tr>
        </thead>
        <tbody>
          {[...s.byYear].reverse().map((y) => (
            <tr key={y.year}>
              <th scope="row" className="num text-left font-semibold text-muted">
                {y.year}
              </th>
              {MONTHS.map((_, m) => {
                const c = cell(y.year, m);
                return (
                  <td key={m} className={cn("num h-8 rounded text-center", c?.partial && "italic opacity-60")} style={{ background: c ? heat(c.ret) : "transparent" }} title={c?.partial ? t("season.partial") : undefined}>
                    {c ? fmtPct(c.ret, Math.abs(c.ret) >= 100 ? 0 : 1) : ""}
                  </td>
                );
              })}
              <td className={cn("num h-8 rounded text-center font-semibold", y.partial && "italic opacity-60")} style={{ background: heat(y.ret, 150) }}>
                {fmtPct(y.ret, 0)}
              </td>
            </tr>
          ))}
          {footer.map(([key, f]) => (
            <tr key={key} className="text-muted">
              <th scope="row" className="pt-1 text-left font-medium">
                {t(key)}
              </th>
              {s.byMonth.map((b, m) => (
                <td key={m} className={cn("num pt-1 text-center", key === "season.avg" && (b.mean >= 0 ? "text-bull" : "text-bear"))}>
                  {f(b)}
                </td>
              ))}
              <td />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BucketBars({ rows, labels, digits }: { rows: BucketStats[]; labels: string[]; digits: number }) {
  const max = Math.max(...rows.map((r) => Math.abs(r.mean)).filter(Number.isFinite), 1e-9);
  return (
    <div className="space-y-1.5 px-4 pb-4">
      {rows.map((r, k) => (
        <div key={k} className="grid grid-cols-[44px_1fr_64px_44px] items-center gap-2 text-xs">
          <span className="text-muted">{labels[k]}</span>
          <div className="relative h-3 rounded bg-panel-2">
            <div className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
            <div
              className={cn("absolute inset-y-0 rounded", r.mean >= 0 ? "bg-bull" : "bg-bear")}
              style={r.mean >= 0 ? { left: "50%", width: `${(r.mean / max) * 50}%` } : { right: "50%", width: `${(-r.mean / max) * 50}%` }}
            />
          </div>
          <span className={cn("num text-right font-semibold", r.mean >= 0 ? "text-bull" : "text-bear")}>{fmtPct(r.mean, digits)}</span>
          <span className="num text-right text-faint">{Number.isFinite(r.positive) ? `${Math.round(r.positive * 100)}%` : "—"}</span>
        </div>
      ))}
    </div>
  );
}

function Histogram({ s }: { s: Seasonality }) {
  const max = Math.max(...s.histogram.map((b) => b.count), 1);
  return (
    <div className="px-4 pb-4">
      <div className="flex h-40 items-end gap-0.5">
        {s.histogram.map((b) => (
          <div
            key={b.from}
            className={cn("flex-1 rounded-t", b.to <= 0 ? "bg-bear" : b.from >= 0 ? "bg-bull" : "bg-muted")}
            style={{ height: `${Math.max(1, (b.count / max) * 100)}%`, opacity: 0.85 }}
            title={`${b.from.toFixed(1)}% … ${b.to.toFixed(1)}%: ${b.count}`}
          />
        ))}
      </div>
      <div className="num mt-1 flex justify-between text-[10px] text-faint">
        <span>≤ {s.histogram[0]!.to.toFixed(0)}%</span>
        <span>0%</span>
        <span>≥ {s.histogram[s.histogram.length - 1]!.from.toFixed(0)}%</span>
      </div>
    </div>
  );
}
