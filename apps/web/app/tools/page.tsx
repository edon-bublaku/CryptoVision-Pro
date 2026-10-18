"use client";

import type { Side } from "@cv/core";
import { baseAsset, formatPrice } from "@cv/core";
import { closedOnly, getKlinesDeep, universe } from "@cv/exchange";
import { compound, dca, dcaBacktest, leverageCalc, positionSize, quantityForTargetAverage, recoveryGain, requiredRate, rrTargets, type Buy } from "@cv/risk";
import { useQuery } from "@tanstack/react-query";
import { Calculator, Loader2, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, Card, CardHeader, Field, Input, PageHeader, Segmented, Select, Stat } from "@/components/ui/primitives";
import { compactUsd, SeriesChart } from "@/components/ui/series-chart";
import { useTickers } from "@/lib/data/hooks";
import { useT, type TKey } from "@/lib/i18n";
import { useSettings } from "@/lib/store/settings";
import { cn } from "@/lib/utils";

type Tab = "size" | "dca" | "history" | "leverage" | "rr" | "growth";

const n = (v: string) => (v.trim() === "" ? NaN : Number(v));
const fmt = (v: number | undefined, d = 2) => (v === undefined || !Number.isFinite(v) ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: d }));
const usd = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? "—" : `$${fmt(v, 2)}`);

export default function ToolsPage() {
  const t = useT();
  const [tab, setTab] = useState<Tab>("size");
  return (
    <div className="mx-auto max-w-[1100px] space-y-5 p-4 lg:p-8">
      <PageHeader icon={<Calculator size={20} />} title={t("tools.title")} subtitle={t("tools.subtitle")} />
      <div className="-mx-4 overflow-x-auto px-4 pb-1">
        <Segmented
          value={tab}
          onChange={setTab}
          className="min-w-max"
          options={(["size", "dca", "history", "leverage", "rr", "growth"] as Tab[]).map((v) => ({ value: v, label: t(`tools.tab.${v}`) }))}
        />
      </div>
      {tab === "size" && <PositionSize />}
      {tab === "dca" && <Dca />}
      {tab === "history" && <DcaHistory />}
      {tab === "leverage" && <Leverage />}
      {tab === "rr" && <RiskReward />}
      {tab === "growth" && <Growth />}
      <p className="text-[11px] leading-relaxed text-faint">{t("tools.note")}</p>
    </div>
  );
}

function SideToggle({ side, onChange }: { side: Side; onChange: (s: Side) => void }) {
  const t = useT();
  return (
    <Field label={t("common.side")} group>
      <Segmented value={side} onChange={onChange} options={[{ value: "LONG", label: "LONG" }, { value: "SHORT", label: "SHORT" }]} />
    </Field>
  );
}

function Results({ children, cols = 4 }: { children: React.ReactNode; cols?: 2 | 3 | 4 }) {
  return <div className={cn("grid grid-cols-2 gap-4 border-t border-line p-4", cols === 3 && "md:grid-cols-3", cols === 4 && "md:grid-cols-4")}>{children}</div>;
}

function PositionSize() {
  const t = useT();
  const s = useSettings();
  const [f, setF] = useState({ equity: String(s.equity), risk: String(s.riskPct), entry: "100", stop: "95", lev: String(s.maxLeverage) });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const r = positionSize({ equity: n(f.equity), riskPct: n(f.risk), entry: n(f.entry), stopLoss: n(f.stop), maxLeverage: Math.max(1, n(f.lev) || 1), feeRate: s.feePct / 100 });
  return (
    <Card>
      <CardHeader title={t("tools.size.title")} subtitle={t("tools.size.sub")} />
      <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-5">
        <Field label={t("settings.equity")}>
          <Input inputMode="decimal" value={f.equity} onChange={set("equity")} />
        </Field>
        <Field label={t("backtest.riskPct")}>
          <Input inputMode="decimal" value={f.risk} onChange={set("risk")} />
        </Field>
        <Field label={t("plan.entry")}>
          <Input inputMode="decimal" value={f.entry} onChange={set("entry")} placeholder="100" />
        </Field>
        <Field label={t("plan.stop")}>
          <Input inputMode="decimal" value={f.stop} onChange={set("stop")} placeholder="95" />
        </Field>
        <Field label={t("plan.leverage")}>
          <Input inputMode="decimal" value={f.lev} onChange={set("lev")} />
        </Field>
      </div>
      <Results>
        <Stat label={t("common.quantity")} value={r ? fmt(r.quantity, 6) : "—"} />
        <Stat label={t("tools.notional")} value={usd(r?.notional)} />
        <Stat label={t("tools.atRisk")} value={usd(r?.riskAmount)} tone="bear" sub={r ? `${t("tools.fees")} ${usd(r.fees)}` : undefined} />
        <Stat label={t("plan.leverage")} value={r ? `${r.leverage}×` : "—"} sub={r?.liquidationPrice ? `LIQ ${formatPrice(r.liquidationPrice)}` : r?.cappedByLeverage ? t("tools.capped") : undefined} />
      </Results>
    </Card>
  );
}

function Dca() {
  const t = useT();
  const fee = useSettings((s) => s.feePct);
  const [buys, setBuys] = useState<{ price: string; amount: string }[]>([
    { price: "100", amount: "500" },
    { price: "80", amount: "500" },
  ]);
  const [hold, setHold] = useState({ qty: "", avg: "", price: "", target: "" });
  const parsed: Buy[] = buys.map((b) => ({ price: n(b.price), amount: n(b.amount) }));
  const r = dca(parsed, fee / 100);
  const need = quantityForTargetAverage(n(hold.qty), n(hold.avg), n(hold.price), n(hold.target));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title={t("tools.dca.title")} subtitle={t("tools.dca.sub")} />
        <div className="space-y-2 p-4">
          {buys.map((b, k) => (
            <div key={k} className="flex items-end gap-2">
              <Field label={k === 0 ? t("common.price") : ""} className="flex-1">
                <Input inputMode="decimal" aria-label={`${t("common.price")} ${k + 1}`} value={b.price} onChange={(e) => setBuys((xs) => xs.map((x, i) => (i === k ? { ...x, price: e.target.value } : x)))} />
              </Field>
              <Field label={k === 0 ? t("tools.amount") : ""} className="flex-1">
                <Input inputMode="decimal" aria-label={`${t("tools.amount")} ${k + 1}`} value={b.amount} onChange={(e) => setBuys((xs) => xs.map((x, i) => (i === k ? { ...x, amount: e.target.value } : x)))} />
              </Field>
              <button className="mb-1.5 rounded-lg p-2 text-faint hover:bg-panel-2 hover:text-bear disabled:opacity-30" disabled={buys.length <= 1} onClick={() => setBuys((xs) => xs.filter((_, i) => i !== k))} aria-label={t("common.delete")}>
                <X size={15} />
              </button>
            </div>
          ))}
          <Button size="xs" variant="ghost" onClick={() => setBuys((xs) => [...xs, { price: "", amount: "" }])} disabled={buys.length >= 20}>
            <Plus size={12} /> {t("tools.addBuy")}
          </Button>
        </div>
        <Results>
          <Stat label={t("plan.avgEntry")} value={r ? formatPrice(r.avgPrice) : "—"} />
          <Stat label={t("common.quantity")} value={r ? fmt(r.quantity, 6) : "—"} />
          <Stat label={t("tools.invested")} value={usd(r?.invested)} sub={r ? `${t("tools.fees")} ${usd(r.fees)}` : undefined} />
          <Stat label={t("tools.breakeven")} value={r ? formatPrice(r.breakeven) : "—"} sub={t("tools.breakevenSub")} />
        </Results>
      </Card>
      <Card>
        <CardHeader title={t("tools.avg.title")} subtitle={t("tools.avg.sub")} />
        <div className="grid grid-cols-2 gap-3 p-4">
          <Field label={t("tools.avg.qty")}>
            <Input inputMode="decimal" value={hold.qty} onChange={(e) => setHold({ ...hold, qty: e.target.value })} />
          </Field>
          <Field label={t("tools.avg.avg")}>
            <Input inputMode="decimal" value={hold.avg} onChange={(e) => setHold({ ...hold, avg: e.target.value })} />
          </Field>
          <Field label={t("tools.avg.price")}>
            <Input inputMode="decimal" value={hold.price} onChange={(e) => setHold({ ...hold, price: e.target.value })} />
          </Field>
          <Field label={t("tools.avg.target")}>
            <Input inputMode="decimal" value={hold.target} onChange={(e) => setHold({ ...hold, target: e.target.value })} />
          </Field>
        </div>
        <Results cols={2}>
          <Stat label={t("tools.avg.buy")} value={need !== null ? fmt(need, 6) : "—"} sub={need !== null ? usd(need * n(hold.price)) : t("tools.avg.impossible")} />
          <Stat label={t("tools.avg.newSize")} value={need !== null ? fmt(need + n(hold.qty), 6) : "—"} />
        </Results>
      </Card>
    </div>
  );
}

function Leverage() {
  const t = useT();
  const fee = useSettings((s) => s.feePct);
  const [side, setSide] = useState<Side>("LONG");
  const [f, setF] = useState({ entry: "100", lev: "10", margin: "100", exit: "", mmr: "0.5" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const r = leverageCalc({ side, entry: n(f.entry), leverage: n(f.lev), margin: n(f.margin), maintenanceMargin: n(f.mmr) / 100, exit: f.exit ? n(f.exit) : undefined, feeRate: fee / 100 });
  return (
    <Card>
      <CardHeader title={t("tools.lev.title")} subtitle={t("tools.lev.sub")} />
      <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-6">
        <SideToggle side={side} onChange={setSide} />
        <Field label={t("plan.entry")}>
          <Input inputMode="decimal" value={f.entry} onChange={set("entry")} placeholder="100" />
        </Field>
        <Field label={t("plan.leverage")}>
          <Input inputMode="decimal" value={f.lev} onChange={set("lev")} />
        </Field>
        <Field label={t("tools.margin")}>
          <Input inputMode="decimal" value={f.margin} onChange={set("margin")} />
        </Field>
        <Field label={t("tools.mmr")}>
          <Input inputMode="decimal" value={f.mmr} onChange={set("mmr")} />
        </Field>
        <Field label={t("tools.exit")}>
          <Input inputMode="decimal" value={f.exit} onChange={set("exit")} placeholder={t("tools.optional")} />
        </Field>
      </div>
      <Results>
        <Stat label={t("tools.notional")} value={usd(r?.notional)} sub={r ? `${fmt(r.quantity, 6)}` : undefined} />
        <Stat label={t("tools.liq")} value={r ? formatPrice(r.liquidation) : "—"} tone="bear" sub={r ? `${fmt(r.distanceToLiquidationPct, 2)}% ${t("tools.away")}` : undefined} />
        <Stat label="PnL" value={r?.pnl !== undefined ? usd(r.pnl) : "—"} tone={r?.pnl !== undefined ? (r.pnl >= 0 ? "bull" : "bear") : undefined} sub={r?.roe !== undefined ? `ROE ${fmt(r.roe, 2)}%` : undefined} />
        <Stat label={t("tools.fees")} value={usd(r?.fees)} />
      </Results>
      {r && n(f.lev) >= 10 && <p className="mx-4 mb-4 rounded-lg bg-warn-soft p-2.5 text-xs text-warn">{t("tools.lev.warn", { pct: fmt(r.distanceToLiquidationPct, 1) })}</p>}
    </Card>
  );
}

function RiskReward() {
  const t = useT();
  const [side, setSide] = useState<Side>("LONG");
  const [f, setF] = useState({ entry: "100", stop: "95" });
  const r = rrTargets(side, n(f.entry), n(f.stop), [1, 1.5, 2, 3, 4, 5]);
  return (
    <Card>
      <CardHeader title={t("tools.rr.title")} subtitle={t("tools.rr.sub")} />
      <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-3">
        <SideToggle side={side} onChange={setSide} />
        <Field label={t("plan.entry")}>
          <Input inputMode="decimal" value={f.entry} onChange={(e) => setF({ ...f, entry: e.target.value })} placeholder="100" />
        </Field>
        <Field label={t("plan.stop")}>
          <Input inputMode="decimal" value={f.stop} onChange={(e) => setF({ ...f, stop: e.target.value })} placeholder={side === "LONG" ? "95" : "105"} />
        </Field>
      </div>
      {r ? (
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full text-sm">
            <thead className="text-[11px] tracking-wide text-muted uppercase">
              <tr className="border-b border-line">
                <th className="px-4 py-2 text-left">R</th>
                <th className="px-4 py-2 text-right">{t("tools.rr.target")}</th>
                <th className="px-4 py-2 text-right">{t("tools.rr.move")}</th>
                <th className="px-4 py-2 text-right">{t("tools.rr.winRate")}</th>
              </tr>
            </thead>
            <tbody>
              {r.targets.map((x, k) => (
                <tr key={x.r} className="border-b border-line/60">
                  <td className="num px-4 py-2 font-semibold">{x.r}R</td>
                  <td className="num px-4 py-2 text-right text-bull">{formatPrice(x.price)}</td>
                  <td className="num px-4 py-2 text-right">{fmt(x.movePct, 2)}%</td>
                  <td className="num px-4 py-2 text-right text-muted">{r.breakevenWinRate[k]!.winRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="p-4 text-xs text-muted">{t("tools.rr.risk", { pct: fmt(r.riskPct, 2) })}</p>
        </div>
      ) : (
        <p className="border-t border-line p-4 text-xs text-faint">{t("tools.rr.empty")}</p>
      )}
    </Card>
  );
}

function Growth() {
  const t = useT();
  const [f, setF] = useState({ start: "1000", rate: "3", periods: "24", contribution: "100", target: "10000", loss: "30" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const periods = Math.round(n(f.periods));
  const c = compound({ start: n(f.start), ratePct: n(f.rate), periods, contribution: n(f.contribution) || 0 });
  const req = requiredRate(n(f.start), n(f.target), periods);
  const rec = recoveryGain(n(f.loss));
  const max = c ? Math.max(...c.path, 1) : 1;
  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardHeader title={t("tools.growth.title")} subtitle={t("tools.growth.sub")} />
        <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
          <Field label={t("tools.growth.start")}>
            <Input inputMode="decimal" value={f.start} onChange={set("start")} />
          </Field>
          <Field label={t("tools.growth.rate")}>
            <Input inputMode="decimal" value={f.rate} onChange={set("rate")} />
          </Field>
          <Field label={t("tools.growth.periods")}>
            <Input inputMode="numeric" value={f.periods} onChange={set("periods")} />
          </Field>
          <Field label={t("tools.growth.contribution")}>
            <Input inputMode="decimal" value={f.contribution} onChange={set("contribution")} />
          </Field>
        </div>
        {c && (
          <div className="flex h-28 items-end gap-px px-4" aria-hidden>
            {c.path.map((v, k) => (
              <div key={k} className="brand-gradient min-w-px flex-1 rounded-t-sm opacity-80" style={{ height: `${Math.max(2, (v / max) * 100)}%` }} />
            ))}
          </div>
        )}
        <Results cols={3}>
          <Stat label={t("tools.growth.balance")} value={usd(c?.balance)} tone="bull" />
          <Stat label={t("tools.growth.contributed")} value={usd(c?.contributed)} />
          <Stat label={t("tools.growth.gain")} value={usd(c?.gain)} />
        </Results>
      </Card>
      <div className="space-y-4">
        <Card>
          <CardHeader title={t("tools.goal.title")} />
          <div className="p-4">
            <Field label={t("tools.goal.target")}>
              <Input inputMode="decimal" value={f.target} onChange={set("target")} />
            </Field>
            <p className="mt-3 text-sm">
              {req !== null ? t("tools.goal.result", { rate: fmt(req, 2), periods }) : "—"}
            </p>
          </div>
        </Card>
        <Card>
          <CardHeader title={t("tools.recovery.title")} />
          <div className="p-4">
            <Field label={t("tools.recovery.loss")}>
              <Input inputMode="decimal" value={f.loss} onChange={set("loss")} />
            </Field>
            <p className="mt-3 text-sm">{rec !== null ? t("tools.recovery.result", { gain: fmt(rec, 1) }) : "—"}</p>
          </div>
        </Card>
      </div>
    </div>
  );
}

/** Same cache key as the seasonality page, so switching between them doesn't refetch. */
const HISTORY_BARS = 3000;

function DcaHistory() {
  const t = useT();
  const fee = useSettings((s) => s.feePct);
  const { data: tickers } = useTickers();
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [amount, setAmount] = useState("100");
  const [every, setEvery] = useState(7);
  const [years, setYears] = useState(3);
  const options = useMemo(() => (tickers ? universe(tickers, 120).map((x) => x.symbol) : [symbol]), [tickers, symbol]);
  const q = useQuery({
    queryKey: ["daily-deep", symbol, HISTORY_BARS],
    queryFn: async ({ signal }) => closedOnly(await getKlinesDeep(symbol, "1d", HISTORY_BARS, signal)),
    staleTime: 60 * 60_000,
  });
  const r = useMemo(() => (q.data ? dcaBacktest({ candles: q.data.slice(-years * 365), amount: n(amount), everyDays: every, feeRate: fee / 100 }) : null), [q.data, years, amount, every, fee]);
  const shorter = !!q.data && q.data.length < years * 365;
  const pctTone = (v: number | undefined) => (v === undefined ? undefined : v >= 0 ? "bull" : "bear");
  return (
    <Card>
      <CardHeader title={t("tools.hist.title")} subtitle={t("tools.hist.sub")} />
      <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
        <Field label={t("common.symbol")}>
          <Select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            {options.map((o) => (
              <option key={o} value={o}>
                {baseAsset(o)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("tools.hist.amount")}>
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label={t("tools.hist.every")}>
          <Select value={every} onChange={(e) => setEvery(+e.target.value)}>
            {[1, 7, 14, 30].map((d) => (
              <option key={d} value={d}>
                {t(`tools.hist.every${d}` as TKey)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("tools.hist.period")}>
          <Select value={years} onChange={(e) => setYears(+e.target.value)}>
            {[1, 2, 3, 5].map((y) => (
              <option key={y} value={y}>
                {t("tools.hist.years", { n: y })}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {q.isLoading ? (
        <p className="flex items-center gap-2 border-t border-line p-4 text-xs text-faint">
          <Loader2 size={12} className="animate-spin" /> {t("common.loading")}
        </p>
      ) : !r ? (
        <p className="border-t border-line p-4 text-xs text-faint">{q.error ? t("common.error") : "—"}</p>
      ) : (
        <>
          <Results>
            <Stat label={t("tools.hist.invested")} value={usd(r.invested)} sub={t("tools.hist.buys", { n: r.buys })} />
            <Stat label={t("tools.hist.value")} value={usd(r.value)} tone={pctTone(r.returnPct)} sub={`${r.returnPct >= 0 ? "+" : ""}${fmt(r.returnPct, 1)}%`} />
            <Stat label={t("tools.hist.avgCost")} value={formatPrice(r.avgCost)} sub={`${fmt(r.quantity, 6)} ${baseAsset(symbol)}`} />
            <Stat label={t("tools.hist.worst")} value={`${fmt(r.worstPct, 1)}%`} tone="bear" />
          </Results>
          <div className="border-t border-line px-4 pt-4 pb-2">
            <SeriesChart
              label={t("tools.hist.title")}
              times={r.path.map((p) => p.time)}
              format={compactUsd}
              series={[
                { label: "DCA", color: "var(--accent)", values: r.path.map((p) => p.value) },
                { label: t("tools.hist.lump"), color: "var(--warn)", values: r.path.map((p) => p.lump) },
                { label: t("tools.hist.invested"), color: "var(--muted)", values: r.path.map((p) => p.invested), dashed: true },
              ]}
            />
          </div>
          <div className="grid gap-3 border-t border-line p-4 text-sm sm:grid-cols-2">
            <p>
              <b>DCA:</b> {usd(r.value)} ({r.returnPct >= 0 ? "+" : ""}
              {fmt(r.returnPct, 1)}%) · {t("tools.hist.worstShort")} {fmt(r.worstPct, 1)}%
            </p>
            <p>
              <b>{t("tools.hist.lump")}:</b> {usd(r.lump.value)} ({r.lump.returnPct >= 0 ? "+" : ""}
              {fmt(r.lump.returnPct, 1)}%) · {t("tools.hist.worstShort")} {fmt(r.lump.worstPct, 1)}%
            </p>
            {shorter && <p className="text-xs text-warn sm:col-span-2">{t("tools.hist.shorter", { n: fmt((q.data?.length ?? 0) / 365, 1) })}</p>}
            <p className="text-xs text-faint sm:col-span-2">{t("tools.hist.note")}</p>
          </div>
        </>
      )}
    </Card>
  );
}
