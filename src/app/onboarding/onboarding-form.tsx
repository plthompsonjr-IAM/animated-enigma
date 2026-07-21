'use client';

import { useFormState } from 'react-dom';
import { createOrganization } from '@/lib/auth/org-actions';
import type { FormState } from '@/lib/auth/actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SubmitButton, FormNotice } from '@/components/forms/form-bits';

const initialState: FormState = {};

export function OnboardingForm() {
  const [state, formAction] = useFormState(createOrganization, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <FormNotice error={state.error} />
      <div className="space-y-1.5">
        <Label htmlFor="name">Company name</Label>
        <Input id="name" name="name" placeholder="PT's Tactical Renovations" required />
        <p className="text-xs text-muted-foreground">
          You’ll be the administrator. You can invite your team right after.
        </p>
      </div>
      <SubmitButton pendingLabel="Creating…">Create organization</SubmitButton>
    </form>
  );
}
