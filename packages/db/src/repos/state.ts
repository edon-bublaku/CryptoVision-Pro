import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../client";
import { drawings, userState } from "../schema";

export interface StateDoc {
  value: unknown;
  version: number;
  updatedAt: string;
}

export async function getAllState(db: Db, userId: string): Promise<Record<string, StateDoc>> {
  const rows = await db.select().from(userState).where(eq(userState.userId, userId));
  return Object.fromEntries(rows.map((r) => [r.key, { value: r.value, version: r.version, updatedAt: r.updatedAt.toISOString() }]));
}

/**
 * Optimistic concurrency: the write succeeds only if `baseVersion` matches the stored version
 * (or the document does not exist yet). Returns the new version, or the current doc on conflict.
 */
export async function putState(db: Db, userId: string, key: string, value: unknown, baseVersion: number | null): Promise<{ ok: true; version: number } | { ok: false; current: StateDoc }> {
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(userState).where(and(eq(userState.userId, userId), eq(userState.key, key))).for("update");
    if (cur && baseVersion !== null && cur.version !== baseVersion)
      return { ok: false as const, current: { value: cur.value, version: cur.version, updatedAt: cur.updatedAt.toISOString() } };
    const version = (cur?.version ?? 0) + 1;
    await tx
      .insert(userState)
      .values({ userId, key, value, version, updatedAt: new Date() })
      .onConflictDoUpdate({ target: [userState.userId, userState.key], set: { value, version, updatedAt: new Date() } });
    return { ok: true as const, version };
  });
}

export async function listDrawings(db: Db, userId: string): Promise<Record<string, { data: unknown[]; updatedAt: string }>> {
  const rows = await db.select().from(drawings).where(eq(drawings.userId, userId));
  return Object.fromEntries(rows.map((r) => [r.symbol, { data: r.data, updatedAt: r.updatedAt.toISOString() }]));
}

export async function putDrawings(db: Db, userId: string, symbol: string, data: unknown[]) {
  if (data.length === 0) {
    await db.delete(drawings).where(and(eq(drawings.userId, userId), eq(drawings.symbol, symbol)));
    return;
  }
  await db
    .insert(drawings)
    .values({ userId, symbol, data, updatedAt: new Date() })
    .onConflictDoUpdate({ target: [drawings.userId, drawings.symbol], set: { data, updatedAt: sql`now()` } });
}
