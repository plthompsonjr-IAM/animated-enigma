'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import {
  completeVisit,
  cancelVisit,
  reopenVisit,
  rescheduleVisit,
  assignVisit,
} from '@/lib/site-visits/actions';
import type { FormState } from '@/lib/auth/actions';
import { DURATION_OPTIONS } from '@/lib/site-visits/site-visits-core';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { SubmitButton, FormNotice } from '@/components/forms/form-bits';

interface Member {
  id: string;
  name: string | null;
  email: string;
}

const initial: FormState = {};

/** The action row for one visit: complete, reschedule, reassign, cancel/reopen. */
export function VisitActions({
  visitId,
  status,
  assignedTo,
  durationMinutes,
  members,
}: {
  visitId: string;
  status: 'scheduled' | 'completed' | 'cancelled';
  assignedTo: string | null;
  durationMinutes: number;
  members: Member[];
}) {
  const [panel, setPanel] = useState<'none' | 'complete' | 'reschedule'>('none');
  const [completeState, completeAction] = useFormState(completeVisit, initial);

  if (completeState.message && panel === 'complete') setPanel('none');

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {status === 'scheduled' ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={() => setPanel(panel === 'complete' ? 'none' : 'complete')}
            >
              Complete
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => setPanel(panel === 'reschedule' ? 'none' : 'reschedule')}
            >
              Reschedule
            </Button>
            <form action={cancelVisit}>
              <input type="hidden" name="visitId" value={visitId} />
              <Button type="submit" size="sm" variant="ghost" className="h-7 px-2 text-xs">
                Cancel
              </Button>
            </form>
            <AssignInline visitId={visitId} assignedTo={assignedTo} members={members} />
          </>
        ) : (
          <form action={reopenVisit}>
            <input type="hidden" name="visitId" value={visitId} />
            <Button type="submit" size="sm" variant="ghost" className="h-7 px-2 text-xs">
              Reopen
            </Button>
          </form>
        )}
      </div>

      {panel === 'complete' ? (
        <form action={completeAction} className="space-y-2 rounded-md border p-2.5">
          <FormNotice error={completeState.error} />
          <input type="hidden" name="visitId" value={visitId} />
          <Textarea name="notes" placeholder="Visit notes / outcome…" className="min-h-[44px]" />
          <Textarea
            name="measurements"
            placeholder="Measurements (rooms, dimensions, counts)…"
            className="min-h-[44px]"
          />
          <SubmitButton className="w-auto" pendingLabel="Saving…">
            Mark complete
          </SubmitButton>
        </form>
      ) : null}

      {panel === 'reschedule' ? (
        <form
          action={rescheduleVisit}
          className="flex flex-wrap items-end gap-2 rounded-md border p-2.5"
        >
          <input type="hidden" name="visitId" value={visitId} />
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">New date & time</label>
            <Input name="scheduledAt" type="datetime-local" required className="w-auto" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Duration</label>
            <Select
              name="durationMinutes"
              defaultValue={String(durationMinutes)}
              className="w-auto"
            >
              {DURATION_OPTIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" size="sm">
            Save
          </Button>
        </form>
      ) : null}
    </div>
  );
}

/** Inline assignee dropdown that submits on change. */
function AssignInline({
  visitId,
  assignedTo,
  members,
}: {
  visitId: string;
  assignedTo: string | null;
  members: Member[];
}) {
  return (
    <form action={assignVisit}>
      <input type="hidden" name="visitId" value={visitId} />
      <Select
        name="assignedTo"
        defaultValue={assignedTo ?? ''}
        aria-label="Assign visit"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="h-7 w-auto py-0 text-xs"
      >
        <option value="">Unassigned</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name ?? m.email}
          </option>
        ))}
      </Select>
    </form>
  );
}
