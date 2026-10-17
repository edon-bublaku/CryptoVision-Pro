import { audit, deleteUser, listAudit, updateUser } from "@cv/db";
import { sendTelegram, verifyPassword } from "@cv/server";
import { z } from "zod";
import { body, HttpError, json, route } from "@/lib/server/http";
import { endSession, publicUser } from "@/lib/server/session";

export const GET = route({ auth: true }, async ({ db, user }) => {
  const log = await listAudit(db, user!.id, 30);
  return json({ user: publicUser(user!), audit: log.map((a) => ({ action: a.action, ip: a.ip, createdAt: a.createdAt })) });
});

export const PATCH = route({ auth: true, rate: 30 }, async ({ req, db, user, ip }) => {
  const input = await body(
    req,
    z.object({
      name: z.string().trim().max(80).nullable().optional(),
      telegramChatId: z.string().trim().regex(/^-?\d{3,20}$/).nullable().optional(),
      emailAlerts: z.boolean().optional(),
      locale: z.enum(["sq", "en"]).optional(),
      testTelegram: z.boolean().optional(),
    }),
  );
  const { testTelegram, ...patch } = input;
  const u = await updateUser(db, user!.id, patch);
  await audit(db, { userId: user!.id, action: "account_updated", ip, meta: { fields: Object.keys(patch) } });
  let telegram: boolean | undefined;
  if (testTelegram && u?.telegramChatId) telegram = await sendTelegram(u.telegramChatId, "✅ <b>CryptoVision Pro</b>: Telegram u lidh me sukses.");
  return json({ user: publicUser(u!), telegram });
});

/** Permanent deletion (GDPR): requires the password; cascades to all user data. */
export const DELETE = route({ auth: true, rate: 5 }, async ({ req, db, user, sessionId, ip }) => {
  const { password } = await body(req, z.object({ password: z.string().min(1) }));
  if (!(await verifyPassword(password, user!.passwordHash))) throw new HttpError(401, "invalid_credentials");
  await audit(db, { userId: null, action: "account_deleted", ip, meta: { email: user!.email } });
  await endSession(db, sessionId);
  await deleteUser(db, user!.id);
  return json({ ok: true });
});
