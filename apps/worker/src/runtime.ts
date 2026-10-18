import type { Timeframe } from "@cv/core";
import { TIMEFRAMES } from "@cv/core";
import { requireDb } from "@cv/db";
import { env, log, setFlag } from "@cv/server";
import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { runRatingAlerts, runRsiAlerts, startPriceAlerts } from "./alerts";
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

type JobName = "scan" | "track" | "rsi" | "rating";
type JobData = { timeframe?: Timeframe };

async function run(name: JobName, data: JobData) {
  const db = await requireDb();
  if (name === "scan" && data.timeframe) return scanJob(db, data.timeframe);
  if (name === "track") return trackJob(db);
  if (name === "rsi") return runRsiAlerts(db);
  if (name === "rating") return runRatingAlerts(db);
}

export function scanTimeframes(): Timeframe[] {
  return env()
    .SCAN_TIMEFRAMES.split(",")
    .map((s) => s.trim())
    .filter((s): s is Timeframe => (TIMEFRAMES as string[]).includes(s));
}

/** One full pass: scan every configured timeframe, then follow open signals. */
export async function runOnce() {
  for (const tf of scanTimeframes()) await run("scan", { timeframe: tf });
  await run("track", {});
}

const g = globalThis as unknown as { __cvWorker?: Promise<() => Promise<void>> };

/**
 * Starts scans, signal tracking and 24/7 alerts. Runs either as its own process (`pnpm dev:worker`)
 * or inside the web server (instrumentation.ts) — the default single-process setup. Idempotent per
 * process. Returns a stop function.
 */
export function startWorker(): Promise<() => Promise<void>> {
  return (g.__cvWorker ??= boot());
}

async function boot(): Promise<() => Promise<void>> {
  const e = env();
  const tfs = scanTimeframes();
  const stops: (() => Promise<void> | void)[] = [startPriceAlerts(await requireDb())];
  // Heartbeat lets the web app know server-side alerting is live (so browsers stop duplicating it).
  const beat = () => setFlag("cv:worker:heartbeat", 90);
  void beat();
  const beatTimer = setInterval(beat, 30_000);
  stops.push(() => clearInterval(beatTimer));

  if (e.REDIS_URL) {
    // BullMQ: repeatable jobs survive restarts and run exactly once across worker replicas.
    const connection = new Redis(e.REDIS_URL, { maxRetriesPerRequest: null });
    const queue = new Queue<JobData>("cryptovision", { connection, defaultJobOptions: { removeOnComplete: 100, removeOnFail: 200, attempts: 2, backoff: { type: "exponential", delay: 30_000 } } });
    for (const tf of tfs) await queue.upsertJobScheduler(`scan-${tf}`, { every: SCAN_EVERY[tf] }, { name: "scan", data: { timeframe: tf } });
    await queue.upsertJobScheduler("track", { every: 5 * 60_000 }, { name: "track", data: {} });
    await queue.upsertJobScheduler("rsi", { every: 60_000 }, { name: "rsi", data: {} });
    await queue.upsertJobScheduler("rating", { every: 15 * 60_000 }, { name: "rating", data: {} });
    const worker = new Worker<JobData>("cryptovision", (job: Job<JobData>) => run(job.name as JobName, job.data), { connection, concurrency: 1, lockDuration: 10 * 60_000 });
    worker.on("failed", (job, err) => log.error({ job: job?.name, data: job?.data, err: err.message }, "job failed"));
    stops.push(() => worker.close(), () => queue.close(), () => void connection.disconnect());
    log.info({ timeframes: tfs }, "worker started (BullMQ)");
  } else {
    // Single-instance scheduler without Redis. Jobs run one at a time; the first scan starts
    // after a short delay so it doesn't compete with server start-up.
    const timers: ReturnType<typeof setTimeout>[] = [];
    let busy = Promise.resolve();
    const schedule = (name: JobName, data: JobData, every: number, delay: number) => {
      const go = () => (busy = busy.then(() => run(name, data)).then(() => undefined, (err: unknown) => log.error({ name, err: String(err) }, "job failed")));
      timers.push(setTimeout(() => {
        void go();
        timers.push(setInterval(go, every));
      }, delay));
    };
    tfs.forEach((tf, i) => schedule("scan", { timeframe: tf }, SCAN_EVERY[tf], 5_000 + i * 1_000));
    schedule("track", {}, 5 * 60_000, 60_000);
    schedule("rsi", {}, 60_000, 30_000);
    schedule("rating", {}, 15 * 60_000, 90_000);
    stops.push(() => timers.forEach((t) => clearTimeout(t)));
    log.info({ timeframes: tfs }, "worker started (in-process scheduler)");
  }

  return async () => {
    for (const s of stops) await s();
    g.__cvWorker = undefined;
  };
}
