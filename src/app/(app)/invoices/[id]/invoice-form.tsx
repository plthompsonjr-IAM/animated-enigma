'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { Plus, Trash2 } from 'lucide-react';
import { saveInvoice } from '@/lib/invoices/actions';
import {
  formatMoney,
  invoiceTotals,
  lineAmount,
  type InvoiceLineInput,
} from '@/lib/invoices/invoices-core';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { SubmitButton, FormNotice } from '@/components/forms/form-bits';

interface Row extends InvoiceLineInput {
  key: string;
}

/**
 * Draft-only invoice editor. Totals recompute as you type using the same pure
 * functions the server uses to persist them, so the preview can't disagree with
 * what gets saved.
 */
export function InvoiceForm({
  invoiceId,
  initial,
}: {
  invoiceId: string;
  initial: {
    lines: InvoiceLineInput[];
    taxRate: string;
    credits: string;
    dueDate: string;
    paymentInstructions: string;
  };
}) {
  const [state, formAction] = useFormState(saveInvoice, {} as { error?: string; message?: string });
  const [rows, setRows] = useState<Row[]>(() =>
    initial.lines.length > 0
      ? initial.lines.map((l, i) => ({ ...l, key: `l${i}` }))
      : [{ key: 'l0', description: '', quantity: '1', unitPrice: '', taxable: true }],
  );
  const [taxRate, setTaxRate] = useState(initial.taxRate);
  const [credits, setCredits] = useState(initial.credits);

  const totals = invoiceTotals(rows, taxRate, credits);

  function update(key: string, patch: Partial<Row>) {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="invoiceId" value={invoiceId} />

      <div className="space-y-2">
        <Label className="block">Line items</Label>
        {rows.map((row) => (
          <div key={row.key} className="rounded-md border p-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
              <div>
                <Label className="mb-1 block text-xs">Description</Label>
                <Input
                  name="lineDescription"
                  value={row.description}
                  placeholder="Rough-in plumbing"
                  onChange={(e) => update(row.key, { description: e.target.value })}
                />
              </div>
              <div>
                <Label className="mb-1 block text-xs">Qty</Label>
                <Input
                  name="lineQuantity"
                  inputMode="decimal"
                  className="w-20"
                  value={row.quantity == null ? '' : String(row.quantity)}
                  onChange={(e) => update(row.key, { quantity: e.target.value })}
                />
              </div>
              <div>
                <Label className="mb-1 block text-xs">Unit price</Label>
                <Input
                  name="lineUnitPrice"
                  inputMode="decimal"
                  className="w-28"
                  value={row.unitPrice == null ? '' : String(row.unitPrice)}
                  onChange={(e) => update(row.key, { unitPrice: e.target.value })}
                />
              </div>
            </div>
            <input
              type="hidden"
              name="lineTaxable"
              value={row.taxable !== false ? 'true' : 'false'}
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={row.taxable !== false}
                  className="h-3.5 w-3.5 accent-primary"
                  onChange={(e) => update(row.key, { taxable: e.target.checked })}
                />
                Taxable
              </label>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium tabular-nums">
                  {formatMoney(lineAmount(row))}
                </span>
                {rows.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setRows((c) => c.filter((r) => r.key !== row.key))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
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
                description: '',
                quantity: '1',
                unitPrice: '',
                taxable: true,
              },
            ])
          }
        >
          <Plus className="h-4 w-4" />
          Add line
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="taxRate" className="mb-1.5 block">
            Tax rate (%)
          </Label>
          <Input
            id="taxRate"
            name="taxRate"
            inputMode="decimal"
            value={taxRate}
            onChange={(e) => setTaxRate(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="credits" className="mb-1.5 block">
            Credits
          </Label>
          <Input
            id="credits"
            name="credits"
            inputMode="decimal"
            value={credits}
            onChange={(e) => setCredits(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="dueDate" className="mb-1.5 block">
            Due date
          </Label>
          <Input id="dueDate" name="dueDate" type="date" defaultValue={initial.dueDate} />
        </div>
      </div>

      <div className="space-y-1 rounded-md bg-secondary/50 px-3 py-2 text-sm">
        <TotalRow label="Subtotal" value={formatMoney(totals.subtotal)} />
        <TotalRow
          label={`Tax on ${formatMoney(totals.taxableSubtotal)}`}
          value={formatMoney(totals.taxAmount)}
        />
        {totals.credits > 0 ? (
          <TotalRow label="Credits" value={`−${formatMoney(totals.credits)}`} />
        ) : null}
        <div className="flex items-center justify-between border-t pt-1 font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{formatMoney(totals.total)}</span>
        </div>
      </div>

      <div>
        <Label htmlFor="paymentInstructions" className="mb-1.5 block">
          Payment instructions
        </Label>
        <Textarea
          id="paymentInstructions"
          name="paymentInstructions"
          rows={2}
          defaultValue={initial.paymentInstructions}
          placeholder="Checks payable to… / ACH details / portal link"
        />
      </div>

      <FormNotice error={state.error} message={state.message} />
      <SubmitButton className="sm:w-auto sm:px-6" pendingLabel="Saving…">
        Save invoice
      </SubmitButton>
    </form>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-muted-foreground">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
