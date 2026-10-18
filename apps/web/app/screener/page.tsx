"use client";

import type { Timeframe } from "@cv/core";
import { baseAsset, formatCompact, formatPrice } from "@cv/core";
import { ArrowDown, ArrowUp, Loader2, Plus, Radar, RefreshCw, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, Segmented, Select, PageHeader } from "@/components/ui/primitives";
import { ActionBadge, CoinIcon, Pct, Sparkline } from "@/components/ui/viz";
import { useT } from "@/lib/i18n";
import { useScan } from "@/lib/store/scan";
import { useScanner } from "@/lib/use-scanner";
import { useSignalRows } from "@/lib/use-signal-rows";
import { useSavedScans, type Metric, type Rule } from "@/lib/store/screens";
import { cn } from "@/lib/utils";

type Op = Rule["op"];

const METRICS: { id: Metric; label: string; fmt?: (v: number) => string }[] = [
  { id: "rsi", label: "RSI(14)" },
  { id: "adx", label: "ADX(14)" },
  { id: "stochK", label: "Stoch RSI K" },
  { id: "macdHist", label: "MACD hist" },
  { id: "percentB", label: "Bollinger %B" },
  { id: "bbWidthPctl", label: "BB width percentile" },
  { id: "relVol", label: "Rel. volume (×)" },
  { id: "atrPct", label: "ATR %" },
  { id: "distEma20", label: "% from EMA20" },
  { id: "distEma50", label: "% from EMA50" },
  { id: "distEma200", label: "% from EMA200" },
  { id: "distHigh20", label: "% from 20-bar high" },
  { id: "distLow20", label: "% from 20-bar low" },
  { id: "trendScore", label: "Trend score (−1..1)" },
  { id: "change24h", label: "24h change %" },
  { id: "quoteVolume", label: "24h volume $", fmt: formatCompact },
];

const PRESETS: { key: string; rules: Rule[] }[] = [
  { key: "screener.preset.oversold", rules: [{ metric: "rsi", op: "<", value: 40 }, { metric: "distEma200", op: ">", value: 0 }] },
  { key: "screener.preset.breakout", rules: [{ metric: "distHigh20", op: ">", value: -1.5 }, { metric: "relVol", op: ">", value: 1.3 }] },
  { key: "screener.preset.strongTrend", rules: [{ metric: "adx", op: ">", value: 30 }] },
  { key: "screener.preset.squeeze", rules: [{ metric: "bbWidthPctl", op: "<", value: 15 }] },
  { key: "screener.preset.bearish", rules: [{ metric: "distEma200", op: "<", value: 0 }, { metric: "macdHist", op: "<", value: 0 }] },
];


export default function ScreenerPage() {
  const t = useT();
  const localTf = useScan((s) => s.timeframe);
  const { rows, timeframe, scannedAt } = useSignalRows(localTf);
  const { run, progress } = useScanner();
  const { saved, save, remove } = useSavedScans();
  const [rules, setRules] = useState<Rule[]>(PRESETS[0]!.rules);
  const [tf, setTf] = useState<Timeframe>(timeframe);
  const [sort, setSort] = useState<{ key: Metric | "score"; dir: 1 | -1 }>({ key: "score", dir: -1 });

  const results = useMemo(() => {
    const ok = rows.filter((r) => rules.every((rule) => {
      const v = r.snapshot[rule.metric];
      return Number.isFinite(v) && (rule.op === ">" ? v > rule.value : v < rule.value);
    }));
    return ok.sort((a, b) => {
      const va = sort.key === "score" ? a.signal.score : a.snapshot[sort.key];
      const vb = sort.key === "score" ? b.signal.score : b.snapshot[sort.key];
      return (va - vb) * sort.dir;
    });
  }, [rows, rules, sort]);

  const th = (key: Metric | "score", label: string) => (
    <th className="cursor-pointer px-2 py-2 text-right whitespace-nowrap hover:text-fg" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : -1 }))}>
      {label} {sort.key === key && (sort.dir === 1 ? <ArrowUp size={10} className="inline" /> : <ArrowDown size={10} className="inline" />)}
    </th>
  );

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 lg:p-8">
      <PageHeader icon={<Radar size={20} />} title={t("screener.title")} subtitle={t("screener.subtitle")} />

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex items-end gap-2">
              <Field label={t("common.timeframe")} group>
                <Segmented value={tf} onChange={setTf} options={(["15m", "1h", "4h", "1d"] as Timeframe[]).map((x) => ({ value: x, label: x }))} />
              </Field>
              <Button variant="primary" onClick={() => run(tf)} disabled={!!progress}>
                {progress ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                {progress ? `${progress.done}/${progress.total || "…"}` : t("signals.scan")}
              </Button>
            </div>
            {scannedAt && <p className="mt-2 text-xs text-muted">{rows.length} coin · {timeframe}</p>}
          </Card>

          <Card>
            <CardHeader title={t("screener.presets")} />
            <div className="flex flex-wrap gap-1.5 p-3">
              {PRESETS.map((p) => (
                <Button key={p.key} size="xs" onClick={() => setRules(p.rules)}>
                  {t(p.key)}
                </Button>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader
              title={t("screener.addRule")}
              right={
                <Button size="xs" variant="ghost" onClick={() => setRules([...rules, { metric: "rsi", op: "<", value: 30 }])} aria-label={t("screener.addRule")}>
                  <Plus size={13} />
                </Button>
              }
            />
            <div className="space-y-2 p-3">
              {rules.map((r, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <Select className="min-w-0 flex-1" aria-label={t("screener.metric")} value={r.metric} onChange={(e) => setRules(rules.map((x, k) => (k === i ? { ...x, metric: e.target.value as Metric } : x)))}>
                    {METRICS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </Select>
                  <Select className="w-14" aria-label={t("screener.op")} value={r.op} onChange={(e) => setRules(rules.map((x, k) => (k === i ? { ...x, op: e.target.value as Op } : x)))}>
                    <option value=">">&gt;</option>
                    <option value="<">&lt;</option>
                  </Select>
                  <Input className="w-20" type="number" step="any" aria-label={t("alerts.value")} value={r.value} onChange={(e) => setRules(rules.map((x, k) => (k === i ? { ...x, value: +e.target.value } : x)))} />
                  <button className="p-1 text-faint hover:text-bear" onClick={() => setRules(rules.filter((_, k) => k !== i))} aria-label={t("common.delete")}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <Button
                size="xs"
                className="w-full"
                onClick={() => {
                  const name = window.prompt(t("screener.save"));
                  if (name) save(name, rules);
                }}
              >
                <Save size={13} /> {t("screener.save")}
              </Button>
            </div>
          </Card>

          {saved.length > 0 && (
            <Card>
              <CardHeader title={t("screener.saved")} />
              <div className="space-y-1 p-2">
                {saved.map((s) => (
                  <div key={s.name} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-panel-2">
                    <button className="flex-1 text-left text-sm" onClick={() => setRules(s.rules)}>
                      {s.name} <span className="text-xs text-faint">({s.rules.length})</span>
                    </button>
                    <button className="text-faint hover:text-bear" onClick={() => remove(s.name)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        <Card className="min-w-0">
          <CardHeader title={`${t("screener.results")}: ${results.length}`} subtitle={rules.map((r) => `${METRICS.find((m) => m.id === r.metric)?.label} ${r.op} ${r.value}`).join(" · ")} />
          {rows.length === 0 ? (
            <Empty icon={<Radar size={26} />} title={t("signals.notScanned")} />
          ) : results.length === 0 ? (
            <Empty title={t("signals.empty")} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[11px] tracking-wide text-muted uppercase">
                  <tr className="border-b border-line">
                    <th className="px-4 py-2 text-left">{t("common.symbol")}</th>
                    <th className="px-2 py-2" />
                    {th("price", t("common.price"))}
                    {th("change24h", "24h")}
                    {th("score", t("common.score"))}
                    {th("rsi", "RSI")}
                    {th("adx", "ADX")}
                    {th("relVol", "RVOL")}
                    {th("distEma200", "EMA200 %")}
                    {th("atrPct", "ATR %")}
                    <th className="px-4 py-2 text-right">{t("common.side")}</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.symbol} className="border-b border-line/60 hover:bg-panel-2/50">
                      <td className="px-4 py-2">
                        <Link href={`/chart?symbol=${r.symbol}&tf=${timeframe}`} className="flex items-center gap-2 font-semibold hover:text-accent">
                          <CoinIcon symbol={r.symbol} size={22} /> {baseAsset(r.symbol)}
                          {r.signal.status === "ACTIVE" && <Badge tone="accent">●</Badge>}
                        </Link>
                      </td>
                      <td className="px-2">
                        <Sparkline values={r.snapshot.spark} width={70} height={22} />
                      </td>
                      <td className="num px-2 text-right">{formatPrice(r.snapshot.price)}</td>
                      <td className="px-2 text-right">
                        <Pct value={r.snapshot.change24h} />
                      </td>
                      <td className={cn("num px-2 text-right font-semibold", r.signal.score >= 60 ? "text-bull" : r.signal.score <= 40 ? "text-bear" : "text-muted")}>{r.signal.score}</td>
                      <td className={cn("num px-2 text-right", r.snapshot.rsi < 30 ? "text-bull" : r.snapshot.rsi > 70 ? "text-bear" : "")}>{r.snapshot.rsi.toFixed(1)}</td>
                      <td className="num px-2 text-right">{r.snapshot.adx.toFixed(1)}</td>
                      <td className={cn("num px-2 text-right", r.snapshot.relVol > 1.5 && "text-warn")}>{r.snapshot.relVol.toFixed(2)}</td>
                      <td className="px-2 text-right">
                        <Pct value={r.snapshot.distEma200} digits={1} />
                      </td>
                      <td className="num px-2 text-right">{r.snapshot.atrPct.toFixed(2)}</td>
                      <td className="px-4 text-right">
                        <ActionBadge action={r.signal.action} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
