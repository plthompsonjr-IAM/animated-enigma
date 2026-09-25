'use client';

import { useActionState } from 'react';
import { acceptInvitation } from '@/lib/auth/org-actions';
import type { FormState } from '@/lib/auth/actions';
import { SubmitButton, FormNotice } from '@/components/forms/form-bits';

const initialState: FormState = {};

export function AcceptInviteForm({ token }: { token: string }) {
  const [state, formAction] = useActionState(acceptInvitation, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <FormNotice error={state.error} />
      <input type="hidden" name="token" value={token} />
      <SubmitButton pendingLabel="Joining…">Accept invitation</SubmitButton>
    </form>
  );
}
