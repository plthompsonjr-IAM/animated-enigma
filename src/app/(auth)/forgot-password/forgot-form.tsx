'use client';

import Link from 'next/link';
import { useFormState } from 'react-dom';
import { requestPasswordReset, type FormState } from '@/lib/auth/actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SubmitButton, FormNotice } from '@/components/forms/form-bits';

const initialState: FormState = {};

export function ForgotPasswordForm() {
  const [state, formAction] = useFormState(requestPasswordReset, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Reset your password</h1>
        <p className="text-sm text-muted-foreground">
          Enter your email and we’ll send a reset link.
        </p>
      </div>

      <FormNotice error={state.error} message={state.message} />

      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>

      <SubmitButton pendingLabel="Sending…">Send reset link</SubmitButton>

      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
