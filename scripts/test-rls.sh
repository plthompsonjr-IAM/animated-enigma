#!/usr/bin/env bash
# Task 6 — run the DB-level RLS test suite against a throwaway Postgres cluster.
# Requires a local PostgreSQL server installation (initdb/pg_ctl/psql on PATH,
# or under /usr/lib/postgresql/*/bin). Applies the drizzle migrations in order,
# then executes scripts/rls-assertions.sql. Exits non-zero on any failure.
set -euo pipefail

# Postgres refuses to run as root: create/drop to an unprivileged user.
if [ "$(id -u)" = "0" ]; then
  id -u pgtest >/dev/null 2>&1 || useradd -m -s /bin/bash pgtest
  exec su pgtest -c "cd '$(pwd)' && bash scripts/test-rls.sh"
fi

PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
[ -n "$PGBIN" ] && export PATH="$PGBIN:$PATH"

PORT="${RLS_TEST_PORT:-55432}"
WORKDIR="$(mktemp -d)"
DATADIR="$WORKDIR/data"
export PGHOST="$WORKDIR" PGPORT="$PORT" PGUSER=postgres

cleanup() {
  pg_ctl -D "$DATADIR" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "→ init throwaway cluster ($DATADIR)"
initdb -D "$DATADIR" -U postgres --auth=trust >/dev/null
pg_ctl -D "$DATADIR" -o "-p $PORT -k $WORKDIR -c listen_addresses=''" -l "$WORKDIR/pg.log" start >/dev/null

createdb tactical_rls_test

echo "→ apply migrations"
for f in drizzle/*.sql; do
  echo "   $f"
  psql -q -v ON_ERROR_STOP=on -d tactical_rls_test -f "$f"
done

echo "→ run RLS assertions"
psql -q -v ON_ERROR_STOP=on -d tactical_rls_test -f scripts/rls-assertions.sql

echo "✓ RLS test suite passed"
