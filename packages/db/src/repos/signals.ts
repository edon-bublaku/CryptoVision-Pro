import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../client";
import { scans, signals, trackedSignals, type SignalRow } from "../schema";

export interface SignalInput {
  id: string;
  symbol: string;
  timeframe: string;
  action: string;
  status: string;
  score: number;
  confidence: number;
  strategyId: string | null;
  candleTime: Date;
  signal: unknown;
  snapshot: unknown;
  gate: Record<string, boolean>;
}

export async function startScan(db: Db, timeframe: string): Promise<number> {
  const [s] = await db.insert(scans).values({ timeframe }).returning({ id: scans.id });
  return s!.id;
}

export async function finishScan(db: Db, id: number, rows: SignalInput[], failed: string[]) {
  await db.transaction(async (tx) => {
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200).map((r) => ({ ...r, scanId: id }));
      await tx
        .insert(signals)
        .values(chunk)
        .onConflictDoUpdate({ target: signals.id, set: { scanId: sql`excluded.scan_id`, signal: sql`excluded.signal`, snapshot: sql`excluded.snapshot`, gate: sql`excluded.gate`, status: sql`excluded.status`, action: sql`excluded.action`, score: sql`excluded.score`, confidence: sql`excluded.confidence` } });
    }
    await tx
      .update(scans)
      .set({ finishedAt: new Date(), coins: rows.length, active: rows.filter((r) => r.status === "ACTIVE").length, failed })
      .where(eq(scans.id, id));
    const active = rows.filter((r) => r.status === "ACTIVE").map((r) => r.id);
    if (active.length) await tx.insert(trackedSignals).values(active.map((signalId) => ({ signalId, outcome: "pending" as const }))).onConflictDoNothing();
  });
}

export async function latestScan(db: Db, timeframe: string): Promise<{ scan: typeof scans.$inferSelect; rows: SignalRow[] } | null> {
  const [scan] = await db.select().from(scans).where(and(eq(scans.timeframe, timeframe), sql`${scans.finishedAt} IS NOT NULL`)).orderBy(desc(scans.id)).limit(1);
  if (!scan) return null;
  const rows = await db.select().from(signals).where(eq(signals.scanId, scan.id));
  return { scan, rows };
}

export async function openTracked(db: Db, limit = 200) {
  return db
    .select({ t: trackedSignals, s: signals })
    .from(trackedSignals)
    .innerJoin(signals, eq(signals.id, trackedSignals.signalId))
    .where(inArray(trackedSignals.outcome, ["pending", "open", "tp1", "tp2"]))
    .limit(limit);
}

export async function updateTracked(db: Db, signalId: string, outcome: (typeof trackedSignals.$inferSelect)["outcome"], bestR: number) {
  await db.update(trackedSignals).set({ outcome, bestR, updatedAt: new Date() }).where(eq(trackedSignals.signalId, signalId));
}

export async function trackRecord(db: Db, limit = 300) {
  const rows = await db
    .select({ t: trackedSignals, s: signals })
    .from(trackedSignals)
    .innerJoin(signals, eq(signals.id, trackedSignals.signalId))
    .orderBy(desc(signals.candleTime))
    .limit(limit);
  const resolved = rows.filter((r) => ["tp1", "tp2", "tp3", "sl"].includes(r.t.outcome));
  const wins = resolved.filter((r) => r.t.outcome !== "sl").length;
  return { rows, stats: { total: rows.length, resolved: resolved.length, wins, winRate: resolved.length ? wins / resolved.length : null } };
}
