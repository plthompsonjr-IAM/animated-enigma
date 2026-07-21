'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { navItems } from './nav-config';
import { cn } from '@/lib/utils';
import { signOut } from '@/lib/auth/actions';
import { switchOrganization } from '@/lib/auth/org-actions';

export interface SidebarOrgOption {
  id: string;
  name: string;
}

export interface SidebarAccount {
  email: string | null;
  activeOrgId: string | null;
  activeOrgName: string | null;
  organizations: SidebarOrgOption[];
}

/** Desktop sidebar navigation (hidden on mobile). */
export function Sidebar({ account }: { account?: SidebarAccount }) {
  const pathname = usePathname();

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r bg-card md:flex">
      <div className="flex h-16 items-center gap-2 border-b px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded bg-primary text-sm font-black text-primary-foreground">
          PT
        </div>
        <div className="leading-tight">
          <div className="text-sm font-bold">Tactical Foreman</div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">
            Your Home, Our Mission.
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {navItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-3 border-t p-4">
        {account?.activeOrgName ? (
          account.organizations.length > 1 ? (
            <form action={switchOrganization}>
              <label
                htmlFor="org-switcher"
                className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Organization
              </label>
              <select
                id="org-switcher"
                name="organizationId"
                defaultValue={account.activeOrgId ?? undefined}
                // Submit on change so switching is one tap.
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              >
                {account.organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </form>
          ) : (
            <div className="text-sm font-medium">{account.activeOrgName}</div>
          )
        ) : null}

        {account?.email ? (
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs text-muted-foreground">{account.email}</span>
            <form action={signOut}>
              <button
                type="submit"
                aria-label="Sign out"
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </form>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">Preview mode — auth not configured</div>
        )}
      </div>
    </aside>
  );
}
