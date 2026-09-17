'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useState, useTransition } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  CLIENT_SORTS,
  CLIENT_SORT_LABELS,
  CLIENT_TYPES,
  CLIENT_TYPE_LABELS,
} from '@/lib/clients/clients-core';

/** Search box, type/tag filters, and sort — reflected into the URL query. */
export function ClientsToolbar({ tags }: { tags: string[] }) {
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
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
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
          placeholder="Search name, company, phone, email…"
          className="pl-9"
          aria-label="Search clients"
        />
      </form>

      <Select
        aria-label="Filter by client type"
        defaultValue={params.get('type') ?? ''}
        onChange={(e) => push({ type: e.target.value })}
        className="sm:w-40"
      >
        <option value="">All types</option>
        {CLIENT_TYPES.map((t) => (
          <option key={t} value={t}>
            {CLIENT_TYPE_LABELS[t]}
          </option>
        ))}
      </Select>

      {tags.length > 0 ? (
        <Select
          aria-label="Filter by tag"
          defaultValue={params.get('tag') ?? ''}
          onChange={(e) => push({ tag: e.target.value })}
          className="sm:w-40"
        >
          <option value="">All tags</option>
          {tags.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </Select>
      ) : null}

      <Select
        aria-label="Sort clients"
        defaultValue={params.get('sort') ?? 'name'}
        onChange={(e) => push({ sort: e.target.value })}
        className="sm:w-40"
      >
        {CLIENT_SORTS.map((s) => (
          <option key={s} value={s}>
            {CLIENT_SORT_LABELS[s]}
          </option>
        ))}
      </Select>

      {pending ? <span className="sr-only">Updating…</span> : null}
    </div>
  );
}
