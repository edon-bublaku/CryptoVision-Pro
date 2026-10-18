"use client";

import type { Side } from "@cv/core";
import { baseAsset, correlation, formatCompact, formatPrice } from "@cv/core";
import { liquidationPrice, maxLoss, orderProblem, positionSize, unrealizedPnl, type OrderType } from "@cv/risk";
import { useQueries } from "@tanstack/react-query";
import { AlertTriangle, BriefcaseBusiness, Download, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, Modal, Segmented, Select, Stat, PageHeader } from "@/components/ui/primitives";
import { CoinIcon, Pct } from "@/components/ui/viz";
import { closedOnly, getKlines } from "@cv/exchange";
import { useLivePrices, useTickers } from "@/lib/data/hooks";
import { sectorOf } from "@cv/exchange";
import { useT } from "@/lib/i18n";
import { usePortfolio, type Position } from "@/lib/store/portfolio";
import { useSettings } from "@/lib/store/settings";
import { cn, download } from "@/lib/utils";

const COLORS = ["#4f8cff", "#16c784", "#f5a524", "#a78bfa", "#22d3ee", "#f472b6", "#f0475a", "#84cc16", "#e7ebf3", "#fb923c"];

export default function PortfolioPage() {
  const t = useT();
  const { positions, closed, orders, close, remove, removeClosed, cancelOrder } = usePortfolio();
  const settings = useSettings();
  const live = useLivePrices();
  const [adding, setAdding] = useState(false);

  const rows = positions.map((p) => {
    const price = live[p.symbol]?.price ?? p.entry;
    const { pnl, roe } = unrealizedPnl(p.side, p.entry, price, p.quantity, p.leverage);
    const risk = maxLoss(p);
    return { p, price, pnl, roe, notional: price * p.quantity, risk };
  });
  const unrealized = rows.reduce((s, r) => s + r.pnl, 0);
  const realized = closed.reduce((s, c) => s + c.pnl, 0);
  const equity = settings.equity + realized + unrealized;
  const openRisk = rows.reduce((s, r) => s + (r.risk ?? 0), 0);
  const noStop = rows.filter((r) => r.risk === null).length;
  const totalNotional = rows.reduce((s, r) => s + r.notional, 0);

  const wins = closed.filter((c) => c.pnl > 0);
  const grossW = wins.reduce((s, c) => s + c.pnl, 0);
  const grossL = Math.abs(closed.filter((c) => c.pnl <= 0).reduce((s, c) => s + c.pnl, 0));

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 lg:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader icon={<BriefcaseBusiness size={20} />} title={t("portfolio.title")} subtitle={t("portfolio.subtitle")} />
        <Button variant="primary" size="md" onClick={() => setAdding(true)}>
          <Plus size={15} /> {t("portfolio.add")}
        </Button>
      </div>

      <Card className="grid grid-cols-2 gap-4 p-4 md:grid-cols-5">
        <Stat label={t("portfolio.equity")} value={`$${equity.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} sub={`${t("settings.equity")}: $${settings.equity.toLocaleString()}`} />
        <Stat label={t("portfolio.unrealized")} value={`${unrealized >= 0 ? "+" : ""}$${unrealized.toFixed(2)}`} tone={unrealized >= 0 ? "bull" : "bear"} />
        <Stat label={t("portfolio.realized")} value={`${realized >= 0 ? "+" : ""}$${realized.toFixed(2)}`} tone={realized >= 0 ? "bull" : "bear"} />
        <Stat
          label={t("portfolio.openRisk")}
          value={`$${openRisk.toFixed(2)}`}
          sub={`${((openRisk / settings.equity) * 100).toFixed(2)}% · ${noStop ? `${noStop} ${t("portfolio.noStop").toLowerCase()}` : "✓"}`}
          tone={openRisk / settings.equity > 0.06 ? "bear" : undefined}
        />
        <Stat label={t("portfolio.positions")} value={`${positions.length} / ${settings.maxPositions}`} sub={`$${formatCompact(totalNotional)}`} />
      </Card>

      {positions.length >= settings.maxPositions && (
        <div className="flex items-center gap-2 rounded-lg bg-warn-soft p-3 text-xs text-warn">
          <AlertTriangle size={14} /> {t("portfolio.maxPositions")}
        </div>
      )}
      <CorrelationWarnings symbols={[...new Set(positions.map((p) => p.symbol))]} />

      {orders.length > 0 && (
        <Card>
          <CardHeader title={t("paper.orders")} subtitle={t("paper.ordersSub")} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[11px] tracking-wide text-muted uppercase">
                <tr className="border-b border-line">
                  <th className="px-4 py-2 text-left">{t("common.symbol")}</th>
                  <th className="px-2 py-2 text-left">{t("paper.type")}</th>
                  <th className="px-2 py-2 text-right">{t("paper.trigger")}</th>
                  <th className="px-2 py-2 text-right">{t("common.price")}</th>
                  <th className="px-2 py-2 text-right">{t("paper.distance")}</th>
                  <th className="px-2 py-2 text-right">SL / TP</th>
                  <th className="px-2 py-2 text-right">{t("common.quantity")}</th>
                  <th className="px-2 py-2 text-right">{t("paper.expires")}</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const last = live[o.symbol]?.price;
                  return (
                    <tr key={o.id} className="border-b border-line/60">
                      <td className="px-4 py-2">
                        <span className="flex items-center gap-2 font-semibold">
                          <CoinIcon symbol={o.symbol} size={20} /> {baseAsset(o.symbol)} <Badge tone={o.side === "LONG" ? "bull" : "bear"}>{o.side}</Badge>
                          {o.leverage > 1 && <Badge>{o.leverage}×</Badge>}
                        </span>
                      </td>
                      <td className="px-2">
                        <Badge tone="accent">{o.type}</Badge>
                      </td>
                      <td className="num px-2 text-right">{formatPrice(o.price)}</td>
                      <td className="num px-2 text-right">{last !== undefined ? formatPrice(last) : "—"}</td>
                      <td className="num px-2 text-right text-xs text-muted">{last !== undefined ? `${(((o.price - last) / last) * 100).toFixed(2)}%` : "—"}</td>
                      <td className="num px-2 text-right text-xs">
                        <div className="text-bear">{o.stopLoss !== undefined ? formatPrice(o.stopLoss) : "—"}</div>
                        <div className="text-bull">{o.takeProfit !== undefined ? formatPrice(o.takeProfit) : "—"}</div>
                      </td>
                      <td className="num px-2 text-right">{o.quantity.toPrecision(5)}</td>
                      <td className="px-2 text-right text-xs text-muted">{o.expiresAt ? new Date(o.expiresAt).toLocaleString() : "GTC"}</td>
                      <td className="px-4 text-right">
                        <Button size="xs" onClick={() => cancelOrder(o.id)}>
                          {t("paper.cancel")}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="min-w-0 xl:col-span-2">
          <CardHeader title={t("portfolio.positions")} />
          {rows.length === 0 ? (
            <Empty icon={<BriefcaseBusiness size={26} />} title={t("portfolio.empty")} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[11px] tracking-wide text-muted uppercase">
                  <tr className="border-b border-line">
                    <th className="px-4 py-2 text-left">{t("common.symbol")}</th>
                    <th className="px-2 py-2 text-right">{t("plan.entry")}</th>
                    <th className="px-2 py-2 text-right">{t("common.price")}</th>
                    <th className="px-2 py-2 text-right">SL / TP</th>
                    <th className="px-2 py-2 text-right">{t("plan.risk")}</th>
                    <th className="px-2 py-2 text-right">PnL</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ p, price, pnl, roe, risk }) => (
                    <tr key={p.id} className="border-b border-line/60">
                      <td className="px-4 py-2">
                        <Link href={`/chart?symbol=${p.symbol}`} className="flex items-center gap-2 hover:text-accent">
                          <CoinIcon symbol={p.symbol} size={24} />
                          <div>
                            <div className="flex items-center gap-1.5 font-semibold">
                              {baseAsset(p.symbol)} <Badge tone={p.side === "LONG" ? "bull" : "bear"}>{p.side}</Badge>
                              {p.leverage > 1 && <Badge>{p.leverage}×</Badge>}
                              {p.paper && <Badge tone="accent">PAPER</Badge>}
                            </div>
                            <div className="num text-[11px] text-muted">
                              {p.quantity.toPrecision(5)} · {p.notes ?? ""}
                            </div>
                          </div>
                        </Link>
                      </td>
                      <td className="num px-2 text-right">{formatPrice(p.entry)}</td>
                      <td className="num px-2 text-right">{formatPrice(price)}</td>
                      <td className="num px-2 text-right text-xs">
                        <div className="text-bear">{p.stopLoss !== undefined ? formatPrice(p.stopLoss) : "—"}</div>
                        <div className="text-bull">{p.takeProfit !== undefined ? formatPrice(p.takeProfit) : "—"}</div>
                        {p.leverage > 1 && <div className="text-warn" title={t("paper.liq")}>LIQ {formatPrice(liquidationPrice(p) ?? 0)}</div>}
                      </td>
                      <td className="num px-2 text-right text-xs">{risk === null ? <span className="text-warn">{t("portfolio.noStop")}</span> : `$${risk.toFixed(2)}`}</td>
                      <td className="px-2 text-right">
                        <div className={cn("num font-semibold", pnl >= 0 ? "text-bull" : "text-bear")}>
                          {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
                        </div>
                        <Pct value={roe} className="text-xs" />
                      </td>
                      <td className="px-4 text-right whitespace-nowrap">
                        <Button
                          size="xs"
                          onClick={() => {
                            const v = window.prompt(t("portfolio.closePrice"), String(price));
                            if (v && Number.isFinite(+v)) close(p.id, +v);
                          }}
                        >
                          {t("portfolio.closePos")}
                        </Button>
                        <button className="ml-1 p-1 text-faint hover:text-bear" onClick={() => remove(p.id)} aria-label={t("common.delete")}>
                          <X size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title={t("portfolio.allocation")} />
            <Donut items={rows.map((r) => ({ label: baseAsset(r.p.symbol), value: r.notional }))} />
          </Card>
          <Card>
            <CardHeader title={t("portfolio.sectorExposure")} />
            <div className="space-y-1.5 p-4">
              {Object.entries(
                rows.reduce<Record<string, number>>((acc, r) => {
                  const s = sectorOf(baseAsset(r.p.symbol));
                  acc[s] = (acc[s] ?? 0) + r.notional;
                  return acc;
                }, {}),
              )
                .sort((a, b) => b[1] - a[1])
                .map(([s, v]) => (
                  <div key={s} className="flex items-center gap-2 text-xs">
                    <span className="w-28 truncate">{s}</span>
                    <div className="h-2 flex-1 rounded-full bg-line">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${(v / (totalNotional || 1)) * 100}%` }} />
                    </div>
                    <span className="num w-12 text-right">{((v / (totalNotional || 1)) * 100).toFixed(0)}%</span>
                  </div>
                ))}
              {rows.length === 0 && <p className="text-xs text-faint">—</p>}
            </div>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader
          title={t("portfolio.journal")}
          subtitle={closed.length ? `${closed.length} · ${t("backtest.winRate")} ${((wins.length / closed.length) * 100).toFixed(0)}% · PF ${grossL ? (grossW / grossL).toFixed(2) : "∞"}` : undefined}
          right={
            closed.length > 0 && (
              <Button
                size="xs"
                onClick={() =>
                  download(
                    "cryptovision-journal.csv",
                    ["symbol,side,entry,exit,quantity,pnl,r,opened,closed,exit_reason,paper,notes", ...closed.map((c) => [c.symbol, c.side, c.entry, c.exit, c.quantity, c.pnl.toFixed(2), c.r?.toFixed(2) ?? "", new Date(c.openedAt).toISOString(), new Date(c.closedAt).toISOString(), c.exitReason ?? "MANUAL", c.paper ? 1 : 0, JSON.stringify(c.notes ?? "")].join(","))].join("\n"),
                    "text/csv",
                  )
                }
              >
                <Download size={13} /> CSV
              </Button>
            )
          }
        />
        {closed.length === 0 ? (
          <Empty title={t("portfolio.journalEmpty")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {closed.map((c) => (
                  <tr key={c.id} className="border-b border-line/60">
                    <td className="px-4 py-2 font-medium">
                      {baseAsset(c.symbol)} <Badge tone={c.side === "LONG" ? "bull" : "bear"}>{c.side}</Badge>
                      {c.paper && <Badge tone="accent" className="ml-1">PAPER</Badge>}
                      {c.exitReason && c.exitReason !== "MANUAL" && (
                        <Badge tone={c.exitReason === "TP" ? "bull" : c.exitReason === "LIQ" ? "warn" : "bear"} className="ml-1">
                          {c.exitReason}
                        </Badge>
                      )}
                    </td>
                    <td className="num px-2 text-right">{formatPrice(c.entry)} → {formatPrice(c.exit)}</td>
                    <td className={cn("num px-2 text-right font-semibold", c.pnl >= 0 ? "text-bull" : "text-bear")}>
                      {c.pnl >= 0 ? "+" : ""}${c.pnl.toFixed(2)}
                    </td>
                    <td className="num px-2 text-right">{c.r !== undefined ? `${c.r.toFixed(2)}R` : "—"}</td>
                    <td className="px-2 text-xs text-muted">{new Date(c.closedAt).toLocaleDateString()}</td>
                    <td className="px-4 text-right">
                      <button className="p-1 text-faint hover:text-bear" onClick={() => removeClosed(c.id)} aria-label={t("common.delete")}>
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <AddPositionModal open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function Donut({ items }: { items: { label: string; value: number }[] }) {
  const total = items.reduce((s, x) => s + x.value, 0);
  if (!total) return <p className="p-4 text-xs text-faint">—</p>;
  const merged = [...items].sort((a, b) => b.value - a.value);
  let acc = 0;
  const R = 60;
  const C = 2 * Math.PI * R;
  return (
    <div className="flex items-center gap-4 p-4">
      <svg width="150" height="150" viewBox="0 0 150 150" className="shrink-0 -rotate-90">
        {merged.map((x, i) => {
          const len = (x.value / total) * C;
          const el = <circle key={i} cx="75" cy="75" r={R} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth="18" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} />;
          acc += len;
          return el;
        })}
      </svg>
      <ul className="space-y-1 text-xs">
        {merged.map((x, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
            <span className="w-14 font-medium">{x.label}</span>
            <span className="num text-muted">{((x.value / total) * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CorrelationWarnings({ symbols }: { symbols: string[] }) {
  const t = useT();
  const qs = useQueries({
    queries: symbols.map((s) => ({ queryKey: ["klines", s, "1d", 91], queryFn: async ({ signal }: { signal: AbortSignal }) => closedOnly(await getKlines(s, "1d", 91, undefined, signal)), staleTime: 3600_000 })),
  });
  const pairs = useMemo(() => {
    const rets = qs.map((q) => (q.data ? q.data.slice(1).map((c, i) => Math.log(c.close / q.data![i]!.close)) : null));
    const out: [string, string, number][] = [];
    for (let i = 0; i < symbols.length; i++)
      for (let j = i + 1; j < symbols.length; j++) {
        const a = rets[i];
        const b = rets[j];
        if (!a || !b) continue;
        const rho = correlation(a, b);
        if (rho > 0.8) out.push([symbols[i]!, symbols[j]!, rho]);
      }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs.map((q) => q.dataUpdatedAt).join(","), symbols.join(",")]);
  if (!pairs.length) return null;
  return (
    <div className="space-y-1 rounded-lg bg-warn-soft p-3 text-xs text-warn">
      {pairs.map(([a, b, r]) => (
        <p key={a + b} className="flex items-center gap-2">
          <AlertTriangle size={13} /> <b>{t("portfolio.correlation")}</b> {baseAsset(a)} / {baseAsset(b)} (ρ {r.toFixed(2)}) {t("portfolio.correlationWarn")}
        </p>
      ))}
    </div>
  );
}

function AddPositionModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const add = usePortfolio((s) => s.add);
  const placeOrder = usePortfolio((s) => s.placeOrder);
  const [exec, setExec] = useState<"manual" | "market" | OrderType>("manual");
  const [expiry, setExpiry] = useState(0);
  const settings = useSettings();
  const { data: tickers } = useTickers();
  const [form, setForm] = useState({ symbol: "BTCUSDT", side: "LONG" as Side, entry: "", quantity: "", stopLoss: "", takeProfit: "", leverage: "1", notes: "" });
  const price = tickers?.find((x) => x.symbol === form.symbol)?.lastPrice;
  const entry = form.entry ? +form.entry : (price ?? 0);
  const sized = form.stopLoss ? positionSize({ equity: settings.equity, riskPct: settings.riskPct, entry, stopLoss: +form.stopLoss, maxLeverage: settings.maxLeverage, feeRate: settings.feePct / 100 }) : null;
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const quantity = form.quantity ? +form.quantity : (sized?.quantity ?? 0);
  const isOrder = exec === "LIMIT" || exec === "STOP";
  // Paper market orders open at the live price, so the typed entry only matters for manual / orders.
  const effEntry = exec === "market" ? (price ?? 0) : entry;
  const problem =
    isOrder && price
      ? orderProblem({ side: form.side, type: exec, price: entry, quantity, stopLoss: form.stopLoss ? +form.stopLoss : undefined, takeProfit: form.takeProfit ? +form.takeProfit : undefined }, price)
      : null;
  const valid = effEntry > 0 && quantity > 0 && !problem && (!isOrder || !!form.entry);

  return (
    <Modal open={open} onClose={onClose} title={t("portfolio.add")}>
      <Field label={t("paper.execution")} className="mb-3" group>
        <Segmented
          value={exec}
          onChange={setExec}
          options={[
            { value: "manual", label: t("paper.manual"), title: t("paper.manualHint") },
            { value: "market", label: "Paper · Market" },
            { value: "LIMIT", label: "Paper · Limit" },
            { value: "STOP", label: "Paper · Stop" },
          ]}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("common.symbol")}>
          <Select value={form.symbol} onChange={(e) => set("symbol", e.target.value)}>
            {[...(tickers ?? [])]
              .sort((a, b) => b.quoteVolume - a.quoteVolume)
              .slice(0, 200)
              .map((x) => (
                <option key={x.symbol} value={x.symbol}>
                  {x.symbol}
                </option>
              ))}
          </Select>
        </Field>
        <Field label={t("common.side")} group>
          <Segmented value={form.side} onChange={(v) => set("side", v)} options={[{ value: "LONG", label: "LONG" }, { value: "SHORT", label: "SHORT" }]} />
        </Field>
        <Field label={isOrder ? t("paper.trigger") : t("plan.entry")} hint={price ? `${t("common.price")}: ${formatPrice(price)}` : undefined}>
          <Input type="number" step="any" disabled={exec === "market"} placeholder={price ? String(price) : ""} value={exec === "market" ? "" : form.entry} onChange={(e) => set("entry", e.target.value)} />
        </Field>
        <Field label={t("plan.stop")}>
          <Input type="number" step="any" value={form.stopLoss} onChange={(e) => set("stopLoss", e.target.value)} />
        </Field>
        <Field label={t("plan.tp")}>
          <Input type="number" step="any" value={form.takeProfit} onChange={(e) => set("takeProfit", e.target.value)} />
        </Field>
        <Field label={t("common.quantity")} hint={sized ? `${t("plan.size")} (${settings.riskPct}%): ${sized.quantity.toPrecision(5)}` : undefined}>
          <Input type="number" step="any" placeholder={sized ? sized.quantity.toPrecision(5) : ""} value={form.quantity} onChange={(e) => set("quantity", e.target.value)} />
        </Field>
        <Field label={t("plan.leverage")}>
          <Input type="number" min="1" max="125" value={form.leverage} onChange={(e) => set("leverage", e.target.value)} />
        </Field>
        <Field label={t("common.notes")}>
          <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
        {isOrder && (
          <Field label={t("paper.expires")}>
            <Select value={expiry} onChange={(e) => setExpiry(+e.target.value)}>
              <option value={0}>GTC</option>
              <option value={3600_000}>1h</option>
              <option value={86_400_000}>24h</option>
              <option value={7 * 86_400_000}>7d</option>
            </Select>
          </Field>
        )}
      </div>
      {problem && <p className="mt-3 rounded-lg bg-warn-soft p-2 text-xs text-warn">{t(`paper.problem.${problem}`)}</p>}
      {exec !== "manual" && <p className="mt-3 text-[11px] leading-relaxed text-faint">{t("paper.help")}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button
          variant="primary"
          disabled={!valid}
          onClick={() => {
            const base = {
              symbol: form.symbol,
              side: form.side,
              quantity,
              stopLoss: form.stopLoss ? +form.stopLoss : undefined,
              takeProfit: form.takeProfit ? +form.takeProfit : undefined,
              // Exchanges cap leverage at 125×; above ~200× the position would be liquidated on entry.
              leverage: Math.min(125, Math.max(1, +form.leverage || 1)),
            };
            if (isOrder) placeOrder({ ...base, type: exec, price: entry, expiresAt: expiry ? Date.now() + expiry : undefined, note: form.notes || undefined });
            else add({ ...base, entry: effEntry, notes: form.notes || undefined, paper: exec === "market" || undefined } satisfies Omit<Position, "id" | "openedAt">);
            onClose();
          }}
        >
          {isOrder ? t("paper.place") : t("common.add")}
        </Button>
      </div>
    </Modal>
  );
}
