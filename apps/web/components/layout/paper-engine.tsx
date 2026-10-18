"use client";

import { baseAsset, formatPrice } from "@cv/core";
import { exitHit, orderTriggered } from "@cv/risk";
import { useEffect } from "react";
import { useLivePrices } from "@/lib/data/hooks";
import { translate } from "@/lib/i18n";
import { usePortfolio } from "@/lib/store/portfolio";
import { useSettings } from "@/lib/store/settings";
import { toast } from "../ui/toast";

function announce(title: string, body: string, tone: "success" | "warn") {
  toast({ title, body, tone });
  if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
    try {
      new Notification(title, { body, icon: "/icon.svg" });
    } catch {
      /* service-worker-only platforms */
    }
  }
}

/**
 * Paper-trading executor: on every live price update it expires stale orders, fills triggered
 * LIMIT/STOP orders and closes paper positions at stop-loss, take-profit or liquidation.
 * Runs while the app is open; fills use deterministic ids so several open devices converge.
 */
export function PaperEngine() {
  const prices = useLivePrices();

  useEffect(() => {
    const lang = useSettings.getState().lang;
    const tr = (k: string, p?: Record<string, string | number>) => translate(lang, k, p);
    const pf = usePortfolio.getState();
    const now = Date.now();

    for (const o of pf.orders) {
      if (o.expiresAt && o.expiresAt <= now) {
        pf.cancelOrder(o.id);
        announce(tr("paper.expired"), `${baseAsset(o.symbol)} ${o.type} ${formatPrice(o.price)}`, "warn");
        continue;
      }
      const p = prices[o.symbol]?.price;
      if (p === undefined || !orderTriggered(o, p)) continue;
      const pos = usePortfolio.getState().fillOrder(o.id, p);
      if (pos) announce(tr("paper.filled", { side: pos.side, symbol: baseAsset(pos.symbol) }), `${o.type} @ ${formatPrice(pos.entry)} · ${pos.quantity}`, "success");
    }

    for (const pos of usePortfolio.getState().positions) {
      if (!pos.paper) continue;
      const p = prices[pos.symbol]?.price;
      if (p === undefined) continue;
      const hit = exitHit(pos, p);
      if (!hit) continue;
      usePortfolio.getState().close(pos.id, hit.price, hit.reason);
      const closed = usePortfolio.getState().closed.find((c) => c.id === pos.id);
      const pnl = closed ? `${closed.pnl >= 0 ? "+" : ""}${closed.pnl.toFixed(2)} USDT` : "";
      announce(tr(`paper.exit.${hit.reason}`, { symbol: baseAsset(pos.symbol) }), `${formatPrice(hit.price)} · ${pnl}`, hit.reason === "TP" ? "success" : "warn");
    }
  }, [prices]);

  return null;
}
