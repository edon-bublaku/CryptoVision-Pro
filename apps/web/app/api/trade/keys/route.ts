import { audit, deleteExchangeKey, listExchangeKeys, putExchangeKey } from "@cv/db";
import { apiRestrictions, futuresBalance, spotAccountInfo } from "@cv/exchange/trade";
import { encrypt, verifyPassword } from "@cv/server";
import { z } from "zod";
import { body, HttpError, json, route } from "@/lib/server/http";
import { binanceHttpError, newClient, type TradeMarket } from "@/lib/server/trading";
import { keyInput, type KeyInfo, tradeEnv, tradeMarket } from "@/lib/trade/schema";

export const GET = route({ auth: true, rate: 60 }, async ({ db, user }) => {
  const rows = await listExchangeKeys(db, user!.id);
  const keys: KeyInfo[] = rows.map((r) => ({ env: r.env, market: r.market, keyHint: r.keyHint, permissions: r.permissions, verifiedAt: r.verifiedAt?.toISOString() ?? null }));
  return json({ keys });
});

/**
 * Verifies a key against Binance before storing it. Live keys must not allow withdrawals and need a
 * password confirmation; the key is then encrypted and never returned.
 */
export const POST = route({ auth: true, rate: 10 }, async ({ req, db, user, ip }) => {
  const input = await body(req, keyInput);
  if (input.env === "live") {
    if (!input.password || !(await verifyPassword(input.password, user!.passwordHash))) throw new HttpError(401, "invalid_credentials");
  }
  const markets: TradeMarket[] = input.market === "both" ? ["spot", "futures"] : [input.market];
  const permissions: Record<string, boolean> = {};
  try {
    if (input.env === "live") {
      // /sapi exists only on live; it reports what this particular key may do.
      const r = await apiRestrictions(newClient("live", "spot", input.apiKey, input.secret));
      Object.assign(permissions, {
        withdrawals: r.enableWithdrawals,
        spot: r.enableSpotAndMarginTrading,
        futures: r.enableFutures,
        ipRestrict: r.ipRestrict,
        internalTransfer: r.enableInternalTransfer ?? false,
        universalTransfer: r.permitsUniversalTransfer ?? false,
      });
      // A trading key must not be able to move funds out of the account.
      if (r.enableWithdrawals || r.enableInternalTransfer) throw new HttpError(422, "withdraw_enabled");
      for (const m of markets) {
        if (m === "spot" && !r.enableSpotAndMarginTrading) throw new HttpError(422, "spot_trading_disabled");
        if (m === "futures" && !r.enableFutures) throw new HttpError(422, "futures_disabled");
      }
    }
    for (const m of markets) {
      const c = newClient(input.env, m, input.apiKey, input.secret);
      if (m === "spot") {
        const acct = await spotAccountInfo(c);
        if (!acct.canTrade) throw new HttpError(422, "spot_trading_disabled");
      } else await futuresBalance(c);
      permissions[`${m}Verified`] = true;
    }
  } catch (e) {
    binanceHttpError(e);
  }
  const hint = input.apiKey.slice(-4);
  for (const m of markets) {
    await putExchangeKey(db, { userId: user!.id, env: input.env, market: m, apiKeyEnc: encrypt(input.apiKey), secretEnc: encrypt(input.secret), keyHint: hint, permissions, verifiedAt: new Date() });
  }
  await audit(db, { userId: user!.id, action: "exchange_key_saved", ip, meta: { env: input.env, markets, hint, ipRestrict: permissions.ipRestrict ?? null } });
  return json({ ok: true, markets, permissions });
});

export const DELETE = route({ auth: true, rate: 20 }, async ({ req, db, user, ip }) => {
  const q = z.object({ env: tradeEnv, market: tradeMarket }).parse(Object.fromEntries(req.nextUrl.searchParams));
  await deleteExchangeKey(db, user!.id, q.env, q.market);
  await audit(db, { userId: user!.id, action: "exchange_key_deleted", ip, meta: q });
  return json({ ok: true });
});
