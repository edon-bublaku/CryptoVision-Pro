"use client";

import { baseAsset } from "@cv/core";
import type { Regime } from "@cv/rating";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRecommendation } from "@/lib/data/rating";
import { useT, type TKey } from "@/lib/i18n";
import { Card, CardHeader } from "../ui/primitives";
import { CoinIcon } from "../ui/viz";
import { scoreColor } from "./rating-view";

const REGIME_COLOR: Record<Regime, string> = { risk_on: "var(--bull)", neutral: "var(--warn)", risk_off: "var(--bear)" };

/** Dashboard summary of the model portfolio: regime, exposure and the top picks. */
export function RecommendationCard() {
  const t = useT();
  const { rec, loaded, total } = useRecommendation(40, 6);
  return (
    <Card className="gradient-border">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Sparkles size={15} className="text-accent" /> {t("rec.dashboard")}
          </span>
        }
        right={
          <Link href="/recommendations" className="flex items-center gap-1 text-xs text-accent hover:underline">
            {t("rec.dashboardMore")} <ArrowRight size={12} />
          </Link>
        }
      />
      {!rec ? (
        <p className="flex items-center gap-2 px-4 pb-4 text-xs text-muted">
          <Loader2 size={13} className="animate-spin" /> {t("ratingPage.loading", { n: loaded, total })}
        </p>
      ) : (
        <div className="space-y-3 px-4 pb-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="h-2 w-2 rounded-full" style={{ background: REGIME_COLOR[rec.market.regime] }} />
            <b style={{ color: REGIME_COLOR[rec.market.regime] }}>{t(`rec.regime.${rec.market.regime}` as TKey)}</b>
            <span className="text-muted">
              {t("rec.exposure")}: <b className="num text-fg">{Math.round(rec.market.exposure * 100)}%</b>
            </span>
            <span className="text-muted">
              {t("rec.cash")}: <b className="num text-fg">{Math.round(rec.cash * 100)}%</b>
            </span>
          </div>
          {rec.picks.length === 0 ? (
            <p className="text-xs text-muted">{t("rec.none")}</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {rec.picks.slice(0, 6).map((p) => (
                <Link key={p.symbol} href={`/chart?symbol=${p.symbol}`} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 transition-colors hover:border-line-strong">
                  <CoinIcon symbol={p.symbol} size={24} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{baseAsset(p.symbol)}</div>
                    <div className="num text-[11px] text-muted">{(p.weight * 100).toFixed(1)}%</div>
                  </div>
                  <span className="num text-lg font-bold" style={{ color: scoreColor(p.rating.score) }}>
                    {Math.round(p.rating.score)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
