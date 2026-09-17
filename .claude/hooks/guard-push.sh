#!/usr/bin/env bash
# PreToolUse / Bash — branch protection.
#
# "Never push to a different branch without explicit permission" is a standing
# instruction from Patrick, and until now it was enforced only by my remembering
# it. A push to main or to someone else's branch is not something you undo
# cleanly, so it gets a real gate.
#
# Blocks: any `git push` whose target is not the designated branch, and any
# force-push to it. Allows everything else through untouched.
set -uo pipefail

DESIGNATED="claude/tactical-foreman-build-m7i3ng"

payload="$(cat 2>/dev/null || echo '{}')"
cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // ""' 2>/dev/null)"

# Not a push — nothing to say.
printf '%s' "$cmd" | grep -qE '(^|[;&|]|\s)git\s+push\b' || exit 0

deny() {
  jq -n --arg r "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $r
    }
  }'
  exit 0
}

# Force-pushing the designated branch discards history that may already be on
# the PR. There are legitimate reasons (restarting from a merged base), but it
# should be a deliberate ask, not a reflex.
if printf '%s' "$cmd" | grep -qE '(--force|--force-with-lease|[[:space:]]-f([[:space:]]|$))'; then
  deny "That is a force-push. It discards remote history that may already be on PR #6.

If you genuinely need it — restarting the branch from a merged base is the usual reason — say so to Patrick and get explicit agreement first, then run it."
fi

# Find the branch being pushed. `git push -u origin <branch>` or `git push origin <branch>`.
target="$(printf '%s' "$cmd" \
  | grep -oE 'git[[:space:]]+push[^;&|]*' \
  | sed -E 's/.*(origin|upstream)[[:space:]]+([^[:space:];&|]+).*/\2/' \
  | head -1)"

# A bare `git push` follows the tracking branch, which is the designated one.
if [ -z "$target" ] || printf '%s' "$target" | grep -qE '^git|push$'; then
  exit 0
fi

# Strip any refspec form (HEAD:branch, branch:branch).
target="${target##*:}"

if [ "$target" != "$DESIGNATED" ]; then
  deny "Blocked: this pushes to '$target', not the designated branch.

All work on this project goes to:
    $DESIGNATED

Pushing elsewhere — main especially — needs Patrick's explicit permission first. If he has given it in this conversation, tell him the hook blocked it and ask him to confirm, rather than working around it."
fi

exit 0
