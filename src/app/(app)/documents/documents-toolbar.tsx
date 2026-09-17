'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';
import { Select } from '@/components/ui/select';

/** Project, kind, and "shared only" filters, reflected into the URL. */
export function DocumentsToolbar({
  projects,
  view,
  shared,
}: {
  projects: { id: string; name: string; number: string | null }[];
  view: string;
  shared: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

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
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label="What to show"
        value={view}
        onChange={(e) => push({ view: e.target.value === 'all' ? '' : e.target.value })}
        className="w-auto"
      >
        <option value="all">Everything</option>
        <option value="photos">Photos only</option>
        <option value="documents">Documents only</option>
      </Select>

      <Select
        aria-label="Filter by project"
        defaultValue={params.get('project') ?? ''}
        onChange={(e) => push({ project: e.target.value })}
        className="w-auto sm:w-64"
      >
        <option value="">All projects</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.number ? `${p.number} · ${p.name}` : p.name}
          </option>
        ))}
      </Select>

      <label className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
        <input
          type="checkbox"
          checked={shared}
          onChange={(e) => push({ shared: e.target.checked ? '1' : '' })}
          className="h-4 w-4 rounded border-input"
        />
        Only what the client can see
      </label>

      {pending ? <span className="sr-only">Updating…</span> : null}
    </div>
  );
}
