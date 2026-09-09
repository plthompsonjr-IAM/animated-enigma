import { z } from 'zod';

/**
 * Environment validation.
 *
 * Server env is validated lazily (via `serverEnv()`) so the app can build and
 * render static shells without live credentials during early development. Public
 * (NEXT_PUBLIC_*) values are read directly where needed. Fuller enforcement is
 * tightened as each integration lands in later tasks.
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
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

/** Parse and cache server-side environment variables. */
export function serverEnv(): ServerEnv {
  if (cached) return cached;
  cached = serverSchema.parse(process.env);
  return cached;
}

export const publicEnv = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
};
