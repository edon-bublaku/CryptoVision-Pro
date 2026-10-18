# ADR 0005 — Platformë e vetë-mjaftueshme: PGlite + worker brenda serverit, pa Docker

- **Statusi:** Pranuar
- **Data:** 2026-10-18
- **Përditëson:** [ADR 0004](0004-worker-hybrid-mode.md)

## Konteksti

Për llogari, sinkronizim dhe alerte 24/7, versioni i mëparshëm kërkonte PostgreSQL, Redis dhe
një proces të veçantë worker-i. Në praktikë kjo do të thoshte Docker. Kërkesa e produktit: platforma
duhet të niset me një komandë, pa instaluar shërbime.

## Vendimi

1. **Databaza e integruar si default.** Kur `DATABASE_URL` mungon, `@cv/db` hap
   [PGlite](https://pglite.dev) (PostgreSQL 18 i kompiluar në WASM) në `$CV_HOME/db`
   (default `~/.cryptovision/db`). Skema, repo-t dhe migrimet janë të njëjta me PostgreSQL-in e
   jashtëm, që mbetet i mbështetur (`DATABASE_URL=postgres://…`). `DATABASE_URL=off` kthen mënyrën
   vetëm-lokal.
2. **Migrimet janë pjesë e kodit.** `pnpm db:generate` gjeneron SQL me drizzle-kit dhe e përfshin në
   `src/migrations.gen.ts`. `getDb()` i aplikon një herë për proces me migratorin e drizzle-s, ndaj
   hash-et dhe tabela `drizzle.__drizzle_migrations` përputhen me `drizzle-kit migrate`. Në PostgreSQL,
   një advisory lock serializon proceset që nisin njëkohësisht.
3. **Worker-i brenda serverit.** `apps/web/instrumentation.ts` nis `startWorker()` nga
   `@cv/worker/runtime` kur nis serveri (`WORKER=inprocess`, default). `WORKER=external` e lë për
   `pnpm worker` (vetëm me PostgreSQL, sepse PGlite është një-procesësh). `WORKER=off` e çaktivizon.
4. **Bus pa Redis.** `@cv/server` ofron `publish/subscribe/setFlag/hasFlag`. Me `REDIS_URL` përdoret
   Redis pub/sub. Pa të, përdoret një `EventEmitter` në `globalThis`, i mjaftueshëm kur worker-i dhe
   SSE-ja jetojnë në të njëjtin proces. Rate limit-i kishte tashmë fallback në memorie.
5. **Sekretet.** Pa `ENCRYPTION_KEY`, gjenerohet një çelës i rastësishëm 32-bajtësh në
   `$CV_HOME/secret.key` (leje 0600). Kjo zëvendëson çelësin e derivuar të zhvillimit, që ishte i
   parashikueshëm. Me PostgreSQL të jashtëm në prodhim, `ENCRYPTION_KEY` mbetet i detyrueshëm, sepse
   skedari është për makinë.
6. **Docker u hoq** (Dockerfile, docker-compose, `scripts/dev-services.sh`, `output: "standalone"`).
   `pnpm build && pnpm start` është rruga e prodhimit. CI teston si PostgreSQL + Redis, ashtu edhe PGlite.

## Pasojat

- `pnpm dev` jep platformën e plotë. 16 testet e2e kalojnë si me PGlite, ashtu edhe me PostgreSQL.
- PGlite është një-procesësh: për disa instanca serveri duhen PostgreSQL dhe Redis. Dy procese mbi të
  njëjtën dosje PGlite do ta korruptonin databazën, prandaj `apps/worker` refuzon të niset pa PostgreSQL.
- Një server dev i nisur para një migrimi të ri duhet rinisur, sepse migrimet aplikohen në nisje.
- Hosting serverless (p.sh. Vercel) nuk ka disk të qëndrueshëm: aty duhet `DATABASE_URL`.
