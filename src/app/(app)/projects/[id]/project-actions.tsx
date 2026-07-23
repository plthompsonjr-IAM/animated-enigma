'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { Plus } from 'lucide-react';
import {
  changeProjectStatus,
  addTeamMember,
  removeTeamMember,
  addProjectNote,
  archiveProject,
  restoreProject,
} from '@/lib/projects/actions';
import type { FormState } from '@/lib/auth/actions';
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_STYLES,
  nextStatus,
  type ProjectStatus,
} from '@/lib/projects/projects-core';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { SubmitButton, FormNotice } from '@/components/forms/form-bits';
import { cn } from '@/lib/utils';

interface Member {
  id: string;
  name: string | null;
  email: string;
}

/** Inline status dropdown — submits on change. */
export function StatusChanger({ projectId, status }: { projectId: string; status: ProjectStatus }) {
  return (
    <form action={changeProjectStatus}>
      <input type="hidden" name="projectId" value={projectId} />
      <Select
        name="status"
        defaultValue={status}
        aria-label="Change status"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        {PROJECT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {PROJECT_STATUS_LABELS[s]}
          </option>
        ))}
      </Select>
    </form>
  );
}

/** One-tap "advance to next stage" button, shown when there is a next stage. */
export function AdvanceButton({ projectId, status }: { projectId: string; status: ProjectStatus }) {
  const next = nextStatus(status);
  if (!next) return null;
  return (
    <form action={changeProjectStatus}>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="status" value={next} />
      <Button
        type="submit"
        size="sm"
        className={cn('w-full', PROJECT_STATUS_STYLES[next])}
        variant="outline"
      >
        Advance to {PROJECT_STATUS_LABELS[next]}
      </Button>
    </form>
  );
}

export function AddTeamMember({
  projectId,
  candidates,
}: {
  projectId: string;
  candidates: Member[];
}) {
  const [open, setOpen] = useState(false);
  if (candidates.length === 0) {
    return <p className="text-xs text-muted-foreground">Everyone’s already on this project.</p>;
  }
  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Add team member
      </Button>
    );
  }
  return (
    <form action={addTeamMember} className="flex items-center gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <Select name="userId" aria-label="Team member" defaultValue="" className="flex-1">
        <option value="">Select…</option>
        {candidates.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name ?? m.email}
          </option>
        ))}
      </Select>
      <Button type="submit" size="sm">
        Add
      </Button>
    </form>
  );
}

export function RemoveTeamMemberButton({
  projectId,
  memberId,
}: {
  projectId: string;
  memberId: string;
}) {
  return (
    <form action={removeTeamMember}>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="memberId" value={memberId} />
      <Button type="submit" variant="ghost" size="sm" className="h-7 px-2 text-xs">
        Remove
      </Button>
    </form>
  );
}

const noteInitial: FormState = {};

export function AddNoteForm({ projectId }: { projectId: string }) {
  const [state, formAction] = useFormState(addProjectNote, noteInitial);
  return (
    <form action={formAction} className="space-y-2">
      <FormNotice error={state.error} message={state.message} />
      <input type="hidden" name="projectId" value={projectId} />
      <Textarea
        name="summary"
        placeholder="Log an update, decision, or note…"
        required
        className="min-h-[44px]"
      />
      <SubmitButton className="w-auto" pendingLabel="Adding…">
        Add to timeline
      </SubmitButton>
    </form>
  );
}

export function ArchiveProjectButton({
  projectId,
  archived,
}: {
  projectId: string;
  archived: boolean;
}) {
  return (
    <form action={archived ? restoreProject : archiveProject}>
      <input type="hidden" name="projectId" value={projectId} />
      <Button type="submit" variant={archived ? 'outline' : 'ghost'} size="sm">
        {archived ? 'Restore project' : 'Archive project'}
      </Button>
    </form>
  );
}
