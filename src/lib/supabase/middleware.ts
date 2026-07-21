import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { publicEnv } from '@/lib/env';
import { decideAccess } from '@/lib/auth/route-access';

/**
 * Middleware: refresh the Supabase session cookie and enforce
 * authentication-level route protection (Task 6). Organization membership is
 * enforced by the app layout; RBAC by services/actions; tenancy by RLS.
 *
 * Without Supabase env vars the app runs in unauthenticated preview mode and
 * requests pass through untouched.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  if (!publicEnv.supabaseUrl || !publicEnv.supabaseAnonKey) {
    return response;
  }

  const supabase = createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const decision = decideAccess(request.nextUrl.pathname, Boolean(user));
  if (decision.kind === 'redirect') {
    return NextResponse.redirect(new URL(decision.to, request.url));
  }

  return response;
}
