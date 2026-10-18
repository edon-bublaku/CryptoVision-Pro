import { asc, desc, eq, isNotNull, isNull, and } from "drizzle-orm";
import type { Db } from "../client";
import { positions, type PositionRow } from "../schema";

export interface PositionInput {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  entry: string;
  quantity: string;
  stopLoss?: string | null;
  takeProfit?: string | null;
  leverage: string;
  strategyId?: string | null;
  notes?: string | null;
  openedAt: Date;
  exit?: string | null;
  closedAt?: Date | null;
  pnl?: string | null;
  r?: number | null;
  paper?: boolean;
  exitReason?: "MANUAL" | "SL" | "TP" | "LIQ" | null;
}

export async function listPositions(db: Db, userId: string): Promise<{ open: PositionRow[]; closed: PositionRow[] }> {
  const open = await db.select().from(positions).where(and(eq(positions.userId, userId), isNull(positions.closedAt))).orderBy(asc(positions.openedAt));
  const closed = await db.select().from(positions).where(and(eq(positions.userId, userId), isNotNull(positions.closedAt))).orderBy(desc(positions.closedAt)).limit(1000);
  return { open, closed };
}

/** The client owns the portfolio list; the server mirrors it atomically. */
export async function replacePortfolio(db: Db, userId: string, rows: PositionInput[]) {
  await db.transaction(async (tx) => {
    await tx.delete(positions).where(eq(positions.userId, userId));
    if (rows.length) await tx.insert(positions).values(rows.map((r) => ({ ...r, userId })));
  });
}
