"use client";

import type { Timeframe } from "@cv/core";
import { baseAsset, formatPrice } from "@cv/core";
import { Bell, BellRing, CheckCheck, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, Modal, Select, Switch, PageHeader } from "@/components/ui/primitives";
import { CoinIcon } from "@/components/ui/viz";
import { useTickers } from "@/lib/data/hooks";
import { useT } from "@/lib/i18n";
import { useAlerts, type AlertType } from "@/lib/store/alerts";
import { useSettings } from "@/lib/store/settings";
import { timeAgo } from "@/lib/utils";

const TYPES: AlertType[] = ["price_above", "price_below", "change_pct", "rsi_above", "rsi_below", "signal"];

export default function AlertsPage() {
  const t = useT();
  const lang = useSettings((s) => s.lang);
  const { alerts, history, update, remove, markAllRead, clearHistory } = useAlerts();
  const [open, setOpen] = useState(false);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    setPerm(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
    return () => markAllRead();
  }, [markAllRead]);

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 lg:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader icon={<Bell size={20} />} title={t("alerts.title")} subtitle={t("alerts.subtitle")} />
        <div className="flex gap-2">
          {perm !== "unsupported" &&
            (perm === "granted" ? (
              <Badge tone="bull">
                <BellRing size={12} /> {t("alerts.browserOn")}
              </Badge>
            ) : (
              <Button onClick={async () => setPerm(await Notification.requestPermission())}>
                <BellRing size={14} /> {t("alerts.enableBrowser")}
              </Button>
            ))}
          <Button variant="primary" onClick={() => setOpen(true)}>
            <Plus size={15} /> {t("alerts.new")}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader title={`${t("alerts.active")} (${alerts.filter((a) => a.active).length})`} />
        {alerts.length === 0 ? (
          <Empty icon={<Bell size={26} />} title={t("alerts.empty")} />
        ) : (
          <div className="divide-y divide-line/60">
            {alerts.map((a) => (
              <div key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                <CoinIcon symbol={a.symbol} size={26} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">
                    {baseAsset(a.symbol)} · {t(`alerts.type.${a.type}`)}{" "}
                    {a.type !== "signal" && a.type !== "drawing" && <span className="num">{a.type.startsWith("price") ? formatPrice(a.value) : a.value}</span>}
                    {a.timeframe && (a.type.startsWith("rsi") || a.type === "drawing") && <span className="text-xs text-faint"> · {a.timeframe}</span>}
                  </div>
                  <div className="text-xs text-muted">
                    {a.note ?? ""} {a.once ? `· ${t("alerts.once")}` : ""} · {timeAgo(a.createdAt, lang)}
                  </div>
                </div>
                <Switch checked={a.active} onChange={(v) => update(a.id, { active: v, lastSide: undefined })} />
                <button className="p-1 text-faint hover:text-bear" onClick={() => remove(a.id)} aria-label={t("common.delete")}>
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title={t("alerts.history")}
          right={
            history.length > 0 && (
              <Button size="xs" variant="ghost" onClick={clearHistory}>
                <CheckCheck size={13} /> {t("common.delete")}
              </Button>
            )
          }
        />
        {history.length === 0 ? (
          <Empty title="—" />
        ) : (
          <div className="divide-y divide-line/60">
            {history.map((h) => (
              <div key={h.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                {!h.read && <span className="h-2 w-2 rounded-full bg-accent" />}
                <span className="font-semibold">{baseAsset(h.symbol)}</span>
                <span className="flex-1 text-muted">{h.message}</span>
                <span className="text-xs text-faint">{timeAgo(h.time, lang)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
      <NewAlertModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function NewAlertModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const add = useAlerts((s) => s.add);
  const { data: tickers } = useTickers();
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [type, setType] = useState<AlertType>("price_above");
  const [value, setValue] = useState("");
  const [tf, setTf] = useState<Timeframe>("1h");
  const [once, setOnce] = useState(true);
  const price = tickers?.find((x) => x.symbol === symbol)?.lastPrice;
  const needsValue = type !== "signal";
  return (
    <Modal open={open} onClose={onClose} title={t("alerts.new")}>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("common.symbol")} className="col-span-2 sm:col-span-1">
          <Select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            {[...(tickers ?? [])]
              .sort((a, b) => b.quoteVolume - a.quoteVolume)
              .slice(0, 200)
              .map((x) => (
                <option key={x.symbol}>{x.symbol}</option>
              ))}
          </Select>
        </Field>
        <Field label={t("alerts.type")} className="col-span-2 sm:col-span-1">
          <Select value={type} onChange={(e) => setType(e.target.value as AlertType)}>
            {TYPES.map((x) => (
              <option key={x} value={x}>
                {t(`alerts.type.${x}`)}
              </option>
            ))}
          </Select>
        </Field>
        {needsValue && (
          <Field label={t("alerts.value")} hint={type.startsWith("price") && price ? `${t("common.price")}: ${formatPrice(price)}` : undefined}>
            <Input type="number" step="any" value={value} placeholder={type.startsWith("rsi") ? "70" : type === "change_pct" ? "5" : price ? String(price) : ""} onChange={(e) => setValue(e.target.value)} />
          </Field>
        )}
        {type.startsWith("rsi") && (
          <Field label={t("common.timeframe")}>
            <Select value={tf} onChange={(e) => setTf(e.target.value as Timeframe)}>
              {(["15m", "1h", "4h", "1d"] as Timeframe[]).map((x) => (
                <option key={x}>{x}</option>
              ))}
            </Select>
          </Field>
        )}
        <div className="col-span-2">
          <Switch checked={once} onChange={setOnce} label={t("alerts.once")} />
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button
          variant="primary"
          disabled={needsValue && !Number.isFinite(parseFloat(value))}
          onClick={() => {
            add({ symbol, type, value: needsValue ? parseFloat(value) : 0, timeframe: type.startsWith("rsi") ? tf : undefined, once });
            onClose();
            setValue("");
          }}
        >
          {t("common.add")}
        </Button>
      </div>
    </Modal>
  );
}
