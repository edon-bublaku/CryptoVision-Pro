import type { Timeframe } from "@cv/core";
import { TIMEFRAMES } from "@cv/core";
import { closeDb, requireDb } from "@cv/db";
import { runMigrations } from "@cv/db/migrate";
import { env, getRedis, log } from "@cv/server";
import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { runRsiAlerts, startPriceAlerts } from "./alerts";
import { scanJob, trackJob } from "./jobs";


/** How often each timeframe is rescanned (ms): a few times per candle. */
const SCAN_EVERY: Record<Timeframe, number> = {
  "1m": 60_000,
  "5m": 120_000,
  "15m": 5 * 60_000,
  "1h": 15 * 60_000,
  "4h": 30 * 60_000,
  "1d": 2 * 3600_000,
  "1w": 6 * 3600_000,
};

type JobName = "scan" | "track" | "rsi";
type JobData = { timeframe?: Timeframe };

async function run(name: JobName, data: JobData) {
  const db = requireDb();
  if (name === "scan" && data.timeframe) return scanJob(db, data.timeframe);
  if (name === "track") return trackJob(db);
  if (name === "rsi") return runRsiAlerts(db);
}

async function main() {
  const e = env();
  if (!e.DATABASE_URL) throw new Error("The worker needs DATABASE_URL");
  await runMigrations();
  const tfs = e.SCAN_TIMEFRAMES.split(",").map((s) => s.trim()).filter((s): s is Timeframe => (TIMEFRAMES as string[]).includes(s));

  if (process.argv.includes("--once")) {
    for (const tf of tfs) await run("scan", { timeframe: tf });
    await run("track", {});
    await closeDb();
    process.exit(0);
  }

  const stopAlerts = startPriceAlerts(requireDb());
  const stops: (() => Promise<void> | void)[] = [stopAlerts];
  // Heartbeat lets the web app know server-side alerting is live (so browsers stop duplicating it).
  const beat = () => getRedis()?.set("cv:worker:heartbeat", String(Date.now()), "EX", 90).catch(() => {});
  void beat();
  const beatTimer = setInterval(beat, 30_000);
  stops.push(() => clearInterval(beatTimer));

  if (e.REDIS_URL) {
    // BullMQ: repeatable jobs survive restarts and run exactly once across worker replicas.
    const connection = new Redis(e.REDIS_URL, { maxRetriesPerRequest: null });
    const queue = new Queue<JobData>("cryptovision", { connection, defaultJobOptions: { removeOnComplete: 100, removeOnFail: 200, attempts: 2, backoff: { type: "exponential", delay: 30_000 } } });
    for (const tf of tfs) await queue.upsertJobScheduler(`scan-${tf}`, { every: SCAN_EVERY[tf]}, { name: "scan", data: { timeframe: tf } });
    await queue.upsertJobScheduler("track", { every: 5 * 60_000}, { name: "track", data: {} });
    await queue.upsertJobScheduler("rsi", { every: 60_000 }, { name: "rsi", data: {} });
    const worker = new Worker<JobData>("cryptovision", (job: Job<JobData>) => run(job.name as JobName, job.data), { connection, concurrency: 1, lockDuration: 10 * 60_000 });
    worker.on("failed", (job, err) => log.error({ job: job?.name, data: job?.data, err: err.message }, "job failed"));
    stops.push(() => worker.close(), () => queue.close(), () => void connection.disconnect());
    log.info({ timeframes: tfs }, "worker started (BullMQ)");
  } else {
    // Single-instance fallback without Redis.
    const timers: ReturnType<typeof setInterval>[] = [];
    let busy = Promise.resolve();
    const schedule = (name: JobName, data: JobData, every: number) => {
      const go = () => (busy = busy.then(() => run(name, data)).then(() => undefined, (err: unknown) => log.error({ name, err: String(err) }, "job failed")));
      void go();
      timers.push(setInterval(go, every));
    };
    for (const tf of tfs) schedule("scan", { timeframe: tf }, SCAN_EVERY[tf]);
    schedule("track", {}, 5 * 60_000);
    schedule("rsi", {}, 60_000);
    stops.push(() => timers.forEach(clearInterval));
    log.info({ timeframes: tfs }, "worker started (in-process scheduler)");
  }

  const shutdown = async (sig: string) => {
    log.info({ sig }, "shutting down");
    for (const s of stops) await s();
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
