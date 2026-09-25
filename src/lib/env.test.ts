import { describe, it, expect } from 'vitest';
import { resolveAppUrl, resolveDatabaseUrl, resolveServiceRoleKey } from './env';

describe('resolveDatabaseUrl', () => {
  it('prefers the hand-set DATABASE_URL', () => {
    expect(
      resolveDatabaseUrl({ DATABASE_URL: 'postgresql://a@h:6543/db', POSTGRES_URL: 'postgresql://b@h/db' }),
    ).toBe('postgresql://a@h:6543/db');
  });

  it("falls back to the integration's POSTGRES_URL and strips its workaround flag", () => {
    expect(
      resolveDatabaseUrl({
        POSTGRES_URL:
          'postgres://postgres.ref:pw@aws-0-ca-central-1.pooler.supabase.com:6543/postgres?workaround=supabase-pooler.vercel',
      }),
    ).toBe('postgres://postgres.ref:pw@aws-0-ca-central-1.pooler.supabase.com:6543/postgres');
  });

  it('keeps other query parameters', () => {
    expect(resolveDatabaseUrl({ POSTGRES_URL: 'postgres://u:p@h/db?sslmode=require&workaround=x' })).toBe(
      'postgres://u:p@h/db?sslmode=require',
    );
  });

  it('treats blank as unset', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: '  ' })).toBeUndefined();
    expect(resolveDatabaseUrl({})).toBeUndefined();
  });

  it('passes an unparseable value through untouched rather than crashing at import', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: 'not a url' })).toBe('not a url');
  });
});

describe('resolveServiceRoleKey', () => {
  it('accepts either generation of the secret key, hand-set first', () => {
    expect(resolveServiceRoleKey({ SUPABASE_SERVICE_ROLE_KEY: 'jwt', SUPABASE_SECRET_KEY: 'sb' })).toBe('jwt');
    expect(resolveServiceRoleKey({ SUPABASE_SECRET_KEY: 'sb_secret_x' })).toBe('sb_secret_x');
    expect(resolveServiceRoleKey({})).toBeUndefined();
  });
});

describe('resolveAppUrl', () => {
  it('uses the explicit URL when set, without a trailing slash', () => {
    expect(resolveAppUrl({ NEXT_PUBLIC_APP_URL: 'https://foreman.example.com/', VERCEL_ENV: 'production' })).toBe(
      'https://foreman.example.com',
    );
  });

  it('uses the production domain in production', () => {
    expect(
      resolveAppUrl({
        VERCEL_ENV: 'production',
        VERCEL_PROJECT_PRODUCTION_URL: 'tactical-foreman.vercel.app',
        VERCEL_URL: 'tactical-foreman-abc123.vercel.app',
      }),
    ).toBe('https://tactical-foreman.vercel.app');
  });

  it('uses the stable branch URL on a preview, never the per-deployment one', () => {
    expect(
      resolveAppUrl({
        VERCEL_ENV: 'preview',
        VERCEL_PROJECT_PRODUCTION_URL: 'tactical-foreman.vercel.app',
        VERCEL_BRANCH_URL: 'tactical-foreman-git-branch-team.vercel.app',
        VERCEL_URL: 'tactical-foreman-abc123.vercel.app',
      }),
    ).toBe('https://tactical-foreman-git-branch-team.vercel.app');
  });

  it('falls back to the deployment URL when the preferred one is absent', () => {
    expect(resolveAppUrl({ VERCEL_ENV: 'preview', VERCEL_URL: 'x-abc.vercel.app' })).toBe('https://x-abc.vercel.app');
    expect(resolveAppUrl({ VERCEL_ENV: 'production', VERCEL_URL: 'x-abc.vercel.app' })).toBe('https://x-abc.vercel.app');
  });

  it('is the dev server anywhere else', () => {
    expect(resolveAppUrl({})).toBe('http://localhost:3000');
    expect(resolveAppUrl({ VERCEL_ENV: 'development', VERCEL_URL: 'x.vercel.app' })).toBe('http://localhost:3000');
  });
});
