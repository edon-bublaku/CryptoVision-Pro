"use client";

import { alignCloses, assetStats, clusterOrder, correlationMatrix, type AssetStats, type Quadrant } from "@cv/analytics";
import { baseAsset, formatPrice, mean, median } from "@cv/core";
import { closedOnly, getKlines, mapLimit, universe } from "@cv/exchange";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Loader2, Orbit } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Card, CardHeader, Empty, PageHeader, Segmented, Skeleton, Stat } from "@/components/ui/primitives";
import { CoinIcon, Pct } from "@/components/ui/viz";
import { useTickers } from "@/lib/data/hooks";
import { useT, type TKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const BENCH = "BTCUSDT";

const QUADRANT_COLOR: Record<Quadrant, string> = {
  leading: "var(--bull)",
  weakening: "var(--warn)",
  lagging: "var(--bear)",
  improving: "var(--accent)",
};

/** Daily candles for the top coins by volume (always including the BTC benchmark). */
function useMarketData(size: number) {
  const { data: tickers } = useTickers();
  const symbols = useMemo(() => {
    if (!tickers) return [];
    const top = universe(tickers, size).map((x) => x.symbol);
    return top.includes(BENCH) ? top : [BENCH, ...top.slice(0, size - 1)];
  }, [tickers, size]);
  return useQuery({
    queryKey: ["markets", symbols],
    enabled: symbols.length > 1,
    staleTime: 10 * 60_000,
    queryFn: async ({ signal }) => {
      const res = await mapLimit(symbols, 4, async (s) => ({ symbol: s, candles: closedOnly(await getKlines(s, "1d", 400, undefined, signal)) }));
      // Coins listed recently would shrink the common window for everyone; keep those with ≥ 200 days.
      const ok = res.filter((r): r is { symbol: string; candles: ReturnType<typeof closedOnly> } => !(r instanceof Error) && r.candles.length >= 200);
      return alignCloses(ok);
    },
  });
}

export default function MarketsPage() {
  const t = useT();
  const [size, setSize] = useState(15);
  const [lookback, setLookback] = useState(90);
  const { data, isLoading, error } = useMarketData(size);

  const view = useMemo(() => {
    if (!data || !data.times.length) return null;
    const stats = assetStats(data, BENCH, lookback);
    const symbols = stats.map((s) => s.symbol);
    const matrix = correlationMatrix(data.closes, symbols, lookback);
    const order = clusterOrder(symbols, matrix);
    const alts = stats.filter((s) => s.symbol !== BENCH);
    return {
      stats,
      symbols: order.map((i) => symbols[i]!),
      matrix: order.map((i) => order.map((j) => matrix[i]![j]!)),
      avgCorr: mean(alts.map((s) => s.corrBench)),
      medianVol: median(stats.map((s) => s.vol30d)),
      leading: alts.filter((s) => s.quadrant === "leading").length / Math.max(1, alts.length),
      dispersion: Math.sqrt(mean(alts.map((s) => (s.ret30d - mean(alts.map((x) => x.ret30d))) ** 2))),
      days: data.times.length,
    };
  }, [data, lookback]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 lg:p-8">
      <PageHeader
        icon={<Orbit size={20} />}
        title={t("markets.title")}
        subtitle={t("markets.subtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented value={size} onChange={setSize} options={[10, 15, 20].map((v) => ({ value: v, label: `${v} coin` }))} />
            <Segmented value={lookback} onChange={setLookback} options={[30, 90, 180].map((v) => ({ value: v, label: `${v}d` }))} />
          </div>
        }
      />

      {error ? (
        <Empty title={t("common.error")} />
      ) : isLoading || !view ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-[420px]" />
          <Skeleton className="h-[420px]" />
          <div className="col-span-full flex items-center justify-center gap-2 text-sm text-muted">
            <Loader2 size={14} className="animate-spin" /> {t("markets.loading")}
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t("markets.avgCorr")} value={view.avgCorr.toFixed(2)} sub={t("markets.avgCorrSub")} />
            <Stat label={t("markets.leadingShare")} value={`${Math.round(view.leading * 100)}%`} sub={t("markets.leadingShareSub")} tone={view.leading >= 0.5 ? "bull" : "neutral"} />
            <Stat label={t("markets.medianVol")} value={`${view.medianVol.toFixed(0)}%`} sub={t("markets.medianVolSub")} />
            <Stat label={t("markets.dispersion")} value={`${view.dispersion.toFixed(1)}%`} sub={t("markets.dispersionSub")} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader title={t("markets.rrg")} subtitle={t("markets.rrgSub")} />
              <RrgChart stats={view.stats.filter((s) => s.rrg.length)} />
            </Card>
            <Card>
              <CardHeader title={t("markets.corr")} subtitle={t("markets.corrSub", { days: lookback })} />
              <CorrelationHeatmap symbols={view.symbols} matrix={view.matrix} />
            </Card>
          </div>

          <Card>
            <CardHeader title={t("markets.table")} subtitle={t("markets.tableSub")} />
            <StatsTable stats={view.stats} />
          </Card>
          <p className="text-[11px] leading-relaxed text-faint">{t("markets.note", { days: view.days })}</p>
        </>
      )}
    </div>
  );
}

function RrgChart({ stats }: { stats: AssetStats[] }) {
  const t = useT();
  const [hover, setHover] = useState<string | null>(null);
  const W = 560;
  const H = 420;
  const pad = 28;
  // Symmetric around 100 so the quadrants keep equal area; scaled to the latest points (90th
  // percentile) so one outlier doesn't squash everyone else. Older trail points are clamped.
  const dev = stats.flatMap((s) => s.rrg.slice(-1)).flatMap((p) => [Math.abs(p.ratio - 100), Math.abs(p.momentum - 100)]).sort((a, b) => a - b);
  const span = Math.max(0.5, dev[Math.floor((dev.length - 1) * 0.9)] ?? 1) * 1.25;
  const clampV = (v: number) => Math.min(100 + span, Math.max(100 - span, v));
  const x = (v: number) => pad + ((clampV(v) - (100 - span)) / (2 * span)) * (W - 2 * pad);
  const y = (v: number) => H - pad - ((clampV(v) - (100 - span)) / (2 * span)) * (H - 2 * pad);
  const cx = x(100);
  const cy = y(100);
  const quads: { q: Quadrant; x: number; y: number; w: number; h: number; lx: number; ly: number; anchor: "start" | "end" }[] = [
    { q: "improving", x: pad, y: pad, w: cx - pad, h: cy - pad, lx: pad + 8, ly: pad + 16, anchor: "start" },
    { q: "leading", x: cx, y: pad, w: W - pad - cx, h: cy - pad, lx: W - pad - 8, ly: pad + 16, anchor: "end" },
    { q: "lagging", x: pad, y: cy, w: cx - pad, h: H - pad - cy, lx: pad + 8, ly: H - pad - 8, anchor: "start" },
    { q: "weakening", x: cx, y: cy, w: W - pad - cx, h: H - pad - cy, lx: W - pad - 8, ly: H - pad - 8, anchor: "end" },
  ];
  return (
    <div className="px-2 pb-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full select-none" role="img" aria-label={t("markets.rrg")}>
        {quads.map((q) => (
          <g key={q.q}>
            <rect x={q.x} y={q.y} width={q.w} height={q.h} fill={QUADRANT_COLOR[q.q]} opacity={0.06} />
            <text x={q.lx} y={q.ly} textAnchor={q.anchor} fontSize={11} fontWeight={600} fill={QUADRANT_COLOR[q.q]} opacity={0.9}>
              {t(`markets.q.${q.q}` as TKey)}
            </text>
          </g>
        ))}
        <line x1={cx} x2={cx} y1={pad} y2={H - pad} stroke="var(--line-strong)" />
        <line x1={pad} x2={W - pad} y1={cy} y2={cy} stroke="var(--line-strong)" />
        <text x={W - pad} y={cy - 6} textAnchor="end" fontSize={10} fill="var(--faint)">
          RS-Ratio →
        </text>
        <text x={cx + 6} y={pad + 30} fontSize={10} fill="var(--faint)">
          ↑ RS-Momentum
        </text>
        {stats.map((s) => {
          const lastP = s.rrg[s.rrg.length - 1]!;
          const color = QUADRANT_COLOR[s.quadrant ?? "lagging"];
          const dim = hover && hover !== s.symbol;
          return (
            <g key={s.symbol} opacity={dim ? 0.18 : 1} onMouseEnter={() => setHover(s.symbol)} onMouseLeave={() => setHover(null)} className="cursor-pointer">
              <polyline points={s.rrg.map((p) => `${x(p.ratio)},${y(p.momentum)}`).join(" ")} fill="none" stroke={color} strokeWidth={1.5} strokeOpacity={0.55} strokeLinejoin="round" />
              {s.rrg.slice(0, -1).map((p, i) => (
                <circle key={i} cx={x(p.ratio)} cy={y(p.momentum)} r={1.8} fill={color} opacity={0.35 + (i / s.rrg.length) * 0.5} />
              ))}
              <circle cx={x(lastP.ratio)} cy={y(lastP.momentum)} r={5} fill={color} stroke="var(--bg)" strokeWidth={1.5} />
              <text x={x(lastP.ratio) + 7} y={y(lastP.momentum) + 4} fontSize={10.5} fontWeight={600} fill="var(--fg)">
                {baseAsset(s.symbol)}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="px-2 text-[11px] text-faint">{t("markets.rrgHelp")}</p>
    </div>
  );
}

function CorrelationHeatmap({ symbols, matrix }: { symbols: string[]; matrix: number[][] }) {
  const [cell, setCell] = useState<[number, number] | null>(null);
  const n = symbols.length;
  const color = (v: number) =>
    v >= 0 ? `color-mix(in oklab, var(--accent) ${Math.round(v * 85)}%, var(--panel-2))` : `color-mix(in oklab, var(--bear) ${Math.round(-v * 85)}%, var(--panel-2))`;
  return (
    <div className="overflow-x-auto px-4 pb-4">
      <div className="inline-grid min-w-full gap-px text-[10px]" style={{ gridTemplateColumns: `56px repeat(${n}, minmax(22px, 1fr))` }}>
        <div />
        {symbols.map((s, j) => (
          <div key={s} className={cn("num truncate pb-1 text-center text-muted [writing-mode:vertical-rl] rotate-180", cell?.[1] === j && "text-fg")}>
            {baseAsset(s)}
          </div>
        ))}
        {symbols.map((row, i) => (
          <div key={row} className="contents">
            <div className={cn("num truncate pr-2 text-right leading-[22px] text-muted", cell?.[0] === i && "text-fg")}>{baseAsset(row)}</div>
            {matrix[i]!.map((v, j) => (
              <div
                key={j}
                title={`${baseAsset(row)} / ${baseAsset(symbols[j]!)}: ${v.toFixed(2)}`}
                onMouseEnter={() => setCell([i, j])}
                onMouseLeave={() => setCell(null)}
                className="num flex aspect-square items-center justify-center rounded-[3px] text-[9px] text-fg/80"
                style={{ background: color(v) }}
              >
                {n <= 15 && i !== j ? v.toFixed(1).replace("0.", ".") : ""}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 text-[10px] text-faint">
        <span>−1</span>
        <div className="h-2 flex-1 rounded-full" style={{ background: "linear-gradient(90deg, var(--bear), var(--panel-2), var(--accent))" }} />
        <span>+1</span>
      </div>
    </div>
  );
}

type SortKey = "ret7d" | "ret30d" | "ret90d" | "vol30d" | "beta" | "corrBench" | "maxDd90d" | "riskAdjusted";

function StatsTable({ stats }: { stats: AssetStats[] }) {
  const t = useT();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "riskAdjusted", dir: -1 });
  const rows = useMemo(
    () => [...stats].sort((a, b) => ((Number.isFinite(a[sort.key]) ? a[sort.key] : -Infinity) - (Number.isFinite(b[sort.key]) ? b[sort.key] : -Infinity)) * sort.dir),
    [stats, sort],
  );
  const th = (key: SortKey, label: string) => (
    <th className="cursor-pointer px-3 py-2 text-right whitespace-nowrap hover:text-fg" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : -1 }))}>
      {label} {sort.key === key && (sort.dir === 1 ? <ArrowUp size={10} className="inline" /> : <ArrowDown size={10} className="inline" />)}
    </th>
  );
  const num = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "—");
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-[11px] tracking-wide text-muted uppercase">
          <tr className="border-b border-line">
            <th className="px-3 py-2 text-left">Coin</th>
            <th className="px-3 py-2 text-right">{t("markets.col.price")}</th>
            {th("ret7d", "7d")}
            {th("ret30d", "30d")}
            {th("ret90d", "90d")}
            {th("vol30d", t("markets.col.vol"))}
            {th("beta", t("markets.col.beta"))}
            {th("corrBench", t("markets.col.corr"))}
            {th("maxDd90d", t("markets.col.dd"))}
            {th("riskAdjusted", t("markets.col.riskAdj"))}
            <th className="px-3 py-2 text-left">{t("markets.col.rotation")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.symbol} className="border-b border-line/60 hover:bg-panel-2">
              <td className="px-3 py-2">
                <Link href={`/chart?symbol=${s.symbol}`} className="flex items-center gap-2 font-semibold hover:text-accent">
                  <CoinIcon symbol={s.symbol} size={20} /> {baseAsset(s.symbol)}
                </Link>
              </td>
              <td className="num px-3 py-2 text-right">{formatPrice(s.last)}</td>
              <td className="px-3 py-2 text-right"><Pct value={s.ret7d} digits={1} /></td>
              <td className="px-3 py-2 text-right"><Pct value={s.ret30d} digits={1} /></td>
              <td className="px-3 py-2 text-right"><Pct value={s.ret90d} digits={1} /></td>
              <td className="num px-3 py-2 text-right">{num(s.vol30d, 0)}%</td>
              <td className="num px-3 py-2 text-right">{num(s.beta)}</td>
              <td className="num px-3 py-2 text-right">{num(s.corrBench)}</td>
              <td className="num px-3 py-2 text-right text-bear">{num(s.maxDd90d, 1)}%</td>
              <td className={cn("num px-3 py-2 text-right font-semibold", s.riskAdjusted >= 0 ? "text-bull" : "text-bear")}>{num(s.riskAdjusted)}</td>
              <td className="px-3 py-2">
                {s.quadrant ? (
                  <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: QUADRANT_COLOR[s.quadrant] }}>
                    <span className="h-2 w-2 rounded-full" style={{ background: QUADRANT_COLOR[s.quadrant] }} />
                    {t(`markets.q.${s.quadrant}` as TKey)}
                  </span>
                ) : (
                  <span className="text-xs text-faint">{t("markets.benchmark")}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
