import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, requireDb } from "./client";

/** Applies pending SQL migrations from packages/db/drizzle. Safe to run on every deploy. */
export async function runMigrations() {
  const folder = fileURLToPath(new URL("../drizzle", import.meta.url));
  await migrate(requireDb(), { migrationsFolder: folder });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runMigrations()
    .then(() => {
      console.info("migrations applied");
      return closeDb();
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
