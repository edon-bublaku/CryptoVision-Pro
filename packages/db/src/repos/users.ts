import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../client";
import { auditLog, sessions, users, type User } from "../schema";

export async function createUser(db: Db, input: { email: string; passwordHash: string; name?: string | null; locale?: string }): Promise<User> {
  const [u] = await db
    .insert(users)
    .values({ email: input.email.trim(), passwordHash: input.passwordHash, name: input.name ?? null, locale: input.locale ?? "sq" })
    .returning();
  return u!;
}

export async function findUserByEmail(db: Db, email: string): Promise<User | undefined> {
  const [u] = await db.select().from(users).where(sql`lower(${users.email}) = lower(${email.trim()})`).limit(1);
  return u;
}

export async function findUserById(db: Db, id: string): Promise<User | undefined> {
  const [u] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return u;
}

export async function updateUser(db: Db, id: string, patch: Partial<Omit<User, "id" | "createdAt">>): Promise<User | undefined> {
  const [u] = await db
    .update(users)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();
  return u;
}

export async function deleteUser(db: Db, id: string) {
  await db.delete(users).where(eq(users.id, id));
}

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

/** Brute-force protection: lock the account for 15 minutes after 5 consecutive failures. */
export async function recordLoginAttempt(db: Db, user: User, success: boolean): Promise<void> {
  if (success) {
    await db.update(users).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, user.id));
    return;
  }
  const failed = user.failedLogins + 1;
  await db
    .update(users)
    .set({ failedLogins: failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : user.lockedUntil })
    .where(eq(users.id, user.id));
}

export function isLocked(user: User): boolean {
  return !!user.lockedUntil && user.lockedUntil.getTime() > Date.now();
}

export async function audit(db: Db, entry: { userId?: string | null; action: string; ip?: string | null; meta?: Record<string, unknown> }) {
  await db.insert(auditLog).values({ userId: entry.userId ?? null, action: entry.action, ip: entry.ip ?? null, meta: entry.meta ?? {} });
}

export async function listAudit(db: Db, userId: string, limit = 50) {
  return db.select().from(auditLog).where(eq(auditLog.userId, userId)).orderBy(sql`${auditLog.createdAt} desc`).limit(limit);
}

// ---------- sessions ----------

export async function createSession(db: Db, s: { id: string; userId: string; ttlMs: number; ip?: string | null; userAgent?: string | null }) {
  await db.insert(sessions).values({ id: s.id, userId: s.userId, expiresAt: new Date(Date.now() + s.ttlMs), ip: s.ip ?? null, userAgent: s.userAgent ?? null });
}

/** Resolves a session; expired sessions are deleted. Sliding expiry is refreshed at most hourly. */
export async function getSessionUser(db: Db, id: string, ttlMs: number): Promise<{ user: User; sessionId: string } | null> {
  const [row] = await db.select({ s: sessions, u: users }).from(sessions).innerJoin(users, eq(users.id, sessions.userId)).where(eq(sessions.id, id)).limit(1);
  if (!row) return null;
  if (row.s.expiresAt.getTime() < Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  if (Date.now() - row.s.lastSeenAt.getTime() > 3_600_000)
    await db.update(sessions).set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() + ttlMs) }).where(eq(sessions.id, id));
  return { user: row.u, sessionId: id };
}

export async function deleteSession(db: Db, id: string) {
  await db.delete(sessions).where(eq(sessions.id, id));
}

export async function listSessions(db: Db, userId: string) {
  return db.select().from(sessions).where(eq(sessions.userId, userId)).orderBy(sql`${sessions.lastSeenAt} desc`);
}

/** Revoke all sessions of a user except (optionally) the current one. */
export async function revokeOtherSessions(db: Db, userId: string, keepId?: string) {
  await db.delete(sessions).where(keepId ? and(eq(sessions.userId, userId), sql`${sessions.id} <> ${keepId}`) : eq(sessions.userId, userId));
}
