'use client';

import { Search, Bell, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Top header: org name, global search placeholder, notifications, quick-create. */
export function Header() {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur md:px-6">
      <div className="flex items-center gap-2 md:hidden">
        <div className="flex h-7 w-7 items-center justify-center rounded bg-primary text-xs font-black text-primary-foreground">
          PT
        </div>
        <span className="text-sm font-bold">Tactical Foreman</span>
      </div>

      <button
        type="button"
        className="hidden h-9 flex-1 items-center gap-2 rounded-md border bg-secondary/50 px-3 text-sm text-muted-foreground md:flex md:max-w-md"
      >
        <Search className="h-4 w-4" />
        Search leads, clients, projects…
      </button>

      <div className="ml-auto flex items-center gap-1.5">
        <Button variant="ghost" size="icon" aria-label="Search" className="md:hidden">
          <Search className="h-5 w-5" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Notifications">
          <Bell className="h-5 w-5" />
        </Button>
        <Button size="sm" className="hidden md:inline-flex">
          <Plus className="h-4 w-4" />
          Quick create
        </Button>
      </div>
    </header>
  );
}
