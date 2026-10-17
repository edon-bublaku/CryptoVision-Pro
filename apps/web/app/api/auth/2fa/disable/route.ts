import { audit, updateUser } from "@cv/db";
import { decrypt, verifyPassword, verifyTotp } from "@cv/server";
import { z } from "zod";
import { body, HttpError, json, route } from "@/lib/server/http";

export const POST = route({ auth: true, rate: 10 }, async ({ req, db, user, ip }) => {
  const { password, code } = await body(req, z.object({ password: z.string().min(1), code: z.string().regex(/^\d{6}$/) }));
  if (!user!.totpEnabled || !user!.totpSecret) throw new HttpError(409, "not_enabled");
  if (!(await verifyPassword(password, user!.passwordHash))) throw new HttpError(401, "invalid_credentials");
  if (!verifyTotp(decrypt(user!.totpSecret), code)) throw new HttpError(400, "invalid_code");
  await updateUser(db, user!.id, { totpEnabled: false, totpSecret: null, recoveryCodes: [] });
  await audit(db, { userId: user!.id, action: "2fa_disabled", ip });
  return json({ ok: true });
});
