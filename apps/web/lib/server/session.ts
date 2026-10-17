import "server-only";
import { createSession, deleteSession, getSessionUser, type Db, type User } from "@cv/db";
import { env, randomToken, sha256 } from "@cv/server";
import { cookies } from "next/headers";

const prod = () => env().NODE_ENV === "production";
/** __Host- prefix pins the cookie to this exact origin over HTTPS. */
export const COOKIE = () => (prod() ? "__Host-cv_session" : "cv_session");
const ttlMs = () => env().SESSION_TTL_DAYS * 86_400_000;

export async function currentSession(db: Db): Promise<{ user: User; sessionId: string } | null> {
  const token = (await cookies()).get(COOKIE())?.value;
  if (!token) return null;
  return getSessionUser(db, sha256(token), ttlMs());
}

/** Opaque random token in an httpOnly cookie; only its SHA-256 is stored, so a DB leak can't hijack sessions. */
export async function startSession(db: Db, user: User, meta: { ip: string; userAgent: string | null }) {
  const token = randomToken(32);
  await createSession(db, { id: sha256(token), userId: user.id, ttlMs: ttlMs(), ip: meta.ip, userAgent: meta.userAgent?.slice(0, 300) ?? null });
  (await cookies()).set(COOKIE(), token, { httpOnly: true, secure: prod(), sameSite: "lax", path: "/", maxAge: ttlMs() / 1000 });
}

export async function endSession(db: Db, sessionId: string | null) {
  if (sessionId) await deleteSession(db, sessionId);
  (await cookies()).delete(COOKIE());
}

export function publicUser(u: User) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    totpEnabled: u.totpEnabled,
    telegramChatId: u.telegramChatId,
    emailAlerts: u.emailAlerts,
    locale: u.locale,
    createdAt: u.createdAt.toISOString(),
    recoveryCodesLeft: u.recoveryCodes.length,
  };
}

export type PublicUser = ReturnType<typeof publicUser>;
