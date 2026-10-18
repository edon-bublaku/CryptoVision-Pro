import { audit, listExchangeKeys, updateTradingSettings } from "@cv/db";
import { cancelAllOrders, describeError, futuresOpenAlgoOrders, futuresOpenOrders, futuresPositions, spotOpenOrders } from "@cv/exchange/trade";
import { body, json, route } from "@/lib/server/http";
import { clientFor } from "@/lib/server/trading";
import { tradeEnv } from "@/lib/trade/schema";
import { z } from "zod";

/**
 * Emergency stop: raises the kill switch first (no new orders), then cancels every open order in the
 * environment. Positions are reported, not closed: closing is a separate, deliberate decision.
 */
export const POST = route({ auth: true, rate: 10 }, async ({ req, db, user, ip }) => {
  const { env } = await body(req, z.object({ env: tradeEnv }));
  await updateTradingSettings(db, user!.id, { killSwitch: true });
  const keys = (await listExchangeKeys(db, user!.id)).filter((k) => k.env === env);
  const cancelled: { market: string; symbol: string; ok: boolean }[] = [];
  const errors: { market: string; error: ReturnType<typeof describeError> }[] = [];
  let openPositions = 0;
  for (const k of keys) {
    try {
      const c = await clientFor(db, user!, env, k.market);
      let symbols: string[];
      if (k.market === "spot") symbols = (await spotOpenOrders(c)).map((o) => o.symbol);
      else {
        const [o, a, p] = await Promise.all([futuresOpenOrders(c), futuresOpenAlgoOrders(c), futuresPositions(c)]);
        symbols = [...o.map((x) => x.symbol), ...a.map((x) => x.symbol)];
        openPositions += p.length;
      }
      for (const s of new Set(symbols)) cancelled.push({ market: k.market, symbol: s, ok: (await cancelAllOrders(c, s)).every((x) => x.ok) });
    } catch (e) {
      errors.push({ market: k.market, error: describeError(e) });
    }
  }
  await audit(db, { userId: user!.id, action: "trading_panic", ip, meta: { env, cancelled: cancelled.length, errors: errors.length, openPositions } });
  return json({ killSwitch: true, cancelled, errors, openPositions });
});
