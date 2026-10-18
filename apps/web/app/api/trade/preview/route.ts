import { body, json, route } from "@/lib/server/http";
import { assertEnvAllowed, binanceHttpError, buildPlan, clientFor, previewOf, tradingContext } from "@/lib/server/trading";
import { bracketRequest } from "@/lib/trade/schema";

/** Exactly what would be sent, with every number rounded and every rule checked. Sends nothing. */
export const POST = route({ auth: true, rate: 60 }, async ({ req, db, user }) => {
  const r = await body(req, bracketRequest);
  const settings = await tradingContext(db, user!);
  assertEnvAllowed(settings, r.env);
  const c = await clientFor(db, user!, r.env, r.market);
  try {
    const { plan, ctx } = await buildPlan(c, r, settings.maxRiskPct);
    return json(previewOf(plan, ctx));
  } catch (e) {
    binanceHttpError(e);
  }
});
