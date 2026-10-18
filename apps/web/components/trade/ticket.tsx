"use client";

import { baseAsset, formatPrice } from "@cv/core";
import { Eye, Loader2, Plus, Send, ShieldAlert, Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, CardHeader, Field, Input, Modal, Segmented } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { useLivePrices } from "@/lib/data/hooks";
import { useT } from "@/lib/i18n";
import { useSettings } from "@/lib/store/settings";
import { useTradeRefresh } from "@/lib/trade/hooks";
import { DEFAULT_TARGETS, newIntentId, riskQuantity, type Ticket, ticketFromQuery, ticketProblems, toRequest } from "@/lib/trade/model";
import type { AccountResponse, OrderResponse, PreviewResponse } from "@/lib/trade/schema";
import { cn } from "@/lib/utils";
import { IssueList, Row, StatusBadge, StepsList, tradeError } from "./parts";

const FEE: Record<Ticket["market"], number> = { spot: 0.001, futures: 0.0005 };

function quoteOf(symbol: string) {
  return ["USDT", "USDC", "FDUSD", "BUSD"].find((q) => symbol.endsWith(q)) ?? "USDT";
}

export function OrderTicket({
  env,
  market,
  onMarket,
  account,
  maxRiskPct,
  disabled,
}: {
  env: "testnet" | "live";
  market: Ticket["market"];
  onMarket: (m: Ticket["market"]) => void;
  account: AccountResponse | undefined;
  maxRiskPct: number;
  disabled: string | null;
}) {
  const t = useT();
  const params = useSearchParams();
  const userRisk = useSettings((s) => s.riskPct);
  const [ticket, setTicket] = useState<Ticket>(() => {
    const q = ticketFromQuery(params);
    return {
      env,
      market: q.market ?? market,
      symbol: q.symbol ?? "BTCUSDT",
      side: q.side ?? "LONG",
      entryType: q.entryType ?? "MARKET",
      price: q.price ?? "",
      quantity: "",
      stopLoss: q.stopLoss ?? "",
      targets: q.targets ? [...q.targets, ...DEFAULT_TARGETS].slice(0, 3).map((x, k) => ({ price: x.price, sizePct: x.sizePct || DEFAULT_TARGETS[k]!.sizePct })) : DEFAULT_TARGETS,
      leverage: q.leverage ?? "3",
      marginType: "ISOLATED",
    };
  });
  const [riskPct, setRiskPct] = useState(() => String(Math.min(userRisk, maxRiskPct)));
  const [manualQty, setManualQty] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<Ticket>) => setTicket((s) => ({ ...s, ...p }));

  // The page owns the market switch (it decides which account is shown); keep both in step.
  useEffect(() => {
    if (ticket.market !== market) onMarket(ticket.market);
  }, [ticket.market, market, onMarket]);
  useEffect(() => setTicket((s) => (s.env === env ? s : { ...s, env })), [env]);

  const live = useLivePrices()[ticket.symbol.toUpperCase()]?.price;
  const quote = quoteOf(ticket.symbol.toUpperCase());
  const equity = Number(account?.balances.find((b) => b.asset === quote)?.total ?? 0);
  const refPrice = ticket.entryType === "LIMIT" ? Number(ticket.price) : (live ?? 0);
  const autoQty = useMemo(
    () => riskQuantity({ entry: refPrice, stop: Number(ticket.stopLoss), equity, riskPct: Math.min(Number(riskPct) || 0, maxRiskPct), feeRate: FEE[ticket.market] }),
    [refPrice, ticket.stopLoss, equity, riskPct, maxRiskPct, ticket.market],
  );
  useEffect(() => {
    if (!manualQty) setTicket((s) => (s.quantity === autoQty ? s : { ...s, quantity: autoQty }));
  }, [autoQty, manualQty]);

  const spot = ticket.market === "spot";
  const problems = ticketProblems(ticket);

  const doPreview = async () => {
    setBusy(true);
    try {
      setPreview(await api<PreviewResponse>("/api/trade/preview", { body: toRequest(ticket) }));
    } catch (e) {
      toast({ title: t("trade.previewFailed"), body: tradeError(e, t), tone: "warn" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title={t("trade.ticket")}
        subtitle={t("trade.ticketSub")}
        right={<Badge tone={env === "live" ? "bear" : "accent"}>{env === "live" ? t("trade.envLive") : t("trade.envTestnet")}</Badge>}
      />
      <div className="space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("trade.market")} group>
            <Segmented
              value={ticket.market}
              onChange={(m) => set({ market: m, side: m === "spot" ? "LONG" : ticket.side })}
              options={[
                { value: "spot", label: "Spot" },
                { value: "futures", label: "Futures USDⓈ-M" },
              ]}
            />
          </Field>
          <Field label={t("common.symbol")}>
            <Input value={ticket.symbol} onChange={(e) => set({ symbol: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} maxLength={20} autoComplete="off" spellCheck={false} />
          </Field>
          <Field label={t("common.side")} group>
            <Segmented
              value={ticket.side}
              onChange={(s) => set({ side: s })}
              options={[
                { value: "LONG", label: "LONG" },
                { value: "SHORT", label: spot ? t("trade.shortFuturesOnly") : "SHORT", title: spot ? t("trade.issue.spot_long_only") : undefined },
              ]}
            />
          </Field>
          <Field label={t("trade.entryType")} group>
            <Segmented
              value={ticket.entryType}
              onChange={(v) => set({ entryType: v })}
              options={[
                { value: "MARKET", label: "Market" },
                { value: "LIMIT", label: "Limit" },
              ]}
            />
          </Field>
          {ticket.entryType === "LIMIT" && (
            <Field label={t("trade.limitPrice")}>
              <Input inputMode="decimal" value={ticket.price} onChange={(e) => set({ price: e.target.value })} />
            </Field>
          )}
          <Field label={t("trade.stopLoss")} hint={t("trade.stopHint")}>
            <Input inputMode="decimal" value={ticket.stopLoss} onChange={(e) => set({ stopLoss: e.target.value })} aria-required />
          </Field>
          {!spot && (
            <>
              <Field label={t("trade.leverage")}>
                <Input inputMode="numeric" value={ticket.leverage} onChange={(e) => set({ leverage: e.target.value.replace(/\D/g, "").slice(0, 3) })} />
              </Field>
              <Field label={t("trade.marginType")} group>
                <Segmented
                  value={ticket.marginType}
                  onChange={(v) => set({ marginType: v })}
                  options={[
                    { value: "ISOLATED", label: "Isolated" },
                    { value: "CROSSED", label: "Cross" },
                  ]}
                />
              </Field>
            </>
          )}
        </div>

        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-muted">{spot ? t("trade.targetSpot") : t("trade.targets")}</legend>
          {(spot ? ticket.targets.slice(0, 1) : ticket.targets).map((tp, k) => (
            <div key={k} className="grid grid-cols-[1fr_5.5rem_auto] items-end gap-2">
              <Field label={`TP${k + 1}`}>
                <Input inputMode="decimal" value={tp.price} onChange={(e) => set({ targets: ticket.targets.map((x, j) => (j === k ? { ...x, price: e.target.value } : x)) })} />
              </Field>
              {spot ? (
                <span className="pb-2 text-xs text-muted">100%</span>
              ) : (
                <Field label="%">
                  <Input inputMode="numeric" value={tp.sizePct} onChange={(e) => set({ targets: ticket.targets.map((x, j) => (j === k ? { ...x, sizePct: e.target.value.replace(/\D/g, "").slice(0, 3) } : x)) })} />
                </Field>
              )}
              {!spot && ticket.targets.length > 1 ? (
                <Button variant="ghost" size="xs" aria-label={t("trade.removeTarget", { n: k + 1 })} onClick={() => set({ targets: ticket.targets.filter((_, j) => j !== k) })}>
                  <Trash2 size={13} />
                </Button>
              ) : (
                <span />
              )}
            </div>
          ))}
          {!spot && ticket.targets.length < 3 && (
            <Button size="xs" variant="ghost" onClick={() => set({ targets: [...ticket.targets, { price: "", sizePct: "20" }] })}>
              <Plus size={13} /> {t("trade.addTarget")}
            </Button>
          )}
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("trade.riskPct", { max: maxRiskPct })} hint={equity > 0 ? t("trade.riskOf", { eq: `${equity.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${quote}` }) : t("trade.noEquity", { q: quote })}>
            <Input
              inputMode="decimal"
              value={riskPct}
              onChange={(e) => {
                setRiskPct(e.target.value);
                setManualQty(false);
              }}
            />
          </Field>
          <Field
            label={t("trade.quantity", { coin: baseAsset(ticket.symbol.toUpperCase()) || "—" })}
            hint={
              manualQty ? (
                <button type="button" className="text-accent hover:underline" onClick={() => setManualQty(false)}>
                  {t("trade.fromRisk")}
                </button>
              ) : (
                t("trade.qtyAuto")
              )
            }
          >
            <Input
              inputMode="decimal"
              value={ticket.quantity}
              onChange={(e) => {
                setManualQty(true);
                set({ quantity: e.target.value });
              }}
            />
          </Field>
        </div>
        {ticket.entryType === "MARKET" && live && <p className="text-xs text-muted">{t("trade.lastPrice", { p: formatPrice(live) })}</p>}

        {disabled ? (
          <p className="flex items-center gap-2 rounded-xl bg-warn-soft p-3 text-xs text-warn">
            <ShieldAlert size={14} /> {disabled}
          </p>
        ) : (
          problems.length > 0 && <p className="text-xs text-muted">{t("trade.fill", { fields: problems.map((p) => t(`trade.field.${p}` as Parameters<typeof t>[0])).join(", ") })}</p>
        )}
        <Button variant="primary" className="w-full sm:w-auto" disabled={busy || !!disabled || problems.length > 0} onClick={doPreview}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />} {t("trade.preview")}
        </Button>
      </div>
      {preview && <ConfirmOrder env={env} ticket={ticket} preview={preview} onClose={() => setPreview(null)} />}
    </Card>
  );
}

function ConfirmOrder({ env, ticket, preview, onClose }: { env: "testnet" | "live"; ticket: Ticket; preview: PreviewResponse; onClose: () => void }) {
  const t = useT();
  const refresh = useTradeRefresh();
  // One intent per confirmation: retrying after a lost response can't send the bracket twice.
  const [intentId] = useState(newIntentId);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OrderResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { plan, context } = preview;
  const q = context.quoteAsset;
  const money = (v: string | number) => `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${q}`;
  const blocked = plan.errors.length > 0;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<OrderResponse>("/api/trade/order", { body: { ...toRequest(ticket), intentId } });
      setResult(r);
      toast({ title: t(`trade.status.${r.status}` as Parameters<typeof t>[0]), body: `${plan.symbol} ${plan.side}`, tone: r.status === "placed" ? "success" : "warn" });
    } catch (e) {
      const data = (e as { data?: OrderResponse }).data;
      if (data?.status === "rejected" && data.plan) setResult(data);
      setError(tradeError(e, t));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  return (
    <Modal open onClose={() => !busy && onClose()} title={t("trade.confirmTitle", { env: env === "live" ? t("trade.envLive") : t("trade.envTestnet") })} wide>
      <div className="space-y-4">
        {env === "live" ? (
          <p className="rounded-xl bg-bear-soft p-3 text-sm font-medium text-bear">{t("trade.liveWarning")}</p>
        ) : (
          <p className="rounded-xl bg-accent-soft p-3 text-sm text-fg">{t("trade.testnetNote")}</p>
        )}
        <div className="grid gap-x-8 sm:grid-cols-2">
          <div>
            <Row label={t("trade.market")} value={plan.market === "spot" ? "Spot" : `Futures · ${plan.marginType === "CROSSED" ? "Cross" : "Isolated"} ${plan.leverage}×`} />
            <Row label={t("common.symbol")} value={plan.symbol} />
            <Row label={t("common.side")} value={plan.side} tone={plan.side === "LONG" ? "bull" : "bear"} />
            <Row label={t("trade.entry")} value={`${plan.entryType === "MARKET" ? "Market ≈ " : "Limit "}${plan.entryPrice}`} />
            {plan.workingPrice && plan.entryType === "MARKET" && <Row label={t("trade.worstFill")} value={plan.workingPrice} />}
            <Row label={t("trade.qty")} value={plan.quantity} />
            <Row label={t("trade.notional")} value={money(plan.notional)} />
            {plan.margin && <Row label={t("trade.margin")} value={money(plan.margin)} />}
            {plan.market === "futures" && <Row label={t("trade.liquidation")} value={plan.liquidation ?? "—"} tone="bear" />}
          </div>
          <div>
            <Row label={t("trade.stopLoss")} value={plan.stopLoss} tone="bear" />
            {plan.targets.map((tp, k) => (
              <Row key={k} label={`TP${k + 1} (${tp.sizePct}%)`} value={`${tp.price} × ${tp.quantity}`} tone="bull" />
            ))}
            <Row label={t("trade.risk")} value={`${money(plan.riskAmount)} · ${plan.riskPct.toFixed(2)}%`} tone="bear" />
            <Row label={t("trade.reward")} value={money(plan.reward)} tone="bull" />
            <Row label="R:R" value={plan.rr.toFixed(2)} />
            <Row label={t("trade.fees")} value={money(Number(plan.entryFee) + Number(plan.exitFeeAtStop))} />
          </div>
        </div>
        <IssueList items={plan.errors} tone="bear" />
        <IssueList items={plan.warnings} tone="warn" />
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
          {plan.market === "spot" ? <li>{t("trade.noteSpot")}</li> : <li>{t("trade.noteFutures")}</li>}
          <li>{t("trade.noteSlippage")}</li>
          <li>{t("trade.noteNoAdvice")}</li>
        </ul>
        <details className="rounded-xl border border-line p-3 text-xs">
          <summary className="cursor-pointer font-medium text-fg">{t("trade.exactOrders", { n: plan.orders.length })}</summary>
          <ol className="mt-2 space-y-2">
            {plan.orders.map((o, k) => (
              <li key={k}>
                <span className="font-medium">{t(`trade.role.${o.role}` as Parameters<typeof t>[0])}</span> <code className="text-muted">POST {o.path}</code>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-panel-2 p-2 text-[11px]">{Object.entries(o.params).map(([k2, v]) => `${k2}=${v}`).join("\n")}</pre>
              </li>
            ))}
          </ol>
        </details>

        {result ? (
          <div className="space-y-2 rounded-xl border border-line p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <StatusBadge status={result.status} /> {t(`trade.statusInfo.${result.status}` as Parameters<typeof t>[0])}
            </div>
            <StepsList steps={result.steps} />
            {result.replay && <p className="text-xs text-muted">{t("trade.replay")}</p>}
          </div>
        ) : (
          env === "live" && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              <span>{t("trade.ackLive")}</span>
            </label>
          )
        )}
        {error && <p className="rounded-xl bg-bear-soft p-3 text-sm text-bear">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>
            {result ? t("common.close") : t("common.cancel")}
          </Button>
          {!result && (
            <Button variant={plan.side === "LONG" ? "bull" : "bear"} disabled={busy || blocked || (env === "live" && !ack)} onClick={send} className={cn(busy && "opacity-70")}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} {t("trade.send", { side: plan.side, coin: baseAsset(plan.symbol) })}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
