import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../client";
import { alertEvents, alerts, pushSubscriptions, users, type AlertRow } from "../schema";

export type AlertInput = Omit<AlertRow, "userId" | "createdAt" | "triggeredAt" | "lastSide"> & { createdAt?: Date };

export async function listAlerts(db: Db, userId: string): Promise<AlertRow[]> {
  return db.select().from(alerts).where(eq(alerts.userId, userId)).orderBy(desc(alerts.createdAt));
}

/** Mirror the client's alert list while keeping server-side evaluation state (lastSide, triggeredAt). */
export async function replaceAlerts(db: Db, userId: string, input: AlertInput[]) {
  await db.transaction(async (tx) => {
    const existing = await tx.select().from(alerts).where(eq(alerts.userId, userId));
    const byId = new Map(existing.map((a) => [a.id, a]));
    const keep = new Set(input.map((a) => a.id));
    const remove = existing.filter((a) => !keep.has(a.id)).map((a) => a.id);
    if (remove.length) await tx.delete(alerts).where(and(eq(alerts.userId, userId), inArray(alerts.id, remove)));
    for (const a of input) {
      const prev = byId.get(a.id);
      const changedLevel = prev && (prev.value !== a.value || prev.type !== a.type);
      const row = { ...a, userId, createdAt: a.createdAt ?? prev?.createdAt ?? new Date(), lastSide: changedLevel || !a.active ? null : (prev?.lastSide ?? null), triggeredAt: prev?.triggeredAt ?? null };
      await tx.insert(alerts).values(row).onConflictDoUpdate({ target: alerts.id, set: row, setWhere: eq(alerts.userId, userId) });
    }
  });
}

export async function activeAlerts(db: Db): Promise<(AlertRow & { telegramChatId: string | null; emailAlerts: boolean; email: string })[]> {
  const rows = await db
    .select({ a: alerts, telegramChatId: users.telegramChatId, emailAlerts: users.emailAlerts, email: users.email })
    .from(alerts)
    .innerJoin(users, eq(users.id, alerts.userId))
    .where(eq(alerts.active, true));
  return rows.map((r) => ({ ...r.a, telegramChatId: r.telegramChatId, emailAlerts: r.emailAlerts, email: r.email }));
}

export async function setAlertSide(db: Db, id: string, side: -1 | 1) {
  await db.update(alerts).set({ lastSide: side }).where(eq(alerts.id, id));
}

/** Marks an alert triggered; returns false if another worker already handled it (idempotency). */
export async function markTriggered(db: Db, alert: Pick<AlertRow, "id" | "once">, cooldownMs = 60 * 60_000): Promise<boolean> {
  const res = await db
    .update(alerts)
    .set({ triggeredAt: new Date(), active: alert.once ? false : true })
    .where(and(eq(alerts.id, alert.id), eq(alerts.active, true), sql`(${alerts.triggeredAt} IS NULL OR ${alerts.triggeredAt} < now() - (${cooldownMs} || ' milliseconds')::interval)`))
    .returning({ id: alerts.id });
  return res.length > 0;
}

export async function logAlertEvent(db: Db, e: { userId: string; alertId: string | null; symbol: string; message: string; channels: string[] }) {
  const [row] = await db.insert(alertEvents).values(e).returning();
  return row!;
}

export async function listAlertEvents(db: Db, userId: string, limit = 100) {
  return db.select().from(alertEvents).where(eq(alertEvents.userId, userId)).orderBy(desc(alertEvents.createdAt)).limit(limit);
}

export async function markEventsRead(db: Db, userId: string) {
  await db.update(alertEvents).set({ read: true }).where(and(eq(alertEvents.userId, userId), eq(alertEvents.read, false)));
}

export async function savePushSubscription(db: Db, userId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }) {
  await db.insert(pushSubscriptions).values({ userId, ...sub }).onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId, keys: sub.keys } });
}

export async function deletePushSubscription(db: Db, endpoint: string) {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

export async function listPushSubscriptions(db: Db, userId: string) {
  return db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
}
