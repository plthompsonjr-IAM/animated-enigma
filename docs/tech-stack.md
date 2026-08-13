# PT's Tactical Foreman — Technical Stack (Task 2)

| | |
|---|---|
| **Document version** | 1.0 |
| **Date** | 2026-07-18 |
| **Status** | Recommended — pending owner approval |
| **Basis** | `docs/PRD.md` v1.0 |

This document recommends the technical stack for PT's Tactical Foreman per the PRD's requirements: secure, mobile-first, multi-tenant, AI-assisted, with Google Workspace, payments, PDF, e-signature, RBAC, audit logging, and cloud deployment. No application code is generated in this task.

---

## 1. Selected Stack (summary)

| Layer | Selection | Role |
|---|---|---|
| Web framework | **Next.js 15+ (App Router)** | Web app, API routes/server actions, SSR for mobile speed |
| Language | **TypeScript** (strict) | End-to-end type safety, shared types front/back |
| Database | **PostgreSQL via Supabase** | Relational data, row-level security for tenant isolation |
| ORM / migrations | **Drizzle ORM + drizzle-kit** | Typed schema in code, SQL-first migrations |
| Auth | **Supabase Auth** | Email/password + verification/reset; JWT sessions; portal roles |
| File/photo storage | **Supabase Storage** (S3-compatible) | Photos, documents; signed expiring URLs; RLS policies |
| Styling | **Tailwind CSS** | Utility CSS, mobile-first |
| Component library | **shadcn/ui** (Radix primitives) | Accessible components, owned in-repo (no lock-in) |
| Validation | **Zod** | All API input validation + AI structured-output validation |
| AI | **Anthropic Claude API** (`claude-opus-4-8` default; `claude-sonnet-5` / `claude-haiku-4-5` as configurable per-task tiers) | Scope/estimate drafting, AI Foreman, job memory |
| Email (transactional) | **Resend** | Verification, notifications, proposal links |
| Email (user-sent) | **Gmail API (Google Workspace)** via OAuth | Client-facing emails sent as the user |
| Calendar | **Google Calendar API** via OAuth | Site visits, schedules, inspections |
| Payments | **Stripe** (behind a provider-independent ledger) | Client invoice payments |
| PDF generation | **@react-pdf/renderer** | Proposals, contracts, invoices, reports |
| E-signature | **Built-in capture** (`signature_pad` + audit metadata) | Proposal/change-order approval |
| Error monitoring | **Sentry** | Server + client error tracking |
| Analytics | **PostHog** (or Vercel Analytics) | Product usage |
| Testing | **Vitest** (unit/integration) + **Playwright** (E2E) + Testing Library | Task 44 test suite |
| Lint/format | **ESLint + Prettier** | Code quality |
| Hosting | **Vercel** | App hosting, previews, edge network |
| Repo/CI | **GitHub + GitHub Actions** | CI checks, migration gating |

---

## 2. Reasons for Each Selection

**Next.js + TypeScript.** One codebase serves the responsive web app, the client/sub portals, and the API layer (route handlers + server actions), which keeps a solo-maintainable footprint. Server-side rendering and streaming matter on jobsite phones with weak signal — first paint comes from the server, not a large JS bundle. TypeScript end-to-end lets database types (Drizzle), validation schemas (Zod), and UI props share one type system, which is the cheapest defense against financial-calculation bugs the PRD treats as critical. React Native/Expo can later reuse the API layer and types for the future native app.

**PostgreSQL via Supabase.** The PRD demands relational integrity, organization-level isolation, and auditability — a relational database is non-negotiable. Supabase bundles managed Postgres with the three other things we'd otherwise integrate separately: Auth, Storage, and **row-level security**, which is the PRD's required enforcement point for tenant isolation (security is enforced in the database, not just the app). Daily backups and point-in-time recovery are managed. Critically, Supabase is *just Postgres* — if we outgrow it, we take a `pg_dump` to RDS/Neon and keep the schema, RLS policies, and SQL.

**Drizzle ORM.** Schema defined in TypeScript, generating plain SQL migrations we can read and audit — important because RLS policies, triggers (audit logging, `updated_at`), and constraints will live in migrations. Lighter runtime than Prisma, no separate schema DSL, and it never hides the SQL, which matters for the financial-integrity constraints (immutability triggers, check constraints).

**Supabase Auth.** Email/password with verification and reset out of the box, JWTs that carry the claims RLS policies check, and support for separate portal user contexts. Avoids building password infrastructure ourselves (PRD security req. #1) and avoids a per-user-priced third party (Auth0/Clerk) that gets expensive as client/sub portal users accumulate.

**Tailwind + shadcn/ui.** Mobile-first utility styling with a component library that is copied into the repo rather than installed as a dependency — we own and can restyle every component (PTTR branding is configuration, not a fork of someone's theme). Radix primitives give accessibility (focus, keyboard, screen reader) without effort. This is also the ecosystem's best-trodden path, which maximizes AI-assisted development velocity for the remaining 44 tasks.

**Zod.** One validation library for API inputs *and* AI structured outputs (Task 32 requires validating all AI-produced structured data against application schemas). Zod schemas double as the source for TypeScript types and can be handed to the Claude SDK for structured-output enforcement.

**Anthropic Claude API.** The AI layer is the product's differentiator, and its hard requirements (separate facts from assumptions, never auto-act, permission-filtered context, cited sources) demand strong instruction-following and tool use. Claude Opus 4.8 is the default model for quality-sensitive work (scope generation, estimate drafting, job-memory answers); `claude-sonnet-5` and `claude-haiku-4-5` are configured as per-task tiers so high-volume/low-stakes calls (summaries, classification, follow-up nudges) cost a fraction. Model choice lives in org-level AI settings (Task 41) — **the AI service layer is provider-abstracted** so OpenAI or others could be swapped in per the modularity rule. Structured outputs + Zod validation enforce the "AI drafts must validate against schemas" rule at the API level.

**Resend + Gmail API (two email paths, on purpose).** Transactional system mail (verification, notification, proposal links) needs high deliverability and no user OAuth — Resend. Client-facing correspondence should come *from the contractor's own address* so replies land in their inbox — Gmail API with per-user OAuth (Task 35). Conflating these two paths is a common design mistake; the PRD's requirements (metadata logging, approval gating) apply to the Gmail path.

**Stripe behind a provider-independent ledger.** Task 28 explicitly requires the accounting model to be payment-provider independent: invoices, payments, and allocations are our tables; Stripe is one way a payment record gets created (webhook) alongside manual entry for checks/cash — common in renovation work. Stripe is chosen for hosted checkout/payment links (no card data ever touches us — PCI SAQ-A), strong webhooks, and future ACH support (bank transfers matter at renovation invoice sizes).

**@react-pdf/renderer.** Pure-JS PDF generation that runs in Vercel's serverless runtime without a headless browser. Proposal/invoice layouts are written as React components — same skill set as the rest of the app, and branding (logo, colors, "Your Home, Our Mission.") is data-driven. Escape hatch: if a design ever exceeds react-pdf's layout model, a hosted HTML-to-PDF service (Gotenberg/Browserless) can be swapped in behind the same `PdfService` interface.

**Built-in e-signature.** Task 19's requirements (draw/type signature, timestamp, IP/session metadata, configurable legal disclosures, signed PDF) are met by capturing signatures in our own secure-link flow and stamping the audit record — appropriate for residential renovation contracts and $0/document. DocuSign/Dropbox Sign remain a post-MVP upgrade behind a `SignatureService` interface if certified third-party signatures become a requirement.

**Vercel + GitHub Actions.** First-party Next.js hosting with per-PR preview deployments (useful for Patrick reviewing each task's output), automatic SSL, and env separation for dev/staging/production (Task 45). GitHub Actions runs lint, typecheck, tests, and migration checks before deploy.

**Sentry, PostHog, Vitest, Playwright, ESLint/Prettier.** Standard, low-cost, well-integrated choices for the PRD's monitoring, analytics, and Task 44 testing requirements; Playwright covers the mobile-viewport E2E flows the acceptance criteria demand.

---

## 3. Alternatives Considered

| Decision | Alternatives | Why not chosen |
|---|---|---|
| Next.js | Remix/React Router 7; SvelteKit; Rails/Laravel + React SPA | Remix is solid but a smaller ecosystem for our component/AI tooling; SvelteKit complicates future React Native code sharing; a separate SPA + API doubles the codebase without benefit at this scale |
| Supabase | **Neon/RDS + Auth.js + S3** (self-assembled); Firebase; PlanetScale | Self-assembly is the credible runner-up — more control, but three integrations instead of one and hand-rolled RLS tooling; Firebase is non-relational (fails PRD data requirements); PlanetScale is MySQL-based, historically without FK enforcement |
| Drizzle | Prisma; Kysely; raw SQL | Prisma is heavier at runtime, hides SQL, and its migration DSL makes RLS/trigger work awkward; Kysely is a query builder without a schema/migration story; raw SQL forfeits type safety |
| Supabase Auth | Clerk; Auth0; Auth.js (NextAuth) | Clerk/Auth0 are per-MAU priced — portal users (every client and sub) make that expensive; Auth.js is free but leaves password/verification/reset plumbing to us and doesn't mint RLS-ready JWTs natively |
| shadcn/ui | MUI; Mantine; Chakra | Heavier dependencies, harder deep re-branding, larger bundles on slow connections; shadcn's copy-in model gives full ownership |
| Claude API | OpenAI API; Gemini; multi-provider router (OpenRouter) | OpenAI is a viable alternative and remains swappable behind the AI service interface; Claude chosen for instruction-following/tool-use strength on the safety-gated drafting workflows; a router adds a dependency before we need one |
| Stripe | Square; PayPal/Braintree; ACH-first (Plaid) | Square is strongest in-person; renovation payments here are remote invoice payments; Stripe's API/webhook/Checkout maturity wins; ledger stays provider-independent regardless |
| @react-pdf/renderer | Puppeteer/Playwright HTML→PDF; pdfmake; DocRaptor/PDFMonkey (SaaS) | Headless Chromium is painful in serverless (size/cold starts) and pushes toward extra infrastructure; pdfmake's JSON layouts are harder to maintain than React components; SaaS adds per-doc cost and an external dependency for a core artifact |
| Built-in signature | DocuSign; Dropbox Sign | $10–40+/user/mo for capability Task 19 doesn't require at MVP; kept as a swappable post-MVP option |
| Vercel | Netlify; Fly.io/Render; AWS Amplify | Vercel is first-party for Next.js with the least ops burden; Fly/Render mean managing containers; acceptable alternatives if pricing ever becomes a problem |
| Resend | Postmark; SES | Postmark equally good (slightly pricier); SES is cheapest but with real deliverability/ops overhead |

---

## 4. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **RLS policy mistakes** — a wrong policy silently leaks cross-tenant data | Critical | Automated cross-tenant tests from Task 6 onward (PRD acceptance #3–5); RLS templates per table; security review at Task 43 |
| Supabase platform dependency (auth+db+storage in one vendor) | Medium | It's standard Postgres + S3-compatible storage; documented export path; no proprietary query features |
| Vercel serverless limits (function duration/size) vs. long AI calls & PDF renders | Medium | Streaming responses for AI; queue long jobs (Supabase cron/queues or Inngest) post-MVP; react-pdf avoids the heavyweight-browser problem |
| AI cost/latency drift as usage grows | Medium | Per-task model tiers, prompt caching, org-level AI settings incl. usage caps; costs are metered per-call and logged |
| AI output quality on estimates (money-adjacent) | High | PRD hard rules: AI never publishes; every item carries assumption/confidence status; human approval gates; Zod schema validation |
| Google OAuth verification process (Gmail/Calendar scopes require app review) | Medium | Start verification early (Task 35); restrict to needed scopes; internal-user mode works pre-verification for PTTR's own Workspace |
| E-signature enforceability varies by jurisdiction | Medium | Configurable disclosures (Task 19); audit metadata; DocuSign swap-in path if needed |
| Single-framework concentration (Next.js churn between major versions) | Low | Pin majors; business logic lives in framework-agnostic service modules per the modularity rule |
| Solo-founder bus factor / operational complexity | Medium | Managed services everywhere; infrastructure-as-configuration documented in Task 45 |

---

## 5. Estimated Operating Costs

Early-stage (PTTR as the primary org, a handful of internal users, dozens of portal users). Monthly, USD:

| Service | Tier | Est. cost |
|---|---|---|
| Vercel | Pro (1 seat) | $20 |
| Supabase | Pro (8 GB DB, 100 GB storage, PITR add-on optional) | $25–35 |
| Anthropic Claude API | Metered — Opus 4.8 $5/$25 per Mtok; Sonnet 5 $3/$15 (intro $2/$10 through 2026-08-31); Haiku 4.5 $1/$5. Moderate use (a few hundred drafting calls/mo with caching) | $20–80 |
| Resend | Free → Pro | $0–20 |
| Sentry | Developer/Team | $0–26 |
| PostHog | Free tier | $0 |
| Stripe | Per-transaction only: 2.9% + $0.30 card; ~0.8% ACH (capped) | $0 fixed |
| Google Workspace APIs | Free at this volume | $0 |
| Domain + DNS | — | ~$2 (amortized) |
| GitHub | Free (private repo, Actions free tier) | $0 |
| **Total fixed** | | **≈ $70–185/mo** + payment processing fees |

Card fees are the dominant real cost at scale (2.9% + $0.30 on client payments) — surfacing **ACH as the preferred rail** for large invoices is a product decision worth making early. AI spend scales with usage but stays modest with tiering and prompt caching; heavy Opus-only usage without caching is the main way this line item surprises.

---

## 6. Local Development Requirements

- **Node.js 20 LTS+** and **pnpm** (lockfile committed)
- **Supabase CLI** + **Docker Desktop** — `supabase start` runs the full stack (Postgres, Auth, Storage, mail-catcher) locally; `supabase db reset` replays migrations + seed
- **Git**; editor with TypeScript/ESLint/Tailwind extensions (VS Code recommended)
- **`.env.local`** from the committed `.env.example`: Supabase local keys, `ANTHROPIC_API_KEY`, Stripe **test** keys, Google OAuth **dev** client, Resend test key
- **Stripe CLI** for local webhook forwarding (`stripe listen`)
- Commands (established at Task 5): `pnpm dev`, `pnpm test`, `pnpm test:e2e`, `pnpm lint`, `pnpm typecheck`, `pnpm db:generate` / `db:migrate` / `db:seed`
- Works fully offline except AI/Gmail/Calendar/Stripe calls (all mockable in tests; no live keys required to run the app)

---

## 7. Production Deployment Architecture

Three isolated environments (Task 45): **development** (local, per-developer), **staging** (Vercel preview/staging + dedicated Supabase project + Stripe test mode), **production** (Vercel production + dedicated Supabase project + Stripe live). Each environment has its own database, storage buckets, OAuth clients, and secrets — no shared credentials.

```
Browser / phone (PWA-ready web app)
        │ HTTPS (Vercel edge, SSL, CDN-cached static assets)
        ▼
Vercel — Next.js app
  ├─ Server components / route handlers / server actions
  │     ├─ RBAC middleware (session → role → org scope)
  │     ├─ Service layer (modular: EstimateService, PdfService,
  │     │   AiService, EmailService, CalendarService, PaymentService…)
  │     └─ Drizzle → Supabase Postgres (RLS enforced in-database)
  ├─ Webhook endpoints: Stripe, Resend, (Google push later)
  └─ Cron (Vercel cron): reminders, follow-ups, credential-expiry checks
        │
        ├─► Supabase: Postgres (RLS, PITR backups) · Auth (JWT) · Storage (signed URLs)
        ├─► Anthropic Claude API (server-side only; keys never reach the client)
        ├─► Google APIs: Gmail + Calendar (per-user OAuth tokens, encrypted at rest)
        ├─► Stripe: Checkout/Payment Links + webhooks → provider-independent ledger
        ├─► Resend: transactional email
        └─► Sentry / PostHog: errors + analytics
```

Operational posture: GitHub Actions gate (lint, typecheck, unit + E2E, migration dry-run) → Vercel deploy; migrations applied to staging before production; Supabase daily backups + point-in-time recovery; secrets only in Vercel/Supabase env managers; rollback = redeploy previous Vercel build + documented migration-rollback procedure (Task 45).

---

## 8. Decision Requested

Approve this stack (or flag substitutions) so Task 3 (system architecture) and Task 4 (database schema) can build on it. The two most consequential commitments are **Supabase as the data/auth/storage backbone** and **Claude as the default AI provider (abstracted)** — everything else is swappable at low cost later.
