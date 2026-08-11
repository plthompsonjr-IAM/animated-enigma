#!/usr/bin/env bash
# SessionStart — orientation.
#
# This build runs across many sessions, and each one starts cold: the container
# is fresh, the context is empty, and the first thing I do is usually spend tool
# calls rediscovering where things stand. This answers that in one shot.
#
# Deliberately facts only — branch, working state, migration count, open items.
# No advice; the skills carry that.
set -uo pipefail

root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -n "$root" ] && [ -d "$root" ] || exit 0
cd "$root" || exit 0

DESIGNATED="claude/tactical-foreman-build-m7i3ng"
branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
dirty_count="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
unpushed="$(git log --oneline '@{u}'..HEAD 2>/dev/null | wc -l | tr -d ' ')"
last_commit="$(git log -1 --format='%s' 2>/dev/null | cut -c1-72)"
latest_migration="$(ls drizzle/*.sql 2>/dev/null | sed 's|drizzle/||' | sort | tail -1)"
migration_count="$(ls drizzle/*.sql 2>/dev/null | wc -l | tr -d ' ')"

lines=()
lines+=("PT's Tactical Foreman — session start")
lines+=("")

if [ "$branch" = "$DESIGNATED" ]; then
  lines+=("branch:      $branch")
else
  lines+=("branch:      $branch  ⚠ NOT the designated branch ($DESIGNATED)")
fi

lines+=("last commit: $last_commit")

state=""
[ "$dirty_count" != "0" ] && state="$dirty_count uncommitted"
if [ "$unpushed" != "0" ]; then
  [ -n "$state" ] && state="$state, "
  state="$state$unpushed unpushed"
fi
lines+=("working:     ${state:-clean, everything pushed}")
lines+=("migrations:  $migration_count files, latest $latest_migration")
lines+=("")
lines+=("Blocked on Patrick: cost rates per person (margins are meaningless until set);")
lines+=("email delivery (needs an API key); attorney review of the contract terms.")
lines+=("")
lines+=("CLAUDE.md has the rules and conventions. Skills: domain-slice, db-change, ship-check.")

body="$(printf '%s\n' "${lines[@]}")"

jq -n --arg c "$body" '{
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: $c
  }
}'
exit 0
