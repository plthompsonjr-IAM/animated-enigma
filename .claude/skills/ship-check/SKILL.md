---
name: ship-check
description: Use before committing or reporting completion on any change to PT's Tactical Foreman. Runs the full verification gate — typecheck, lint, tests, build, the real-Postgres RLS suite, and the setup-script check — plus the SQL-shape smoke test for new queries, and the rules on what may honestly be claimed in a commit message or report. Trigger before any git commit, or when asked whether something is done.
---

# Before you ship

Two rules govern this file. **Run the gate before claiming anything.** And
**claim only what the gate actually proved.**

## The gate

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
bash scripts/test-rls.sh
bash scripts/test-setup-sql.sh
```

The last two need a local PostgreSQL install; they spin up throwaway clusters and
clean up after themselves. They take a couple of minutes and they are the two
that catch the expensive mistakes, so don't skip them because the unit tests were
green.

`test-setup-sql.sh` fails if any table lacks **ENABLE + FORCE** row level
security. That check exists because the app connects as a `BYPASSRLS` role, so
`ENABLE` on its own is not a boundary — a table with only `ENABLE` leaks one
contractor's jobs into another's account with no error anywhere.

## Smoke-test new SQL against the real schema

Unit tests never touch a database and the build never runs a query, so a wrong
column name or a wrong enum value compiles, passes, ships, and then throws the
first time somebody opens the page.

**Whenever you add a query with a raw `sql` fragment — an enum comparison, a
correlated subquery, a `filter (where …)` aggregate — add its shape to
`scripts/rls-assertions.sql` and run it there.**

The pattern used for the dashboard and financials sections:

```sql
do $$
declare n int;
begin
  select count(*)::int into n from <the same shape the app uses>;
  raise notice 'PASS: <name> query runs (% rows)', n;
  -- and prove it stays inside the tenant:
  select count(*)::int into n from <table>;
  if n <> 1 then raise exception 'FAIL: saw % rows, expected 1', n; end if;
end $$;
```

This has already caught two real bugs that every other check passed:
- a query filtering `contracts` on `'sent'` and `'out_for_signature'`, neither of
  which exists in the `contract_status` enum;
- a `photos`/`documents` path constraint that would have accepted a row whose
  storage path pointed at another organisation's prefix.

Both would have surfaced to Patrick as a 500 on a page he'd just been told was
finished.

## When something fails

**Fix the code, not the assertion.** Two examples from this build, both of which
started as a failing test and ended as a genuine improvement:

- Aging percentages summed to 101% because each was rounded independently. On a
  financial report that reads as an error. The fix was largest-remainder
  apportionment, not a looser assertion.
- Typing a word into an amount field reported "an expense of zero isn't worth
  recording", because `toNum` coerces anything unparseable to `0`. The fix was a
  strict `parseAmount`, not a reworded expectation.

If a test turns out to have encoded the wrong expectation, say so explicitly and
fix the test — but check the code first. The default assumption is that the test
found something.

## Live database

If the change touched the schema, follow the **db-change** skill through to
applying and verifying on project `zhlkfuvscnblkkyfticz`. Then confirm:

- `relrowsecurity` **and** `relforcerowsecurity` are both true on every new table
- policy, trigger, and constraint counts match what the migration declared
- `get_advisors` (`type: security`) shows nothing new. Three pre-existing WARNs
  on `has_role` / `is_member_of` / `org_has_members` are known and unrelated.

If the tools time out, check `get_project` — the free tier auto-pauses and
reports `INACTIVE`. `restore_project` brings it back.

## What you may claim

The commit message and the report to Patrick are the only record of what is
actually true. Be exact:

- **Say what ran and passed.** Give the real numbers — "584 tests (31 files), 160
  RLS assertions" — not "all tests pass".
- **Say what did not run.** Migrations sitting unapplied. A storage upload path
  that was built but never exercised. A screen that compiles but has never
  rendered against real data. Write it in the commit body, not just in chat; the
  chat scrolls away and the commit doesn't.
- **Never describe an integration as working on the strength of having written
  the code.** Creating a storage bucket is not the same as proving an upload
  works. Applying a migration is not the same as exercising the feature.
- **Report a bug you introduced and fixed** if it was interesting — it tells
  Patrick what the checks are worth.
- **Don't let a PR description go stale.** If the body says "Tasks 9–19" and the
  branch now carries 29, fix it. A description that was true when written and is
  false now is worse than no description.

Commit trailer, every time:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HaHWhCxfC1rDYDXtSritBt
```

Never put a model identifier anywhere else in a repo artifact — not in code
comments, PR titles, or bodies.

## Push

Branch is `claude/tactical-foreman-build-m7i3ng`. Always
`git push -u origin claude/tactical-foreman-build-m7i3ng`. Never push elsewhere
without being asked. On a network failure, retry up to four times with 2s/4s/8s/16s
backoff.

## Then report

Plain language, no jargon, structured as: what was built, the judgement calls
worth knowing about, what was tested with real numbers, **what needs Patrick's
decision or action**, and what comes next. The standing open items are the
contract terms needing an attorney, email delivery needing an API key, and cost
rates per person needing to be set before margins mean anything.
