'use client';

import { useFormState } from 'react-dom';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { createClient, updateClient, type ClientFormState } from '@/lib/clients/actions';
import {
  CLIENT_TYPES,
  CLIENT_TYPE_LABELS,
  CONTACT_METHODS,
  CONTACT_METHOD_LABELS,
  DUPLICATE_REASON_LABELS,
} from '@/lib/clients/clients-core';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { buttonVariants } from '@/components/ui/button';
import { SubmitButton, FormNotice } from '@/components/forms/form-bits';

export interface ClientFormValues {
  id?: string;
  clientType?: string;
  displayName?: string;
  companyName?: string | null;
  primaryPhone?: string | null;
  primaryEmail?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressZip?: string | null;
  preferredContactMethod?: string | null;
  tags?: string[];
  notes?: string | null;
}

const initial: ClientFormState = {};

export function ClientForm({
  values,
  mode,
}: {
  values?: ClientFormValues;
  mode: 'create' | 'edit';
}) {
  const [state, formAction] = useFormState(
    mode === 'create' ? createClient : updateClient,
    initial,
  );
  const v = values ?? {};

  return (
    <form action={formAction} className="space-y-6">
      <FormNotice error={state.duplicates?.length ? undefined : state.error} />
      {state.duplicates?.length ? <DuplicateWarning duplicates={state.duplicates} /> : null}
      {mode === 'edit' && v.id ? <input type="hidden" name="clientId" value={v.id} /> : null}

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Client
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Client type" htmlFor="clientType">
            <Select id="clientType" name="clientType" defaultValue={v.clientType ?? 'individual'}>
              {CLIENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {CLIENT_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Name" htmlFor="displayName" required>
            <Input
              id="displayName"
              name="displayName"
              defaultValue={v.displayName ?? ''}
              placeholder="e.g. Jane Dorsey"
              required
            />
          </Field>
          <Field label="Company name" htmlFor="companyName">
            <Input
              id="companyName"
              name="companyName"
              defaultValue={v.companyName ?? ''}
              placeholder="For company clients"
            />
          </Field>
          <Field label="Preferred contact" htmlFor="preferredContactMethod">
            <Select
              id="preferredContactMethod"
              name="preferredContactMethod"
              defaultValue={v.preferredContactMethod ?? ''}
            >
              <option value="">No preference</option>
              {CONTACT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {CONTACT_METHOD_LABELS[m]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Phone" htmlFor="primaryPhone">
            <Input
              id="primaryPhone"
              name="primaryPhone"
              type="tel"
              defaultValue={v.primaryPhone ?? ''}
            />
          </Field>
          <Field label="Email" htmlFor="primaryEmail">
            <Input
              id="primaryEmail"
              name="primaryEmail"
              type="email"
              defaultValue={v.primaryEmail ?? ''}
            />
          </Field>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Billing address
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Street" htmlFor="addressLine1" className="sm:col-span-2">
            <Input id="addressLine1" name="addressLine1" defaultValue={v.addressLine1 ?? ''} />
          </Field>
          <Field label="Unit / suite" htmlFor="addressLine2" className="sm:col-span-2">
            <Input id="addressLine2" name="addressLine2" defaultValue={v.addressLine2 ?? ''} />
          </Field>
          <Field label="City" htmlFor="addressCity">
            <Input id="addressCity" name="addressCity" defaultValue={v.addressCity ?? ''} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="State" htmlFor="addressState">
              <Input id="addressState" name="addressState" defaultValue={v.addressState ?? ''} />
            </Field>
            <Field label="ZIP" htmlFor="addressZip">
              <Input id="addressZip" name="addressZip" defaultValue={v.addressZip ?? ''} />
            </Field>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Organization
        </h2>
        <div className="grid gap-4">
          <Field label="Tags" htmlFor="tags">
            <Input
              id="tags"
              name="tags"
              defaultValue={(v.tags ?? []).join(', ')}
              placeholder="VIP, repeat, HOA — comma separated"
            />
          </Field>
          <Field label="Notes" htmlFor="notes">
            <Textarea id="notes" name="notes" defaultValue={v.notes ?? ''} />
          </Field>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <SubmitButton className="w-auto" pendingLabel="Saving…">
          {mode === 'create'
            ? state.duplicates?.length
              ? 'Create anyway'
              : 'Create client'
            : 'Save changes'}
        </SubmitButton>
        <Link
          href={mode === 'edit' && v.id ? `/clients/${v.id}` : '/clients'}
          className={buttonVariants({ variant: 'outline' })}
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

/** Possible-duplicate panel: matches with reasons, and a confirm checkbox that
 * lets the office proceed deliberately. */
function DuplicateWarning({
  duplicates,
}: {
  duplicates: NonNullable<ClientFormState['duplicates']>;
}) {
  return (
    <div className="space-y-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="text-sm">
          <p className="font-medium">This may already be a client</p>
          <ul className="mt-1 space-y-1">
            {duplicates.map((d) => (
              <li key={d.id}>
                <Link href={`/clients/${d.id}`} className="font-medium underline">
                  {d.displayName}
                </Link>{' '}
                <span className="text-muted-foreground">
                  ({d.reasons.map((r) => DUPLICATE_REASON_LABELS[r]).join(', ')})
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="confirmDuplicate" value="true" className="h-4 w-4" />
        This is a different client — create anyway
      </label>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  required,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor} className="mb-1.5 block">
        {label}
        {required ? <span className="text-primary"> *</span> : null}
      </Label>
      {children}
    </div>
  );
}
