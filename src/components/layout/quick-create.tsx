'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Plus,
  Phone,
  Users,
  Contact,
  Hammer,
  Calculator,
  ListChecks,
  ClipboardList,
  Upload,
  Bot,
  type LucideIcon,
} from 'lucide-react';
import { QUICK_CREATE_ITEMS } from '@/lib/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const ICONS: Record<string, LucideIcon> = {
  Phone,
  Users,
  Contact,
  Hammer,
  Calculator,
  ListChecks,
  ClipboardList,
  Upload,
  Bot,
};

/** Desktop: dropdown from the header button. */
export function QuickCreateButton() {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative hidden md:block">
      <Button size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Plus className="h-4 w-4" />
        Quick create
      </Button>
      {open ? (
        <div className="absolute right-0 top-full z-40 mt-2 w-56 rounded-md border bg-card p-1.5 shadow-lg">
          {QUICK_CREATE_ITEMS.map((item) => {
            const Icon = ICONS[item.icon] ?? Plus;
            return (
              <Link
                key={item.label}
                href={item.href}
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 rounded px-2.5 py-2 text-sm hover:bg-accent"
              >
                <Icon className="h-4 w-4 text-primary" />
                {item.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** Mobile: center FAB in the bottom nav opening a thumb-reachable sheet. */
export function QuickCreateFab() {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <button
        type="button"
        aria-label="Quick create"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="-mt-5 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus className={cn('h-6 w-6 transition-transform', open && 'rotate-45')} />
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-40 md:hidden"
          role="dialog"
          aria-label="Quick create"
          onClick={() => setOpen(false)}
        >
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-xl border-t bg-card p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Quick create
            </p>
            <div className="grid grid-cols-4 gap-2">
              {QUICK_CREATE_ITEMS.map((item) => {
                const Icon = ICONS[item.icon] ?? Plus;
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="flex min-h-[4.5rem] flex-col items-center justify-center gap-1.5 rounded-md border bg-secondary/50 px-1 py-2 text-center"
                  >
                    <Icon className="h-5 w-5 text-primary" />
                    <span className="text-[10px] font-semibold leading-tight">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
