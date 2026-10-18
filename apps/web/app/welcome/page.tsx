"use client";

import { baseAsset, formatPrice } from "@cv/core";
import { ArrowRight, BellRing, CandlestickChart, FlaskConical, Lock, Scale, ShieldAlert, Sparkles, Zap } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { HeroChart } from "@/components/auth/auth-layout";
import { Button } from "@/components/ui/primitives";
import { CoinIcon, Pct } from "@/components/ui/viz";
import { universe } from "@cv/exchange";
import { useTickers } from "@/lib/data/hooks";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/lib/store/auth";
import { useSettings } from "@/lib/store/settings";

const FEATURES = [
  { icon: Zap, t: "landing.f1", d: "landing.f1d" },
  { icon: Scale, t: "landing.f2", d: "landing.f2d" },
  { icon: CandlestickChart, t: "landing.f3", d: "landing.f3d" },
  { icon: BellRing, t: "landing.f4", d: "landing.f4d" },
  { icon: FlaskConical, t: "landing.f5", d: "landing.f5d" },
  { icon: Lock, t: "landing.f6", d: "landing.f6d" },
] as const;

export default function Welcome() {
  const t = useT();
  const lang = useSettings((s) => s.lang);
  const set = useSettings((s) => s.set);
  const user = useAuth((s) => s.user);
  const health = useAuth((s) => s.health);
  const { data } = useTickers();
  const top = useMemo(() => (data ? universe(data, 8) : []), [data]);

  return (
    <div className="relative overflow-hidden">
      <div className="grid-dots pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,#000_20%,transparent_70%)] opacity-50" />
      <div className="brand-gradient pointer-events-none absolute top-[-280px] left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full opacity-20 blur-3xl" />

      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Link href="/welcome" className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" className="h-9 w-9" />
          <span className="font-semibold tracking-tight">
            CryptoVision <span className="gradient-text">Pro</span>
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <button className="rounded-lg px-2 py-1 text-xs font-bold text-muted hover:text-fg" onClick={() => set({ lang: lang === "sq" ? "en" : "sq" })}>
            {lang === "sq" ? "EN" : "SQ"}
          </button>
          {health?.db && !user && (
            <Link href="/login">
              <Button size="sm" variant="ghost">
                {t("auth.login")}
              </Button>
            </Link>
          )}
          <Link href="/">
            <Button size="sm" variant="primary">
              {t("landing.cta")} <ArrowRight size={14} />
            </Button>
          </Link>
        </div>
      </header>

      <main>
        <section className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 pt-10 pb-16 lg:grid-cols-[1.05fr_1fr] lg:pt-16">
          <div className="animate-fade-up">
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-panel-2 px-3 py-1 text-xs text-muted">
              <Sparkles size={13} className="text-accent" /> {t("landing.badge")}
            </span>
            <h1 className="mt-5 text-4xl leading-[1.05] font-semibold tracking-tight sm:text-6xl">
              {t("landing.title1")}
              <br />
              <span className="gradient-text">{t("landing.title2")}</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-lg">{t("landing.sub")}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/">
                <Button variant="primary" size="md" className="h-11 px-5">
                  {t("landing.cta")} <ArrowRight size={16} />
                </Button>
              </Link>
              {health?.db && !user && (
                <Link href="/register">
                  <Button size="md" className="h-11 px-5">
                    {t("landing.cta2")}
                  </Button>
                </Link>
              )}
            </div>
            <p className="mt-6 flex items-center gap-2 text-xs text-faint">
              <ShieldAlert size={13} className="text-warn" /> {t("disclaimer.short")}
            </p>
          </div>
          <div className="relative">
            <div className="glass shadow-card gradient-border rounded-3xl p-6">
              <div className="mb-3 flex items-center justify-between text-xs text-muted">
                <span className="flex items-center gap-2">
                  <span className="live-dot h-2 w-2 rounded-full bg-bull" /> BTC/USDT · 4h
                </span>
                <span className="num">{top[0] ? formatPrice(top.find((x) => x.symbol === "BTCUSDT")?.lastPrice ?? top[0].lastPrice) : "—"}</span>
              </div>
              <HeroChart className="w-full" />
            </div>
            <div className="glass shadow-card animate-float absolute -bottom-6 -left-4 hidden rounded-2xl border border-line px-4 py-3 sm:block">
              <div className="text-[10px] tracking-wide text-muted uppercase">R:R</div>
              <div className="num text-lg font-semibold text-bull">1 : 2.8</div>
            </div>
            <div className="glass shadow-card absolute -top-10 right-12 hidden rounded-2xl border border-line px-4 py-3 [animation-delay:1.5s] sm:block animate-float">
              <div className="text-[10px] tracking-wide text-muted uppercase">Stop-loss</div>
              <div className="num text-lg font-semibold text-bear">−3.4%</div>
            </div>
          </div>
        </section>

        {top.length > 0 && (
          <section className="relative mx-auto max-w-6xl px-5">
            <div className="mb-3 text-xs font-medium tracking-wide text-muted uppercase">{t("landing.live")}</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {top.map((x) => (
                <Link key={x.symbol} href={`/chart?symbol=${x.symbol}`} className="glass shadow-card flex items-center gap-3 rounded-2xl border border-line px-4 py-3 transition-transform hover:-translate-y-0.5">
                  <CoinIcon symbol={x.symbol} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{baseAsset(x.symbol)}</div>
                    <div className="num truncate text-xs text-muted">{formatPrice(x.lastPrice)}</div>
                  </div>
                  <Pct value={x.priceChangePercent} className="text-xs font-semibold" />
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="relative mx-auto max-w-6xl px-5 py-20">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <div key={f.t} className="glass shadow-card animate-fade-up rounded-3xl border border-line p-6" style={{ animationDelay: `${i * 60}ms` }}>
                <div className="brand-gradient mb-4 flex h-10 w-10 items-center justify-center rounded-xl text-[#060911]">
                  <f.icon size={18} />
                </div>
                <h3 className="font-semibold tracking-tight">{t(f.t)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{t(f.d)}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="relative mx-auto max-w-4xl px-5 pb-20">
          <div className="glass shadow-card gradient-border rounded-3xl p-8 text-center">
            <h2 className="text-2xl font-semibold tracking-tight">{t("landing.honest")}</h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-muted">{t("landing.honestD")}</p>
            <div className="mt-6 grid grid-cols-3 gap-3">
              {[
                ["1171", "trade OOS"],
                ["39.4%", "win rate"],
                ["0.71", "profit factor"],
              ].map(([v, l]) => (
                <div key={l} className="rounded-2xl border border-line bg-panel-2 p-4">
                  <div className="num text-2xl font-semibold">{v}</div>
                  <div className="mt-1 text-[11px] tracking-wide text-muted uppercase">{l}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="relative border-t border-line">
        <div className="mx-auto max-w-6xl px-5 py-8 text-center text-[11px] leading-relaxed text-faint">{t("disclaimer.long")}</div>
      </footer>
    </div>
  );
}
