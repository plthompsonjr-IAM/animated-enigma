import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * Database connection (server-only).
 *
 * A single lazily-initialized postgres-js client wrapped by Drizzle. The client
 * is created on first access so the app can build without DATABASE_URL present.
 * Application queries go through the repository layer, which always scopes by
 * organization; row-level security in Postgres is the hard tenant boundary.
 */

let client: ReturnType<typeof postgres> | null = null;

function getClient() {
  if (client) return client;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set — configure it in .env.local (see .env.example).');
  }
  // `prepare: false` is required by Supabase's transaction-mode pooler, which
  // multiplexes statements across backends and so cannot hold prepared statements.
  //
  // The pool size matters more once this is deployed than it ever did locally. A
  // dev server is one long-lived process and wants a real pool. Serverless is the
  // opposite: every warm function instance holds its own pool, so a per-client
  // maximum of ten multiplies across concurrent invocations and exhausts the
  // database's connection limit under exactly the load you'd want to survive.
  // One connection per instance is the right shape there — the pooler is doing
  // the pooling, and a second layer of it underneath only competes.
  const max = Number(process.env.DB_POOL_MAX ?? (process.env.NODE_ENV === 'production' ? 1 : 10));

  client = postgres(url, {
    prepare: false,
    max: Number.isFinite(max) && max > 0 ? max : 1,
    // Don't hold a connection open across a cold function that will never be
    // reused; the pooler reclaims it faster than the platform reaps the instance.
    idle_timeout: 20,
  });
  return client;
}

export function getDb() {
  return drizzle(getClient(), { schema });
}

export { schema };
