'use client';

import * as React from 'react';
import { Search, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QuickCreateButton } from './quick-create';

export interface HeaderAccount {
  orgName: string | null;
  email: string | null;
}

function initialsOf(email: string | null): string {
  if (!email) return '?';
  const name = email.split('@')[0] ?? '';
  const parts = name.split(/[._-]+/).filter(Boolean);
  const chars =
    parts.length >= 2 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : name.slice(0, 2);
  return chars.toUpperCase() || '?';
}

/** Notification bell with an (empty for now) dropdown — wiring lands in Task 37. */
function NotificationBell() {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Notifications"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell className="h-5 w-5" />
      </Button>
      {open ? (
        <div className="absolute right-0 top-full z-40 mt-2 w-72 rounded-md border bg-card p-4 shadow-lg">
          <p className="text-sm font-medium">Notifications</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Nothing yet. Lead follow-ups, task assignments, and payment alerts will show up here.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** Top header: org name, global search placeholder, notifications, quick-create, user. */
export function Header({ account }: { account?: HeaderAccount }) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur md:px-6">
      <div className="flex min-w-0 items-center gap-2 md:hidden">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-primary text-xs font-black text-primary-foreground">
          PT
        </div>
        <span className="truncate text-sm font-bold">{account?.orgName ?? 'Tactical Foreman'}</span>
      </div>

      <div className="hidden min-w-0 items-center gap-3 md:flex md:flex-1">
        {account?.orgName ? (
          <span className="hidden shrink-0 text-sm font-semibold lg:inline">{account.orgName}</span>
        ) : null}
        <button
          type="button"
          className="flex h-9 w-full max-w-md items-center gap-2 rounded-md border bg-secondary/50 px-3 text-sm text-muted-foreground"
        >
          <Search className="h-4 w-4" />
          Search leads, clients, projects…
        </button>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <Button variant="ghost" size="icon" aria-label="Search" className="md:hidden">
          <Search className="h-5 w-5" />
        </Button>
        <NotificationBell />
        <QuickCreateButton />
        {account?.email ? (
          <div
            title={account.email}
            className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold"
          >
            {initialsOf(account.email)}
          </div>
        ) : null}
      </div>
    </header>
  );
}
