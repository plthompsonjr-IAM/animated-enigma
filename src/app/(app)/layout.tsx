import { redirect } from 'next/navigation';
import { Sidebar, type SidebarAccount } from '@/components/layout/sidebar';
import { MobileNav } from '@/components/layout/mobile-nav';
import { Header } from '@/components/layout/header';
import { getAuthContext } from '@/lib/auth/session';

/**
 * Authenticated application shell: desktop sidebar + top header + mobile bottom
 * nav. Middleware already blocks unauthenticated access to these routes; this
 * layout additionally requires an organization (redirecting new users to
 * onboarding) and passes account context to the chrome. Without Supabase env
 * the app runs in unauthenticated preview mode.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAuthContext();

  if (ctx.configured && !ctx.userId) redirect('/login');
  if (ctx.configured && ctx.dbAvailable && ctx.userId && !ctx.activeOrg) redirect('/onboarding');

  const account: SidebarAccount = {
    email: ctx.email,
    activeOrgId: ctx.activeOrg?.organizationId ?? null,
    activeOrgName: ctx.activeOrg?.organizationName ?? null,
    organizations: ctx.memberships.map((m) => ({
      id: m.organizationId,
      name: m.organizationName,
    })),
  };

  return (
    <div className="flex min-h-dvh">
      <Sidebar account={account} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="flex-1 px-4 pb-24 pt-6 md:px-8 md:pb-8">{children}</main>
      </div>
      <MobileNav />
    </div>
  );
}
