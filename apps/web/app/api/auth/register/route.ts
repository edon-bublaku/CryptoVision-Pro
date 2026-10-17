import { audit, createUser, findUserByEmail } from "@cv/db";
import { hashPassword, rateLimit } from "@cv/server";
import { body, HttpError, json, route } from "@/lib/server/http";
import { registerInput } from "@/lib/server/schemas";
import { publicUser, startSession } from "@/lib/server/session";

export const POST = route({ rate: 10 }, async ({ req, db, ip }) => {
  const input = await body(req, registerInput);
  const rl = await rateLimit(`register:${ip}`, 5, 3600);
  if (!rl.ok) throw new HttpError(429, "rate_limited", "Too many accounts from this address", { retryAfter: rl.retryAfterSec });
  if (await findUserByEmail(db, input.email)) throw new HttpError(409, "email_taken");
  const user = await createUser(db, { email: input.email, passwordHash: await hashPassword(input.password), name: input.name });
  await startSession(db, user, { ip, userAgent: req.headers.get("user-agent") });
  await audit(db, { userId: user.id, action: "register", ip });
  return json({ user: publicUser(user) }, 201);
});
