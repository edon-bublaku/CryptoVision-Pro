"use client";

import type { Timeframe } from "@cv/core";
import { baseAsset, formatPrice } from "@cv/core";
import { History, Loader2, RefreshCw, ShieldAlert, Zap } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { SignalCard } from "@/components/signals/signal-card";
import { Badge, Button, Card, CardHeader, Empty, Field, Segmented, Select, Switch, PageHeader } from "@/components/ui/primitives";
import { ActionBadge, CoinIcon } from "@/components/ui/viz";
import { useT } from "@/lib/i18n";
import { useScan, type TrackedSignal } from "@/lib/store/scan";
import { useSettings } from "@/lib/store/settings";
import { STRATEGY_IDS } from "@cv/signals";
import { useScanner } from "@/lib/use-scanner";
import { useSignalRows } from "@/lib/use-signal-rows";
import { useAuth } from "@/lib/store/auth";
import { api } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { cn, timeAgo } from "@/lib/utils";

const SCAN_TFS: Timeframe[] = ["15m", "1h", "4h", "1d"];

export default function SignalsPage() {
  const t = useT();
  const lang = useSettings((s) => s.lang);
  const defaultTf = useSettings((s) => s.defaultTf);
  const scanSize = useSettings((s) => s.scanSize);
  const set = useSettings((s) => s.set);
  const { error, tracked: localTracked, timeframe: localTf } = useScan();
  const { run, progress } = useScanner();
  const [tf, setTf] = useState<Timeframe>(SCAN_TFS.includes(localTf) ? localTf : defaultTf);
  const { rows, scannedAt, timeframe, source } = useSignalRows(tf);
  const hasDb = useAuth((s) => !!s.health?.db);
  const serverTrack = useQuery({
    queryKey: ["server-track"],
    queryFn: ({ signal }) => api<{ rows: TrackedSignal[] }>("/api/signals/track", { signal }),
    enabled: hasDb,
    staleTime: 60_000,
  });
  const tracked = serverTrack.data?.rows.length ? serverTrack.data.rows : localTracked;
  const [tab, setTab] = useState<"live" | "track">("live");
  const [onlyActive, setOnlyActive] = useState(false);
  const [dir, setDir] = useState<"all" | "long" | "short">("all");
  const [minScore, setMinScore] = useState(0);
  const [minRR, setMinRR] = useState(0);
  const [strategy, setStrategy] = useState("all");

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        const s = r.signal;
        if (onlyActive && s.status !== "ACTIVE") return false;
        if (dir === "long" && !s.action.includes("BUY")) return false;
        if (dir === "short" && !s.action.includes("SELL")) return false;
        if (Math.abs(s.score - 50) * 2 < minScore) return false;
        if (minRR > 0 && (!s.plan || s.plan.riskReward < minRR)) return false;
        if (strategy !== "all" && s.strategyId !== strategy) return false;
        return true;
      }),
    [rows, onlyActive, dir, minScore, minRR, strategy],
  );
  const activeCount = rows.filter((r) => r.signal.status === "ACTIVE").length;

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 lg:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader icon={<Zap size={20} />} title={t("signals.title")} subtitle={t("signals.subtitle")} />
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "live", label: t("nav.signals") },
            { value: "track", label: `${t("signals.tracked")} (${tracked.length})` },
          ]}
        />
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn-soft p-3 text-xs text-warn">
        <ShieldAlert size={15} className="mt-px shrink-0" />
        <span>
          {t("disclaimer.short")} {t("backtest.honesty")}
        </span>
      </div>

      {tab === "live" ? (
        <>
          <Card className="p-3">
            <div className="flex flex-wrap items-end gap-3">
              <Field label={t("common.timeframe")}>
                <Segmented value={tf} onChange={setTf} options={SCAN_TFS.map((x) => ({ value: x, label: x }))} />
              </Field>
              <Field label={t("signals.universe")}>
                <Select value={scanSize} onChange={(e) => set({ scanSize: +e.target.value })}>
                  {[20, 40, 60, 100].map((n) => (
                    <option key={n} value={n}>
                      Top {n}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button variant="primary" size="md" onClick={() => run(tf)} disabled={!!progress}>
                {progress ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                {progress ? `${t("signals.scanning")} ${progress.done}/${progress.total || "…"}` : t("signals.scan")}
              </Button>
              {scannedAt && (
                <span className="pb-2 text-xs text-muted">
                  {t("signals.lastScan")}: {timeAgo(scannedAt, lang)} · {timeframe} · {rows.length} coin · {activeCount} {t("status.ACTIVE").toLowerCase()} · <Badge tone={source === "server" ? "accent" : "neutral"}>{t(`signals.source.${source}`)}</Badge>
                </span>
              )}
            </div>
            {progress && progress.total > 0 && (
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-line">
                <div className="h-full bg-accent transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </div>
            )}
            {error && <p className="mt-2 text-xs text-bear">{error}</p>}
            <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-line pt-3">
              <Switch checked={onlyActive} onChange={setOnlyActive} label={t("signals.onlyActive")} />
              <Field label={t("signals.direction")}>
                <Segmented
                  value={dir}
                  onChange={setDir}
                  size="xs"
                  options={[
                    { value: "all", label: t("common.all") },
                    { value: "long", label: "Long" },
                    { value: "short", label: "Short" },
                  ]}
                />
              </Field>
              <Field label={`${t("signals.minScore")} (|S−50|×2 ≥ ${minScore})`}>
                <input type="range" min={0} max={80} step={5} value={minScore} onChange={(e) => setMinScore(+e.target.value)} className="w-32 accent-[var(--accent)]" />
              </Field>
              <Field label={t("signals.minRR")}>
                <Select value={minRR} onChange={(e) => setMinRR(+e.target.value)}>
                  {[0, 1.5, 2, 2.5, 3].map((n) => (
                    <option key={n} value={n}>
                      {n === 0 ? t("common.all") : `≥ ${n}`}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("common.strategy")}>
                <Select value={strategy} onChange={(e) => setStrategy(e.target.value)}>
                  <option value="all">{t("common.all")}</option>
                  {STRATEGY_IDS.map((id) => (
                    <option key={id} value={id}>
                      {t(`strategy.${id}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </Card>

          {rows.length === 0 ? (
            <Card>
              <Empty icon={<Zap size={28} />} title={t("signals.notScanned")}>
                <Button variant="primary" className="mt-3" onClick={() => run(tf)} disabled={!!progress}>
                  {t("signals.scan")}
                </Button>
              </Empty>
            </Card>
          ) : filtered.length === 0 ? (
            <Card>
              <Empty title={t("signals.empty")} />
            </Card>
          ) : (
            <div className="space-y-2">
              {filtered.map((r, i) => (
                <SignalCard key={r.symbol} row={r} defaultOpen={i === 0} />
              ))}
            </div>
          )}
        </>
      ) : (
        <TrackRecord tracked={tracked} />
      )}
    </div>
  );
}

function TrackRecord({ tracked }: { tracked: TrackedSignal[] }) {
  const t = useT();
  const lang = useSettings((s) => s.lang);
  const resolved = tracked.filter((x) => ["tp1", "tp2", "tp3", "sl"].includes(x.outcome));
  const wins = resolved.filter((x) => x.outcome !== "sl").length;
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <History size={15} /> {t("signals.tracked")}
          </span>
        }
        subtitle={t("signals.trackedDesc")}
        right={
          resolved.length > 0 && (
            <Badge tone={wins / resolved.length >= 0.5 ? "bull" : "bear"}>
              {wins}/{resolved.length} · {((wins / resolved.length) * 100).toFixed(0)}%
            </Badge>
          )
        }
      />
      {tracked.length === 0 ? (
        <Empty title={t("signals.empty")} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] tracking-wide text-muted uppercase">
              <tr className="border-b border-line">
                <th className="px-4 py-2">{t("common.symbol")}</th>
                <th className="px-2 py-2">{t("common.side")}</th>
                <th className="px-2 py-2">{t("common.strategy")}</th>
                <th className="px-2 py-2 text-right">{t("plan.entry")}</th>
                <th className="px-2 py-2 text-right">SL</th>
                <th className="px-2 py-2 text-right">Max R</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-4 py-2 text-right">{t("common.date")}</th>
              </tr>
            </thead>
            <tbody>
              {tracked.map((x) => (
                <tr key={x.signal.id} className="border-b border-line/60 hover:bg-panel-2/50">
                  <td className="px-4 py-2">
                    <Link href={`/chart?symbol=${x.signal.symbol}&tf=${x.signal.timeframe}`} className="flex items-center gap-2 font-medium hover:text-accent">
                      <CoinIcon symbol={x.signal.symbol} size={20} /> {baseAsset(x.signal.symbol)} <span className="text-xs text-faint">{x.signal.timeframe}</span>
                    </Link>
                  </td>
                  <td className="px-2 py-2">
                    <ActionBadge action={x.signal.action} />
                  </td>
                  <td className="px-2 py-2 text-xs text-muted">{x.signal.strategyId ? t(`strategy.${x.signal.strategyId}`) : "—"}</td>
                  <td className="num px-2 py-2 text-right">{formatPrice(x.signal.plan?.entry ?? NaN)}</td>
                  <td className="num px-2 py-2 text-right text-bear">{formatPrice(x.signal.plan?.stopLoss ?? NaN)}</td>
                  <td className="num px-2 py-2 text-right">{x.bestR.toFixed(2)}</td>
                  <td className="px-2 py-2">
                    <Badge tone={x.outcome === "sl" ? "bear" : x.outcome.startsWith("tp") ? "bull" : x.outcome === "open" ? "accent" : "neutral"}>{t(`signals.outcome.${x.outcome}`)}</Badge>
                  </td>
                  <td className={cn("px-4 py-2 text-right text-xs text-muted")}>{timeAgo(x.signal.candleTime * 1000, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
