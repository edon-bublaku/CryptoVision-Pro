#!/usr/bin/env bash
# Starts PostgreSQL 16 and Redis locally without Docker (data under .data/).
# Prefer `docker compose up -d db redis` when Docker is available.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/.data"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PGPORT="${PGPORT:-5432}"
mkdir -p "$DATA"
# PostgreSQL refuses to run as root; in containers run it as the postgres user.
AS=""
if [ "$(id -u)" = "0" ] && id postgres >/dev/null 2>&1; then
  AS="runuser -u postgres --"
  mkdir -p "$DATA/pg" && chown postgres "$DATA/pg" && chmod 700 "$DATA/pg"
  touch "$DATA/pg.log" && chown postgres "$DATA/pg.log"
fi

if [ ! -f "$DATA/pg/PG_VERSION" ]; then
  $AS "$PGBIN/initdb" -D "$DATA/pg" -U cryptovision --auth=trust >/dev/null
fi
if ! $AS "$PGBIN/pg_ctl" -D "$DATA/pg" status >/dev/null 2>&1; then
  $AS "$PGBIN/pg_ctl" -D "$DATA/pg" -o "-p $PGPORT -k /tmp" -l "$DATA/pg.log" start >/dev/null
  sleep 1
fi
psql -h /tmp -p "$PGPORT" -U cryptovision -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='cryptovision'" | grep -q 1 \
  || psql -h /tmp -p "$PGPORT" -U cryptovision -d postgres -c "CREATE DATABASE cryptovision" >/dev/null
psql -h /tmp -p "$PGPORT" -U cryptovision -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='cryptovision_test'" | grep -q 1 \
  || psql -h /tmp -p "$PGPORT" -U cryptovision -d postgres -c "CREATE DATABASE cryptovision_test" >/dev/null

if ! redis-cli -p "${REDIS_PORT:-6379}" ping >/dev/null 2>&1; then
  redis-server --port "${REDIS_PORT:-6379}" --daemonize yes --dir "$DATA" --save "" >/dev/null
fi
echo "postgres://cryptovision@localhost:$PGPORT/cryptovision  ·  redis://localhost:${REDIS_PORT:-6379}"
