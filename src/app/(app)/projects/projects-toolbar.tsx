'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useState, useTransition } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { PROJECT_SORTS, PROJECT_SORT_LABELS } from '@/lib/projects/projects-core';

interface Member {
  id: string;
  name: string | null;
  email: string;
}

/** Search box, assignee filter, and sort — reflected into the URL query. */
export function ProjectsToolbar({ members }: { members: Member[] }) {
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
          placeholder="Search name, number, client…"
          className="pl-9"
          aria-label="Search projects"
        />
      </form>

      <Select
        aria-label="Filter by team member"
        defaultValue={params.get('assignee') ?? ''}
        onChange={(e) => push({ assignee: e.target.value })}
        className="sm:w-48"
      >
        <option value="">Anyone assigned</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name ?? m.email}
          </option>
        ))}
      </Select>

      <Select
        aria-label="Sort projects"
        defaultValue={params.get('sort') ?? 'recent'}
        onChange={(e) => push({ sort: e.target.value })}
        className="sm:w-48"
      >
        {PROJECT_SORTS.map((s) => (
          <option key={s} value={s}>
            {PROJECT_SORT_LABELS[s]}
          </option>
        ))}
      </Select>

      {pending ? <span className="sr-only">Updating…</span> : null}
    </div>
  );
}
