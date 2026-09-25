'use client';

import { useFormState } from 'react-dom';
import Link from 'next/link';
import { quickIntake, type IntakeFormState } from '@/lib/intake/actions';
import { PRIORITIES, PRIORITY_LABELS } from '@/lib/leads/leads-core';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { buttonVariants } from '@/components/ui/button';
import { SubmitButton, FormNotice } from '@/components/forms/form-bits';

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
  'Phone Call',
  'Referral',
  'Website',
  'Google',
  'Facebook',
  'Repeat Client',
  'Walk-up',
  'Other',
];

const initial: IntakeFormState = {};

/** Fast, minimal capture form for a call in progress. Two save paths:
 * "Save & take another" loops back for the next call, "Save & open" jumps to
 * the new lead so the rep can keep working it. */
export function QuickIntakeForm() {
  const [state, formAction] = useFormState(quickIntake, initial);

  return (
    <form action={formAction} className="space-y-5">
      <FormNotice error={state.error} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Who’s calling?" htmlFor="clientName" required className="sm:col-span-2">
          <Input id="clientName" name="clientName" placeholder="Name" required autoFocus />
        </Field>
        <Field label="Phone" htmlFor="phone">
          <Input id="phone" name="phone" type="tel" placeholder="(410) 555-1234" />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" />
        </Field>
        <Field label="Property address" htmlFor="propertyAddress" className="sm:col-span-2">
          <Input id="propertyAddress" name="propertyAddress" placeholder="Street, city" />
        </Field>
        <Field label="Project type" htmlFor="projectType">
          <Select id="projectType" name="projectType" defaultValue="">
            <option value="">Select…</option>
            {PROJECT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Lead source" htmlFor="leadSource">
          <Select id="leadSource" name="leadSource" defaultValue="Phone Call">
            {LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Priority" htmlFor="priority">
          <Select id="priority" name="priority" defaultValue="medium">
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Follow up on" htmlFor="nextFollowUpDate">
          <Input id="nextFollowUpDate" name="nextFollowUpDate" type="date" />
        </Field>
        <Field label="What do they need?" htmlFor="description" className="sm:col-span-2">
          <Textarea
            id="description"
            name="description"
            rows={3}
            placeholder="Quick notes from the call…"
          />
        </Field>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <SubmitButton name="next" value="another" pendingLabel="Saving…" className="sm:w-auto">
          Save &amp; take another
        </SubmitButton>
        <SubmitButton
          name="next"
          value="open"
          variant="outline"
          pendingLabel="Saving…"
          className="sm:w-auto"
        >
          Save &amp; open lead
        </SubmitButton>
        <Link href="/leads" className={buttonVariants({ variant: 'outline' })}>
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
