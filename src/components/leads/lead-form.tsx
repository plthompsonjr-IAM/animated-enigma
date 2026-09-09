'use client';

import { useFormState } from 'react-dom';
import Link from 'next/link';
import { createLead, updateLead } from '@/lib/leads/actions';
import type { FormState } from '@/lib/auth/actions';
import {
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
} from '@/lib/leads/leads-core';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { buttonVariants } from '@/components/ui/button';
import { SubmitButton, FormNotice } from '@/components/forms/form-bits';

export interface LeadFormValues {
  id?: string;
  leadName?: string;
  clientName?: string | null;
  phone?: string | null;
  email?: string | null;
  propertyAddress?: string | null;
  projectType?: string | null;
  leadSource?: string | null;
  estimatedBudget?: string | null;
  desiredStartDate?: string | null;
  description?: string | null;
  assignedTo?: string | null;
  status?: string;
  priority?: string;
  nextFollowUpDate?: string | null;
  notes?: string | null;
}

export interface Member {
  id: string;
  name: string | null;
  email: string;
}

const initial: FormState = {};

const PROJECT_TYPES = [
  'Bathroom Remodel',
  'Kitchen Remodel',
  'Flooring',
  'Painting',
  'Roofing',
  'Siding',
  'Deck',
  'Fence',
  'Shed',
  'Plumbing Repair',
  'Electrical Repair',
  'General Renovation',
  'Commercial Project',
];

const LEAD_SOURCES = [
  'Referral',
  'Website',
  'Google',
  'Facebook',
  'Repeat Client',
  'Walk-up',
  'Phone Call',
  'Other',
];

export function LeadForm({
  members,
  values,
  mode,
}: {
  members: Member[];
  values?: LeadFormValues;
  mode: 'create' | 'edit';
}) {
  const [state, formAction] = useFormState(mode === 'create' ? createLead : updateLead, initial);
  const v = values ?? {};

  return (
    <form action={formAction} className="space-y-6">
      <FormNotice error={state.error} />
      {mode === 'edit' && v.id ? <input type="hidden" name="leadId" value={v.id} /> : null}

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Lead
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Lead name" htmlFor="leadName" required className="sm:col-span-2">
            <Input
              id="leadName"
              name="leadName"
              defaultValue={v.leadName ?? ''}
              placeholder="e.g. Hall bath full remodel"
              required
            />
          </Field>
          <Field label="Client name" htmlFor="clientName">
            <Input id="clientName" name="clientName" defaultValue={v.clientName ?? ''} />
          </Field>
          <Field label="Project type" htmlFor="projectType">
            <Select id="projectType" name="projectType" defaultValue={v.projectType ?? ''}>
              <option value="">Select…</option>
              {PROJECT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Phone" htmlFor="phone">
            <Input id="phone" name="phone" type="tel" defaultValue={v.phone ?? ''} />
          </Field>
          <Field label="Email" htmlFor="email">
            <Input id="email" name="email" type="email" defaultValue={v.email ?? ''} />
          </Field>
          <Field label="Property address" htmlFor="propertyAddress" className="sm:col-span-2">
            <Input
              id="propertyAddress"
              name="propertyAddress"
              defaultValue={v.propertyAddress ?? ''}
              placeholder="Street, city, state"
            />
          </Field>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Details
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Lead source" htmlFor="leadSource">
            <Select id="leadSource" name="leadSource" defaultValue={v.leadSource ?? ''}>
              <option value="">Select…</option>
              {LEAD_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Estimated budget" htmlFor="estimatedBudget">
            <Input
              id="estimatedBudget"
              name="estimatedBudget"
              type="number"
              min="0"
              step="100"
              defaultValue={v.estimatedBudget ?? ''}
              placeholder="$"
            />
          </Field>
          <Field label="Desired start date" htmlFor="desiredStartDate">
            <Input
              id="desiredStartDate"
              name="desiredStartDate"
              type="date"
              defaultValue={v.desiredStartDate ?? ''}
            />
          </Field>
          <Field label="Assigned salesperson" htmlFor="assignedTo">
            <Select id="assignedTo" name="assignedTo" defaultValue={v.assignedTo ?? ''}>
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name ?? m.email}
                </option>
              ))}
            </Select>
          </Field>
          {mode === 'create' ? (
            <Field label="Status" htmlFor="status">
              <Select id="status" name="status" defaultValue={v.status ?? 'new'}>
                {LEAD_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {LEAD_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label="Priority" htmlFor="priority">
            <Select id="priority" name="priority" defaultValue={v.priority ?? 'medium'}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Next follow-up" htmlFor="nextFollowUpDate">
            <Input
              id="nextFollowUpDate"
              name="nextFollowUpDate"
              type="date"
              defaultValue={v.nextFollowUpDate ?? ''}
            />
          </Field>
          <Field label="Description" htmlFor="description" className="sm:col-span-2">
            <Textarea
              id="description"
              name="description"
              defaultValue={v.description ?? ''}
              placeholder="What does the client want done?"
            />
          </Field>
          <Field label="Internal notes" htmlFor="notes" className="sm:col-span-2">
            <Textarea id="notes" name="notes" defaultValue={v.notes ?? ''} />
          </Field>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <SubmitButton className="w-auto" pendingLabel="Saving…">
          {mode === 'create' ? 'Create lead' : 'Save changes'}
        </SubmitButton>
        <Link
          href={mode === 'edit' && v.id ? `/leads/${v.id}` : '/leads'}
          className={buttonVariants({ variant: 'outline' })}
        >
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
