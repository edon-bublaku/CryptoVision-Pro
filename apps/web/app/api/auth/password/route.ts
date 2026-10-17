import { audit, revokeOtherSessions, updateUser } from "@cv/db";
import { hashPassword, verifyPassword } from "@cv/server";
import { z } from "zod";
import { body, HttpError, json, route } from "@/lib/server/http";

export const POST = route({ auth: true, rate: 10 }, async ({ req, db, user, sessionId, ip }) => {
  const input = await body(req, z.object({ current: z.string().min(1), next: z.string().min(10).max(200) }));
  if (!(await verifyPassword(input.current, user!.passwordHash))) throw new HttpError(401, "invalid_credentials");
  await updateUser(db, user!.id, { passwordHash: await hashPassword(input.next) });
  await revokeOtherSessions(db, user!.id, sessionId ?? undefined);
  await audit(db, { userId: user!.id, action: "password_changed", ip });
  return json({ ok: true });
});
