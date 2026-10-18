import { audit, beginIntent, finishIntent } from "@cv/db";
import { describeError, executePlan } from "@cv/exchange/trade";
import { body, HttpError, json, route } from "@/lib/server/http";
import { assertEnvAllowed, binanceHttpError, buildPlan, clientFor, idPrefix, tradingContext } from "@/lib/server/trading";
import { orderRequest, type OrderResponse } from "@/lib/trade/schema";

/**
 * Sends a confirmed bracket (entry + mandatory stop + targets). The plan is rebuilt here from the
 * same request, so every rule is enforced server side whatever the browser sent; quantities and
 * prices round deterministically to the same values the confirmation showed.
 */
export const POST = route({ auth: true, rate: 20 }, async ({ req, db, user, ip }) => {
  const { intentId, ...r } = await body(req, orderRequest);
  const settings = await tradingContext(db, user!);
  assertEnvAllowed(settings, r.env);
  if (settings.killSwitch) throw new HttpError(423, "kill_switch");
  const c = await clientFor(db, user!, r.env, r.market);

  const claim = await beginIntent(db, { userId: user!.id, intentId, env: r.env, market: r.market, symbol: r.symbol, action: "bracket", request: r });
  if (!claim.created) {
    const replay: OrderResponse = { status: claim.row.status as OrderResponse["status"], steps: claim.row.steps as OrderResponse["steps"], replay: true };
    return json(replay);
  }
  try {
    const { plan, rules } = await buildPlan(c, r, settings.maxRiskPct, idPrefix());
    if (plan.errors.length) {
      await finishIntent(db, claim.row.id, "rejected", []);
      return json({ status: "rejected", steps: [], plan } satisfies OrderResponse, 422);
    }
    const exec = await executePlan(c, plan, rules);
    await finishIntent(db, claim.row.id, exec.status, exec.steps);
    await audit(db, {
      userId: user!.id,
      action: "order_submitted",
      ip,
      meta: { env: r.env, market: r.market, symbol: r.symbol, side: r.side, entryType: r.entryType, quantity: plan.quantity, stopLoss: plan.stopLoss, status: exec.status, intentId },
    });
    return json({ ...exec, plan } satisfies OrderResponse);
  } catch (e) {
    await finishIntent(db, claim.row.id, "failed", [{ role: "request", ok: false, path: "", params: {}, error: describeError(e) }]);
    binanceHttpError(e);
  }
});
