"use client";

import { baseAsset } from "@cv/core";
import { journalStats, type GroupStats, type JournalStats } from "@cv/risk";
import { BookOpenCheck, BriefcaseBusiness, Sparkles } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Button, Card, CardHeader, Empty, PageHeader, Segmented, Stat } from "@/components/ui/primitives";
import { compactUsd, SeriesChart } from "@/components/ui/series-chart";
import { CoinIcon } from "@/components/ui/viz";
import { useT, type TKey } from "@/lib/i18n";
import { usePortfolio } from "@/lib/store/portfolio";
import { useSettings } from "@/lib/store/settings";
import { cn } from "@/lib/utils";

type Kind = "all" | "paper" | "real";
type Period = "all" | 90 | 30;

const usd = (v: number) => (Number.isFinite(v) ? `${v < 0 ? "−" : v > 0 ? "+" : ""}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—");
const pct = (v: number, d = 0) => (Number.isFinite(v) ? `${(v * 100).toFixed(d)}%` : "—");
const r2 = (v: number) => (Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}R` : "—");

export default function JournalPage() {
  const t = useT();
  const closed = usePortfolio((s) => s.closed);
  const equity = useSettings((s) => s.equity);
  const [kind, setKind] = useState<Kind>("all");
  const [period, setPeriod] = useState<Period>("all");

  const stats = useMemo(() => {
    // Period filtering is relative to "now" at render time; trades are immutable once closed.
    const since = period === "all" ? 0 : Date.now() - period * 86_400_000;
    const list = closed.filter((c) => c.closedAt >= since && (kind === "all" || (kind === "paper" ? c.paper : !c.paper)));
    return journalStats(list, equity);
  }, [closed, kind, period, equity]);

  return (
    <div className="mx-auto max-w-[1300px] space-y-5 p-4 lg:p-8">
      <PageHeader
        icon={<BookOpenCheck size={20} />}
        title={t("journal.title")}
        subtitle={t("journal.subtitle")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Segmented size="xs" value={kind} onChange={setKind} options={(["all", "paper", "real"] as Kind[]).map((k) => ({ value: k, label: t(`journal.kind.${k}` as TKey) }))} />
            <Segmented size="xs" value={period} onChange={setPeriod} options={[{ value: "all", label: t("common.all") }, { value: 90, label: "90D" }, { value: 30, label: "30D" }]} />
          </div>
        }
      />

      {!stats ? (
        <Card>
          <Empty icon={<BookOpenCheck size={26} />} title={t("journal.empty")}>
            <p className="mx-auto max-w-md text-sm text-muted">{t("journal.emptyHint")}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Link href="/recommendations">
                <Button variant="primary">
                  <Sparkles size={14} /> {t("nav.recommendations")}
                </Button>
              </Link>
              <Link href="/portfolio">
                <Button>
                  <BriefcaseBusiness size={14} /> {t("nav.portfolio")}
                </Button>
              </Link>
            </div>
          </Empty>
        </Card>
      ) : (
        <JournalView s={stats} start={equity} />
      )}
      <p className="text-[11px] leading-relaxed text-faint">{t("journal.note")}</p>
    </div>
  );
}

function JournalView({ s, start }: { s: JournalStats; start: number }) {
  const t = useT();
  const tone = (v: number) => (v > 0 ? "bull" : v < 0 ? "bear" : undefined);
  return (
    <>
      <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4 lg:grid-cols-8">
        <Stat label={t("journal.trades")} value={s.trades} sub={`${s.wins}W · ${s.losses}L`} />
        <Stat label={t("backtest.winRate")} value={pct(s.winRate)} />
        <Stat label="Profit factor" value={s.profitFactor === Infinity ? "∞" : Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : "—"} tone={s.profitFactor >= 1 ? "bull" : "bear"} />
        <Stat label={t("journal.net")} value={usd(s.netPnl)} tone={tone(s.netPnl)} sub={start > 0 ? `${((s.netPnl / start) * 100).toFixed(2)}%` : undefined} />
        <Stat label={t("journal.expectancy")} value={usd(s.expectancy)} tone={tone(s.expectancy)} sub={s.rTrades ? `${r2(s.expectancyR)} · ${s.rTrades}/${s.trades}` : undefined} />
        <Stat label={t("journal.payoff")} value={Number.isFinite(s.payoff) ? s.payoff.toFixed(2) : "—"} sub={`${usd(s.avgWin)} / ${usd(-s.avgLoss)}`} />
        <Stat label={t("journal.maxDd")} value={usd(s.maxDrawdown)} tone={s.maxDrawdown < 0 ? "bear" : undefined} sub={s.maxDrawdownPct ? `${s.maxDrawdownPct.toFixed(2)}%` : undefined} />
        <Stat
          label={t("journal.streak")}
          value={s.currentStreak === 0 ? "—" : `${Math.abs(s.currentStreak)}${s.currentStreak > 0 ? "W" : "L"}`}
          tone={tone(s.currentStreak)}
          sub={t("journal.streakMax", { w: s.maxWinStreak, l: s.maxLossStreak })}
        />
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Card>
          <CardHeader title={t("journal.equity")} subtitle={t("journal.equitySub", { h: s.avgHoldHours.toFixed(1) })} />
          <div className="px-4 pb-4">
            <SeriesChart
              label={t("journal.equity")}
              times={s.equity.map((p) => Math.floor(p.time / 1000))}
              series={[{ label: t("journal.equityLine"), color: "var(--accent)", values: s.equity.map((p) => p.value) }]}
              baseline={start}
              format={compactUsd}
            />
          </div>
        </Card>
        <Card>
          <CardHeader title={t("journal.monthly")} />
          <MonthBars months={s.byMonth} />
          <div className="grid grid-cols-2 gap-3 border-t border-line p-4 text-xs">
            {s.best && <TradeChip label={t("journal.best")} symbol={s.best.symbol} pnl={s.best.pnl} r={s.best.r} />}
            {s.worst && <TradeChip label={t("journal.worst")} symbol={s.worst.symbol} pnl={s.worst.pnl} r={s.worst.r} />}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("journal.bySymbol")} />
          <GroupTable rows={s.bySymbol} head="Coin" label={(k) => <span className="inline-flex items-center gap-2 font-semibold"><CoinIcon symbol={k} size={18} />{baseAsset(k)}</span>} />
        </Card>
        <Card>
          <CardHeader title={t("journal.byWeekday")} subtitle={t("journal.byWeekdaySub")} />
          <WeekdayBars rows={s.byWeekday} />
        </Card>
        <Card>
          <CardHeader title={t("journal.byExit")} />
          <GroupTable rows={s.byExit} head={t("journal.exitCol")} label={(k) => t(`journal.exit.${k}` as TKey)} />
        </Card>
        <Card>
          <CardHeader title={t("journal.bySide")} />
          <GroupTable rows={s.bySide} head={t("common.side")} label={(k) => <span className={k === "LONG" ? "text-bull" : "text-bear"}>{k}</span>} />
          <CardHeader title={t("journal.byStrategy")} className="border-t border-line" />
          <GroupTable rows={s.byStrategy} head={t("common.strategy")} label={(k) => (k === "manual" ? t("journal.manual") : k.startsWith("custom:") ? k.slice(7) : t(`strategy.${k}` as TKey))} />
        </Card>
      </div>
    </>
  );
}

function TradeChip({ label, symbol, pnl, r }: { label: string; symbol: string; pnl: number; r?: number }) {
  return (
    <div className="rounded-lg border border-line p-2.5">
      <div className="text-[10px] tracking-wide text-faint uppercase">{label}</div>
      <div className="mt-1 flex items-center gap-2 font-semibold">
        <CoinIcon symbol={symbol} size={16} />
        {baseAsset(symbol)}
        <span className={cn("num ml-auto", pnl >= 0 ? "text-bull" : "text-bear")}>{usd(pnl)}</span>
      </div>
      {r !== undefined && <div className="num mt-0.5 text-right text-[11px] text-muted">{r2(r)}</div>}
    </div>
  );
}

function GroupTable({ rows, label, head }: { rows: GroupStats[]; label: (key: string) => React.ReactNode; head: string }) {
  const t = useT();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-[11px] tracking-wide text-muted uppercase">
            <th scope="col" className="px-4 py-2 text-left font-medium">{head}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{t("journal.trades")}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{t("backtest.winRate")}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">R</th>
            <th scope="col" className="px-4 py-2 text-right font-medium">PnL</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.key} className="border-b border-line/50 hover:bg-panel-2">
              <td className="px-4 py-1.5 text-xs">{label(g.key)}</td>
              <td className="num px-3 py-1.5 text-right text-xs">{g.trades}</td>
              <td className="num px-3 py-1.5 text-right text-xs">{pct(g.winRate)}</td>
              <td className="num px-3 py-1.5 text-right text-xs text-muted">{r2(g.avgR)}</td>
              <td className={cn("num px-4 py-1.5 text-right text-xs font-semibold", g.pnl >= 0 ? "text-bull" : "text-bear")}>{usd(g.pnl)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Diverging bars around zero, one per month. */
function MonthBars({ months }: { months: JournalStats["byMonth"] }) {
  const max = Math.max(...months.map((m) => Math.abs(m.pnl)), 1e-9);
  return (
    <div className="space-y-1 px-4 pb-3">
      {months.slice(-12).map((m) => (
        <div key={m.month} className="grid grid-cols-[56px_1fr_84px] items-center gap-2 text-xs">
          <span className="num text-muted">{m.month}</span>
          <div className="relative h-3 rounded bg-panel-2">
            <div className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
            <div
              className={cn("absolute inset-y-0 rounded", m.pnl >= 0 ? "bg-bull" : "bg-bear")}
              style={m.pnl >= 0 ? { left: "50%", width: `${(m.pnl / max) * 50}%` } : { right: "50%", width: `${(-m.pnl / max) * 50}%` }}
            />
          </div>
          <span className={cn("num text-right font-semibold", m.pnl >= 0 ? "text-bull" : "text-bear")}>{usd(m.pnl)}</span>
        </div>
      ))}
    </div>
  );
}

function WeekdayBars({ rows }: { rows: GroupStats[] }) {
  const t = useT();
  const max = Math.max(...rows.map((r) => Math.abs(r.pnl)), 1e-9);
  return (
    <div className="grid grid-cols-7 items-end gap-2 px-4 pb-4" style={{ height: 170 }}>
      {rows.map((r) => (
        <div key={r.key} className="flex h-full flex-col items-center justify-end gap-1" title={`${r.trades} · ${pct(r.winRate)}`}>
          <span className={cn("num text-[10px]", r.pnl >= 0 ? "text-bull" : "text-bear")}>{r.trades ? compactUsd(r.pnl) : ""}</span>
          <div className="flex w-full flex-1 flex-col justify-end">
            <div className={cn("w-full rounded-t", r.pnl >= 0 ? "bg-bull" : "bg-bear", !r.trades && "bg-line")} style={{ height: `${Math.max(2, (Math.abs(r.pnl) / max) * 100)}%` }} />
          </div>
          <span className="text-[10px] text-muted">{t(`journal.wd.${r.key}` as TKey)}</span>
        </div>
      ))}
    </div>
  );
}
