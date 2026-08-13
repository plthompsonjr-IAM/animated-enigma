'use client';

import { useFormState } from 'react-dom';
import { updatePassword, type FormState } from '@/lib/auth/actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SubmitButton, FormNotice } from '@/components/forms/form-bits';

const initialState: FormState = {};

export function ResetPasswordForm() {
  const [state, formAction] = useFormState(updatePassword, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Choose a new password</h1>
        <p className="text-sm text-muted-foreground">
          You arrived here from a reset link — set the new password for your account.
        </p>
      </div>

      <FormNotice error={state.error} />

      <div className="space-y-1.5">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>

      <SubmitButton pendingLabel="Saving…">Set new password</SubmitButton>
    </form>
  );
}
