'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { navItems } from './nav-config';
import { cn } from '@/lib/utils';

/** Desktop sidebar navigation (hidden on mobile). */
export function Sidebar() {
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

      <div className="border-t p-4 text-xs text-muted-foreground">
        <div className="font-medium text-foreground">PT&apos;s Tactical Renovations</div>
        <div>Signed in — foundation build</div>
      </div>
    </aside>
  );
}
