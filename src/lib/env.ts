import { z } from 'zod';

/**
 * Environment validation.
 *
 * Server env is validated lazily (via `serverEnv()`) so the app can build and
 * render static shells without live credentials during early development.
 *
 * Every value the app needs can arrive under more than one name, because the
 * hosts that supply them disagree: Vercel's Supabase integration writes
 * `POSTGRES_URL` and `SUPABASE_SECRET_KEY`, older installs of it wrote
 * `SUPABASE_SERVICE_ROLE_KEY`, and Vercel itself already knows the deployed
 * URL. Accepting each of those means "install the integration" is the whole
 * setup, rather than copying five strings by hand — and the copy-by-hand names
 * still win when both are present, so nothing already configured changes.
 *
 * `NEXT_PUBLIC_*` values must be referenced literally (`process.env.NAME`) —
 * that is how Next.js finds them to inline into the browser bundle — so the
 * public block below spells each name out rather than looping.
 */

const serverSchema = z.object({
  DATABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL_DEFAULT: z.string().default('claude-opus-4-8'),
  AI_MODEL_FAST: z.string().default('claude-haiku-4-5'),
  RESEND_API_KEY: z.string().optional(),
  // Google Workspace (Task 31). All optional: with any absent, the Connect
  // button says what is missing and nothing sends or syncs.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url().optional(),
  /** 32 random bytes, base64. Encrypts stored refresh tokens app-side. */
  GOOGLE_TOKEN_ENCRYPTION_KEY: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  CONTEXT_DEV_API_KEY: z.string().min(1).optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

/** Parse and cache server-side environment variables. */
export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.parse(process.env);
  cached = {
    ...parsed,
    DATABASE_URL: resolveDatabaseUrl(process.env),
    SUPABASE_SERVICE_ROLE_KEY: resolveServiceRoleKey(process.env),
  };
  return cached;
}

// ── Pure resolvers (tested) ──────────────────────────────────────────────────

/** The subset of `process.env` the resolvers read. Plain object so tests can pass one. */
export type RawEnv = Record<string, string | undefined>;

function present(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

/**
 * The Postgres connection string for the running app.
 *
 * `DATABASE_URL` if set by hand; otherwise `POSTGRES_URL`, which is what the
 * Vercel ↔ Supabase integration writes — already the transaction pooler, which
 * is the one the app must use. The integration appends a `workaround=` query
 * parameter meant for Vercel's own Postgres client; postgres-js has no use for
 * it, so it is stripped rather than passed through as an unknown option.
 */
export function resolveDatabaseUrl(env: RawEnv): string | undefined {
  const raw = present(env.DATABASE_URL) ?? present(env.POSTGRES_URL);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    url.searchParams.delete('workaround');
    return url.toString();
  } catch {
    return raw;
  }
}

/** The key that bypasses row-level security — server-only, under either of its names. */
export function resolveServiceRoleKey(env: RawEnv): string | undefined {
  return present(env.SUPABASE_SERVICE_ROLE_KEY) ?? present(env.SUPABASE_SECRET_KEY);
}

/**
 * The URL people reach the app at — the base of every invite, proposal, and
 * calendar link.
 *
 * `NEXT_PUBLIC_APP_URL` if set by hand. Otherwise Vercel already knows it:
 * the production domain in production, and the branch's stable URL on a
 * preview (not the per-deployment URL, which is replaced by the next push and
 * would leave a client holding a dead link). Locally, the dev server.
 */
export function resolveAppUrl(env: RawEnv): string {
  const explicit = present(env.NEXT_PUBLIC_APP_URL);
  if (explicit) return explicit.replace(/\/+$/, '');

  const vercelEnv = present(env.VERCEL_ENV);
  const host =
    vercelEnv === 'production'
      ? (present(env.VERCEL_PROJECT_PRODUCTION_URL) ?? present(env.VERCEL_URL))
      : vercelEnv === 'preview'
        ? (present(env.VERCEL_BRANCH_URL) ?? present(env.VERCEL_URL))
        : undefined;
  if (host) return `https://${host.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;

  return 'http://localhost:3000';
}

export const publicEnv = {
  appUrl: resolveAppUrl(process.env),
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  // The legacy anon key and the newer publishable key are interchangeable for
  // the browser client; the integration supplies whichever generation it is on.
  supabaseAnonKey:
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    '',
};

/** The app's database connection string, or undefined when none is configured. */
export function databaseUrl(): string | undefined {
  return resolveDatabaseUrl(process.env);
}
