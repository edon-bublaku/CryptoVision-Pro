/**
 * Runs once when the server starts. Opens (and migrates) the database and, unless WORKER is
 * `external` or `off`, starts the worker inside this process — so `pnpm dev` alone gives the
 * full platform: accounts, sync, 24/7 scans and alerts, with no external services to install.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { boot } = await import("./lib/server/boot");
  await boot();
}
