'use client';

import { useFormState } from 'react-dom';
import Link from 'next/link';
import { createCatalogItem, updateCatalogItem } from '@/lib/catalog/actions';
import type { FormState } from '@/lib/auth/actions';
import { UNITS, UNIT_LABELS, TIERS, TIER_LABELS } from '@/lib/catalog/catalog-core';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { buttonVariants } from '@/components/ui/button';
import { SubmitButton, FormNotice } from '@/components/forms/form-bits';

export interface CatalogFormValues {
  id?: string;
  name?: string;
  trade?: string | null;
  description?: string | null;
  unit?: string;
  defaultMaterialCost?: string | null;
  defaultLaborHours?: string | null;
  defaultLaborRate?: string | null;
  equipmentCost?: string | null;
  /** Whole percent for display (e.g. "5"), not the stored fraction. */
  wastePctPercent?: string | null;
  vendor?: string | null;
  vendorItemNumber?: string | null;
  region?: string | null;
  tier?: string;
  lastVerifiedDate?: string | null;
  notes?: string | null;
}

const TRADES = [
  'Carpentry',
  'Plumbing',
  'Electrical',
  'Drywall',
  'Painting',
  'Flooring',
  'Tile',
  'Roofing',
  'Concrete',
  'HVAC',
  'Demolition',
  'General Labor',
];

const initial: FormState = {};

export function CatalogForm({
  mode,
  values,
}: {
  mode: 'create' | 'edit';
  values?: CatalogFormValues;
}) {
  const [state, formAction] = useFormState(
    mode === 'create' ? createCatalogItem : updateCatalogItem,
    initial,
  );
  const v = values ?? {};

  return (
    <form action={formAction} className="space-y-6">
      <FormNotice error={state.error} />
      {mode === 'edit' && v.id ? <input type="hidden" name="itemId" value={v.id} /> : null}

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Item
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="name" required className="sm:col-span-2">
            <Input
              id="name"
              name="name"
              defaultValue={v.name ?? ''}
              placeholder='e.g. 5/8" drywall, hung & finished'
              required
            />
          </Field>
          <Field label="Trade" htmlFor="trade">
            <Input id="trade" name="trade" list="catalog-trades" defaultValue={v.trade ?? ''} />
            <datalist id="catalog-trades">
              {TRADES.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </Field>
          <Field label="Unit" htmlFor="unit">
            <Select id="unit" name="unit" defaultValue={v.unit ?? 'each'}>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {UNIT_LABELS[u]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tier" htmlFor="tier">
            <Select id="tier" name="tier" defaultValue={v.tier ?? 'standard'}>
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {TIER_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Description" htmlFor="description" className="sm:col-span-2">
            <Textarea id="description" name="description" defaultValue={v.description ?? ''} />
          </Field>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Cost per unit
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Material cost ($)" htmlFor="defaultMaterialCost">
            <Input
              id="defaultMaterialCost"
              name="defaultMaterialCost"
              type="number"
              min="0"
              step="0.01"
              defaultValue={v.defaultMaterialCost ?? ''}
            />
          </Field>
          <Field label="Waste (%)" htmlFor="wastePct">
            <Input
              id="wastePct"
              name="wastePct"
              type="number"
              min="0"
              max="100"
              step="0.5"
              defaultValue={v.wastePctPercent ?? ''}
              placeholder="e.g. 10"
            />
          </Field>
          <Field label="Labor hours" htmlFor="defaultLaborHours">
            <Input
              id="defaultLaborHours"
              name="defaultLaborHours"
              type="number"
              min="0"
              step="0.01"
              defaultValue={v.defaultLaborHours ?? ''}
            />
          </Field>
          <Field label="Labor rate ($/hr)" htmlFor="defaultLaborRate">
            <Input
              id="defaultLaborRate"
              name="defaultLaborRate"
              type="number"
              min="0"
              step="0.01"
              defaultValue={v.defaultLaborRate ?? ''}
            />
          </Field>
          <Field label="Equipment cost ($)" htmlFor="equipmentCost">
            <Input
              id="equipmentCost"
              name="equipmentCost"
              type="number"
              min="0"
              step="0.01"
              defaultValue={v.equipmentCost ?? ''}
            />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">
          Unit cost = material × (1 + waste) + labor hours × labor rate + equipment.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Sourcing
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Vendor" htmlFor="vendor">
            <Input id="vendor" name="vendor" defaultValue={v.vendor ?? ''} />
          </Field>
          <Field label="Vendor item #" htmlFor="vendorItemNumber">
            <Input
              id="vendorItemNumber"
              name="vendorItemNumber"
              defaultValue={v.vendorItemNumber ?? ''}
            />
          </Field>
          <Field label="Region" htmlFor="region">
            <Input
              id="region"
              name="region"
              defaultValue={v.region ?? ''}
              placeholder="e.g. Harford County"
            />
          </Field>
          <Field label="Last verified" htmlFor="lastVerifiedDate">
            <Input
              id="lastVerifiedDate"
              name="lastVerifiedDate"
              type="date"
              defaultValue={v.lastVerifiedDate ?? ''}
            />
          </Field>
          <Field label="Notes" htmlFor="notes" className="sm:col-span-2">
            <Textarea id="notes" name="notes" defaultValue={v.notes ?? ''} />
          </Field>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <SubmitButton className="w-auto" pendingLabel="Saving…">
          {mode === 'create' ? 'Add to catalog' : 'Save changes'}
        </SubmitButton>
        <Link href="/cost-catalog" className={buttonVariants({ variant: 'outline' })}>
          Cancel
        </Link>
      </div>
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
