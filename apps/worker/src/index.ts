import { closeDb, dbMode, requireDb } from "@cv/db";
import { log } from "@cv/server";
import { runOnce, startWorker } from "./runtime";

/**
 * Stand-alone worker process. Only needed when the web server runs with WORKER=external
 * (e.g. several web replicas sharing PostgreSQL + Redis); by default the worker runs inside
 * the web server.
 */
async function main() {
  if (dbMode() !== "postgres")
    throw new Error("The embedded database is single-process: the worker already runs inside the web server (`pnpm dev` / `pnpm start`). Set DATABASE_URL to PostgreSQL to run it separately.");
  await requireDb(); // applies pending migrations
  if (process.argv.includes("--once")) {
    await runOnce();
    await closeDb();
    process.exit(0);
  }
  const stop = await startWorker();
  const shutdown = async (sig: string) => {
    log.info({ sig }, "shutting down");
    await stop();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  log.fatal({ err: err instanceof Error ? err.stack : String(err) }, "worker crashed");
  process.exit(1);
});
