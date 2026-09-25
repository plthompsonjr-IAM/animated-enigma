'use client';

import { useFormState } from 'react-dom';
import { useMemo } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { submitPublicIntake, type IntakeFormState } from '@/lib/intake/actions';
import { TIMELINE_OPTIONS, BUDGET_RANGES, HEARD_ABOUT_OPTIONS } from '@/lib/intake/intake-core';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
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
  'Something else',
];

const initial: IntakeFormState = {};

export function PublicIntakeForm({ orgSlug, orgName }: { orgSlug: string; orgName: string }) {
  const [state, formAction] = useFormState(submitPublicIntake, initial);
  // Stable render timestamp for the too-fast-submit spam check.
  const startedAt = useMemo(() => Date.now().toString(), []);

  if (state.ok) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <CheckCircle2 className="h-7 w-7" />
        </div>
        <div>
          <h2 className="text-xl font-bold">Thanks — we’ve got it.</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Someone from {orgName} will reach out shortly to talk through your project. If it’s
            urgent, give us a call.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      <FormNotice error={state.error} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="startedAt" value={startedAt} />

      {/* Honeypot: visually hidden, off-screen, not tab-reachable. Bots fill it. */}
      <div
        aria-hidden="true"
        className="absolute left-[-9999px] top-[-9999px] h-0 w-0 overflow-hidden"
      >
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="space-y-4">
        <Field label="Your name" htmlFor="name" required>
          <Input id="name" name="name" placeholder="First and last name" required />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone" htmlFor="phone">
            <Input id="phone" name="phone" type="tel" placeholder="(410) 555-1234" />
          </Field>
          <Field label="Email" htmlFor="email">
            <Input id="email" name="email" type="email" placeholder="you@email.com" />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">
          Add at least a phone number or email so we can reach you.
        </p>

        <Field label="Property address" htmlFor="address">
          <Input id="address" name="address" placeholder="Where is the work? Street, city" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="What can we help with?" htmlFor="projectType">
            <Select id="projectType" name="projectType" defaultValue="">
              <option value="">Select a project type…</option>
              {PROJECT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="When do you want it done?" htmlFor="timeline">
            <Select id="timeline" name="timeline" defaultValue="">
              <option value="">Select…</option>
              {TIMELINE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Rough budget" htmlFor="budgetRange">
            <Select id="budgetRange" name="budgetRange" defaultValue="">
              <option value="">Select…</option>
              {BUDGET_RANGES.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="How did you hear about us?" htmlFor="heardAbout">
            <Select id="heardAbout" name="heardAbout" defaultValue="">
              <option value="">Select…</option>
              {HEARD_ABOUT_OPTIONS.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Tell us about the project" htmlFor="description">
          <Textarea
            id="description"
            name="description"
            rows={4}
            placeholder="What are you looking to get done? The more detail, the better we can help."
          />
        </Field>
      </div>

      <SubmitButton pendingLabel="Sending…">Request my estimate</SubmitButton>
      <p className="text-center text-xs text-muted-foreground">
        We’ll only use your info to contact you about your project.
      </p>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor} className="mb-1.5 block">
        {label}
        {required ? <span className="text-primary"> *</span> : null}
      </Label>
      {children}
    </div>
  );
}
