import { describe, it, expect } from 'vitest';
import { decideAccess, isProtectedPath, isAuthPath, isPublicPath } from './route-access';

describe('route access decisions', () => {
  it('classifies protected, auth, and public paths', () => {
    expect(isProtectedPath('/dashboard')).toBe(true);
    expect(isProtectedPath('/settings/team')).toBe(true);
    expect(isProtectedPath('/financials')).toBe(true);
    expect(isProtectedPath('/login')).toBe(false);
    expect(isAuthPath('/login')).toBe(true);
    expect(isAuthPath('/reset-password')).toBe(true);
    expect(isPublicPath('/invite/abc123')).toBe(true);
    expect(isPublicPath('/auth/callback')).toBe(true);
    // Client share links are public; the internal money sections are not.
    expect(isPublicPath('/proposal/tok')).toBe(true);
    expect(isPublicPath('/change-order/tok')).toBe(true);
    expect(isProtectedPath('/contracts')).toBe(true);
    expect(isProtectedPath('/change-orders/abc')).toBe(true);
    expect(isProtectedPath('/invoices/abc')).toBe(true);
    // The singular public path must not accidentally expose the plural one.
    expect(isPublicPath('/change-orders/abc')).toBe(false);
  });

  it('unauthenticated users are redirected to login from every protected section', () => {
    const sections = [
      '/dashboard',
      '/leads',
      '/clients',
      '/projects',
      '/estimates',
      '/proposals',
      '/schedule',
      '/tasks',
      '/documents',
      '/financials',
      '/ai-foreman',
      '/settings',
      '/settings/team',
      '/onboarding',
    ];
    for (const path of sections) {
      const decision = decideAccess(path, false);
      expect(decision.kind).toBe('redirect');
      if (decision.kind === 'redirect') {
        expect(decision.to.startsWith('/login?next=')).toBe(true);
      }
    }
  });

  it('the login redirect preserves the requested destination', () => {
    const decision = decideAccess('/settings/team', false);
    expect(decision).toEqual({
      kind: 'redirect',
      to: `/login?next=${encodeURIComponent('/settings/team')}`,
    });
  });

  it('unauthenticated users may reach public and auth pages', () => {
    expect(decideAccess('/login', false).kind).toBe('allow');
    expect(decideAccess('/register', false).kind).toBe('allow');
    expect(decideAccess('/invite/some-token', false).kind).toBe('allow');
  });

  it('authenticated users are bounced from auth screens into the app', () => {
    expect(decideAccess('/login', true)).toEqual({ kind: 'redirect', to: '/dashboard' });
    expect(decideAccess('/register', true)).toEqual({ kind: 'redirect', to: '/dashboard' });
  });

  it('authenticated users pass through protected routes', () => {
    expect(decideAccess('/dashboard', true).kind).toBe('allow');
    expect(decideAccess('/settings/team', true).kind).toBe('allow');
  });
});
