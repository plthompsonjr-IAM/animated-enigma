#!/usr/bin/env bash
# Verify scripts/supabase-setup.sql applies cleanly to an empty database, and
# that it leaves every table RLS-protected.
#
# supabase-setup.sql bootstraps a fresh Supabase project. It is the file someone
# runs once when standing the system up, so a syntax error or a missing FORCE in
# it is not discovered until exactly the wrong moment. This catches both.
#
# The script is a first-run bootstrap, not re-runnable end to end (early parts
# create types unguarded), so this applies it once.
#
# Requires a local PostgreSQL installation (initdb/pg_ctl/psql on PATH, or under
# /usr/lib/postgresql/*/bin). Exits non-zero on failure.
set -euo pipefail

# Postgres refuses to run as root.
if [ "$(id -u)" = "0" ]; then
  id -u pgtest >/dev/null 2>&1 || useradd -m -s /bin/bash pgtest
  exec su pgtest -c "cd '$(pwd)' && bash scripts/test-setup-sql.sh"
fi

PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
[ -n "$PGBIN" ] && export PATH="$PGBIN:$PATH"

WORKDIR="$(mktemp -d)"
DATADIR="$WORKDIR/data"
export PGHOST="$WORKDIR" PGPORT="${SETUP_TEST_PORT:-55433}" PGUSER=postgres

cleanup() {
  pg_ctl -D "$DATADIR" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "→ init throwaway cluster"
initdb -D "$DATADIR" -U postgres --auth=trust >/dev/null
pg_ctl -D "$DATADIR" -o "-p $PGPORT -k $WORKDIR -c listen_addresses=''" \
  -l "$WORKDIR/pg.log" start >/dev/null
createdb setup_test

echo "→ apply scripts/supabase-setup.sql"
psql -q -v ON_ERROR_STOP=on -d setup_test -f scripts/supabase-setup.sql >/dev/null

TABLES="$(psql -q -At -d setup_test \
  -c "select count(*) from information_schema.tables where table_schema='public'")"
echo "→ $TABLES tables created"

# The check that matters: the app connects as a BYPASSRLS role, so ENABLE alone
# is not a boundary. Anything without FORCE is a tenant leak waiting to happen.
UNPROTECTED="$(psql -q -At -d setup_test -c "
  select relname from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and (not c.relrowsecurity or not c.relforcerowsecurity)")"

if [ -n "$UNPROTECTED" ]; then
  echo "✗ tables missing ENABLE + FORCE row level security:"
  echo "$UNPROTECTED" | sed 's/^/    /'
  exit 1
fi

echo "✓ supabase-setup.sql applies cleanly; all $TABLES tables are RLS-protected"
