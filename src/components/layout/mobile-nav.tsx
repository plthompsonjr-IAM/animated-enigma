'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Plus } from 'lucide-react';
import { mobileNavItems } from './nav-config';
import { cn } from '@/lib/utils';

/**
 * Mobile bottom navigation with a center quick-create button.
 * Optimized for one-handed jobsite use (thumb-zone targets, ≥44px).
 */
export function MobileNav() {
  const pathname = usePathname();
  const left = mobileNavItems.slice(0, 2);
  const right = mobileNavItems.slice(2);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 backdrop-blur md:hidden">
      <div className="mx-auto flex max-w-lg items-center justify-around px-2 pb-[env(safe-area-inset-bottom)] pt-1.5">
        {left.map((item) => (
          <MobileLink key={item.href} href={item.href} pathname={pathname} label={item.label}>
            <item.icon className="h-5 w-5" />
          </MobileLink>
        ))}

        <button
          type="button"
          aria-label="Quick create"
          className="-mt-5 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="h-6 w-6" />
        </button>

        {right.map((item) => (
          <MobileLink key={item.href} href={item.href} pathname={pathname} label={item.label}>
            <item.icon className="h-5 w-5" />
          </MobileLink>
        ))}
      </div>
    </nav>
  );
}

function MobileLink({
  href,
  pathname,
  label,
  children,
}: {
  href: string;
  pathname: string;
  label: string;
  children: React.ReactNode;
}) {
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={cn(
        'flex min-w-[3.5rem] flex-col items-center gap-0.5 px-2 py-1',
        active ? 'text-primary' : 'text-muted-foreground',
      )}
    >
      {children}
      <span className="text-[9px] font-semibold uppercase tracking-wide">{label}</span>
    </Link>
  );
}
