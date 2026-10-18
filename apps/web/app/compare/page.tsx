"use client";

import { alignCloses, assetStats, correlationMatrix, type AssetStats } from "@cv/analytics";
import { baseAsset, formatPrice } from "@cv/core";
import { universe } from "@cv/exchange";
import { PILLAR_IDS, rateAt, type PillarId, type Rating } from "@cv/rating";
import { CandlestickChart, GitCompareArrows, Loader2, Plus, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { scoreColor, VERDICT_TONE } from "@/components/rating/rating-view";
import { Badge, Card, CardHeader, Empty, PageHeader, Segmented, Select, Skeleton } from "@/components/ui/primitives";
import { CoinIcon, Pct } from "@/components/ui/viz";
import { useTickers } from "@/lib/data/hooks";
import { BENCH, useContextsFor } from "@/lib/data/rating";
import { useT, type TKey } from "@/lib/i18n";
import { activeRatingWeights, useSettings } from "@/lib/store/settings";
import { cn, shortDate } from "@/lib/utils";

const MAX = 4;
const DEFAULT = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
/** One colour per slot, stable while coins are added or removed elsewhere. */
const COLORS = ["var(--accent)", "var(--accent-2)", "var(--warn)", "#f472b6"];
const PERIODS = [30, 90, 180, 365] as const;
type Period = (typeof PERIODS)[number];

interface Entry {
  symbol: string;
  color: string;
  rating: Rating | null;
  stats: AssetStats | undefined;
}

export default function ComparePage() {
  return (
    <Suspense fallback={null}>
      <Compare />
    </Suspense>
  );
}

function parse(raw: string | null): string[] {
  const list = (raw ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z0-9]{2,20}USDT$/.test(s));
  const unique = [...new Set(list)].slice(0, MAX);
  return unique.length ? unique : DEFAULT;
}

function Compare() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const symbols = useMemo(() => parse(params.get("s")), [params]);
  const [period, setPeriod] = useState<Period>(90);
  const s = useSettings();
  const weights = activeRatingWeights(s);
  const { data: tickers } = useTickers();
  const { contexts, loaded, total, errors } = useContextsFor(symbols);

  const setSymbols = (next: string[]) => router.replace(`/compare?s=${next.join(",")}`, { scroll: false });
  const options = useMemo(() => (tickers ? universe(tickers, 150).filter((x) => !symbols.includes(x.symbol)) : []), [tickers, symbols]);

  const view = useMemo(() => {
    if (!contexts.some((c) => c.symbol === BENCH)) return null;
    const aligned = alignCloses(contexts.map((c) => ({ symbol: c.symbol, candles: c.ctx.candles })));
    const stats = assetStats(aligned, BENCH);
    const entries: Entry[] = symbols.map((sym, k) => {
      const ctx = contexts.find((c) => c.symbol === sym)?.ctx;
      return { symbol: sym, color: COLORS[k]!, rating: ctx ? rateAt(ctx, undefined, weights) : null, stats: stats.find((x) => x.symbol === sym) };
    });
    const present = symbols.filter((sym) => aligned.closes[sym]);
    return { aligned, entries, present, corr: correlationMatrix(aligned.closes, present, 90) };
  }, [contexts, symbols, weights]);

  const loading = loaded < total;
  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 lg:p-8">
      <PageHeader icon={<GitCompareArrows size={20} />} title={t("compare.title")} subtitle={t("compare.subtitle")} />

      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          {symbols.map((sym, k) => (
            <span key={sym} className="inline-flex items-center gap-2 rounded-xl border border-line bg-panel-2 py-1 pr-1 pl-2 text-sm font-semibold">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS[k] }} aria-hidden />
              <CoinIcon symbol={sym} size={18} />
              {baseAsset(sym)}
              <button
                className="rounded-md p-1 text-faint hover:bg-panel-2 hover:text-fg disabled:opacity-30"
                onClick={() => setSymbols(symbols.filter((x) => x !== sym))}
                disabled={symbols.length <= 2}
                aria-label={t("compare.remove", { coin: baseAsset(sym) })}
              >
                <X size={13} />
              </button>
            </span>
          ))}
          {symbols.length < MAX && (
            <label className="relative inline-flex items-center">
              <Plus size={14} className="pointer-events-none absolute left-2.5 text-faint" />
              <span className="sr-only">{t("compare.add")}</span>
              <Select className="h-9 w-44 pl-8" value="" onChange={(e) => e.target.value && setSymbols([...symbols, e.target.value])}>
                <option value="">{t("compare.add")}</option>
                {options.map((o) => (
                  <option key={o.symbol} value={o.symbol}>
                    {baseAsset(o.symbol)}
                  </option>
                ))}
              </Select>
            </label>
          )}
          <span className="ml-auto text-[11px] text-faint">{t("compare.hint", { max: MAX })}</span>
        </div>
      </Card>

      {errors > 0 && <p className="rounded-lg bg-bear-soft p-3 text-sm text-bear">{t("common.error")}</p>}

      {!view ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {symbols.map((sym) => (
            <Skeleton key={sym} className="h-40" />
          ))}
        </div>
      ) : (
        <>
          <div className={cn("grid grid-cols-2 gap-3", symbols.length >= 3 && "xl:grid-cols-4", symbols.length === 3 && "lg:grid-cols-3")}>
            {view.entries.map((e) => (
              <CoinCard key={e.symbol} entry={e} />
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <Card>
              <CardHeader title={t("compare.radar")} subtitle={t("compare.radarSub")} />
              <Radar entries={view.entries} pillars={PILLAR_IDS.filter((p) => (weights[p] ?? 0) > 0)} />
            </Card>
            <Card>
              <CardHeader
                title={t("compare.perf")}
                subtitle={t("compare.perfSub")}
                right={<Segmented size="xs" value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ value: p, label: p === 365 ? "1Y" : `${p}D` }))} />}
              />
              <Performance times={view.aligned.times} closes={view.aligned.closes} entries={view.entries.filter((e) => view.present.includes(e.symbol))} period={period} />
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
            <Card>
              <CardHeader title={t("compare.table")} subtitle={t("compare.tableSub")} />
              <MetricTable entries={view.entries} pillars={PILLAR_IDS.filter((p) => (weights[p] ?? 0) > 0)} />
            </Card>
            <Card>
              <CardHeader title={t("markets.corr")} subtitle={t("compare.corrSub")} />
              <Correlation symbols={view.present} matrix={view.corr} />
              <Highlights entries={view.entries} />
            </Card>
          </div>
        </>
      )}
      {loading && view && (
        <p className="flex items-center gap-2 text-xs text-faint">
          <Loader2 size={12} className="animate-spin" /> {t("common.loading")} {loaded}/{total}
        </p>
      )}
      <p className="text-[11px] leading-relaxed text-faint">{t("compare.note")}</p>
    </div>
  );
}

function CoinCard({ entry: e }: { entry: Entry }) {
  const t = useT();
  const r = e.rating;
  return (
    <Card className="relative overflow-hidden p-3 sm:p-4">
      <span className="absolute inset-x-0 top-0 h-0.5" style={{ background: e.color }} aria-hidden />
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <CoinIcon symbol={e.symbol} size={30} />
          <div className="min-w-0">
            <div className="truncate font-semibold">{baseAsset(e.symbol)}</div>
            <div className="num text-xs text-muted">{e.stats ? formatPrice(e.stats.last) : "—"}</div>
          </div>
        </div>
        <Link href={`/chart?symbol=${e.symbol}`} className="rounded-lg p-1.5 text-faint hover:bg-panel-2 hover:text-accent" aria-label={t("compare.openChart", { coin: baseAsset(e.symbol) })}>
          <CandlestickChart size={16} />
        </Link>
      </div>
      {r ? (
        <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="text-[10px] tracking-wide text-faint uppercase">CV Rating</div>
            <div className="num text-3xl leading-none font-bold" style={{ color: scoreColor(r.score) }}>
              {Math.round(r.score)}
              <span className="ml-1.5 text-base">{r.grade}</span>
            </div>
          </div>
          <Badge tone={VERDICT_TONE[r.verdict]}>{t(`rating.verdict.${r.verdict}` as TKey)}</Badge>
        </div>
      ) : (
        <p className="mt-3 text-xs text-faint">{t("compare.noRating")}</p>
      )}
      {e.stats && (
        <div className="mt-3 grid grid-cols-3 gap-1 border-t border-line pt-3 text-center text-[10px] sm:gap-2 sm:text-[11px]">
          <div>
            <div className="text-faint">7d</div>
            <Pct value={e.stats.ret7d} digits={1} />
          </div>
          <div>
            <div className="text-faint">30d</div>
            <Pct value={e.stats.ret30d} digits={1} />
          </div>
          <div>
            <div className="text-faint">90d</div>
            <Pct value={e.stats.ret90d} digits={1} />
          </div>
        </div>
      )}
    </Card>
  );
}

/** Spider chart of the pillar scores; one polygon per coin on a shared 0–100 scale. */
function Radar({ entries, pillars }: { entries: Entry[]; pillars: PillarId[] }) {
  const t = useT();
  const [focus, setFocus] = useState<string | null>(null);
  const R = 105;
  const n = pillars.length;
  const at = (k: number, v: number): [number, number] => {
    const a = -Math.PI / 2 + (k * 2 * Math.PI) / n;
    return [Math.cos(a) * (R * v) / 100, Math.sin(a) * (R * v) / 100];
  };
  const ring = (v: number) => pillars.map((_, k) => at(k, v).join(",")).join(" ");
  if (n < 3) return <Empty title={t("compare.radarEmpty")} />;
  return (
    <div className="px-2 pb-4">
      <svg viewBox="-215 -145 430 290" className="mx-auto block w-full max-w-[460px]" role="img" aria-label={t("compare.radar")}>
        {[25, 50, 75, 100].map((v) => (
          <polygon key={v} points={ring(v)} fill="none" stroke="var(--line-strong)" strokeWidth={v === 50 ? 1 : 0.6} strokeDasharray={v === 50 ? "3 3" : undefined} />
        ))}
        {pillars.map((p, k) => {
          const [x, y] = at(k, 100);
          const [lx, ly] = at(k, 118);
          const anchor = Math.abs(lx) < 8 ? "middle" : lx > 0 ? "start" : "end";
          return (
            <g key={p}>
              <line x1={0} y1={0} x2={x} y2={y} stroke="var(--line)" />
              <text x={lx} y={ly} dy="0.35em" textAnchor={anchor} fontSize={12} fill="var(--muted)">
                {t(`rating.pillar.${p}` as TKey)}
              </text>
            </g>
          );
        })}
        {entries.map((e) => {
          if (!e.rating) return null;
          const pts = pillars.map((p, k) => at(k, e.rating!.pillars.find((x) => x.id === p)?.score ?? 0).join(",")).join(" ");
          const dim = focus && focus !== e.symbol;
          return (
            <polygon
              key={e.symbol}
              points={pts}
              fill={e.color}
              fillOpacity={dim ? 0.03 : focus ? 0.22 : 0.1}
              stroke={e.color}
              strokeOpacity={dim ? 0.25 : 1}
              strokeWidth={focus === e.symbol ? 2.2 : 1.5}
              strokeLinejoin="round"
              className="transition-[fill-opacity,stroke-opacity]"
            />
          );
        })}
      </svg>
      <Legend entries={entries} focus={focus} onFocus={setFocus} value={(e) => (e.rating ? Math.round(e.rating.score).toString() : "—")} />
    </div>
  );
}

function Legend({ entries, focus, onFocus, value }: { entries: Entry[]; focus: string | null; onFocus: (s: string | null) => void; value: (e: Entry) => React.ReactNode }) {
  return (
    <div className="mt-2 flex flex-wrap justify-center gap-1.5">
      {entries.map((e) => (
        <button
          key={e.symbol}
          className={cn("inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs", focus === e.symbol ? "border-line-strong bg-panel-2" : "border-transparent hover:bg-panel-2")}
          onMouseEnter={() => onFocus(e.symbol)}
          onMouseLeave={() => onFocus(null)}
          onFocus={() => onFocus(e.symbol)}
          onBlur={() => onFocus(null)}
        >
          <span className="h-2 w-2 rounded-full" style={{ background: e.color }} aria-hidden />
          <span className="font-semibold">{baseAsset(e.symbol)}</span>
          <span className="num text-muted">{value(e)}</span>
        </button>
      ))}
    </div>
  );
}

/** Closes rebased to 0% at the start of the window, with a hover read-out. */
function Performance({ times, closes, entries, period }: { times: number[]; closes: Record<string, number[]>; entries: Entry[]; period: Period }) {
  const t = useT();
  const lang = useSettings((s) => s.lang);
  const [hover, setHover] = useState<number | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const start = Math.max(0, times.length - 1 - period);
  const win = times.slice(start);
  const series = entries.map((e) => {
    const c = (closes[e.symbol] ?? []).slice(start);
    const base = c[0] ?? NaN;
    return { e, pct: c.map((v) => (v / base - 1) * 100) };
  });
  const all = series.flatMap((s) => s.pct).filter(Number.isFinite);
  if (win.length < 2 || !all.length) return <Empty title={t("compare.noHistory")} />;
  const lo = Math.min(0, ...all);
  const hi = Math.max(0, ...all);
  const pad = (hi - lo) * 0.08 || 1;
  const y0 = lo - pad;
  const y1 = hi + pad;
  const W = 1000;
  const H = 300;
  const x = (i: number) => (i / (win.length - 1)) * W;
  const y = (v: number) => H - ((v - y0) / (y1 - y0)) * H;
  const ticks = niceTicks(y0, y1, 5);
  const idx = hover ?? win.length - 1;
  const date = (sec: number) => shortDate(sec, lang, period === 365);
  const fmtPct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

  return (
    <div className="px-4 pb-4">
      <div className="relative h-[240px] sm:h-[300px]">
        <div className="absolute inset-y-0 right-0 left-11">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="h-full w-full touch-none overflow-visible"
            onPointerMove={(ev) => {
              const box = ev.currentTarget.getBoundingClientRect();
              setHover(Math.max(0, Math.min(win.length - 1, Math.round(((ev.clientX - box.left) / box.width) * (win.length - 1)))));
            }}
            onPointerLeave={() => setHover(null)}
            role="img"
            aria-label={t("compare.perf")}
          >
            {ticks.map((v) => (
              <line key={v} x1={0} x2={W} y1={y(v)} y2={y(v)} stroke={v === 0 ? "var(--line-strong)" : "var(--line)"} vectorEffect="non-scaling-stroke" strokeDasharray={v === 0 ? undefined : "4 4"} />
            ))}
            {series.map(({ e, pct }) => (
              <path
                key={e.symbol}
                d={pct.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(Number.isFinite(v) ? v : 0).toFixed(1)}`).join("")}
                fill="none"
                stroke={e.color}
                strokeWidth={focus === e.symbol ? 2.6 : 1.7}
                strokeOpacity={focus && focus !== e.symbol ? 0.25 : 1}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
              />
            ))}
            {hover !== null && <line x1={x(idx)} x2={x(idx)} y1={0} y2={H} stroke="var(--muted)" strokeOpacity={0.5} vectorEffect="non-scaling-stroke" />}
          </svg>
          {hover !== null && (
            <div
              className="pointer-events-none absolute top-1 z-10 min-w-32 rounded-lg border border-line bg-panel-solid/95 p-2 text-[11px] shadow-lg"
              style={{ left: `${(idx / (win.length - 1)) * 100}%`, transform: `translateX(${idx > win.length / 2 ? "calc(-100% - 8px)" : "8px"})` }}
            >
              <div className="mb-1 text-faint">{date(win[idx]!)}</div>
              {series.map(({ e, pct }) => (
                <div key={e.symbol} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: e.color }} />
                    {baseAsset(e.symbol)}
                  </span>
                  <span className={cn("num font-semibold", (pct[idx] ?? 0) >= 0 ? "text-bull" : "text-bear")}>{fmtPct(pct[idx] ?? NaN)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="pointer-events-none absolute inset-y-0 left-0 w-10">
          {ticks.map((v) => (
            <span key={v} className="num absolute right-0 -translate-y-1/2 text-[10px] text-faint" style={{ top: `${(y(v) / H) * 100}%` }}>
              {v > 0 ? "+" : ""}
              {Math.abs(v) >= 100 ? v.toFixed(0) : Number(v.toFixed(1))}%
            </span>
          ))}
        </div>
      </div>
      <div className="mt-1 flex justify-between pl-11 text-[10px] text-faint">
        <span>{date(win[0]!)}</span>
        <span>{date(win[win.length - 1]!)}</span>
      </div>
      <Legend
        entries={series.map((s) => s.e)}
        focus={focus}
        onFocus={setFocus}
        value={(e) => {
          const p = series.find((s) => s.e.symbol === e.symbol)?.pct ?? [];
          const v = p[p.length - 1] ?? NaN;
          return <span className={v >= 0 ? "text-bull" : "text-bear"}>{fmtPct(v)}</span>;
        }}
      />
    </div>
  );
}

function niceTicks(lo: number, hi: number, count: number): number[] {
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

interface Row {
  key: string;
  label: string;
  value: (e: Entry) => number;
  format: (v: number) => React.ReactNode;
  /** 1: higher is better, -1: lower is better, 0: informational only. */
  better: 1 | -1 | 0;
  section?: string;
}

function MetricTable({ entries, pillars }: { entries: Entry[]; pillars: PillarId[] }) {
  const t = useT();
  const num = (d: number) => (v: number) => (Number.isFinite(v) ? v.toFixed(d) : "—");
  const score = (v: number) => (Number.isFinite(v) ? <span style={{ color: scoreColor(v) }}>{Math.round(v)}</span> : "—");
  const pct = (v: number) => (Number.isFinite(v) ? <Pct value={v} digits={1} /> : "—");
  const st = (k: keyof AssetStats) => (e: Entry) => (e.stats ? (e.stats[k] as number) : NaN);
  const rows: Row[] = [
    { key: "score", label: "CV Rating", value: (e) => e.rating?.score ?? NaN, format: score, better: 1, section: t("compare.sec.rating") },
    { key: "conf", label: t("rating.confidence"), value: (e) => (e.rating ? e.rating.confidence * 100 : NaN), format: (v) => (Number.isFinite(v) ? `${Math.round(v)}%` : "—"), better: 1 },
    ...pillars.map<Row>((p) => ({ key: p, label: t(`rating.pillar.${p}` as TKey), value: (e) => e.rating?.pillars.find((x) => x.id === p)?.score ?? NaN, format: score, better: 1 })),
    { key: "ret7d", label: t("compare.ret", { d: 7 }), value: st("ret7d"), format: pct, better: 1, section: t("compare.sec.perf") },
    { key: "ret30d", label: t("compare.ret", { d: 30 }), value: st("ret30d"), format: pct, better: 1 },
    { key: "ret90d", label: t("compare.ret", { d: 90 }), value: st("ret90d"), format: pct, better: 1 },
    { key: "riskAdjusted", label: t("markets.col.riskAdj"), value: st("riskAdjusted"), format: num(2), better: 1 },
    { key: "vol30d", label: t("markets.col.vol"), value: st("vol30d"), format: (v) => (Number.isFinite(v) ? `${v.toFixed(0)}%` : "—"), better: -1, section: t("compare.sec.risk") },
    { key: "maxDd90d", label: t("markets.col.dd"), value: st("maxDd90d"), format: (v) => (Number.isFinite(v) ? <span className="text-bear">{v.toFixed(1)}%</span> : "—"), better: 1 },
    { key: "beta", label: t("markets.col.beta"), value: st("beta"), format: num(2), better: 0 },
    { key: "corrBench", label: t("markets.col.corr"), value: st("corrBench"), format: num(2), better: 0 },
  ];
  return (
    <div className="overflow-x-auto pb-2">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-[11px] tracking-wide text-muted uppercase">
            <th scope="col" className="sticky left-0 z-[1] bg-panel-solid px-4 py-2 text-left font-medium">{t("compare.metric")}</th>
            {entries.map((e) => (
              <th scope="col" key={e.symbol} className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: e.color }} aria-hidden />
                  {baseAsset(e.symbol)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const vals = entries.map(row.value);
            const finite = vals.filter(Number.isFinite);
            const tied = finite.every((v) => v === finite[0]);
            const best = row.better && finite.length > 1 && !tied ? (row.better === 1 ? Math.max(...finite) : Math.min(...finite)) : NaN;
            return [
              row.section && (
                <tr key={`${row.key}-section`}>
                  <td colSpan={entries.length + 1} className="sticky left-0 px-4 pt-3 pb-1 text-[10px] font-semibold tracking-wider text-faint uppercase">
                    {row.section}
                  </td>
                </tr>
              ),
              <tr key={row.key} className="border-b border-line/50 hover:bg-panel-2">
                <td className="sticky left-0 z-[1] bg-panel-solid px-4 py-1.5 text-xs whitespace-nowrap text-muted">{row.label}</td>
                {vals.map((v, k) => (
                  <td key={entries[k]!.symbol} className={cn("num px-3 py-1.5 text-right text-xs", v === best && "font-bold")}>
                    <span className={cn("inline-block rounded-md px-1.5 py-0.5", v === best && "bg-accent-soft")}>{row.format(v)}</span>
                  </td>
                ))}
              </tr>,
            ];
          })}
        </tbody>
      </table>
      <p className="px-4 pt-2 text-[10px] text-faint">{t("compare.bestHint")}</p>
    </div>
  );
}

function Correlation({ symbols, matrix }: { symbols: string[]; matrix: number[][] }) {
  const color = (v: number) =>
    v >= 0 ? `color-mix(in oklab, var(--accent) ${Math.round(v * 80)}%, var(--panel-2))` : `color-mix(in oklab, var(--bear) ${Math.round(-v * 80)}%, var(--panel-2))`;
  return (
    <div className="px-4 pb-3">
      <div className="grid gap-1 text-[11px]" style={{ gridTemplateColumns: `52px repeat(${symbols.length}, minmax(0, 1fr))` }}>
        <div />
        {symbols.map((s) => (
          <div key={s} className="truncate text-center font-semibold text-muted">
            {baseAsset(s)}
          </div>
        ))}
        {symbols.map((row, i) => (
          <div key={row} className="contents">
            <div className="truncate pr-1 text-right leading-9 font-semibold text-muted">{baseAsset(row)}</div>
            {symbols.map((col, j) => (
              <div key={col} className="num flex h-9 items-center justify-center rounded-md" style={{ background: i === j ? "var(--panel-2)" : color(matrix[i]?.[j] ?? 0) }} title={`${baseAsset(row)} / ${baseAsset(col)}`}>
                {i === j ? "—" : (matrix[i]?.[j] ?? NaN).toFixed(2)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Plain-language summary: who leads each dimension. Facts only, no advice. */
function Highlights({ entries }: { entries: Entry[] }) {
  const t = useT();
  const pick = (f: (e: Entry) => number, dir: 1 | -1) => {
    const ok = entries.filter((e) => Number.isFinite(f(e)));
    return ok.length > 1 ? ok.reduce((a, b) => ((f(b) - f(a)) * dir > 0 ? b : a)) : null;
  };
  const items: [TKey, Entry | null][] = [
    ["compare.hl.rating", pick((e) => e.rating?.score ?? NaN, 1)],
    ["compare.hl.momentum", pick((e) => e.stats?.ret30d ?? NaN, 1)],
    ["compare.hl.efficiency", pick((e) => e.stats?.riskAdjusted ?? NaN, 1)],
    ["compare.hl.calm", pick((e) => e.stats?.vol30d ?? NaN, -1)],
  ];
  return (
    <div className="space-y-1.5 border-t border-line px-4 py-3">
      {items.map(([key, e]) =>
        e ? (
          <div key={key} className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted">{t(key)}</span>
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <span className="h-2 w-2 rounded-full" style={{ background: e.color }} aria-hidden />
              {baseAsset(e.symbol)}
            </span>
          </div>
        ) : null,
      )}
    </div>
  );
}
