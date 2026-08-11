# PT's Tactical Foreman

An AI-powered general contractor command system for **PT's Tactical Renovations**
(PTTR) — *"Your Home, Our Mission."* Owner: Patrick Thompson.

Built as 50 controlled tasks across 13 phases. Tasks 1–29 are complete and live.

---

## Binding rules

These come from Patrick and are not negotiable.

1. **Review before changing.** Read the surrounding code first. Match it.
2. **Only the required changes.** Don't widen scope, don't refactor adjacent code
   because it looked wrong.
3. **Preserve working functionality.** Every task builds on live code.
4. **Validation and error handling are part of the work**, not a follow-up.
5. **Test what you build**, and run the whole suite before claiming done.
6. **Never invent completed integrations, credentials, or test results.** If it
   wasn't run, say it wasn't run. This is the one that matters most — half the
   value of this system is that its numbers can be trusted.
7. **Modular and mobile-first.** This gets used one-handed on a jobsite.
8. **After each numbered task: stop and report** — plain-language summary, files
   changed, testing results with real numbers, decisions Patrick has to make, and
   the prompt for the next task.
9. **Do everything asked, completely.** Don't defer part of a request with "say
   the word and I'll do it" — if it's needed, do it.

### Git

- Branch: **`claude/tactical-foreman-build-m7i3ng`**. Never push elsewhere without
  explicit permission.
- `git push -u origin claude/tactical-foreman-build-m7i3ng`, retrying up to four
  times on network failure with 2s/4s/8s/16s backoff.
- Commit trailer, every time:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01HaHWhCxfC1rDYDXtSritBt
  ```
- **Never put a model identifier in any repo artifact** — not commit messages
  beyond that trailer, not PR titles or bodies, not code comments.
- Tracking PR is **#6**. Keep its description accurate; a body that says
  "Tasks 9–19" when the branch carries 29 is worse than no body.

---

## Skills

Three skills in `.claude/skills/` cover the recurring procedures. Use them.

| Skill | When |
|---|---|
| `domain-slice` | Starting a numbered task or adding anything under `src/lib/` |
| `db-change` | Any edit to `schema.ts`, any migration, constraint, trigger, policy |
| `ship-check` | Before every commit, and before saying anything is done |

### The verification hook

`.claude/hooks/verify-evidence.sh` runs on every `Stop`, wired up in
`.claude/settings.json`. When a turn changed code it runs typecheck, lint, and
the tests; when it changed migrations or SQL it also runs the RLS suite. **A
failure blocks the turn from ending.**

This exists because rule 6 above is the one that matters most, and "tests pass"
is the easiest thing in the world to say without having checked. The hook prints
the real counts — quote those in the report rather than asserting anything.

It stays quiet for docs-only turns and stamps a passing tree so it doesn't run
twice on the same state. `pnpm build` is outside it (minutes long); run that
yourself.

---

## Stack

- **Next.js 15.1.6** App Router, **React 18.3.1**, TypeScript strict
- Server Components by default; Server Actions with `useFormState` (React 18 API)
- `headers()` / `cookies()` / `params` / `searchParams` are **async** in Next 15
- **Supabase** (Postgres 17.6) + **Drizzle ORM 0.36.4**
- **Vitest** + jsdom. **Tailwind**, no component library beyond local primitives
- `pnpm`

Live project ref: **`zhlkfuvscnblkkyfticz`** (Tactical-Foreman, ca-central-1).
Free tier — it auto-pauses. `INACTIVE` status is why tools time out.

---

## The security model

**The app connects as `postgres`, which has `BYPASSRLS`.**

So `ENABLE ROW LEVEL SECURITY` is not a boundary on its own. Every tenant table
needs **`ENABLE` and `FORCE`**, and `scripts/test-setup-sql.sh` fails the build if
any table lacks either. A table with only `ENABLE` leaks one contractor's jobs
into another's account, silently.

Two policies exist in the codebase:

- **Tenant** — the default. `organization_id = current_org() and is_member_of(...)`
- **Tenant + person** — `time_entries` only. A technician sees only their own
  hours, because everyone's pay is inferable from them. Owners, office managers,
  and project managers see all of it.

Beyond RLS, the database owns invariants that a query would otherwise have to
defend against:

- **Derived values by trigger, never supplied** — `time_entries.hours`,
  `daily_logs.editable_until`, `project_tasks.completed_at`
- **Freeze triggers** on issued invoices, signed contracts, approved change
  orders — raising `errcode = 'restrict_violation'`
- **Append-only** for evidence — `signatures` and `daily_log_revisions` reject
  `UPDATE`/`DELETE` for *every* role, including the app's
- **Exclusion constraint** on `time_entries` so nobody is on two shifts at once
- **Org-scoped storage paths** — a CHECK ensures a file's path sits under its own
  organisation's prefix

Every trigger function pins `set search_path = ''` (the Supabase advisor flags it
otherwise) and fully qualifies cross-table references as `public.<table>`.

---

## Layout

```
src/lib/<domain>/<domain>-core.ts   pure logic, zero I/O — the real decisions
src/lib/<domain>/queries.ts         reads, always org-scoped
src/lib/<domain>/actions.ts         'use server' writes
src/components/<domain>/            presentation
src/app/(app)/<route>/              authenticated screens
src/app/(print)/<route>/print/      chrome-free printable views
drizzle/                            migrations (generated DDL + hand-written RLS)
scripts/                            RLS harness, setup script, verifiers
docs/                               PRD, architecture, full 50-table schema
```

Domains built: `auth` `catalog` `change-orders` `clients` `contracts` `costing`
`daily-logs` `dashboard` `estimates` `financials` `intake` `invoices` `leads`
`media` `projects` `proposals` `schedule` `scopes` `signatures` `site-visits`
`storage` `tasks`

---

## Conventions that hold everywhere

**Money is `numeric(14,2)`. Hours are `numeric(12,4)`. Never floats.**

**A calendar day is `date`, not `timestamptz`.** A crew frames Tuesday through
Friday; storing that as an instant makes the day shift with whoever reads it.
`schedule-core.ts` owns all day arithmetic — reuse it rather than reimplementing.

**Say nothing rather than zero.** A job with no contract has `revisedValue: null`,
not `0`. Null renders as "—"; zero renders as a lie.

**Take `now: Date = new Date()` as a defaulted last parameter** on anything
time-dependent. It's why the tests can assert exact strings.

**Stitch, don't join.** Load related collections in a second query keyed by parent
id. A join multiplies parent rows by child count and every downstream count then
operates on duplicates.

**Gate at the query, not the render.** Someone without `financials:read` should
never have the amounts *fetched*.

**Soft-delete anything with evidentiary value** — photos, tasks, expenses, logs.
Hard-delete scratch records.

**A `<form>` never nests inside another `<form>`.**

### Permissions (`src/lib/auth/rbac.ts`)

| Permission | Means |
|---|---|
| `tasks:write` | field work — **technicians hold this**; time logging rides on it |
| `documents:write` | uploading photos and files from site |
| `schedule:write` | moving crews and dates |
| `financials:read` / `:write` | money the client is billed |
| `costs:read` | internal cost and margin — **stricter than financials** |
| `costs:write` | recording spend, approving time, setting rates |
| `org:manage` | settings, terms, cost rates |

`costs:read` is deliberately absent from `sales_rep` and `field_foreman`.

### Navigation

**Fixed at twelve PRD sections.** Do not add to it. Contracts, invoices, change
orders, and daily logs are reachable by link and URL and are deliberately absent.
New routes still need their prefix in `PROTECTED_PREFIXES`
(`src/lib/auth/route-access.ts`).

---

## Voice

The comments and copy carry real value here. Match them.

**Comments explain why, and especially why not the obvious alternative:**

> Clearing rather than cascading: losing a predecessor should orphan the
> dependency, not delete the successor's work.

**Name the judgement where there is one:**

> Cost-to-date on a running job is not margin. A job 30% built and 50% billed
> looks wonderful and isn't.

> An empty log is worse than no log — it looks like a day where nothing happened.

**User-facing text is plain, specific, and says what to do:**

> Gaps in the daily record are what undermine a delay claim later.

> That's 22 hours — check the times, or split it into two entries.

Not "Warning: incomplete data." Not "Invalid range."

---

## Standing decisions worth knowing

- **Print-to-PDF, no PDF library.** Self-contained theme-independent HTML with
  fixed brand colours (`hsl(24 94% 50%)`), `@page { margin: 16mm }`,
  `print-color-adjust: exact`. Proposals, contracts, change orders, invoices.
- **Token pattern for client links.** SHA-256 hash stored; the raw token exists
  only in the URL and is surfaced once via an event log.
- **Contract value is never mutated.** The revised value is derived as original
  plus approved change orders — matching real construction accounting and keeping
  the freeze trigger absolute.
- **`blocked` is never stored.** It's derived from unfinished dependencies at read
  time, so finishing a predecessor unblocks its successors with no second write.
- **Margin is computed from finished jobs only.** A half-built job has most of its
  revenue recognised and only some of its cost.
- **A member with no cost rate isn't given a made-up one.** Their labour isn't
  costed, and the UI says so. A guessed rate would poison every margin invisibly.

---

## Open items needing Patrick

1. **Cost rates per person.** Margins mean nothing until these are set
   (Settings → Team). Burdened cost to the business, not wages.
2. **Email delivery.** Every client link — proposal, change-order approval,
   invoice — is copy-and-paste. Needs a Resend or Postmark API key.
3. **Attorney review of the contract terms and signature disclosure.** The
   Ohio-specific right-to-cancel wording is the priority item. The starter
   template carries visible `[BRACKETED]` blanks and the app warns while any
   remain.
4. **No client payment portal or card processing.** Payments are recorded by hand.
5. **Storage uploads are unverified end to end.** The `project-files` bucket
   exists and is private, but no file has actually been pushed through.

---

## Current state

- **584 unit tests** across 31 files
- **160 real-Postgres RLS assertions**
- **47 tables**, all `ENABLE` + `FORCE` RLS
- Migrations through `0043` applied to the live project and verified
- Security advisor: three pre-existing WARNs on `has_role` / `is_member_of` /
  `org_has_members` from Task 6. Known, unrelated. Anything else is new and yours.

Remaining placeholder: `/ai-foreman`.
