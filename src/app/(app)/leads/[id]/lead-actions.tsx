'use client';

import { useFormState } from 'react-dom';
import {
  changeLeadStatus,
  assignLead,
  setFollowUp,
  addLeadActivity,
  convertLead,
  archiveLead,
  restoreLead,
} from '@/lib/leads/actions';
import type { FormState } from '@/lib/auth/actions';
import { LEAD_STATUSES, LEAD_STATUS_LABELS, type LeadStatus } from '@/lib/leads/leads-core';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { SubmitButton, FormNotice } from '@/components/forms/form-bits';

interface Member {
  id: string;
  name: string | null;
  email: string;
}

/** Inline status changer — submits on change. Disabled once converted. */
export function StatusChanger({
  leadId,
  status,
  converted,
}: {
  leadId: string;
  status: LeadStatus;
  converted: boolean;
}) {
  return (
    <form action={changeLeadStatus}>
      <input type="hidden" name="leadId" value={leadId} />
      <Select
        name="status"
        defaultValue={status}
        disabled={converted}
        aria-label="Change status"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        {LEAD_STATUSES.map((s) => (
          <option key={s} value={s}>
            {LEAD_STATUS_LABELS[s]}
          </option>
        ))}
      </Select>
    </form>
  );
}

export function AssignPicker({
  leadId,
  assignedTo,
  members,
}: {
  leadId: string;
  assignedTo: string | null;
  members: Member[];
}) {
  return (
    <form action={assignLead}>
      <input type="hidden" name="leadId" value={leadId} />
      <Select
        name="assignedTo"
        defaultValue={assignedTo ?? ''}
        aria-label="Assign salesperson"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
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

export function FollowUpPicker({
  leadId,
  nextFollowUpDate,
}: {
  leadId: string;
  nextFollowUpDate: string | null;
}) {
  return (
    <form action={setFollowUp} className="flex items-center gap-2">
      <input type="hidden" name="leadId" value={leadId} />
      <Input
        type="date"
        name="nextFollowUpDate"
        defaultValue={nextFollowUpDate ?? ''}
        aria-label="Next follow-up date"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="w-auto"
      />
    </form>
  );
}

const noteInitial: FormState = {};

export function AddNoteForm({ leadId }: { leadId: string }) {
  const [state, formAction] = useFormState(addLeadActivity, noteInitial);
  return (
    <form action={formAction} className="space-y-2">
      <FormNotice error={state.error} message={state.message} />
      <input type="hidden" name="leadId" value={leadId} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <Select
          name="activityType"
          defaultValue="note"
          aria-label="Activity type"
          className="sm:w-36"
        >
          <option value="note">Note</option>
          <option value="call">Call</option>
          <option value="email">Email</option>
          <option value="meeting">Meeting</option>
        </Select>
        <Textarea
          name="summary"
          placeholder="Log a call, email, or note…"
          required
          className="min-h-[44px] flex-1"
        />
      </div>
      <SubmitButton className="w-auto" pendingLabel="Adding…">
        Add to timeline
      </SubmitButton>
    </form>
  );
}

export function ConvertButton({ leadId, converted }: { leadId: string; converted: boolean }) {
  if (converted) {
    return (
      <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
        Converted to a project.
      </p>
    );
  }
  return (
    <form action={convertLead}>
      <input type="hidden" name="leadId" value={leadId} />
      <SubmitButton className="w-full" pendingLabel="Converting…">
        Convert to client &amp; project
      </SubmitButton>
    </form>
  );
}

export function ArchiveButton({ leadId, archived }: { leadId: string; archived: boolean }) {
  return (
    <form action={archived ? restoreLead : archiveLead}>
      <input type="hidden" name="leadId" value={leadId} />
      <Button type="submit" variant={archived ? 'outline' : 'ghost'} size="sm">
        {archived ? 'Restore lead' : 'Archive lead'}
      </Button>
    </form>
  );
}
