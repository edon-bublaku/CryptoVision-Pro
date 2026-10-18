"use client";

import { KeyRound, Loader2, OctagonX, ShieldCheck, ShieldOff, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, Modal, Segmented, Select, Switch } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useSettings } from "@/lib/store/settings";
import { useTradeRefresh } from "@/lib/trade/hooks";
import { newIntentId } from "@/lib/trade/model";
import type { AccountResponse, IntentInfo, KeyInfo, TradingSettings } from "@/lib/trade/schema";
import { cn, timeAgo } from "@/lib/utils";
import { ConfirmAction, StatusBadge, StepsList, tradeError } from "./parts";

type Env = "testnet" | "live";
type Market = "spot" | "futures";

const num = (v: string | number, d = 8) => Number(v).toLocaleString(undefined, { maximumFractionDigits: d });

// ---------- connection ----------

export function ConnectionCard({ env, keys }: { env: Env; keys: KeyInfo[] }) {
  const t = useT();
  const refresh = useTradeRefresh();
  const [market, setMarket] = useState<Market | "both">(env === "live" ? "both" : "futures");
  const [apiKey, setApiKey] = useState("");
  const [secret, setSecret] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [remove, setRemove] = useState<KeyInfo | null>(null);
  const mine = keys.filter((k) => k.env === env);

  const save = async () => {
    setBusy(true);
    try {
      await api("/api/trade/keys", { body: { env, market, apiKey: apiKey.trim(), secret: secret.trim(), password: env === "live" ? password : undefined } });
      setApiKey("");
      setSecret("");
      setPassword("");
      toast({ title: t("trade.keySaved"), tone: "success" });
      refresh();
    } catch (e) {
      toast({ title: t("trade.keyFailed"), body: tradeError(e, t), tone: "warn" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><KeyRound size={15} className="text-accent" /> {t("trade.connection")}</span>} subtitle={env === "live" ? t("trade.connLiveSub") : t("trade.connTestSub")} />
      <div className="space-y-4 p-5">
        <ul className="space-y-2">
          {(["spot", "futures"] as const).map((m) => {
            const k = mine.find((x) => x.market === m);
            return (
              <li key={m} className="flex items-center justify-between gap-2 text-sm">
                <span className="font-medium">{m === "spot" ? "Spot" : "Futures USDⓈ-M"}</span>
                {k ? (
                  <span className="flex items-center gap-2">
                    <Badge tone="bull">•••• {k.keyHint}</Badge>
                    {env === "live" && k.permissions.ipRestrict === false && <Badge tone="warn">{t("trade.noIp")}</Badge>}
                    <Button size="xs" variant="ghost" aria-label={t("trade.removeKey", { m })} onClick={() => setRemove(k)}>
                      <Trash2 size={13} />
                    </Button>
                  </span>
                ) : (
                  <Badge>{t("trade.notConnected")}</Badge>
                )}
              </li>
            );
          })}
        </ul>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field label={t("trade.keyFor")}>
            <Select value={market} onChange={(e) => setMarket(e.target.value as Market | "both")}>
              {env === "live" && <option value="both">{t("trade.bothMarkets")}</option>}
              <option value="spot">Spot</option>
              <option value="futures">Futures USDⓈ-M</option>
            </Select>
          </Field>
          <Field label="API Key">
            <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" spellCheck={false} />
          </Field>
          <Field label="Secret Key">
            <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" spellCheck={false} />
          </Field>
          {env === "live" && (
            <Field label={t("trade.yourPassword")}>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </Field>
          )}
          <Button type="submit" variant="primary" disabled={busy || apiKey.trim().length < 16 || secret.trim().length < 16 || (env === "live" && !password)}>
            {busy && <Loader2 size={14} className="animate-spin" />} {t("trade.verifySave")}
          </Button>
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted">
            {env === "testnet" ? (
              <>
                <li>{t("trade.helpTestSpot")}</li>
                <li>{t("trade.helpTestFut")}</li>
              </>
            ) : (
              <>
                <li>{t("trade.helpLive1")}</li>
                <li>{t("trade.helpLive2")}</li>
              </>
            )}
            <li>{t("trade.helpStorage")}</li>
          </ul>
        </form>
      </div>
      <ConfirmAction
        open={!!remove}
        onClose={() => setRemove(null)}
        title={t("trade.removeKeyTitle")}
        confirmLabel={t("common.delete")}
        danger
        onConfirm={async () => {
          if (!remove) return;
          await api(`/api/trade/keys?env=${remove.env}&market=${remove.market}`, { method: "DELETE" });
          refresh();
        }}
      >
        <p>{t("trade.removeKeyBody")}</p>
      </ConfirmAction>
    </Card>
  );
}

// ---------- safety ----------

export function SafetyCard({ settings }: { settings: TradingSettings }) {
  const t = useT();
  const refresh = useTradeRefresh();
  const [maxRisk, setMaxRisk] = useState(String(settings.maxRiskPct));
  const [liveOpen, setLiveOpen] = useState(false);
  const [panic, setPanic] = useState<Env | null>(null);
  const patch = async (body: Record<string, unknown>) => {
    try {
      await api("/api/trade/settings", { method: "PATCH", body });
      refresh();
    } catch (e) {
      toast({ title: t("common.error"), body: tradeError(e, t), tone: "warn" });
    }
  };
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><ShieldCheck size={15} className="text-accent" /> {t("trade.safety")}</span>} subtitle={t("trade.safetySub")} />
      <div className="space-y-4 p-5 text-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-medium">{t("trade.killSwitch")}</p>
            <p className="text-xs text-muted">{settings.killSwitch ? t("trade.killOn") : t("trade.killOff")}</p>
          </div>
          <Switch checked={settings.killSwitch} onChange={(v) => void patch({ killSwitch: v })} label={<span className="sr-only">{t("trade.killSwitch")}</span>} />
        </div>
        <div className="flex items-end gap-2">
          <Field label={t("trade.maxRisk")} className="flex-1">
            <Input inputMode="decimal" value={maxRisk} onChange={(e) => setMaxRisk(e.target.value)} />
          </Field>
          <Button disabled={!(Number(maxRisk) >= 0.1 && Number(maxRisk) <= 2) || Number(maxRisk) === settings.maxRiskPct} onClick={() => void patch({ maxRiskPct: Number(maxRisk) })}>
            {t("common.save")}
          </Button>
        </div>
        <div className="flex items-start justify-between gap-3 border-t border-line pt-4">
          <div>
            <p className="font-medium">{t("trade.liveTrading")}</p>
            <p className="text-xs text-muted">{settings.mode !== "on" ? t("trade.liveOperatorOff") : settings.liveEnabled ? t("trade.liveOn") : t("trade.liveOff")}</p>
          </div>
          {settings.liveEnabled ? (
            <Button size="xs" onClick={() => void patch({ live: { enabled: false } })}>
              <ShieldOff size={13} /> {t("trade.disableLive")}
            </Button>
          ) : (
            <Button size="xs" variant="danger" disabled={settings.mode !== "on"} onClick={() => setLiveOpen(true)}>
              {t("trade.enableLive")}
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <Button variant="danger" onClick={() => setPanic("testnet")}>
            <OctagonX size={14} /> {t("trade.panic", { env: "Testnet" })}
          </Button>
          {settings.liveEnabled && (
            <Button variant="danger" onClick={() => setPanic("live")}>
              <OctagonX size={14} /> {t("trade.panic", { env: "Live" })}
            </Button>
          )}
        </div>
      </div>
      {liveOpen && <EnableLive totp={settings.totpEnabled} onClose={() => setLiveOpen(false)} onDone={refresh} />}
      <ConfirmAction
        open={!!panic}
        onClose={() => setPanic(null)}
        title={t("trade.panicTitle")}
        confirmLabel={t("trade.panicConfirm")}
        danger
        onConfirm={async () => {
          try {
            const r = await api<{ cancelled: unknown[]; openPositions: number }>("/api/trade/panic", { body: { env: panic } });
            toast({ title: t("trade.panicDone", { n: r.cancelled.length }), body: r.openPositions ? t("trade.panicPositions", { n: r.openPositions }) : undefined, tone: "warn" });
          } catch (e) {
            toast({ title: t("common.error"), body: tradeError(e, t), tone: "warn" });
          }
          refresh();
        }}
      >
        <p>{t("trade.panicBody")}</p>
      </ConfirmAction>
    </Card>
  );
}

function EnableLive({ totp, onClose, onDone }: { totp: boolean; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title={t("trade.enableLiveTitle")}>
      {!totp ? (
        <div className="space-y-3 text-sm">
          <p>{t("trade.needTotp")}</p>
          <Link href="/account" className="text-accent hover:underline">
            {t("trade.goAccount")}
          </Link>
        </div>
      ) : (
        <form
          className="space-y-3 text-sm"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setErr(null);
            try {
              await api("/api/trade/settings", { method: "PATCH", body: { live: { enabled: true, password, code } } });
              onDone();
              onClose();
            } catch (x) {
              setErr(tradeError(x, t));
            } finally {
              setBusy(false);
            }
          }}
        >
          <p className="rounded-xl bg-bear-soft p-3 text-bear">{t("trade.enableLiveWarn")}</p>
          <Field label={t("trade.yourPassword")}>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </Field>
          <Field label={t("trade.totpCode")}>
            <Input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} autoComplete="one-time-code" />
          </Field>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>{t("trade.enableLiveAck")}</span>
          </label>
          {err && <p className="text-bear">{err}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="danger" disabled={busy || !password || code.length !== 6 || !ack}>
              {t("trade.enableLive")}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// ---------- account ----------

export function BalancesCard({ account, loading }: { account?: AccountResponse; loading: boolean }) {
  const t = useT();
  return (
    <Card>
      <CardHeader title={t("trade.balances")} subtitle={account ? `${account.market === "spot" ? "Spot" : "Futures"} · ${account.env}` : undefined} />
      {loading ? (
        <p className="flex items-center gap-2 p-5 text-xs text-faint">
          <Loader2 size={12} className="animate-spin" /> {t("common.loading")}
        </p>
      ) : !account || account.balances.length === 0 ? (
        <Empty title={t("trade.noBalances")} />
      ) : (
        <table className="w-full text-sm">
          <caption className="sr-only">{t("trade.balances")}</caption>
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="px-5 py-2 font-medium">{t("trade.asset")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("trade.free")}</th>
              <th className="px-5 py-2 text-right font-medium">{t("trade.total")}</th>
            </tr>
          </thead>
          <tbody>
            {account.balances.slice(0, 20).map((b) => (
              <tr key={b.asset} className="border-t border-line/50">
                <th scope="row" className="px-5 py-1.5 text-left font-medium">
                  {b.asset}
                </th>
                <td className="num px-3 py-1.5 text-right">{num(b.free)}</td>
                <td className="num px-5 py-1.5 text-right">{num(b.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export function PositionsCard({ env, account }: { env: Env; account: AccountResponse }) {
  const t = useT();
  const refresh = useTradeRefresh();
  const [close, setClose] = useState<AccountResponse["positions"][number] | null>(null);
  return (
    <Card role="region" aria-label={t("trade.positions")}>
      <CardHeader title={t("trade.positions")} subtitle={t("trade.positionsSub")} />
      {account.positions.length === 0 ? (
        <Empty title={t("trade.noPositions")} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <caption className="sr-only">{t("trade.positions")}</caption>
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="px-5 py-2 font-medium">{t("common.symbol")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("trade.qty")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("trade.entry")}</th>
                <th className="px-3 py-2 text-right font-medium">Mark</th>
                <th className="px-3 py-2 text-right font-medium">PnL</th>
                <th className="px-3 py-2 text-right font-medium">{t("trade.liquidation")}</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody>
              {account.positions.map((p) => (
                <tr key={`${p.symbol}-${p.positionSide}`} className="border-t border-line/50">
                  <th scope="row" className="px-5 py-2 text-left font-medium">
                    {p.symbol} <Badge tone={p.side === "LONG" ? "bull" : "bear"}>{p.side}</Badge>{" "}
                    <span className="text-xs text-muted">
                      {p.leverage ? `${p.leverage}× ` : ""}
                      {p.marginType ?? ""}
                    </span>
                  </th>
                  <td className="num px-3 py-2 text-right">{num(p.quantity)}</td>
                  <td className="num px-3 py-2 text-right">{num(p.entryPrice)}</td>
                  <td className="num px-3 py-2 text-right">{num(p.markPrice)}</td>
                  <td className={cn("num px-3 py-2 text-right", Number(p.pnl) >= 0 ? "text-bull" : "text-bear")}>{num(p.pnl, 2)}</td>
                  <td className="num px-3 py-2 text-right">{Number(p.liquidationPrice) > 0 ? num(p.liquidationPrice) : "—"}</td>
                  <td className="px-5 py-2 text-right">
                    <Button size="xs" variant="danger" onClick={() => setClose(p)}>
                      {t("trade.closeMarket")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmAction
        open={!!close}
        onClose={() => setClose(null)}
        title={t("trade.closeTitle", { s: close?.symbol ?? "" })}
        confirmLabel={t("trade.closeMarket")}
        danger
        onConfirm={async () => {
          if (!close) return;
          try {
            const r = await api<{ status: string }>("/api/trade/close", { body: { env, symbol: close.symbol, positionSide: close.positionSide, intentId: newIntentId() } });
            toast({ title: t(`trade.status.${r.status}`), body: close.symbol, tone: r.status === "placed" ? "success" : "warn" });
          } catch (e) {
            toast({ title: t("common.error"), body: tradeError(e, t), tone: "warn" });
          }
          refresh();
        }}
      >
        <p>{t("trade.closeBody", { q: close ? num(close.quantity) : "", s: close?.symbol ?? "" })}</p>
      </ConfirmAction>
    </Card>
  );
}

export function OrdersCard({ env, account }: { env: Env; account: AccountResponse }) {
  const t = useT();
  const refresh = useTradeRefresh();
  const [cancel, setCancel] = useState<AccountResponse["orders"][number] | null>(null);
  const protective = (o: AccountResponse["orders"][number]) => /STOP/.test(o.type) || o.closePosition;
  return (
    <Card role="region" aria-label={t("trade.openOrders")}>
      <CardHeader title={t("trade.openOrders")} subtitle={t("trade.openOrdersSub")} />
      {account.orders.length === 0 ? (
        <Empty title={t("trade.noOrders")} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <caption className="sr-only">{t("trade.openOrders")}</caption>
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="px-5 py-2 font-medium">{t("common.symbol")}</th>
                <th className="px-3 py-2 font-medium">{t("trade.type")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("common.price")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("trade.qty")}</th>
                <th className="px-3 py-2 font-medium">{t("trade.state")}</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody>
              {account.orders.map((o) => (
                <tr key={`${o.kind}-${o.id}`} className="border-t border-line/50">
                  <th scope="row" className="px-5 py-2 text-left font-medium">
                    {o.symbol} <Badge tone={o.side === "BUY" ? "bull" : "bear"}>{o.side}</Badge>
                  </th>
                  <td className="px-3 py-2 text-xs">
                    {o.type}
                    {o.closePosition ? " · close" : o.reduceOnly ? " · reduce" : ""}
                  </td>
                  <td className="num px-3 py-2 text-right">{o.triggerPrice ? `⚡ ${num(o.triggerPrice)}` : num(o.price)}</td>
                  <td className="num px-3 py-2 text-right">{o.closePosition ? t("trade.all") : `${num(o.filled)}/${num(o.quantity)}`}</td>
                  <td className="px-3 py-2 text-xs text-muted">{o.status}</td>
                  <td className="px-5 py-2 text-right">
                    <Button size="xs" variant="ghost" aria-label={t("trade.cancelOrder", { id: o.id })} onClick={() => setCancel(o)}>
                      <X size={14} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmAction
        open={!!cancel}
        onClose={() => setCancel(null)}
        title={t("trade.cancelTitle")}
        confirmLabel={t("trade.cancelConfirm")}
        danger={!!cancel && protective(cancel)}
        onConfirm={async () => {
          if (!cancel) return;
          try {
            await api("/api/trade/cancel", {
              body: {
                env,
                market: account.market,
                symbol: cancel.symbol,
                intentId: newIntentId(),
                ...(cancel.kind === "algo" ? { algoId: cancel.id } : cancel.listId !== undefined && cancel.listId >= 0 ? { orderListId: cancel.listId } : { orderId: cancel.id }),
              },
            });
            toast({ title: t("trade.cancelled"), body: cancel.symbol, tone: "success" });
          } catch (e) {
            toast({ title: t("common.error"), body: tradeError(e, t), tone: "warn" });
          }
          refresh();
        }}
      >
        {cancel && protective(cancel) && <p className="rounded-xl bg-bear-soft p-3 text-bear">{t("trade.cancelStopWarn")}</p>}
        {cancel?.listId !== undefined && cancel.listId >= 0 && <p className="text-muted">{t("trade.cancelList")}</p>}
        <p>
          {cancel?.symbol} · {cancel?.type} · {cancel?.side}
        </p>
      </ConfirmAction>
    </Card>
  );
}

export function HistoryCard({ intents }: { intents: IntentInfo[] }) {
  const t = useT();
  const lang = useSettings((s) => s.lang);
  const [filter, setFilter] = useState<"all" | Env>("all");
  const shown = intents.filter((i) => filter === "all" || i.env === filter);
  return (
    <Card role="region" aria-label={t("trade.history")}>
      <CardHeader
        title={t("trade.history")}
        subtitle={t("trade.historySub")}
        right={
          <Segmented
            size="xs"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: t("common.all") },
              { value: "testnet", label: "Testnet" },
              { value: "live", label: "Live" },
            ]}
          />
        }
      />
      {shown.length === 0 ? (
        <Empty title={t("trade.noHistory")} />
      ) : (
        <ul className="divide-y divide-line/50">
          {shown.map((i) => (
            <li key={i.id} className="px-5 py-2.5">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                  <StatusBadge status={i.status} />
                  <Badge tone={i.env === "live" ? "bear" : "accent"}>{i.env}</Badge>
                  <span className="font-medium">{i.symbol}</span>
                  <span className="text-muted">
                    {t(`trade.action.${i.action}`)}
                    {typeof i.request.side === "string" ? ` · ${i.request.side}` : ""} · {i.market}
                  </span>
                  <span className="ml-auto text-xs text-faint">{timeAgo(new Date(i.createdAt).getTime(), lang)}</span>
                </summary>
                <div className="mt-2">
                  <StepsList steps={i.steps} />
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
