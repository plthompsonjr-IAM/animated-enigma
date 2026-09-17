'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useState, useTransition } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { CATALOG_SORTS, CATALOG_SORT_LABELS, TIERS, TIER_LABELS } from '@/lib/catalog/catalog-core';

/** Search, trade/tier filters, and sort — reflected into the URL query. */
export function CatalogToolbar({ trades }: { trades: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(params.get('q') ?? '');

  const push = useCallback(
    (updates: Record<string, string>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      startTransition(() => router.replace(`${pathname}?${next.toString()}`));
    },
    [params, pathname, router],
  );

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <form
        className="relative flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          push({ q: search });
        }}
      >
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onBlur={() => push({ q: search })}
          placeholder="Search name, trade, vendor…"
          className="pl-9"
          aria-label="Search catalog"
        />
      </form>

      {trades.length > 0 ? (
        <Select
          aria-label="Filter by trade"
          defaultValue={params.get('trade') ?? ''}
          onChange={(e) => push({ trade: e.target.value })}
          className="sm:w-44"
        >
          <option value="">All trades</option>
          {trades.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
      ) : null}

      <Select
        aria-label="Filter by tier"
        defaultValue={params.get('tier') ?? ''}
        onChange={(e) => push({ tier: e.target.value })}
        className="sm:w-36"
      >
        <option value="">All tiers</option>
        {TIERS.map((t) => (
          <option key={t} value={t}>
            {TIER_LABELS[t]}
          </option>
        ))}
      </Select>

      <Select
        aria-label="Sort catalog"
        defaultValue={params.get('sort') ?? 'name'}
        onChange={(e) => push({ sort: e.target.value })}
        className="sm:w-48"
      >
        {CATALOG_SORTS.map((s) => (
          <option key={s} value={s}>
            {CATALOG_SORT_LABELS[s]}
          </option>
        ))}
      </Select>

      {pending ? <span className="sr-only">Updating…</span> : null}
    </div>
  );
}
