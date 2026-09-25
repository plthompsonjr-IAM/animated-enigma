'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { Plus, Trash2 } from 'lucide-react';
import { savePaymentSchedule } from '@/lib/contracts/actions';
import {
  MILESTONE_TRIGGERS,
  MILESTONE_TRIGGER_LABELS,
  PAYMENT_STRUCTURES,
  PAYMENT_STRUCTURE_HINTS,
  PAYMENT_STRUCTURE_LABELS,
  defaultMilestones,
  formatMoney,
  milestoneAmount,
  type MilestoneInput,
  type PaymentStructure,
} from '@/lib/contracts/contracts-core';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { SubmitButton, FormNotice } from '@/components/forms/form-bits';

interface Row extends MilestoneInput {
  key: string;
}

/**
 * Draft-only editor for a contract's payment terms. Totals are computed live so
 * the office can see immediately whether the schedule covers the contract
 * value; the server re-validates before saving.
 */
export function ScheduleForm({
  contractId,
  contractValue,
  initialStructure,
  initialMilestones,
}: {
  contractId: string;
  contractValue: number;
  initialStructure: PaymentStructure;
  initialMilestones: MilestoneInput[];
}) {
  const [state, formAction] = useFormState(
    savePaymentSchedule,
    {} as { error?: string; message?: string },
  );
  const [structure, setStructure] = useState<PaymentStructure>(initialStructure);
  const [rows, setRows] = useState<Row[]>(() =>
    (initialMilestones.length > 0 ? initialMilestones : defaultMilestones(initialStructure)).map(
      (m, i) => ({ ...m, key: `m${i}` }),
    ),
  );

  const fixedSchedule = structure !== 'time_materials' && structure !== 'maintenance';
  const total = rows.reduce((sum, r) => sum + milestoneAmount(r, contractValue), 0);
  const remainder = Math.round((contractValue - total + Number.EPSILON) * 100) / 100;

  function applyStructure(next: PaymentStructure) {
    setStructure(next);
    setRows(defaultMilestones(next).map((m, i) => ({ ...m, key: `s${next}-${i}` })));
  }

  function update(key: string, patch: Partial<Row>) {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="contractId" value={contractId} />

      <div>
        <Label htmlFor="structureType" className="mb-1.5 block">
          Payment structure
        </Label>
        <Select
          id="structureType"
          name="structureType"
          value={structure}
          onChange={(e) => applyStructure(e.target.value as PaymentStructure)}
        >
          {PAYMENT_STRUCTURES.map((s) => (
            <option key={s} value={s}>
              {PAYMENT_STRUCTURE_LABELS[s]}
            </option>
          ))}
        </Select>
        <p className="mt-1 text-xs text-muted-foreground">{PAYMENT_STRUCTURE_HINTS[structure]}</p>
      </div>

      {fixedSchedule ? (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.key} className="rounded-md border p-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
                <div>
                  <Label className="mb-1 block text-xs">Payment</Label>
                  <Input
                    name="milestoneName"
                    value={row.name}
                    placeholder="Deposit"
                    onChange={(e) => update(row.key, { name: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="mb-1 block text-xs">%</Label>
                  <Input
                    name="milestonePercentage"
                    inputMode="decimal"
                    className="w-20"
                    value={row.percentage == null ? '' : String(row.percentage)}
                    onChange={(e) => update(row.key, { percentage: e.target.value, amount: '' })}
                  />
                </div>
                <div>
                  <Label className="mb-1 block text-xs">or amount</Label>
                  <Input
                    name="milestoneAmount"
                    inputMode="decimal"
                    className="w-28"
                    value={row.amount == null ? '' : String(row.amount)}
                    onChange={(e) => update(row.key, { amount: e.target.value, percentage: '' })}
                  />
                </div>
                <div>
                  <Label className="mb-1 block text-xs">Due</Label>
                  <Select
                    name="milestoneTrigger"
                    value={row.triggerType ?? 'milestone'}
                    className="w-auto"
                    onChange={(e) =>
                      update(row.key, { triggerType: e.target.value as Row['triggerType'] })
                    }
                  >
                    {MILESTONE_TRIGGERS.map((t) => (
                      <option key={t} value={t}>
                        {MILESTONE_TRIGGER_LABELS[t]}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <input type="hidden" name="milestoneDueDate" value={row.dueDate ?? ''} />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-sm font-medium tabular-nums">
                  {formatMoney(milestoneAmount(row, contractValue))}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setRows((c) => c.filter((r) => r.key !== row.key))}
                >
                  <Trash2 className="h-4 w-4" />
                  Remove
                </Button>
              </div>
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setRows((c) => [
                ...c,
                {
                  key: `new${Date.now()}`,
                  name: '',
                  percentage: '',
                  amount: '',
                  triggerType: 'milestone',
                },
              ])
            }
          >
            <Plus className="h-4 w-4" />
            Add payment
          </Button>

          <div className="flex items-center justify-between rounded-md bg-secondary/50 px-3 py-2 text-sm">
            <span className="font-medium">Scheduled</span>
            <span className="tabular-nums">
              {formatMoney(total)} of {formatMoney(contractValue)}
              {Math.abs(remainder) > 0.01 ? (
                <span className="ml-2 text-destructive">
                  ({formatMoney(Math.abs(remainder))} {remainder > 0 ? 'unscheduled' : 'over'})
                </span>
              ) : null}
            </span>
          </div>
        </div>
      ) : (
        <p className="rounded-md border bg-secondary/40 p-3 text-sm text-muted-foreground">
          {PAYMENT_STRUCTURE_LABELS[structure]} has no fixed draw schedule — invoices are raised as
          work happens.
        </p>
      )}

      <FormNotice error={state.error} message={state.message} />
      <SubmitButton className="sm:w-auto sm:px-6" pendingLabel="Saving…">
        Save payment schedule
      </SubmitButton>
    </form>
  );
}
