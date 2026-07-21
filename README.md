# PT's Tactical Foreman

AI-powered general contractor command system for PT's Tactical Renovations —
from first client conversation through intake, estimate, proposal, execution,
invoicing, and warranty. **Your Home, Our Mission.**

Built in controlled phases. See `docs/` for the product and technical basis:

| Doc | What it is |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | Product Requirements Document (Task 1) |
| [`docs/tech-stack.md`](docs/tech-stack.md) | Technical stack recommendation (Task 2) |
| [`docs/architecture.md`](docs/architecture.md) | System architecture (Task 3) |
| [`docs/database-schema.md`](docs/database-schema.md) | Database schema design (Task 4) |

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind CSS · Drizzle ORM ·
PostgreSQL/Supabase (Auth + Storage) · Zod · Anthropic Claude · Vitest.

## Getting started

Requirements: **Node 20+** and **pnpm**. (For the database and auth,
[Supabase CLI](https://supabase.com/docs/guides/cli) + Docker are used from
Task 6 onward.)

```bash
pnpm install
cp .env.example .env.local   # fill in as integrations come online
pnpm dev                     # http://localhost:3000
```

The app runs without external credentials at this stage — it renders the
navigation shell and the twelve section placeholders. Database, auth, and
integrations are wired in later tasks.

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | Start the dev server |
| `pnpm build` | Production build |
| `pnpm start` | Serve the production build |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript, no emit |
| `pnpm format` / `format:check` | Prettier |
| `pnpm test` / `test:watch` | Vitest |
| `pnpm db:generate` / `db:migrate` / `db:studio` | Drizzle migrations & studio |

## Project structure

```
src/
  app/
    (app)/           # authenticated shell + the twelve sections
    globals.css
    layout.tsx       # root layout
    page.tsx         # → /dashboard
    global-error.tsx # root error boundary
    not-found.tsx
  components/
    layout/          # sidebar, mobile nav, header, nav config
    ui/              # button, card (shadcn-style, owned in-repo)
    section-placeholder.tsx
  db/                # Drizzle schema + connection
  lib/
    supabase/        # server/client/middleware auth helpers
    env.ts           # Zod-validated environment
    logger.ts        # structured logging foundation
    utils.ts         # cn()
  middleware.ts      # session refresh (route protection: Task 6)
legacy/              # archived ContractorAds demo (not part of this product)
```
