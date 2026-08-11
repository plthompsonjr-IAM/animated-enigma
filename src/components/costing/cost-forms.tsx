'use client';

import { useFormState } from 'react-dom';
import { useState } from 'react';
import { Play, Plus, Square } from 'lucide-react';
import { clockIn, clockOut, logTimeManually, recordExpense } from '@/lib/costing/actions';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
} from '@/lib/costing/costing-core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { SubmitButton, FormNotice } from '@/components/forms/form-bits';

const initial = {} as { error?: string; message?: string };

/**
 * Clock in and out. One tap each, because this is used standing on a jobsite
 * with gloves on — the manual-entry form is behind a link for when someone
 * forgot, which is the other half of how time actually gets recorded.
 */
export function ClockControls({
  projectId,
  openShiftId,
}: {
  projectId: string;
  openShiftId: string | null;
}) {
  const [manual, setManual] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {openShiftId ? (
          <form action={clockOut} className="flex items-end gap-2">
            <input type="hidden" name="entryId" value={openShiftId} />
            <div>
              <Label htmlFor="breakMinutes" className="mb-1 block text-xs">
                Break (min)
              </Label>
              <Input
                id="breakMinutes"
                name="breakMinutes"
                type="number"
                inputMode="numeric"
                min={0}
                step={5}
                defaultValue={0}
                className="h-9 w-24"
              />
            </div>
            <Button type="submit" size="sm" className="w-auto">
              <Square className="h-4 w-4" />
              Clock out
            </Button>
          </form>
        ) : (
          <form action={clockIn}>
            <input type="hidden" name="projectId" value={projectId} />
            <Button type="submit" size="sm" className="w-auto">
              <Play className="h-4 w-4" />
              Clock in
            </Button>
          </form>
        )}

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-auto"
          onClick={() => setManual((open) => !open)}
        >
          {manual ? 'Cancel' : 'Add time by hand'}
        </Button>
      </div>

      {openShiftId ? (
        <p className="text-xs text-muted-foreground">
          You’re on the clock. Hours are worked out when you clock out.
        </p>
      ) : null}

      {manual ? <ManualTimeForm projectId={projectId} /> : null}
    </div>
  );
}

function ManualTimeForm({ projectId }: { projectId: string }) {
  const [state, formAction] = useFormState(logTimeManually, initial);

  return (
    <form action={formAction} className="space-y-3 rounded-md border p-3">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="clockIn" className="mb-1.5 block">
            Started
          </Label>
          <Input id="clockIn" name="clockIn" type="datetime-local" required />
        </div>
        <div>
          <Label htmlFor="clockOut" className="mb-1.5 block">
            Finished
          </Label>
          <Input id="clockOut" name="clockOut" type="datetime-local" required />
        </div>
        <div>
          <Label htmlFor="manualBreak" className="mb-1.5 block">
            Break (min)
          </Label>
          <Input
            id="manualBreak"
            name="breakMinutes"
            type="number"
            inputMode="numeric"
            min={0}
            step={5}
            defaultValue={0}
          />
        </div>
      </div>
      <div>
        <Label htmlFor="timeNotes" className="mb-1.5 block">
          Notes
        </Label>
        <Input id="timeNotes" name="notes" placeholder="Optional — why this is being added late." />
      </div>
      <FormNotice error={state.error} message={state.message} />
      <SubmitButton className="sm:w-auto sm:px-6" pendingLabel="Saving…">
        Record time
      </SubmitButton>
    </form>
  );
}

/** Records money spent on a job. */
export function ExpenseForm({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useFormState(recordExpense, initial);

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
        Record expense
      </Button>
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={formAction} className="space-y-3 rounded-md border p-3">
      <input type="hidden" name="projectId" value={projectId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="expenseDescription" className="mb-1.5 block">
            What was it for
          </Label>
          <Input
            id="expenseDescription"
            name="description"
            placeholder="Tile and thinset"
            required
            maxLength={300}
          />
        </div>
        <div>
          <Label htmlFor="expenseVendor" className="mb-1.5 block">
            Vendor
          </Label>
          <Input id="expenseVendor" name="vendor" placeholder="Home Depot" />
        </div>
        <div>
          <Label htmlFor="expenseAmount" className="mb-1.5 block">
            Amount
          </Label>
          <Input
            id="expenseAmount"
            name="amount"
            inputMode="decimal"
            placeholder="420.50"
            required
          />
          <p className="mt-1 text-xs text-muted-foreground">
            A negative amount records a return or a refund.
          </p>
        </div>
        <div>
          <Label htmlFor="expenseDate" className="mb-1.5 block">
            Date
          </Label>
          <Input
            id="expenseDate"
            name="expenseDate"
            type="date"
            defaultValue={today}
            max={today}
            required
          />
        </div>
        <div>
          <Label htmlFor="expenseCategory" className="mb-1.5 block">
            Category
          </Label>
          <Select id="expenseCategory" name="category" defaultValue="">
            <option value="">Work it out from the vendor</option>
            {EXPENSE_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {EXPENSE_CATEGORY_LABELS[category]}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div>
        <Label htmlFor="expenseNotes" className="mb-1.5 block">
          Notes
        </Label>
        <Textarea id="expenseNotes" name="notes" rows={2} placeholder="Optional." />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isBillable" className="h-4 w-4 rounded border-input" />
        Bill this on to the client
      </label>

      <FormNotice error={state.error} message={state.message} />

      <div className="flex flex-wrap gap-2">
        <SubmitButton className="sm:w-auto sm:px-6" pendingLabel="Saving…">
          Record expense
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
