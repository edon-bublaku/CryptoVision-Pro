"use client";

import { formatPrice, lastFinite, TIMEFRAME_SECONDS, type Timeframe } from "@cv/core";
import { rsi } from "@cv/indicators";
import { useEffect, useRef } from "react";
import { closedOnly, getKlines } from "@cv/exchange";
import { useLivePrices } from "@/lib/data/hooks";
import { translate } from "@/lib/i18n";
import { useAlerts, type Alert } from "@/lib/store/alerts";
import { useDrawings } from "@/lib/store/drawings";
import { useScan, type TrackedSignal } from "@/lib/store/scan";
import { evaluateOutcome } from "@cv/engine";
import { useSettings } from "@/lib/store/settings";
import { drawingLevelAt } from "../chart/chart-tools";
import { toast } from "../ui/toast";

export async function sendTelegram(token: string, chatId: string, text: string): Promise<boolean> {
  if (!token || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function notify(alert: Alert, message: string) {
  const s = useSettings.getState();
  const title = `${translate(s.lang, "alerts.triggered")}: ${alert.symbol}`;
  useAlerts.getState().log({ alertId: alert.id, symbol: alert.symbol, message });
  toast({ title, body: message, tone: "warn" });
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    try {
      new Notification(title, { body: message, icon: "/icon.svg", tag: alert.id });
    } catch {
      /* some browsers only allow notifications from a service worker */
    }
  }
  void sendTelegram(s.telegram.token, s.telegram.chatId, `🔔 ${title}\n${message}`);
  if (alert.once) useAlerts.getState().update(alert.id, { active: false });
}

/**
 * Background engine mounted once in the shell: evaluates alerts against live prices,
 * polls indicator alerts, and follows tracked signals until they hit TP or SL.
 */
export function AlertEngine() {
  const prices = useLivePrices();
  const alerts = useAlerts((s) => s.alerts);
  const lang = useSettings((s) => s.lang);
  const tr = (k: string) => translate(lang, k);

  // Price-based alerts on every live update.
  useEffect(() => {
    for (const a of alerts) {
      if (!a.active) continue;
      const p = prices[a.symbol];
      if (!p) continue;
      const price = p.price;
      if (a.type === "price_above" && price >= a.value) notify(a, `${tr("alerts.type.price_above")} ${formatPrice(a.value)} → ${formatPrice(price)}`);
      else if (a.type === "price_below" && price <= a.value) notify(a, `${tr("alerts.type.price_below")} ${formatPrice(a.value)} → ${formatPrice(price)}`);
      else if (a.type === "change_pct" && p.open > 0) {
        const chg = ((price - p.open) / p.open) * 100;
        if (Math.abs(chg) >= a.value) notify(a, `24h ${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%`);
      } else if (a.type === "drawing" && a.drawingId) {
        const d = useDrawings.getState().bySymbol[a.symbol]?.find((x) => x.id === a.drawingId);
        if (!d) continue;
        const level = drawingLevelAt(d, Date.now() / 1000);
        if (level === null) continue;
        const side = price >= level ? 1 : -1;
        if (a.lastSide === undefined) useAlerts.getState().update(a.id, { lastSide: side });
        else if (side !== a.lastSide) {
          useAlerts.getState().update(a.id, { lastSide: side });
          notify(a, `${a.note ?? tr("alerts.type.drawing")} ${side > 0 ? "↑" : "↓"} ${formatPrice(level)} (${formatPrice(price)})`);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prices]);

  // RSI alerts: poll once a minute.
  useEffect(() => {
    const run = async () => {
      for (const a of useAlerts.getState().alerts) {
        if (!a.active || (a.type !== "rsi_above" && a.type !== "rsi_below")) continue;
        try {
          const cs = closedOnly(await getKlines(a.symbol, a.timeframe ?? "1h", 200));
          const r = lastFinite(rsi(cs.map((c) => c.close)));
          if ((a.type === "rsi_above" && r >= a.value) || (a.type === "rsi_below" && r <= a.value)) notify(a, `RSI(14, ${a.timeframe ?? "1h"}) = ${r.toFixed(1)}`);
        } catch {
          /* retry next tick */
        }
      }
    };
    void run();
    const id = setInterval(run, 60_000);
    return () => clearInterval(id);
  }, []);

  // "New active signal" alerts fire when a scan produces one for the symbol.
  const rows = useScan((s) => s.rows);
  const scannedAt = useScan((s) => s.scannedAt);
  const seen = useRef<number | null>(scannedAt);
  useEffect(() => {
    if (!scannedAt || seen.current === scannedAt) return;
    seen.current = scannedAt;
    for (const a of useAlerts.getState().alerts) {
      if (!a.active || a.type !== "signal") continue;
      const row = rows.find((r) => r.symbol === a.symbol && r.signal.status === "ACTIVE");
      if (row) notify(a, `${translate(lang, `action.${row.signal.action}`)} · ${row.signal.timeframe} · score ${row.signal.score}`);
    }
  }, [scannedAt, rows, lang]);

  // Track record: follow ACTIVE signals until TP/SL/expiry.
  useEffect(() => {
    const run = async () => {
      const tracked = useScan.getState().tracked;
      const open = tracked.filter((x) => x.outcome === "pending" || x.outcome === "open" || x.outcome === "tp1" || x.outcome === "tp2").slice(0, 25);
      if (!open.length) return;
      const updated = new Map<string, TrackedSignal>();
      for (const tsig of open) {
        try {
          const s = tsig.signal;
          const tf = s.timeframe as Timeframe;
          const cs = (await getKlines(s.symbol, tf, 200)).candles.filter((c) => c.time > s.candleTime);
          updated.set(s.id, evaluateOutcome(tsig, cs, TIMEFRAME_SECONDS[tf]));
        } catch {
          /* keep previous */
        }
      }
      if (updated.size) useScan.getState().updateTracked(useScan.getState().tracked.map((x) => updated.get(x.signal.id) ?? x));
    };
    void run();
    const id = setInterval(run, 5 * 60_000);
    return () => clearInterval(id);
  }, []);

  return null;
}
