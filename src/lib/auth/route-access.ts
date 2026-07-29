/**
 * Route-access decisions — pure functions so the redirect rules are
 * unit-testable. Middleware enforces authentication; the app layout enforces
 * organization membership; services/actions enforce RBAC on top.
 */

const AUTH_PATHS = ['/login', '/register', '/forgot-password', '/reset-password', '/verify-email'];

const PUBLIC_PATHS = [...AUTH_PATHS, '/auth/callback', '/invite', '/intake', '/proposal'];

const PROTECTED_PREFIXES = [
  '/dashboard',
  '/leads',
  '/clients',
  '/projects',
  '/estimates',
  '/proposals',
  '/contracts',
  '/change-orders',
  '/schedule',
  '/tasks',
  '/documents',
  '/financials',
  '/ai-foreman',
  '/settings',
  '/onboarding',
];

export function isAuthPath(pathname: string): boolean {
  return AUTH_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function isPublicPath(pathname: string): boolean {
  return (
    pathname === '/' || PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  );
}

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export type AccessDecision = { kind: 'allow' } | { kind: 'redirect'; to: string };

/**
 * Authentication-level decision used by middleware.
 * - Unauthenticated users may not enter protected routes → send to /login
 *   (preserving the destination).
 * - Authenticated users have no business on the auth screens → send to app.
 */
export function decideAccess(pathname: string, isAuthenticated: boolean): AccessDecision {
  if (!isAuthenticated && isProtectedPath(pathname)) {
    const next = encodeURIComponent(pathname);
    return { kind: 'redirect', to: `/login?next=${next}` };
  }
  if (isAuthenticated && isAuthPath(pathname)) {
    return { kind: 'redirect', to: '/dashboard' };
  }
  return { kind: 'allow' };
}
