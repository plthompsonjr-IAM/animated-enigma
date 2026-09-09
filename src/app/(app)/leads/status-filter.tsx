'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { LEAD_STATUSES, LEAD_STATUS_LABELS } from '@/lib/leads/leads-core';

/** Horizontal, scrollable status chips with counts. Links preserve other query params. */
export function StatusFilter({ counts }: { counts: Record<string, number> }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const active = params.get('status') ?? 'all';

  const chips: { key: string; label: string; count?: number }[] = [
    { key: 'all', label: 'All' },
    { key: 'open', label: 'Open' },
    ...LEAD_STATUSES.map((s) => ({
      key: s,
      label: LEAD_STATUS_LABELS[s],
      count: counts[s] ?? 0,
    })),
  ];

  function hrefFor(key: string) {
    const next = new URLSearchParams(params.toString());
    if (key === 'all') next.delete('status');
    else next.set('status', key);
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  return (
    <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
      {chips.map((chip) => {
        const isActive = active === chip.key;
        return (
          <Link
            key={chip.key}
            href={hrefFor(chip.key)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold',
              isActive
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-secondary text-secondary-foreground hover:bg-accent',
            )}
          >
            {chip.label}
            {chip.count !== undefined && chip.count > 0 ? (
              <span
                className={cn(
                  'rounded-full px-1.5 text-[10px]',
                  isActive ? 'bg-primary-foreground/20' : 'bg-background',
                )}
              >
                {chip.count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}
