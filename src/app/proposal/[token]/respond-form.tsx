'use client';

import { useFormState } from 'react-dom';
import { CheckCircle2, ThumbsUp, ThumbsDown } from 'lucide-react';
import { respondToProposal } from '@/lib/proposals/actions';
import type { FormState } from '@/lib/auth/actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SubmitButton, FormNotice } from '@/components/forms/form-bits';

const initial: FormState = {};

/** Client accept/decline. Each submit button carries the decision via name/value. */
export function RespondForm({ token, orgName }: { token: string; orgName: string }) {
  const [state, formAction] = useFormState(respondToProposal, initial);

  if (state.message) {
    const accepted = state.message === 'accepted';
    return (
      <div className="space-y-3 rounded-lg border bg-card p-6 text-center">
        <div
          className={
            accepted
              ? 'mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600'
              : 'mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-secondary text-muted-foreground'
          }
        >
          <CheckCircle2 className="h-7 w-7" />
        </div>
        <h2 className="text-xl font-bold">
          {accepted ? 'Thank you — proposal accepted!' : 'Response recorded'}
        </h2>
        <p className="text-sm text-muted-foreground">
          {accepted
            ? `${orgName} has been notified and will be in touch about next steps.`
            : `Thanks for letting us know. ${orgName} will follow up with you.`}
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4 rounded-lg border bg-card p-6">
      <FormNotice error={state.error} />
      <input type="hidden" name="token" value={token} />

      <div>
        <Label htmlFor="signerName" className="mb-1.5 block">
          Your name
        </Label>
        <Input id="signerName" name="signerName" placeholder="First and last name" required />
      </div>

      <SubmitButton className="w-full" pendingLabel="Submitting…" name="decision" value="accept">
        <ThumbsUp className="h-4 w-4" />
        Accept proposal
      </SubmitButton>

      <SubmitButton
        className="w-full"
        variant="outline"
        pendingLabel="Submitting…"
        name="decision"
        value="decline"
      >
        <ThumbsDown className="h-4 w-4" />
        Decline
      </SubmitButton>

      <p className="text-center text-[11px] text-muted-foreground">
        By accepting you agree to move forward with the scope and price above.
      </p>
    </form>
  );
}
