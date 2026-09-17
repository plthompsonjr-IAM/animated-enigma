#!/usr/bin/env bash
# Stop hook — evidence for completion claims.
#
# The failure mode this exists to prevent: finishing a turn with "tests pass" or
# "the build is clean" when nobody ran them. Saying so and it being false is
# worse than not saying it, because the whole point of this system is that its
# numbers can be trusted.
#
# So: whenever the repo changed during a turn, the gate actually runs before the
# turn is allowed to end. If it fails, the turn is blocked and the failure is
# handed back. If it passes, the real numbers are printed so the report can cite
# them rather than assert them.
#
# Checks run:
#   always (when src/ or tests changed)  typecheck, lint, unit tests
#   when drizzle/ or scripts/*.sql changed   the real-Postgres RLS suite
#
# `pnpm build` is deliberately NOT here — it takes minutes and typecheck catches
# nearly all of what it would. It stays part of the ship-check skill.
#
# Loop safety: a passing gate exits 0, so it never re-fires. A failing gate
# blocks once; `stop_hook_active` then suppresses further blocking so a genuinely
# broken tree can still be reported to the user rather than deadlocking.
set -uo pipefail

payload="$(cat 2>/dev/null || echo '{}')"
stop_active="$(printf '%s' "$payload" | jq -r '.stop_hook_active // false' 2>/dev/null || echo false)"

root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -n "$root" ] && [ -d "$root" ] || exit 0
cd "$root" || exit 0

# ── Did anything actually change? ────────────────────────────────────────────
# A turn that only read files, answered a question, or talked to the database
# has nothing to verify and shouldn't pay for a test run.
head_sha="$(git rev-parse HEAD 2>/dev/null || echo none)"
dirty="$(git status --porcelain 2>/dev/null || true)"
fingerprint="$(printf '%s\n%s' "$head_sha" "$dirty" | sha256sum | cut -d' ' -f1)"

stamp_dir="${TMPDIR:-/tmp}/claude-verify"
stamp="$stamp_dir/$(printf '%s' "$root" | sha256sum | cut -d' ' -f1)"
mkdir -p "$stamp_dir" 2>/dev/null || true

# Already verified this exact tree — don't run it twice.
[ -f "$stamp" ] && [ "$(cat "$stamp" 2>/dev/null)" = "$fingerprint" ] && exit 0

# Which files moved, working tree plus anything committed this turn.
changed="$(
  {
    printf '%s\n' "$dirty" | sed 's/^...//'
    git diff --name-only "@{u}" HEAD 2>/dev/null || true
  } | sort -u
)"
[ -n "$(printf '%s' "$changed" | tr -d '[:space:]')" ] || exit 0

touches_code=false
touches_sql=false
printf '%s\n' "$changed" | grep -qE '^(src/|vitest|tsconfig|package\.json)' && touches_code=true
printf '%s\n' "$changed" | grep -qE '^(drizzle/|scripts/.*\.sql)' && touches_sql=true

if [ "$touches_code" = false ] && [ "$touches_sql" = false ]; then
  # Docs, skills, config only — nothing the gate can speak to.
  printf '%s' "$fingerprint" > "$stamp" 2>/dev/null || true
  exit 0
fi

# ── Run the gate ─────────────────────────────────────────────────────────────
log="$(mktemp)"
trap 'rm -f "$log"' EXIT
failures=()
evidence=()

run() { # run <label> <command...>
  local label="$1"; shift
  if "$@" >"$log" 2>&1; then
    return 0
  fi
  failures+=("$label")
  # Keep the tail — the actual error is nearly always at the end.
  evidence+=("--- $label failed ---")
  evidence+=("$(tail -25 "$log")")
  return 1
}

if [ "$touches_code" = true ]; then
  run "typecheck" pnpm typecheck
  run "lint" pnpm lint

  if pnpm test >"$log" 2>&1; then
    counts="$(grep -E 'Test Files|Tests ' "$log" | tr -s ' ' | sed 's/^ *//' | tr '\n' ';')"
    evidence+=("tests: ${counts:-passed}")
  else
    failures+=("tests")
    evidence+=("--- tests failed ---")
    evidence+=("$(grep -E '✗|×|FAIL|AssertionError|Expected|Received' "$log" | head -25)")
  fi
fi

if [ "$touches_sql" = true ]; then
  if bash scripts/test-rls.sh >"$log" 2>&1; then
    n="$(grep -c "PASS:" "$log" 2>/dev/null || echo 0)"
    evidence+=("RLS suite: $n assertions passed")
  else
    failures+=("RLS suite")
    evidence+=("--- RLS suite failed ---")
    evidence+=("$(grep -E 'FAIL|ERROR|ERROR:' "$log" | head -20)")
    evidence+=("$(tail -15 "$log")")
  fi
fi

body="$(printf '%s\n' "${evidence[@]}")"

# ── Verdict ──────────────────────────────────────────────────────────────────
if [ ${#failures[@]} -gt 0 ]; then
  joined="$(printf '%s, ' "${failures[@]}")"
  joined="${joined%, }"

  if [ "$stop_active" = "true" ]; then
    # Already blocked once this turn. Don't deadlock — let the turn end, but make
    # sure the user sees that the tree is broken.
    jq -n --arg m "⚠ Verification still failing: $joined. Do not treat this work as complete." \
      '{systemMessage: $m}'
    exit 0
  fi

  jq -n --arg r "The verification gate failed: $joined.

$body

Fix this before ending the turn. Do not claim any of this work is complete, tested, or passing until the gate is green — and when you report, cite the real numbers this hook prints rather than asserting that things pass." \
    '{decision: "block", reason: $r}'
  exit 0
fi

# Passed. Stamp it so a follow-up stop on the same tree is free, and hand the
# real numbers back so the report can quote them.
printf '%s' "$fingerprint" > "$stamp" 2>/dev/null || true
jq -n --arg m "✓ Verification gate passed — $(printf '%s ' "${evidence[@]}" | tr -s ' ')" \
  '{systemMessage: $m}'
exit 0
