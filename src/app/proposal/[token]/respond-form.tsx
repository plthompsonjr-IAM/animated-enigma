'use client';

import { useFormState } from 'react-dom';
import { CheckCircle2, ThumbsUp, ThumbsDown } from 'lucide-react';
import { respondToProposal } from '@/lib/proposals/actions';
import type { FormState } from '@/lib/auth/actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SubmitButton, FormNotice } from '@/components/forms/form-bits';

const initial: FormState = {};

/**
 * Client accept/decline with e-signature capture (Tasks 17 & 19). Each submit
 * button carries the decision via name/value. Accepting requires the typed name
 * plus explicit consent to sign electronically; the disclosure shown here is the
 * text recorded on the signature.
 */
export function RespondForm({
  token,
  orgName,
  disclosure,
}: {
  token: string;
  orgName: string;
  disclosure: string;
}) {
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
          Your full name <span className="text-muted-foreground">(this is your signature)</span>
        </Label>
        <Input
          id="signerName"
          name="signerName"
          placeholder="First and last name"
          autoComplete="name"
          required
        />
      </div>

      <div>
        <Label htmlFor="signerEmail" className="mb-1.5 block">
          Email <span className="text-muted-foreground">(optional — for your records)</span>
        </Label>
        <Input
          id="signerEmail"
          name="signerEmail"
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
        />
      </div>

      <div className="rounded-md border bg-secondary/40 p-3">
        <label htmlFor="consent" className="flex cursor-pointer items-start gap-2.5">
          <input
            id="consent"
            name="consent"
            type="checkbox"
            value="on"
            className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
          />
          <span className="text-xs leading-relaxed text-muted-foreground">{disclosure}</span>
        </label>
      </div>

      <SubmitButton className="w-full" pendingLabel="Signing…" name="decision" value="accept">
        <ThumbsUp className="h-4 w-4" />
        Accept &amp; sign
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
        Accepting confirms the scope and price above and records your electronic signature.
      </p>
    </form>
  );
}
