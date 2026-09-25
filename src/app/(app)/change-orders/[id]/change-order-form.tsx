'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { Plus, Trash2 } from 'lucide-react';
import { saveChangeOrder } from '@/lib/change-orders/actions';
import {
  ITEM_DIRECTIONS,
  ITEM_DIRECTION_LABELS,
  costBreakdown,
  formatScheduleChange,
  itemDelta,
  type ChangeOrderItemInput,
  type ItemDirection,
} from '@/lib/change-orders/change-orders-core';
import { formatMoney } from '@/lib/contracts/contracts-core';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { SubmitButton, FormNotice } from '@/components/forms/form-bits';

interface Row extends ChangeOrderItemInput {
  key: string;
}

/**
 * Draft editor for a change order. The net cost is computed from the lines as
 * you type — added work adds, removed work credits — so what the client sees
 * always matches the itemisation.
 */
export function ChangeOrderForm({
  changeOrderId,
  initial,
}: {
  changeOrderId: string;
  initial: {
    reason: string;
    requestedBy: string;
    clientExplanation: string;
    internalNotes: string;
    scheduleChangeDays: number;
    items: ChangeOrderItemInput[];
  };
}) {
  const [state, formAction] = useFormState(
    saveChangeOrder,
    {} as { error?: string; message?: string },
  );
  const [rows, setRows] = useState<Row[]>(() =>
    initial.items.length > 0
      ? initial.items.map((item, i) => ({ ...item, key: `i${i}` }))
      : [{ key: 'i0', direction: 'added', description: '', amount: '' }],
  );
  const [days, setDays] = useState(initial.scheduleChangeDays);

  const totals = costBreakdown(rows);

  function update(key: string, patch: Partial<Row>) {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="changeOrderId" value={changeOrderId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="reason" className="mb-1.5 block">
            Reason
          </Label>
          <Input
            id="reason"
            name="reason"
            defaultValue={initial.reason}
            placeholder="Concealed rot found behind tub"
          />
        </div>
        <div>
          <Label htmlFor="requestedBy" className="mb-1.5 block">
            Requested by
          </Label>
          <Input
            id="requestedBy"
            name="requestedBy"
            defaultValue={initial.requestedBy}
            placeholder="Client, inspector, or field"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label className="block">Added and removed work</Label>
        {rows.map((row) => (
          <div key={row.key} className="rounded-md border p-3">
            <div className="grid gap-2 sm:grid-cols-[auto_1fr_auto]">
              <div>
                <Label className="mb-1 block text-xs">Direction</Label>
                <Select
                  name="itemDirection"
                  value={row.direction}
                  className="w-auto"
                  onChange={(e) => update(row.key, { direction: e.target.value as ItemDirection })}
                >
                  {ITEM_DIRECTIONS.map((d) => (
                    <option key={d} value={d}>
                      {ITEM_DIRECTION_LABELS[d]}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label className="mb-1 block text-xs">Description</Label>
                <Input
                  name="itemDescription"
                  value={row.description}
                  placeholder="Replace subfloor, 40 sq ft"
                  onChange={(e) => update(row.key, { description: e.target.value })}
                />
              </div>
              <div>
                <Label className="mb-1 block text-xs">Amount</Label>
                <Input
                  name="itemAmount"
                  inputMode="decimal"
                  className="w-28"
                  value={row.amount == null ? '' : String(row.amount)}
                  onChange={(e) => update(row.key, { amount: e.target.value })}
                />
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span
                className={`text-sm font-medium tabular-nums ${
                  itemDelta(row) < 0 ? 'text-emerald-600' : ''
                }`}
              >
                {formatMoney(itemDelta(row))}
              </span>
              {rows.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setRows((c) => c.filter((r) => r.key !== row.key))}
                >
                  <Trash2 className="h-4 w-4" />
                  Remove
                </Button>
              ) : null}
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
              { key: `new${Date.now()}`, direction: 'added', description: '', amount: '' },
            ])
          }
        >
          <Plus className="h-4 w-4" />
          Add line
        </Button>

        <div className="space-y-1 rounded-md bg-secondary/50 px-3 py-2 text-sm">
          <Row label="Added" value={formatMoney(totals.added)} />
          <Row label="Removed" value={formatMoney(totals.removed)} />
          <div className="flex items-center justify-between border-t pt-1 font-semibold">
            <span>Net change</span>
            <span className="tabular-nums">{formatMoney(totals.net)}</span>
          </div>
        </div>
      </div>

      <div>
        <Label htmlFor="scheduleChangeDays" className="mb-1.5 block">
          Schedule change (days)
        </Label>
        <Input
          id="scheduleChangeDays"
          name="scheduleChangeDays"
          inputMode="numeric"
          className="w-28"
          value={String(days)}
          onChange={(e) => setDays(Number.parseInt(e.target.value || '0', 10) || 0)}
        />
        <p className="mt-1 text-xs text-muted-foreground">{formatScheduleChange(days)}</p>
      </div>

      <div>
        <Label htmlFor="clientExplanation" className="mb-1.5 block">
          Client explanation <span className="text-muted-foreground">(printed for the client)</span>
        </Label>
        <Textarea
          id="clientExplanation"
          name="clientExplanation"
          rows={3}
          defaultValue={initial.clientExplanation}
          placeholder="Plain-language explanation of what changed and why."
        />
      </div>

      <div>
        <Label htmlFor="internalNotes" className="mb-1.5 block">
          Internal notes <span className="text-muted-foreground">(never shown to the client)</span>
        </Label>
        <Textarea
          id="internalNotes"
          name="internalNotes"
          rows={2}
          defaultValue={initial.internalNotes}
        />
      </div>

      <FormNotice error={state.error} message={state.message} />
      <SubmitButton className="sm:w-auto sm:px-6" pendingLabel="Saving…">
        Save change order
      </SubmitButton>
    </form>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-muted-foreground">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
