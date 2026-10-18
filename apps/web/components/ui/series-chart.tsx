"use client";

import { useState } from "react";
import { useSettings } from "@/lib/store/settings";
import { shortDate } from "@/lib/utils";

export interface ChartSeries {
  label: string;
  color: string;
  values: number[];
  /** Dashed reference line (e.g. money invested). */
  dashed?: boolean;
}

function niceTicks(lo: number, hi: number, count: number): number[] {
  const raw = (hi - lo) / count || 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(8)));
  return out;
}

/**
 * Lightweight responsive line chart for small analytic series (equity curves, DCA paths).
 * Lines stretch with the container; labels are HTML so text never distorts.
 */
export function SeriesChart({
  times,
  series,
  format,
  height = 260,
  label,
  baseline,
}: {
  /** Unix seconds, one per point. */
  times: number[];
  series: ChartSeries[];
  format: (v: number) => string;
  height?: number;
  label: string;
  /** Draws a stronger horizontal line at this value (e.g. starting equity). */
  baseline?: number;
}) {
  const lang = useSettings((s) => s.lang);
  const [hover, setHover] = useState<number | null>(null);
  const all = series.flatMap((s) => s.values).filter(Number.isFinite);
  if (times.length < 2 || !all.length) return null;
  let lo = Math.min(...all, baseline ?? Infinity);
  let hi = Math.max(...all, baseline ?? -Infinity);
  const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.05 || 1;
  lo -= pad;
  hi += pad;
  const W = 1000;
  const H = 300;
  const n = times.length;
  const x = (i: number) => (i / (n - 1)) * W;
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const ticks = niceTicks(lo, hi, 4);
  const idx = hover ?? n - 1;
  const withYear = times[n - 1]! - times[0]! > 300 * 86_400;

  return (
    <div>
      <div className="relative" style={{ height }}>
        <div className="absolute inset-y-0 right-0 left-14">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="h-full w-full touch-none overflow-visible"
            role="img"
            aria-label={label}
            onPointerMove={(e) => {
              const b = e.currentTarget.getBoundingClientRect();
              setHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - b.left) / b.width) * (n - 1)))));
            }}
            onPointerLeave={() => setHover(null)}
          >
            {ticks.map((v) => (
              <line key={v} x1={0} x2={W} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
            ))}
            {baseline !== undefined && <line x1={0} x2={W} y1={y(baseline)} y2={y(baseline)} stroke="var(--line-strong)" vectorEffect="non-scaling-stroke" />}
            {series.map((s) => (
              <path
                key={s.label}
                d={s.values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(Number.isFinite(v) ? v : lo).toFixed(1)}`).join("")}
                fill="none"
                stroke={s.color}
                strokeWidth={s.dashed ? 1.2 : 1.8}
                strokeDasharray={s.dashed ? "6 5" : undefined}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
              />
            ))}
            {hover !== null && <line x1={x(idx)} x2={x(idx)} y1={0} y2={H} stroke="var(--muted)" strokeOpacity={0.5} vectorEffect="non-scaling-stroke" />}
          </svg>
          {hover !== null && (
            <div
              className="pointer-events-none absolute top-1 z-10 min-w-36 rounded-lg border border-line bg-panel-solid/95 p-2 text-[11px] shadow-lg"
              style={{ left: `${(idx / (n - 1)) * 100}%`, transform: `translateX(${idx > n / 2 ? "calc(-100% - 8px)" : "8px"})` }}
            >
              <div className="mb-1 text-faint">{shortDate(times[idx]!, lang, true)}</div>
              {series.map((s) => (
                <div key={s.label} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
                    {s.label}
                  </span>
                  <span className="num font-semibold">{format(s.values[idx] ?? NaN)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="pointer-events-none absolute inset-y-0 left-0 w-12">
          {ticks.map((v) => (
            <span key={v} className="num absolute right-0 -translate-y-1/2 text-[10px] text-faint" style={{ top: `${(y(v) / H) * 100}%` }}>
              {format(v)}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-1 flex justify-between pl-14 text-[10px] text-faint">
        <span>{shortDate(times[0]!, lang, withYear)}</span>
        <span>{shortDate(times[n - 1]!, lang, withYear)}</span>
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-3 text-xs">
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded" style={{ background: s.color, opacity: s.dashed ? 0.7 : 1 }} aria-hidden />
            <span className="text-muted">{s.label}</span>
            <span className="num font-semibold">{format(s.values[s.values.length - 1] ?? NaN)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Compact money formatter for axes: $1.2k, $3.4M, $1.1B. */
export function compactUsd(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "$0";
  const a = Math.abs(v);
  // One decimal below 100k/100M so neighbouring axis ticks (10.5k, 11k) stay distinct.
  const units = ["", "k", "M", "B"];
  // One decimal below 100 of a unit so neighbouring axis ticks (10.5k, 11k) stay distinct.
  const show = (x: number, k: number) => (k === 0 ? Number(x.toFixed(x < 10 ? 2 : 0)) : Number(x.toFixed(x >= 100 ? 0 : 1)));
  let x = a;
  let k = 0;
  while (k < 3 && x >= 1000) {
    x /= 1000;
    k++;
  }
  // Roll over after rounding, so 999,950 reads $1M and not $1000k.
  if (k < 3 && show(x, k) >= 1000) {
    x /= 1000;
    k++;
  }
  const s = k === 0 ? x.toFixed(x < 10 ? 2 : 0) : `${show(x, k)}${units[k]}`;
  return `${v < 0 ? "−" : ""}$${s}`;
}
