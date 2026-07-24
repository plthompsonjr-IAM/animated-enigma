'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { CalendarPlus } from 'lucide-react';
import { scheduleVisit } from '@/lib/site-visits/actions';
import type { FormState } from '@/lib/auth/actions';
import {
  VISIT_TYPES,
  VISIT_TYPE_LABELS,
  DURATION_OPTIONS,
} from '@/lib/site-visits/site-visits-core';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

/** Collapsible "schedule a site visit" form, bound to a lead or a project. */
export function ScheduleVisitForm({
  leadId,
  projectId,
  members,
}: {
  leadId?: string;
  projectId?: string;
  members: Member[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useFormState(scheduleVisit, initial);

  // Close the form once a visit is scheduled successfully.
  if (state.message && open) setOpen(false);

  if (!open) {
    return (
      <div className="space-y-2">
        {state.message ? <FormNotice message={state.message} /> : null}
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          <CalendarPlus className="h-4 w-4" />
          Schedule site visit
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-3 rounded-md border p-3">
      <FormNotice error={state.error} />
      {leadId ? <input type="hidden" name="leadId" value={leadId} /> : null}
      {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Visit type" htmlFor="visitType">
          <Select id="visitType" name="visitType" defaultValue="estimate">
            {VISIT_TYPES.map((t) => (
              <option key={t} value={t}>
                {VISIT_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Assign to" htmlFor="assignedTo">
          <Select id="assignedTo" name="assignedTo" defaultValue="">
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name ?? m.email}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date & time" htmlFor="scheduledAt">
          <Input id="scheduledAt" name="scheduledAt" type="datetime-local" required />
        </Field>
        <Field label="Duration" htmlFor="durationMinutes">
          <Select id="durationMinutes" name="durationMinutes" defaultValue="60">
            {DURATION_OPTIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Notes" htmlFor="notes">
        <Textarea id="notes" name="notes" placeholder="Gate code, what to measure, who to meet…" />
      </Field>

      <div className="flex items-center gap-2">
        <SubmitButton className="w-auto" pendingLabel="Scheduling…">
          Schedule visit
        </SubmitButton>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor} className="mb-1.5 block">
        {label}
      </Label>
      {children}
    </div>
  );
}
