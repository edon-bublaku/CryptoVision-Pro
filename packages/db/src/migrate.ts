import { closeDb, getDb } from "./client";

/** CLI: `pnpm db:migrate`. Servers also migrate automatically on first database access. */
getDb()
  .then(async (db) => {
    console.info(db ? "migrations applied" : "database disabled (DATABASE_URL=off)");
    await closeDb();
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
