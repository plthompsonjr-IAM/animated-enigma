'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';
import { Select } from '@/components/ui/select';

interface Member {
  id: string;
  name: string | null;
  email: string;
}

/** Assignee filter for the schedule, reflected into the URL query. */
export function ScheduleToolbar({ members }: { members: Member[] }) {
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
    <div className="flex items-center gap-2">
      <Select
        aria-label="Filter by assignee"
        defaultValue={params.get('assignee') ?? ''}
        onChange={(e) => push({ assignee: e.target.value })}
        className="sm:w-56"
      >
        <option value="">Everyone</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name ?? m.email}
          </option>
        ))}
      </Select>
      {pending ? <span className="sr-only">Updating…</span> : null}
    </div>
  );
}
