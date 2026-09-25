import { NextResponse, type NextRequest } from 'next/server';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { buildAuthUrl, newState, providerStatus } from '@/lib/google/google-core';
import { GOOGLE_STATE_COOKIE, googleEnv } from '@/lib/google/tokens';

/**
 * Start the Google consent flow.
 *
 * Middleware lets `/api/*` through, so this route enforces its own gate: a
 * signed-in member of an organization, holding `org:manage` for now — the
 * owner connects first. Loosening that to any member is one line here; the
 * database already guarantees each person can only ever store their own
 * connection, so the gate is about who we let try, not who we trust.
 */
export async function GET(request: NextRequest) {
  const origin = new URL(request.url).origin;
  const ctx = await getAuthContext();

  if (!ctx.userId) {
    return NextResponse.redirect(new URL('/login?next=/settings', origin));
  }
  if (!ctx.activeOrg) {
    return NextResponse.redirect(new URL('/onboarding', origin));
  }
  if (!can(ctx.activeOrg.roles, 'org:manage', ctx.activeOrg.extraPermissions)) {
    return NextResponse.redirect(new URL('/settings?google=forbidden', origin));
  }

  const env = googleEnv();
  const status = providerStatus(env);
  if (!status.configured || !env.clientId || !env.redirectUri) {
    return NextResponse.redirect(new URL('/settings?google=unconfigured', origin));
  }

  const state = newState();
  const response = NextResponse.redirect(
    buildAuthUrl({ clientId: env.clientId, redirectUri: env.redirectUri, state }),
  );
  // Lax, not Strict: the cookie has to survive the top-level navigation back
  // from Google, which is a cross-site GET. Ten minutes is more than a consent
  // screen takes and short enough that a stale state can't be replayed later.
  response.cookies.set({
    name: GOOGLE_STATE_COOKIE,
    value: state,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/auth/google',
    maxAge: 600,
  });
  return response;
}
