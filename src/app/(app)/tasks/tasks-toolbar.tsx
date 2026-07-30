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

/** Filters for the task list, reflected into the URL so a view can be shared. */
export function TasksToolbar({
  members,
  projects,
  scope,
  mine,
}: {
  members: Member[];
  projects: ProjectOption[];
  scope: string;
  /** The signed-in user, offered as a one-click "just mine" filter. */
  mine?: string | null;
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

  const assignee = params.get('assignee') ?? '';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label="Which tasks"
        value={scope}
        onChange={(e) => push({ scope: e.target.value === 'open' ? '' : e.target.value })}
        className="w-auto"
      >
        <option value="open">Open</option>
        <option value="all">Everything</option>
        <option value="punch_list">Punch lists</option>
      </Select>

      <Select
        aria-label="Filter by assignee"
        value={assignee}
        onChange={(e) => push({ assignee: e.target.value })}
        className="w-auto sm:w-56"
      >
        <option value="">Everyone</option>
        {mine ? <option value={mine}>Just mine</option> : null}
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name ?? m.email}
          </option>
        ))}
      </Select>

      {projects.length > 0 ? (
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
