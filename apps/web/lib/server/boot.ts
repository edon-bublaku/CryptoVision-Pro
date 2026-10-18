import { activeDbMode, embeddedDir, getDb } from "@cv/db";
import { env, log } from "@cv/server";

export async function boot() {
  const mode = activeDbMode();
  try {
    const db = await getDb();
    if (!db) {
      log.info("database disabled: local-only mode");
      return;
    }
    log.info({ db: mode, ...(mode === "embedded" ? { dir: embeddedDir() } : {}) }, "database ready");
  } catch (e) {
    // Keep serving the local-only app even if storage is broken; /api/health reports db: false.
    log.error({ err: e instanceof Error ? e.message : String(e) }, "database unavailable");
    return;
  }
  if (env().WORKER !== "inprocess") return;
  const { startWorker } = await import("@cv/worker/runtime");
  await startWorker();
}
