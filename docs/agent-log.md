# Agent log

The coordination channel between whichever assistants work on this repository —
Claude, ChatGPT, Codex, or whatever comes next. It lives here rather than in a
chat because chat scrolls away and this does not: it is versioned, it sits beside
the code it describes, and anything that can read the repository can read it.

**Newest entry first.** Read the top two or three and you have current context.

---

## How to use this

**Before starting work:** read the open threads below, then `CLAUDE.md`. This
file carries what is *in motion*; `CLAUDE.md` carries the rules that always hold.
For the full picture — architecture, what is unverified, what is blocked —
`docs/PTTR-Foreman-Handoff.pdf` is the standing brief.

**When you finish a piece of work:** add an entry at the top of the log. Keep it
to what the next reader needs:

```
## YYYY-MM-DD — <what happened>
**By:** <which assistant> · **Commit:** <sha>

What changed, and why. Any decision made and the reasoning behind it —
especially where the obvious alternative was rejected, and why.

Anything found that was not fixed, stated plainly.
```

**When you need an answer from someone else:** add it under Open threads rather
than burying it in a log entry. Move it to Settled when it is resolved, with the
answer — a thread that vanishes teaches the next reader nothing.

**Two rules, and the first one matters most.**

1. **Never record something as done, tested, or integrated unless it actually
   was.** If a migration is unapplied, if a path was never exercised, if a number
   was estimated rather than measured — say so here. This log is only worth
   reading if it can be trusted, and one confident wrong entry costs more than
   ten admitted gaps.
2. **Do not edit past entries.** Correct them with a new one. The history of what
   was believed and when is part of what makes this useful.

**Do not put secrets here.** No API keys, no connection strings, no tokens. This
is a public-shaped file in a repository. Reference a variable by name only.

---

## Open threads

| # | Question | Raised | Waiting on |
|---|---|---|---|
| 1 | Does production deploy from `main`, or does PR #6 merge first? `main` is 36 commits behind and stops at Task 7, so a production deploy from it today would ship placeholder screens. | 2026-08-14 | Owner |
| 4 | Vercel account needs a GitHub Login Connection before any repository can be linked. Nothing can deploy until this is added — it is an OAuth flow in the owner's browser. | 2026-08-14 | Owner |
| 2 | Once a model key exists, may it draft client-facing text directly, or only suggest edits to the existing deterministic draft? Recommendation on file: draft-only, never autonomous. | 2026-08-14 | Owner |
| 3 | `src/components/section-placeholder.tsx` is now unused — `/ai-foreman` was its last caller. Delete it, or keep it for stubbing future screens? Kept for now. | 2026-08-14 | Owner |

### Settled

| Question | Answer | Date |
|---|---|---|
| Does the Foreman belong in the TAC ecosystem? | Yes. Registered as a CapabilityRegistry entry under the PTTR venture, whose description was corrected from real-estate portfolio management to contracting. | 2026-08-14 |
| Anthropic or OpenAI for the AI Foreman? | Anthropic, matching the code as written. The pending OpenAI request serves TAC-BRIDGE's own agents, not this application. | 2026-08-14 |

---

## Log

## 2026-08-16 — First deploy: linked, failed, and why
**By:** Claude · **Commit:** `792f95f`

Both blockers from the 08-14 attempt were cleared by the owner (GitHub Login
Connection, then the Vercel GitHub App installed on the repo). The project
**tactical-foreman** (`prj_RYGvZVCZpbZKMEvY50thibUKaPip`) is now linked, created
with `deploy: false` so the first build would come from this branch rather than
`main`'s stale Task 7 state. An empty commit pushed to trigger it.

**The build failed.** Confirmed via Vercel's own commit status (`state: failure`)
and its PR #6 bot comment — not guessed at. The cause the owner reported from the
Vercel dashboard: `next@15.1.6` is flagged as a known vulnerable version.

That is real, not a false positive: **CVE-2025-29927**, the middleware
authorization-bypass vulnerability — a spoofed `x-middleware-subrequest` header
makes Next.js skip middleware execution entirely. This app gates every protected
route through `src/middleware.ts`, so this was live exposure, not theoretical.
Fixed upstream in 15.2.3 and patched since; upgraded to the latest published 15.x
(15.5.23) rather than jumping to 16, to take every fix issued since 15.1.6
without a major-version migration under deploy pressure. `eslint-config-next`
moved with it. Typecheck, 666 tests, and the production build all clean
afterward; no application code needed to change.

**Also noted while reading tool output, not acted on:** my Vercel read tools
(`get_deployment`, `list_deployments`, `list_projects`) failed with 403/404
throughout this attempt, even immediately after a write to the same project
succeeded. Coincided with the Vercel team being renamed mid-session
(`patthompson-2694's projects` → `Tac System`, same team id). Build status was
only confirmed through the GitHub webhook events Vercel posted to PR #6, not
through direct API reads. If this recurs, that is where to look first.

**Not yet known:** whether the retriggered build (pushed as part of this commit)
succeeds. Check the next PR #6 status before assuming it does.

## 2026-08-14 — First deploy attempted, blocked on a Vercel account setting
**By:** Claude

Owner approved hosting; recorded on IntegrationRequest `6a7f5e62b080aebc19ebd0b1`
as `owner_decision: approved`, `status: authorized`.

**Nothing is deployed.** The Vercel account exists and is reachable
(`team_zWhUMX1dQGGDuuBuucV9BBqg`) and contains zero projects.

Creating the project failed with a 400:

> Failed to link plthompsonjr-IAM/animated-enigma. You need to add a Login
> Connection to your GitHub account first.

The Vercel account has no GitHub Login Connection. That is an OAuth flow in the
owner's browser and cannot be done from here. Until it exists, no repository can
be linked and no deploy can happen.

**Also found, and it matters more than it looks:** `main` is at `c8b5543`
("Build the main application layout", Task 7) and the working branch is **36
commits ahead**. Vercel tracks the default branch for production, so a project
created today would deploy the application as it stood at Task 7 — layout and
placeholder screens, none of Tasks 8 through 30. Decide the branch question
before the first production deploy, not after.

Supabase project `zhlkfuvscnblkkyfticz` is `ACTIVE_HEALTHY`, not paused.

## 2026-08-14 — Deployment groundwork
**By:** Claude · **Commit:** `9f9be31`

The application has never been deployed. This is the preparation, not a record of
a deploy having happened — nothing here has run against a real host.

The change that matters is connection pooling. Every serverless function instance
holds its own pool, so a per-client maximum of ten multiplies across concurrent
invocations and exhausts the database's connection limit under exactly the load
worth surviving. Production now caps at one connection per instance; the pooler
is already doing the pooling and a second layer underneath only competes.
`DB_POOL_MAX` overrides it and falls back to 1 on an unparseable or zero value.

`docs/deployment.md` is the runbook. It leads with the trap most likely to break
a first deploy: the running app needs the **transaction pooler on 6543**, and
migrations need the **direct connection on 5432**. Using the wrong one builds
clean and then fails under traffic.

Migrations deliberately do not run during the build. A failure partway through
leaves the schema half-applied with no clean rollback, and code reverts in
seconds where schema does not.

**Verified:** pool configuration exercised against a real Postgres cluster —
production defaults to 1, development to 10, an explicit override is honoured,
and both a garbage value and zero fall back to 1 rather than producing NaN or a
zero-sized pool. Twenty-five concurrent queries through a single connection all
returned correct results, confirming they queue rather than error.

**Not verified:** everything else about deploying. No host is connected, no
deployment has been attempted, and the post-deploy checklist in the runbook is
entirely unwalked.

## 2026-08-14 — Registered in TAC-BRIDGE
**By:** Claude

The Foreman was absent from every TAC-BRIDGE registry. Now present:

- **PTTR venture description corrected.** It described real-estate portfolio
  management; the Foreman runs a contracting business. Category moved from
  `real_estate` to `service`; the revenue target was left alone.
- **CapabilityRegistry entry** for the application, under TAC Developers, with
  the security model recorded in its scopes so nobody who touches it later misses
  the `BYPASSRLS` problem.
- **Four IntegrationRequests** at `owner_approval`: hosting, transactional email,
  Supabase, and Anthropic. Every `test_result` field states honestly what was and
  was not verified.
- **Two AgentHandoff records** — a technical alignment brief and an escalation of
  the gates blocking launch.

**Found, not changed:** the Venture table holds duplicate records for
`TAC Logistics` and `TAC-IT`, each appearing twice under different ids. Anything
counting ventures will double-count them.

**No credentials exist anywhere in TAC-BRIDGE**, by design — every
`credential_reference` is a vault alias or a pending connector, never a secret.
Do not attempt to route around that.

## 2026-08-14 — Task 30: AI Foreman
**By:** Claude · **Commit:** `afb3174`

The last placeholder screen. Answers "where is this job" from the record, with
the number behind every claim printed underneath it.

**Deterministic on purpose.** No model is connected and the screen says so rather
than implying one is thinking. A briefing assembled by pure functions is
checkable, which is what makes it safe to read to a client. `briefingText()` is
the context packet a model would receive; the model's job is phrasing, never the
numbers.

Findings rank by consequence, not by area — money spent and not billed outranks a
task running two days late, because one is a loan you did not agree to make. The
client-update draft is deliberately narrower than the briefing: no cost, no
margin, no crew conflicts, no overdue invoice.

**Two real bugs found while building:**

- Days remaining used `spanDays`, which is inclusive, so a finish date of tomorrow
  read as "2 days left". Now `dayDiff`.
- The change-order aggregate matched only `approved`, but `countsTowardContract`
  is approved **or** incorporated. It would have undervalued the revised contract
  and missed unbilled extras — the exact leak the feature exists to catch.

**Verified:** 666 unit tests across 33 files, 169 assertions against real
Postgres, typecheck, lint, production build, and the setup-SQL verifier all
clean. The route was served from the production build and returns 200.

**Not verified:** the authenticated path has never been exercised in a browser —
this environment has no Supabase credentials.

## 2026-08-14 — Log opened
**By:** Claude

Opened as the coordination channel between assistants, after a Slack relay was
considered and set aside. Slack would need an always-on service to receive its
events, and neither assistant runs continuously — messages would land in a
channel nobody was listening to. The repository is durable, versioned, readable
by anything that can read code, and needs no infrastructure.

Revisit Slack after the application is deployed, if a real need for it survives.
