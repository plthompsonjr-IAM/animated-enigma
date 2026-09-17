---
name: domain-slice
description: Use when building a new feature area in PT's Tactical Foreman — scheduling, tasks, daily logs, media, costing, and every remaining task follow one shape. Covers the pure-core-first architecture, where queries/actions/components live, permission gating, form and error conventions, and wiring into the project page. Trigger when starting a numbered build task or adding any new domain under src/lib/.
---

# Building a domain slice

Every feature area in this codebase has the same seven parts. Build them in this
order — the pure module first, because it is where the real decisions live and it
is the only part that can be exhaustively tested.

```
src/lib/<domain>/<domain>-core.ts       pure logic, zero I/O
src/lib/<domain>/<domain>-core.test.ts  exhaustive unit tests
src/lib/<domain>/queries.ts             reads, always org-scoped
src/lib/<domain>/actions.ts             'use server' writes
src/components/<domain>/*.tsx           presentation
src/app/(app)/<route>/page.tsx          screen
drizzle/ + scripts/rls-assertions.sql   see the db-change skill
```

## 1. The core module comes first

No imports from `@/db`, no `next/*`, no network. Everything takes plain values
and returns plain values. This is the part that gets read in five years.

What belongs here:
- The status/category catalogues, as `as const` arrays plus a `Record` of labels
  and one of Tailwind classes. Export an `isX(value): value is X` guard for
  anything that arrives from a form.
- Validation returning `{ error?: string }` — the first problem only, phrased for
  a foreman on a phone, not a developer. "That's 22 hours — check the times, or
  split it into two entries." beats "invalid range".
- The domain arithmetic: totals, deltas, aging, overlap, sequencing.
- Formatting helpers so a number is written the same way everywhere.

**Take `now: Date = new Date()` as a defaulted last parameter** on anything
time-dependent. Every such function in this codebase does, and it is why the
tests can assert exact strings.

**Say nothing rather than zero.** A job with no contract has `revisedValue: null`,
not `0` — null renders as "—" and zero renders as a lie. This pattern recurs
everywhere; follow it.

### Then test it exhaustively

Aim for the shape of the existing suites: the happy path, each individual
rejection, the boundary on both sides, and the degenerate input (null, empty,
unparseable, backwards, negative). Name tests as sentences about behaviour —
`it('never counts finished work as overdue')` — not `it('works')`.

Two things these tests have repeatedly caught, so write them deliberately:
- **Timezone assumptions.** Assert something timezone-independent (a parsed day
  keeps its date and lands at hour 0) rather than a formatted string that only
  passes in UTC.
- **Rounding that has to add up.** Percentages shown as a column must sum to 100;
  independent rounding doesn't. Use the largest-remainder helper in
  `financials-core.ts` rather than reinventing it.

Run just this file while iterating: `pnpm vitest run src/lib/<domain>`.

## 2. Queries

Reads only. Every query filters on `organizationId` — RLS is the backstop, not
the plan.

- Load related collections in a **second query and stitch**, never a join. A join
  multiplies parent rows by child count and every downstream count operates on
  duplicates. See `withCrew` in `schedule/queries.ts` or `withChecklists` in
  `tasks/queries.ts`.
- The dashboard-style screens want **counts, not rows**. A contractor with four
  hundred tasks shouldn't pay to load them to see a number.
- Gate expensive or sensitive reads by permission at the *query* level, not just
  the render — `dashboardSignals(orgId, showMoney)` never fetches the amounts
  when the caller can't see money.

## 3. Actions

`'use server'` at the top. Open with a permission gate that returns a
discriminated union, following the existing helpers:

```ts
async function requireXWrite(): Promise<
  { ok: true; orgId: string; userId: string } | { ok: false; error: string }
> { ... }
```

Rules that hold throughout:
- **Validate every id with `uuidOrNull`.** A form field is untrusted.
- **Re-verify ownership** of any referenced row against the caller's org before
  using it. `verifiedMember`, `verifiedScheduleItem` are the pattern.
- **`friendlyDbError(error)`** maps constraint and trigger messages to something
  a person can act on. Match on the constraint name.
- Two signatures, used consistently: `(_prev: FormState, formData: FormData)` for
  forms with `useFormState`, and `(formData: FormData)` for one-tap buttons.
- `revalidatePath` the list route and the project route after every write.
- Return the project id **out of the transaction** rather than assigning to an
  outer `let` — TypeScript won't narrow across the closure.

## 4. Permissions

`src/lib/auth/rbac.ts` is the single source. Pick the right one:

| Permission | Means |
|---|---|
| `tasks:write` | field work — **technicians hold this**; time logging rides on it |
| `documents:write` | uploading photos and files from site |
| `schedule:write` | moving crews and dates |
| `financials:read/write` | money the client is billed |
| `costs:read` | internal cost and margin — **stricter than financials** |
| `costs:write` | recording spend, approving time, setting rates |
| `org:manage` | settings, terms, cost rates |

`costs:read` is deliberately absent from `sales_rep` and `field_foreman`. Never
render cost or margin without checking it.

## 5. Components

`src/components/<domain>/`. Server components by default; `'use client'` only for
forms with `useFormState` and for local open/closed state.

Mobile-first is not decoration — this is used one-handed on a jobsite:
- The common action is **one tap**, no navigation. Status changes, checklist
  ticks, "push a day", clock in/out.
- Wide content (tables, timelines) lives in `overflow-x-auto` with a `min-w-`;
  the page body never scrolls sideways.
- Native `<Select>`; it works before the JS lands and is reliable on a phone.
- A `<form>` may never nest inside another `<form>`. Render sibling forms.

## 6. Screens

- Route under `src/app/(app)/<name>/`. Chrome-free printable views go under
  `src/app/(print)/`.
- **Add the prefix to `PROTECTED_PREFIXES`** in `src/lib/auth/route-access.ts`.
- **The nav is fixed at twelve PRD sections.** Do not add to it. Contracts,
  invoices, change orders, and daily logs are all reachable by link and by URL
  and are deliberately absent from the nav.
- Handle the three states every screen has: not configured, no permission, empty.
  An empty state says what to do next and links there.
- Wire the project-level card into `src/app/(app)/projects/[id]/page.tsx` — add
  the queries to the existing `Promise.all`, gated by permission with
  `Promise.resolve([])` as the else branch.

## 7. Voice

The comments and copy carry a lot of this codebase's value. Match them:

- Comments explain **why**, and especially why *not* the obvious alternative:
  "Clearing rather than cascading: losing a predecessor should orphan the
  dependency, not delete the successor's work."
- Name the judgement where there is one. "Cost-to-date on a running job is not
  margin." "An empty log is worse than no log."
- User-facing text is plain and specific. "Gaps in the daily record are what
  undermine a delay claim later." Not "Warning: incomplete data."

## 8. Never invent

Do not report an integration as working, a credential as configured, or a path as
tested unless it actually was. If storage isn't connected, the screen says so and
the commit message says so. Half the value of this system is that its numbers can
be trusted.
