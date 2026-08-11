#!/usr/bin/env bash
# Stop hook — schema changes have three follow-through steps, and forgetting one
# is the realistic mistake.
#
# Editing src/db/schema.ts is only the first of four:
#   1. schema.ts
#   2. a generated migration        (drizzle-kit generate)
#   3. a hand-written RLS migration (ENABLE + FORCE + policy, constraints, triggers)
#   4. the supabase-setup.sql mirror, so a fresh project gets it too
#
# Skipping 3 is a tenant leak. Skipping 4 means the next fresh deploy is silently
# missing a table. Neither shows up in typecheck, lint, or the unit tests, and a
# generated migration alone passes the RLS harness because there is nothing yet
# asserting the new table.
#
# This does not block — there are legitimate reasons to land these across
# commits. It surfaces what is missing so the omission is a decision rather than
# an oversight.
set -uo pipefail

root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -n "$root" ] && [ -d "$root" ] || exit 0
cd "$root" || exit 0

# Everything that moved this turn: working tree plus anything committed but not
# yet pushed.
changed="$(
  {
    git status --porcelain 2>/dev/null | sed 's/^...//'
    git diff --name-only '@{u}' HEAD 2>/dev/null || true
  } | sort -u
)"

printf '%s\n' "$changed" | grep -q '^src/db/schema\.ts$' || exit 0

missing=()

printf '%s\n' "$changed" | grep -qE '^drizzle/[0-9]+_.*\.sql$' \
  || missing+=("a migration in drizzle/ — run \`pnpm drizzle-kit generate\`")

# The generated file is table DDL only. RLS, constraints, and triggers are
# hand-written in a separate numbered file, by convention *_rls.sql.
printf '%s\n' "$changed" | grep -qE '^drizzle/[0-9]+_.*_(rls|policies)\.sql$' \
  || missing+=("a hand-written RLS migration (ENABLE **and FORCE** + tenant policy)")

printf '%s\n' "$changed" | grep -q '^scripts/supabase-setup\.sql$' \
  || missing+=("the scripts/supabase-setup.sql mirror, so a fresh project gets this too")

printf '%s\n' "$changed" | grep -q '^scripts/rls-assertions\.sql$' \
  || missing+=("assertions in scripts/rls-assertions.sql proving the new rules hold")

[ ${#missing[@]} -eq 0 ] && exit 0

list="$(printf '  - %s\n' "${missing[@]}")"
jq -n --arg m "schema.ts changed. Still outstanding:
$list
See the db-change skill. FORCE is the one that matters — the app connects as a BYPASSRLS role, so ENABLE alone is not a tenant boundary." \
  '{systemMessage: $m}'
exit 0
