'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';
import { Select } from '@/components/ui/select';

interface Member {
  id: string;
  name: string | null;
  email: string;
}

interface ProjectOption {
  id: string;
  name: string;
  number: string | null;
}

/**
 * Filters for the schedule, reflected into the URL query so a filtered view can
 * be bookmarked or shared. Native selects: reliable on a phone, and they work
 * before the JS lands.
 */
export function ScheduleToolbar({
  members,
  projects = [],
  view = 'work',
}: {
  members: Member[];
  projects?: ProjectOption[];
  view?: string;
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
        aria-label="View"
        value={view}
        onChange={(e) => push({ view: e.target.value === 'work' ? '' : e.target.value })}
        className="w-auto"
      >
        <option value="work">Work schedule</option>
        <option value="visits">Site visits</option>
      </Select>

      <Select
        aria-label="Filter by assignee"
        defaultValue={params.get('assignee') ?? ''}
        onChange={(e) => push({ assignee: e.target.value })}
        className="w-auto sm:w-56"
      >
        <option value="">Everyone</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name ?? m.email}
          </option>
        ))}
      </Select>

      {view === 'work' && projects.length > 0 ? (
        <Select
          aria-label="Filter by project"
          defaultValue={params.get('project') ?? ''}
          onChange={(e) => push({ project: e.target.value })}
          className="w-auto sm:w-56"
        >
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.number ? `${p.number} · ${p.name}` : p.name}
            </option>
          ))}
        </Select>
      ) : null}

      {pending ? <span className="sr-only">Updating…</span> : null}
    </div>
  );
}
