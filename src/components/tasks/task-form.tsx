'use client';

import { useFormState } from 'react-dom';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { createTask } from '@/lib/tasks/actions';
import {
  PRIORITIES,
  PRIORITY_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
} from '@/lib/tasks/tasks-core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { SubmitButton, FormNotice } from '@/components/forms/form-bits';

const initial = {} as { error?: string; message?: string };

export interface TaskFormMember {
  userId: string;
  name: string | null;
  email: string;
}

/**
 * Add a task. Collapsed behind a button so the list stays the focus on a phone.
 * Only the title is required — "fix the sticking door" is a legitimate task with
 * no dates, no estimate, and nobody assigned yet.
 */
export function TaskForm({
  projectId,
  members,
  phases,
  punchList = false,
}: {
  projectId: string;
  members: TaskFormMember[];
  /** Schedule phases on this project, offered as the task's parent. */
  phases: { id: string; name: string }[];
  /** Pre-ticks the punch-list flag when adding from the punch-list section. */
  punchList?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useFormState(createTask, initial);

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-auto"
        onClick={() => setOpen(true)}
      >
        <Plus className="h-4 w-4" />
        {punchList ? 'Add punch-list item' : 'Add task'}
      </Button>
    );
  }

  const suffix = punchList ? 'punch' : 'task';

  return (
    <form action={formAction} className="space-y-4 rounded-md border p-3">
      <input type="hidden" name="projectId" value={projectId} />

      <div>
        <Label htmlFor={`title-${suffix}`} className="mb-1.5 block">
          Task
        </Label>
        <Input
          id={`title-${suffix}`}
          name="title"
          placeholder="Set the vanity and connect the drain"
          required
          maxLength={200}
        />
      </div>

      <div>
        <Label htmlFor={`description-${suffix}`} className="mb-1.5 block">
          Details
        </Label>
        <Textarea
          id={`description-${suffix}`}
          name="description"
          rows={2}
          placeholder="Optional — anything the person doing it needs to know."
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`assigneeId-${suffix}`} className="mb-1.5 block">
            Assign to
          </Label>
          <Select id={`assigneeId-${suffix}`} name="assigneeId" defaultValue="">
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name ?? m.email}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor={`priority-${suffix}`} className="mb-1.5 block">
            Priority
          </Label>
          <Select id={`priority-${suffix}`} name="priority" defaultValue="medium">
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor={`startDate-${suffix}`} className="mb-1.5 block">
            Start
          </Label>
          <Input id={`startDate-${suffix}`} name="startDate" type="date" />
        </div>
        <div>
          <Label htmlFor={`dueDate-${suffix}`} className="mb-1.5 block">
            Due
          </Label>
          <Input id={`dueDate-${suffix}`} name="dueDate" type="date" />
        </div>
        <div>
          <Label htmlFor={`estimatedHours-${suffix}`} className="mb-1.5 block">
            Estimated hours
          </Label>
          <Input
            id={`estimatedHours-${suffix}`}
            name="estimatedHours"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.25"
            placeholder="0"
          />
        </div>
        <div>
          <Label htmlFor={`status-${suffix}`} className="mb-1.5 block">
            Status
          </Label>
          <Select id={`status-${suffix}`} name="status" defaultValue="not_started">
            {TASK_STATUSES.filter((s) => s !== 'blocked').map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {phases.length > 0 ? (
        <div>
          <Label htmlFor={`scheduleItemId-${suffix}`} className="mb-1.5 block">
            Schedule phase
          </Label>
          <Select id={`scheduleItemId-${suffix}`} name="scheduleItemId" defaultValue="">
            <option value="">Not tied to a phase</option>
            {phases.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      <div>
        <Label htmlFor={`checklist-${suffix}`} className="mb-1.5 block">
          Checklist
        </Label>
        <Textarea
          id={`checklist-${suffix}`}
          name="checklist"
          rows={3}
          placeholder={'One step per line:\nShut off the water\nSet the vanity\nConnect the drain'}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Optional. Paste a list — bullets and numbering are stripped, and duplicates dropped.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isPunchList"
          defaultChecked={punchList}
          className="h-4 w-4 rounded border-input"
        />
        Punch-list item
      </label>

      <FormNotice error={state.error} message={state.message} />

      <div className="flex flex-wrap gap-2">
        <SubmitButton className="sm:w-auto sm:px-6" pendingLabel="Saving…">
          Add task
        </SubmitButton>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-auto"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
