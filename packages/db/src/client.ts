import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

// numeric(…) → string keeps full precision; bigint counts → number.
pg.types.setTypeParser(20, (v) => Number(v));

const cache = globalThis as unknown as { __cvDb?: { db: Db; pool: pg.Pool; url: string } };

/**
 * One pool per process (survives Next.js hot reloads). Returns null when DATABASE_URL is
 * not configured so the app can run in local-only mode.
 */
export function getDb(url = process.env.DATABASE_URL): Db | null {
  if (!url) return null;
  if (cache.__cvDb?.url === url) return cache.__cvDb.db;
  const pool = new pg.Pool({ connectionString: url, max: Number(process.env.DB_POOL_MAX ?? 10), idleTimeoutMillis: 30_000 });
  const db = drizzle(pool, { schema });
  cache.__cvDb = { db, pool, url };
  return db;
}

export function requireDb(): Db {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is not configured");
  return db;
}

export async function closeDb() {
  await cache.__cvDb?.pool.end();
  cache.__cvDb = undefined;
}

export async function pingDb(db: Db): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
