"use client";

import type { SignalAction } from "@cv/core";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

export function Sparkline({ values, width = 100, height = 28, className, positive }: { values: number[]; width?: number; height?: number; className?: string; positive?: boolean }) {
  const v = values.filter(Number.isFinite);
  if (v.length < 2) return <svg width={width} height={height} className={className} />;
  const min = Math.min(...v);
  const max = Math.max(...v);
  const range = max - min || 1;
  const pts = v.map((x, i) => `${((i / (v.length - 1)) * width).toFixed(1)},${(height - 2 - ((x - min) / range) * (height - 4)).toFixed(1)}`);
  const up = positive ?? v[v.length - 1]! >= v[0]!;
  const color = up ? "var(--bull)" : "var(--bear)";
  const id = `sg${Math.round(Math.random() * 1e9)}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${pts.join(" ")} ${width},${height}`} fill={`url(#${id})`} />
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export function actionTone(a: SignalAction): "bull" | "bear" | "neutral" {
  return a === "BUY" || a === "STRONG_BUY" ? "bull" : a === "SELL" || a === "STRONG_SELL" ? "bear" : "neutral";
}

export function ActionBadge({ action, className, size = "sm" }: { action: SignalAction; className?: string; size?: "sm" | "lg" }) {
  const t = useT();
  const tone = actionTone(action);
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-md font-bold tracking-wide",
        size === "sm" ? "h-6 px-2 text-[11px]" : "h-9 px-4 text-sm",
        tone === "bull" && (action === "STRONG_BUY" ? "bg-bull text-(--on-bull)" : "bg-bull-soft text-bull"),
        tone === "bear" && (action === "STRONG_SELL" ? "bg-bear text-(--on-bear)" : "bg-bear-soft text-bear"),
        tone === "neutral" && "bg-panel-2 text-muted",
        className,
      )}
    >
      {t(`action.${action}`)}
    </span>
  );
}

/** Semi-circular 0–100 gauge for scores and Fear & Greed. */
export function Gauge({ value, size = 120, label, sub }: { value: number; size?: number; label?: string; sub?: string }) {
  const r = size / 2 - 8;
  const cx = size / 2;
  const cy = size / 2;
  const angle = Math.PI * (1 - Math.max(0, Math.min(100, value)) / 100);
  const nx = cx + r * Math.cos(angle);
  const ny = cy - r * Math.sin(angle);
  const color = value >= 60 ? "var(--bull)" : value <= 40 ? "var(--bear)" : "var(--warn)";
  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size / 2 + 10} viewBox={`0 0 ${size} ${size / 2 + 10}`} aria-label={`${Math.round(value)}`}>
        <defs>
          <linearGradient id="gauge-grad" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="var(--bear)" />
            <stop offset="50%" stopColor="var(--warn)" />
            <stop offset="100%" stopColor="var(--bull)" />
          </linearGradient>
        </defs>
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="var(--line)" strokeWidth="8" strokeLinecap="round" />
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="url(#gauge-grad)" strokeWidth="8" strokeLinecap="round" opacity="0.85" />
        <circle cx={nx} cy={ny} r="6" fill="var(--panel)" stroke={color} strokeWidth="3" />
      </svg>
      <div className="num -mt-6 text-2xl font-bold" style={{ color }}>
        {Math.round(value)}
      </div>
      {label && <div className="mt-0.5 text-xs font-medium text-fg">{label}</div>}
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

export function ScoreBar({ score, className }: { score: number; className?: string }) {
  const color = score >= 60 ? "var(--bull)" : score <= 40 ? "var(--bear)" : "var(--warn)";
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-line">
        <div className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
        <div className="absolute inset-y-0 rounded-full" style={{ left: `${Math.min(50, score)}%`, width: `${Math.abs(score - 50)}%`, background: color }} />
      </div>
      <span className="num w-7 text-right text-xs font-semibold" style={{ color }}>
        {score}
      </span>
    </div>
  );
}

export function Pct({ value, className, digits = 2 }: { value: number; className?: string; digits?: number }) {
  return (
    <span className={cn("num", value > 0 ? "text-bull" : value < 0 ? "text-bear" : "text-muted", className)}>
      {value > 0 ? "+" : ""}
      {Number.isFinite(value) ? value.toFixed(digits) : "—"}%
    </span>
  );
}

export function CoinIcon({ symbol, size = 24 }: { symbol: string; size?: number }) {
  const base = symbol.replace(/USDT$/, "");
  let h = 0;
  for (const ch of base) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.38, background: `linear-gradient(135deg, hsl(${h} 70% 50%), hsl(${(h + 40) % 360} 70% 38%))` }}
      aria-hidden
    >
      {base.slice(0, 3)}
    </span>
  );
}
