import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { publicEnv } from '@/lib/env';

/**
 * Server Supabase client — used from Server Components, Route Handlers, and
 * Server Actions. Reads/writes the session cookie so RLS receives the caller's
 * JWT (with org + roles claims). Full role resolution lands in Task 6.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // `setAll` called from a Server Component — safe to ignore when
          // middleware is refreshing the session.
        }
      },
    },
  });
}
