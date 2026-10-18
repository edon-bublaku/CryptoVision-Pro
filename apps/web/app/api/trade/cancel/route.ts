import { audit, beginIntent, finishIntent } from "@cv/db";
import { cancelAllOrders, cancelOrder, describeError } from "@cv/exchange/trade";
import { body, HttpError, json, route } from "@/lib/server/http";
import { binanceHttpError, clientFor } from "@/lib/server/trading";
import { cancelRequest } from "@/lib/trade/schema";

/** Cancelling only lowers risk, so it works with the kill switch on and after live is switched off. */
export const POST = route({ auth: true, rate: 30 }, async ({ req, db, user, ip }) => {
  const { intentId, ...r } = await body(req, cancelRequest);
  if (!r.all && r.orderId === undefined && r.algoId === undefined && r.orderListId === undefined) throw new HttpError(400, "order_required");
  const c = await clientFor(db, user!, r.env, r.market);
  const claim = await beginIntent(db, { userId: user!.id, intentId, env: r.env, market: r.market, symbol: r.symbol, action: r.all ? "cancel_all" : "cancel", request: r });
  if (!claim.created) return json({ status: claim.row.status, steps: claim.row.steps, replay: true });
  try {
    const steps = r.all ? await cancelAllOrders(c, r.symbol) : [{ role: "cancel", ok: true, path: "", params: {}, response: await cancelOrder(c, r) }];
    const status = steps.every((s) => s.ok) ? "placed" : "failed";
    await finishIntent(db, claim.row.id, status, steps);
    await audit(db, { userId: user!.id, action: "order_cancelled", ip, meta: { ...r, status } });
    return json({ status, steps });
  } catch (e) {
    await finishIntent(db, claim.row.id, "failed", [{ role: "cancel", ok: false, path: "", params: {}, error: describeError(e) }]);
    binanceHttpError(e);
  }
});
