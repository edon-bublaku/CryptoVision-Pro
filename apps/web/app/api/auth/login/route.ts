import { audit, findUserByEmail, isLocked, recordLoginAttempt, updateUser } from "@cv/db";
import { decrypt, rateLimit, sha256, verifyPassword, verifyTotp } from "@cv/server";
import { body, HttpError, json, route } from "@/lib/server/http";
import { loginInput } from "@/lib/server/schemas";
import { publicUser, startSession } from "@/lib/server/session";

// Verifying a dummy hash for unknown emails keeps response time constant (no user enumeration).
const DUMMY = "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

export const POST = route({ rate: 20 }, async ({ req, db, ip }) => {
  const input = await body(req, loginInput);
  const rl = await rateLimit(`login:${input.email.toLowerCase()}`, 10, 900);
  if (!rl.ok) throw new HttpError(429, "rate_limited", "Too many attempts", { retryAfter: rl.retryAfterSec });

  const user = await findUserByEmail(db, input.email);
  const passwordOk = await verifyPassword(input.password, user?.passwordHash ?? DUMMY);
  if (!user || !passwordOk) {
    if (user) {
      await recordLoginAttempt(db, user, false);
      await audit(db, { userId: user.id, action: "login_failed", ip });
    }
    throw new HttpError(401, "invalid_credentials");
  }
  if (isLocked(user)) throw new HttpError(423, "locked", "Account temporarily locked", { until: user.lockedUntil?.toISOString() });

  if (user.totpEnabled && user.totpSecret) {
    if (!input.code) return json({ needTotp: true }, 200);
    const code = input.code.replace(/\s/g, "").toLowerCase();
    const okTotp = /^\d{6}$/.test(code) && verifyTotp(decrypt(user.totpSecret), code);
    const recoveryIdx = okTotp ? -1 : user.recoveryCodes.indexOf(sha256(code));
    if (!okTotp && recoveryIdx < 0) {
      await recordLoginAttempt(db, user, false);
      await audit(db, { userId: user.id, action: "login_failed_2fa", ip });
      throw new HttpError(401, "invalid_code");
    }
    if (recoveryIdx >= 0) {
      await updateUser(db, user.id, { recoveryCodes: user.recoveryCodes.filter((_, i) => i !== recoveryIdx) });
      await audit(db, { userId: user.id, action: "recovery_code_used", ip });
    }
  }

  await recordLoginAttempt(db, user, true);
  await startSession(db, user, { ip, userAgent: req.headers.get("user-agent") });
  await audit(db, { userId: user.id, action: "login", ip });
  return json({ user: publicUser(user) });
});
