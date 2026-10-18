import { audit, updateTradingSettings } from "@cv/db";
import { decrypt, env, verifyPassword, verifyTotp } from "@cv/server";
import { body, HttpError, json, route } from "@/lib/server/http";
import { tradingContext } from "@/lib/server/trading";
import { settingsPatch, type TradingSettings } from "@/lib/trade/schema";

const view = (s: { liveEnabled: boolean; killSwitch: boolean; maxRiskPct: number }, totp: boolean): TradingSettings => ({
  liveEnabled: s.liveEnabled,
  killSwitch: s.killSwitch,
  maxRiskPct: s.maxRiskPct,
  totpEnabled: totp,
  mode: env().TRADING,
});

export const GET = route({ auth: true, rate: 60 }, async ({ db, user }) => json(view(await tradingContext(db, user!), user!.totpEnabled)));

/**
 * Live trading needs 2FA: turning it on asks for the password and a current TOTP code. Turning it
 * off, raising the kill switch or lowering risk never asks for anything.
 */
export const PATCH = route({ auth: true, rate: 20 }, async ({ req, db, user, ip }) => {
  const p = await body(req, settingsPatch);
  const patch: { killSwitch?: boolean; maxRiskPct?: number; liveEnabled?: boolean; liveEnabledAt?: Date | null } = {};
  if (p.killSwitch !== undefined) patch.killSwitch = p.killSwitch;
  if (p.maxRiskPct !== undefined) patch.maxRiskPct = Math.round(p.maxRiskPct * 100) / 100;
  if (p.live?.enabled === true) {
    if (env().TRADING !== "on") throw new HttpError(403, "live_disabled_by_operator");
    if (!user!.totpEnabled || !user!.totpSecret) throw new HttpError(409, "totp_required");
    if (!(await verifyPassword(p.live.password, user!.passwordHash))) throw new HttpError(401, "invalid_credentials");
    if (!verifyTotp(decrypt(user!.totpSecret), p.live.code)) throw new HttpError(400, "invalid_code");
    patch.liveEnabled = true;
    patch.liveEnabledAt = new Date();
  } else if (p.live?.enabled === false) {
    patch.liveEnabled = false;
    patch.liveEnabledAt = null;
  }
  const s = await updateTradingSettings(db, user!.id, patch);
  await audit(db, { userId: user!.id, action: "trading_settings_updated", ip, meta: { ...patch, liveEnabledAt: undefined } });
  return json(view(s, user!.totpEnabled));
});
