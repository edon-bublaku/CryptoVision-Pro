import { audit, updateUser } from "@cv/db";
import { decrypt, generateRecoveryCodes, sha256, verifyTotp } from "@cv/server";
import { z } from "zod";
import { body, HttpError, json, route } from "@/lib/server/http";

/** Confirms the authenticator works, enables 2FA and returns one-time recovery codes (shown once). */
export const POST = route({ auth: true, rate: 10 }, async ({ req, db, user, ip }) => {
  const { code } = await body(req, z.object({ code: z.string().regex(/^\d{6}$/) }));
  if (user!.totpEnabled) throw new HttpError(409, "already_enabled");
  if (!user!.totpSecret || !verifyTotp(decrypt(user!.totpSecret), code)) throw new HttpError(400, "invalid_code");
  const codes = generateRecoveryCodes();
  await updateUser(db, user!.id, { totpEnabled: true, recoveryCodes: codes.map(sha256) });
  await audit(db, { userId: user!.id, action: "2fa_enabled", ip });
  return json({ recoveryCodes: codes });
});
