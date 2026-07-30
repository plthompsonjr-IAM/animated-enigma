'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { recordPayment } from '@/lib/invoices/actions';
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  formatMoney,
  unappliedAmount,
  type PaymentMethod,
} from '@/lib/invoices/invoices-core';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { SubmitButton, FormNotice } from '@/components/forms/form-bits';

/**
 * Record money received against this invoice. Defaults to the full outstanding
 * balance — the common case — and shows what would be left unapplied if the
 * payment covers more than this invoice.
 */
export function PaymentForm({
  projectId,
  invoiceId,
  balance,
}: {
  projectId: string;
  invoiceId: string;
  balance: number;
}) {
  const [state, formAction] = useFormState(
    recordPayment,
    {} as { error?: string; message?: string },
  );
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(balance));
  const [applied, setApplied] = useState(String(balance));
  const [method, setMethod] = useState<PaymentMethod>('check');

  const leftover = unappliedAmount(amount, [{ invoiceId, amount: applied }]);

  if (!open) {
    return (
      <Button type="button" size="sm" className="w-auto" onClick={() => setOpen(true)}>
        Record payment
      </Button>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="allocationInvoiceId" value={invoiceId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="amount" className="mb-1.5 block">
            Amount received
          </Label>
          <Input
            id="amount"
            name="amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setApplied(e.target.value);
            }}
          />
        </div>
        <div>
          <Label htmlFor="allocationAmount" className="mb-1.5 block">
            Applied to this invoice
          </Label>
          <Input
            id="allocationAmount"
            name="allocationAmount"
            inputMode="decimal"
            value={applied}
            onChange={(e) => setApplied(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="method" className="mb-1.5 block">
            Method
          </Label>
          <Select
            id="method"
            name="method"
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="paymentDate" className="mb-1.5 block">
            Date received
          </Label>
          <Input
            id="paymentDate"
            name="paymentDate"
            type="date"
            defaultValue={new Date().toISOString().slice(0, 10)}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="referenceNumber" className="mb-1.5 block">
          Reference <span className="text-muted-foreground">(check no., confirmation)</span>
        </Label>
        <Input id="referenceNumber" name="referenceNumber" />
      </div>

      <p className="text-xs text-muted-foreground">
        Outstanding balance {formatMoney(balance)}.
        {leftover > 0
          ? ` ${formatMoney(leftover)} of this payment would be left unapplied — apply it to another invoice from that invoice's page.`
          : ''}
      </p>

      <FormNotice error={state.error} message={state.message} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton className="sm:w-auto sm:px-6" pendingLabel="Recording…">
          Save payment
        </SubmitButton>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
