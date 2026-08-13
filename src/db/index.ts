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
  client = postgres(url, { prepare: false });
  return client;
}

export function getDb() {
  return drizzle(getClient(), { schema });
}

export { schema };
