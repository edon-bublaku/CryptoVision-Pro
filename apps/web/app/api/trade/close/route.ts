import { audit, beginIntent, finishIntent } from "@cv/db";
import { closeFuturesPosition, describeError, futuresPositions, symbolRules } from "@cv/exchange/trade";
import { body, HttpError, json, route } from "@/lib/server/http";
import { binanceHttpError, clientFor, idPrefix } from "@/lib/server/trading";
import { closeRequest } from "@/lib/trade/schema";

/** Closes a futures position at market (reduce-only) and clears its orders. Allowed with the kill switch on. */
export const POST = route({ auth: true, rate: 20 }, async ({ req, db, user, ip }) => {
  const { intentId, ...r } = await body(req, closeRequest);
  const c = await clientFor(db, user!, r.env, "futures");
  const claim = await beginIntent(db, { userId: user!.id, intentId, env: r.env, market: "futures", symbol: r.symbol, action: "close", request: r });
  if (!claim.created) return json({ status: claim.row.status, steps: claim.row.steps, replay: true });
  try {
    const rules = await symbolRules(c, r.symbol);
    const positions = (await futuresPositions(c, r.symbol)).filter((p) => !r.positionSide || (p.positionSide ?? "BOTH") === r.positionSide);
    if (!positions.length) {
      await finishIntent(db, claim.row.id, "failed", []);
      throw new HttpError(404, "no_position");
    }
    const steps = [];
    for (const p of positions) steps.push(...(await closeFuturesPosition(c, rules, p, idPrefix())));
    const status = steps.every((s) => s.ok) ? "placed" : "failed";
    await finishIntent(db, claim.row.id, status, steps);
    await audit(db, { userId: user!.id, action: "position_closed", ip, meta: { env: r.env, symbol: r.symbol, status } });
    return json({ status, steps });
  } catch (e) {
    if (!(e instanceof HttpError)) await finishIntent(db, claim.row.id, "failed", [{ role: "close", ok: false, path: "", params: {}, error: describeError(e) }]);
    binanceHttpError(e);
  }
});
