'use client';

import { useFormState } from 'react-dom';
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { createScheduleItem, deleteScheduleItem, updateScheduleItem } from '@/lib/schedule/actions';
import {
  SCHEDULE_ITEM_STATUSES,
  SCHEDULE_ITEM_STATUS_LABELS,
  SCHEDULE_PHASES,
} from '@/lib/schedule/schedule-core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { SubmitButton, FormNotice } from '@/components/forms/form-bits';

const initial = {} as { error?: string; message?: string };

export interface ScheduleFormCrew {
  userId: string;
  name: string | null;
  email: string;
}

export interface ScheduleFormItem {
  id: string;
  name: string;
  phase: string | null;
  startDate: string;
  endDate: string;
  status: string;
  percentComplete: number;
  dependsOnId: string | null;
  notes: string | null;
  crew: { userId: string }[];
}

/**
 * Add/edit a work item. One form serves both: with `item` it updates in place,
 * without it it appends to the project. Collapsed behind a button when adding so
 * the schedule list stays the focus on a phone.
 */
export function ScheduleItemForm({
  projectId,
  crew,
  siblings,
  item,
  defaultStart,
}: {
  projectId: string;
  crew: ScheduleFormCrew[];
  /** Other items on this project, offered as the predecessor. */
  siblings: { id: string; name: string }[];
  item?: ScheduleFormItem;
  /** Pre-fills the dates when adding — usually the day after the last item ends. */
  defaultStart?: string;
}) {
  const editing = Boolean(item);
  const [open, setOpen] = useState(editing);
  const [state, formAction] = useFormState(
    editing ? updateScheduleItem : createScheduleItem,
    initial,
  );

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
        Add work item
      </Button>
    );
  }

  const assigned = new Set(item?.crew.map((c) => c.userId) ?? []);

  return (
    <div className="space-y-3 rounded-md border p-3">
    <form action={formAction} className="space-y-4">
      {editing ? (
        <input type="hidden" name="itemId" value={item!.id} />
      ) : (
        <input type="hidden" name="projectId" value={projectId} />
      )}

      <div>
        <Label htmlFor={`name-${item?.id ?? 'new'}`} className="mb-1.5 block">
          Work item
        </Label>
        <Input
          id={`name-${item?.id ?? 'new'}`}
          name="name"
          defaultValue={item?.name ?? ''}
          placeholder="Rough-in plumbing"
          required
          maxLength={200}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`startDate-${item?.id ?? 'new'}`} className="mb-1.5 block">
            Start
          </Label>
          <Input
            id={`startDate-${item?.id ?? 'new'}`}
            name="startDate"
            type="date"
            defaultValue={item?.startDate ?? defaultStart ?? ''}
            required
          />
        </div>
        <div>
          <Label htmlFor={`endDate-${item?.id ?? 'new'}`} className="mb-1.5 block">
            End
          </Label>
          <Input
            id={`endDate-${item?.id ?? 'new'}`}
            name="endDate"
            type="date"
            defaultValue={item?.endDate ?? defaultStart ?? ''}
            required
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`phase-${item?.id ?? 'new'}`} className="mb-1.5 block">
            Phase
          </Label>
          <Select id={`phase-${item?.id ?? 'new'}`} name="phase" defaultValue={item?.phase ?? ''}>
            <option value="">—</option>
            {SCHEDULE_PHASES.map((phase) => (
              <option key={phase} value={phase}>
                {phase}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor={`status-${item?.id ?? 'new'}`} className="mb-1.5 block">
            Status
          </Label>
          <Select
            id={`status-${item?.id ?? 'new'}`}
            name="status"
            defaultValue={item?.status ?? 'not_started'}
          >
            {SCHEDULE_ITEM_STATUSES.map((status) => (
              <option key={status} value={status}>
                {SCHEDULE_ITEM_STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`percentComplete-${item?.id ?? 'new'}`} className="mb-1.5 block">
            Percent complete
          </Label>
          <Input
            id={`percentComplete-${item?.id ?? 'new'}`}
            name="percentComplete"
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            step={1}
            defaultValue={item?.percentComplete ?? 0}
          />
        </div>
        <div>
          <Label htmlFor={`dependsOnId-${item?.id ?? 'new'}`} className="mb-1.5 block">
            Starts after
          </Label>
          <Select
            id={`dependsOnId-${item?.id ?? 'new'}`}
            name="dependsOnId"
            defaultValue={item?.dependsOnId ?? ''}
          >
            <option value="">—</option>
            {siblings
              .filter((s) => s.id !== item?.id)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </Select>
        </div>
      </div>

      <div>
        <span className="mb-1.5 block text-sm font-medium">Crew</span>
        {crew.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active team members yet — invite people under Settings → Team.
          </p>
        ) : (
          <div className="grid gap-1.5 sm:grid-cols-2">
            {crew.map((member) => (
              <label
                key={member.userId}
                className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  name="crew"
                  value={member.userId}
                  defaultChecked={assigned.has(member.userId)}
                  className="h-4 w-4 rounded border-input"
                />
                <span className="truncate">{member.name ?? member.email}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div>
        <Label htmlFor={`notes-${item?.id ?? 'new'}`} className="mb-1.5 block">
          Notes
        </Label>
        <Textarea
          id={`notes-${item?.id ?? 'new'}`}
          name="notes"
          rows={2}
          defaultValue={item?.notes ?? ''}
          placeholder="Inspection must pass before drywall."
        />
      </div>

      <FormNotice error={state.error} message={state.message} />

      <div className="flex flex-wrap gap-2">
        <SubmitButton className="sm:w-auto sm:px-6" pendingLabel="Saving…">
          {editing ? 'Save work item' : 'Add work item'}
        </SubmitButton>
        {!editing ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-auto"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </form>

      {/* Sibling of the edit form, not nested inside it — a form in a form is
          invalid HTML, and Enter in a text field must never delete anything. */}
      {editing ? (
        <div className="border-t pt-3">
          <DeleteItemButton itemId={item!.id} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Delete lives in its own form so it can't be reached by pressing Enter in the
 * edit form, and asks once before firing.
 */
function DeleteItemButton({ itemId }: { itemId: string }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-auto text-destructive"
        onClick={() => setConfirming(true)}
      >
        <Trash2 className="h-4 w-4" />
        Remove
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">Remove this work item?</span>
      <form action={deleteScheduleItem}>
        <input type="hidden" name="itemId" value={itemId} />
        <Button type="submit" size="sm" variant="outline" className="w-auto text-destructive">
          Yes, remove
        </Button>
      </form>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-auto"
        onClick={() => setConfirming(false)}
      >
        Keep it
      </Button>
    </div>
  );
}
