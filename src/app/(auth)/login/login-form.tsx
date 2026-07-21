'use client';

import Link from 'next/link';
import { useFormState } from 'react-dom';
import { signIn, type FormState } from '@/lib/auth/actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SubmitButton, FormNotice } from '@/components/forms/form-bits';

const initialState: FormState = {};

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction] = useFormState(signIn, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Sign in</h1>
        <p className="text-sm text-muted-foreground">Welcome back — let’s get to work.</p>
      </div>

      <FormNotice error={state.error} />
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <Link href="/forgot-password" className="text-xs text-primary hover:underline">
            Forgot password?
          </Link>
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>

      <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>

      <p className="text-center text-sm text-muted-foreground">
        New here?{' '}
        <Link href="/register" className="text-primary hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}
