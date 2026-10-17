"use client";

import { Check, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useT } from "@/lib/i18n";

/** Split-screen auth layout: brand story on the left, form on the right (stacked on mobile). */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  const t = useT();
  return (
    <div className="grid min-h-[100dvh] lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden border-r border-line lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="grid-dots absolute inset-0 opacity-40" />
        <div className="brand-gradient absolute -top-32 -left-32 h-96 w-96 rounded-full opacity-25 blur-3xl" />
        <Link href="/welcome" className="relative flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" className="h-10 w-10" />
          <span className="text-lg font-semibold tracking-tight">
            CryptoVision <span className="gradient-text">Pro</span>
          </span>
        </Link>
        <div className="relative space-y-8">
          <HeroChart />
          <ul className="space-y-3">
            {(["auth.perk1", "auth.perk2", "auth.perk3", "auth.perk4"] as const).map((k) => (
              <li key={k} className="flex items-center gap-3 text-sm">
                <span className="brand-gradient flex h-6 w-6 items-center justify-center rounded-full text-[#060911]">
                  <Check size={14} strokeWidth={3} />
                </span>
                {t(k)}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative flex items-center gap-2 text-xs text-muted">
          <ShieldAlert size={14} className="text-warn" /> {t("disclaimer.short")}
        </p>
      </section>
      <section className="flex items-center justify-center p-6 sm:p-10">
        <div className="animate-fade-up w-full max-w-sm">
          <Link href="/welcome" className="mb-8 flex items-center gap-2 lg:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.svg" alt="" className="h-9 w-9" />
            <span className="font-semibold">
              CryptoVision <span className="gradient-text">Pro</span>
            </span>
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm text-muted">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </section>
    </div>
  );
}

/** Decorative candlestick illustration (deterministic, no data). */
export function HeroChart({ className }: { className?: string }) {
  const candles = Array.from({ length: 26 }, (_, i) => {
    const base = 60 + Math.sin(i / 3) * 18 + i * 2.2;
    const up = Math.sin(i * 1.7) > -0.3;
    const body = 6 + ((i * 7) % 9);
    return { x: 14 + i * 15, o: up ? base : base + body, c: up ? base + body : base, h: base + body + 6 + (i % 4) * 2, l: base - 5 - (i % 3) * 2, up };
  });
  const H = 170;
  const y = (v: number) => H - v;
  return (
    <svg viewBox="0 0 410 180" className={className ?? "w-full max-w-md animate-float"} aria-hidden>
      <defs>
        <linearGradient id="hc-area" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="hc-line" x1="0" x2="1">
          <stop offset="0%" stopColor="#7b8cff" />
          <stop offset="60%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#34d399" />
        </linearGradient>
      </defs>
      <path d={`M14 ${y(candles[0]!.c)} ${candles.map((c) => `L${c.x} ${y((c.o + c.c) / 2)}`).join(" ")} L${candles.at(-1)!.x} ${H} L14 ${H} Z`} fill="url(#hc-area)" />
      {candles.map((c, i) => (
        <g key={i} stroke={c.up ? "var(--bull)" : "var(--bear)"} fill={c.up ? "var(--bull)" : "var(--bear)"}>
          <line x1={c.x} x2={c.x} y1={y(c.h)} y2={y(c.l)} strokeWidth="1.2" />
          <rect x={c.x - 4} y={y(Math.max(c.o, c.c))} width="8" height={Math.max(2, Math.abs(c.c - c.o))} rx="1.5" />
        </g>
      ))}
      <path d={`M14 ${y(candles[0]!.c)} ${candles.map((c) => `L${c.x} ${y((c.o + c.c) / 2)}`).join(" ")}`} fill="none" stroke="url(#hc-line)" strokeWidth="2.5" strokeLinecap="round" />
      <rect x="300" y="18" width="98" height="40" rx="10" fill="var(--panel-solid)" stroke="var(--line-strong)" />
      <text x="312" y="34" fontSize="9" fill="var(--muted)" fontFamily="var(--font-mono)">SCORE</text>
      <text x="312" y="50" fontSize="14" fontWeight="700" fill="var(--bull)" fontFamily="var(--font-mono)">78 · BUY</text>
    </svg>
  );
}
