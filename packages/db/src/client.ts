import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import pg from "pg";
import { MIGRATIONS } from "./migrations.gen";
import * as schema from "./schema";

/** Works the same over node-postgres and embedded PGlite. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export type DbMode = "postgres" | "embedded" | "memory" | "off";

// numeric(…) → string keeps full precision; bigint counts → number.
pg.types.setTypeParser(20, (v) => Number(v));

interface Handle {
  key: string;
  mode: DbMode;
  db: Db;
  close: () => Promise<void>;
  ready: Promise<Db>;
}

const cache = globalThis as unknown as { __cvDb?: Handle };

/** Where the embedded database lives. Outside the repo so dev-server file watchers ignore it. */
export function embeddedDir() {
  return process.env.PGLITE_DIR || join(process.env.CV_HOME || join(homedir(), ".cryptovision"), "db");
}

/**
 * DATABASE_URL decides the backend:
 * - `postgres://…` → PostgreSQL (TimescaleDB optional)
 * - unset          → embedded PGlite (real Postgres compiled to WASM) in `PGLITE_DIR`
 * - `memory://`    → throwaway in-memory PGlite (tests)
 * - `off`          → no database: the app runs in local-only (browser storage) mode
 */
export function dbMode(url = process.env.DATABASE_URL): DbMode {
  if (!url) return "embedded";
  if (url === "off" || url === "none") return "off";
  if (url.startsWith("memory:")) return "memory";
  return "postgres";
}

function open(url: string | undefined): Handle | null {
  const mode = dbMode(url);
  if (mode === "off") return null;
  const key = `${mode}:${mode === "embedded" ? embeddedDir() : (url ?? "")}`;
  if (mode === "postgres") {
    const pool = new pg.Pool({ connectionString: url, max: Number(process.env.DB_POOL_MAX ?? 10), idleTimeoutMillis: 30_000 });
    const db = drizzlePg(pool, { schema }) as unknown as Db;
    return { key, mode, db, close: () => pool.end(), ready: migratePostgres(pool).then(() => db) };
  }
  const dir = mode === "embedded" ? embeddedDir() : undefined;
  if (dir) mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  const db = drizzlePglite(client, { schema }) as unknown as Db;
  return { key, mode, db, close: () => client.close(), ready: applyMigrations(db).then(() => db) };
}

function handle(url = process.env.DATABASE_URL): Handle | null {
  if (dbMode(url) === "off") return null;
  const h = cache.__cvDb;
  const mode = dbMode(url);
  const key = `${mode}:${mode === "embedded" ? embeddedDir() : (url ?? "")}`;
  if (h?.key === key) return h;
  const next = open(url);
  // A failed migration must not poison the process forever: the next call retries.
  next?.ready.catch(() => {
    if (cache.__cvDb === next) cache.__cvDb = undefined;
  });
  cache.__cvDb = next ?? undefined;
  return next;
}

/**
 * The process-wide database, migrated and ready, or null in local-only mode. One connection
 * per process (survives Next.js hot reloads via globalThis).
 */
export async function getDb(url?: string): Promise<Db | null> {
  const h = handle(url);
  return h ? h.ready : null;
}

export async function requireDb(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new Error("Database is disabled (DATABASE_URL=off)");
  return db;
}

/** Which backend is active, for health checks and logs. */
export function activeDbMode(): DbMode {
  return dbMode();
}

export async function closeDb() {
  const h = cache.__cvDb;
  cache.__cvDb = undefined;
  await h?.close();
}

export async function pingDb(db: Db): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

// ── Migrations ──────────────────────────────────────────────────────────────

type MigrationMeta = { sql: string[]; folderMillis: number; hash: string; bps: boolean };
type Migratable = { dialect: { migrate(m: MigrationMeta[], session: unknown, cfg: { migrationsFolder: string }): Promise<void> }; session: unknown };

/**
 * Applies the SQL migrations embedded in migrations.gen.ts through drizzle's own migrator,
 * so the bookkeeping table and hashes match `drizzle-kit migrate` exactly.
 */
export async function applyMigrations(db: Db) {
  const metas: MigrationMeta[] = MIGRATIONS.map((m) => ({
    sql: m.sql.split("--> statement-breakpoint"),
    bps: m.breakpoints,
    folderMillis: m.when,
    hash: createHash("sha256").update(m.sql).digest("hex"),
  }));
  const d = db as unknown as Migratable;
  await d.dialect.migrate(metas, d.session, { migrationsFolder: "embedded" });
}

/** Serialises migrations across processes (web + worker starting together) with an advisory lock. */
async function migratePostgres(pool: pg.Pool) {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock(727274)");
    await applyMigrations(drizzlePg(client, { schema }) as unknown as Db);
  } finally {
    await client.query("select pg_advisory_unlock(727274)").catch(() => {});
    client.release();
  }
}
