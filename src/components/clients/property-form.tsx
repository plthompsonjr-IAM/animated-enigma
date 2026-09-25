'use client';

import { useFormState } from 'react-dom';
import Link from 'next/link';
import {
  createProperty,
  updateProperty,
  deleteProperty,
  type ClientFormState,
} from '@/lib/clients/actions';
import { PROPERTY_TYPES, OCCUPANCY_STATUSES, OCCUPANCY_LABELS } from '@/lib/clients/clients-core';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button, buttonVariants } from '@/components/ui/button';
import { SubmitButton, FormNotice } from '@/components/forms/form-bits';

export interface PropertyFormValues {
  id?: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressZip?: string | null;
  propertyType?: string | null;
  squareFootage?: number | null;
  yearBuilt?: number | null;
  occupancyStatus?: string | null;
  accessInstructions?: string | null;
  utilities?: string | null;
  permitJurisdiction?: string | null;
  notes?: string | null;
}

const initial: ClientFormState = {};

export function PropertyForm({
  clientId,
  values,
  mode,
}: {
  clientId: string;
  values?: PropertyFormValues;
  mode: 'create' | 'edit';
}) {
  const [state, formAction] = useFormState(
    mode === 'create' ? createProperty : updateProperty,
    initial,
  );
  const v = values ?? {};

  return (
    <form action={formAction} className="space-y-6">
      <FormNotice error={state.error} />
      <input type="hidden" name="clientId" value={clientId} />
      {mode === 'edit' && v.id ? <input type="hidden" name="propertyId" value={v.id} /> : null}

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Address
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Street" htmlFor="addressLine1" required className="sm:col-span-2">
            <Input
              id="addressLine1"
              name="addressLine1"
              defaultValue={v.addressLine1 ?? ''}
              placeholder="123 Main St"
              required
            />
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
          Property details
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Property type" htmlFor="propertyType">
            <Select id="propertyType" name="propertyType" defaultValue={v.propertyType ?? ''}>
              <option value="">Select…</option>
              {PROPERTY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Occupancy" htmlFor="occupancyStatus">
            <Select
              id="occupancyStatus"
              name="occupancyStatus"
              defaultValue={v.occupancyStatus ?? ''}
            >
              <option value="">Unknown</option>
              {OCCUPANCY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {OCCUPANCY_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Square footage" htmlFor="squareFootage">
            <Input
              id="squareFootage"
              name="squareFootage"
              type="number"
              min="1"
              defaultValue={v.squareFootage ?? ''}
            />
          </Field>
          <Field label="Year built" htmlFor="yearBuilt">
            <Input
              id="yearBuilt"
              name="yearBuilt"
              type="number"
              min="1700"
              max={new Date().getFullYear() + 1}
              defaultValue={v.yearBuilt ?? ''}
            />
          </Field>
          <Field label="Permit jurisdiction" htmlFor="permitJurisdiction" className="sm:col-span-2">
            <Input
              id="permitJurisdiction"
              name="permitJurisdiction"
              defaultValue={v.permitJurisdiction ?? ''}
              placeholder="e.g. Harford County"
            />
          </Field>
          <Field label="Access instructions" htmlFor="accessInstructions" className="sm:col-span-2">
            <Textarea
              id="accessInstructions"
              name="accessInstructions"
              defaultValue={v.accessInstructions ?? ''}
              placeholder="Gate code, lockbox, dog in yard, parking…"
            />
          </Field>
          <Field label="Utilities" htmlFor="utilities" className="sm:col-span-2">
            <Textarea
              id="utilities"
              name="utilities"
              defaultValue={v.utilities ?? ''}
              placeholder="Panel location, water shutoff, gas/electric providers…"
            />
          </Field>
          <Field label="Notes" htmlFor="notes" className="sm:col-span-2">
            <Textarea id="notes" name="notes" defaultValue={v.notes ?? ''} />
          </Field>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <SubmitButton className="w-auto" pendingLabel="Saving…">
          {mode === 'create' ? 'Add property' : 'Save changes'}
        </SubmitButton>
        <Link href={`/clients/${clientId}`} className={buttonVariants({ variant: 'outline' })}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

/** Standalone delete control (kept outside the edit form — forms can't nest). */
export function DeletePropertyButton({
  clientId,
  propertyId,
}: {
  clientId: string;
  propertyId: string;
}) {
  const [state, formAction] = useFormState(deleteProperty, initial);
  return (
    <form action={formAction} className="space-y-2">
      <FormNotice error={state.error} />
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="propertyId" value={propertyId} />
      <Button type="submit" variant="ghost" size="sm">
        Delete property
      </Button>
    </form>
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
