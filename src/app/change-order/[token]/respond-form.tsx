'use client';

import { useFormState } from 'react-dom';
import { ThumbsUp, ThumbsDown, CheckCircle2, XCircle } from 'lucide-react';
import { respondToChangeOrder } from '@/lib/change-orders/actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SubmitButton, FormNotice } from '@/components/forms/form-bits';

const initial = {} as { error?: string; message?: string };

/**
 * Client approve/decline for a change order, with e-signature on approval —
 * the same treatment proposals get. Each submit button carries the decision via
 * name/value so the choice travels with the form data.
 */
export function ChangeOrderRespondForm({
  token,
  orgName,
  disclosure,
}: {
  token: string;
  orgName: string;
  disclosure: string;
}) {
  const [state, formAction] = useFormState(respondToChangeOrder, initial);

  if (state.message === 'approved') {
    return (
      <Outcome
        icon={CheckCircle2}
        tone="text-emerald-600"
        title="Change order approved"
        body={`Thank you. ${orgName} has been notified and will proceed with the change.`}
      />
    );
  }
  if (state.message === 'declined') {
    return (
      <Outcome
        icon={XCircle}
        tone="text-muted-foreground"
        title="Change order declined"
        body={`${orgName} will follow up with you about next steps.`}
      />
    );
  }

  return (
    <form action={formAction} className="space-y-4 rounded-lg border bg-card p-5">
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

      <FormNotice error={state.error} />

      <SubmitButton className="w-full" pendingLabel="Signing…" name="decision" value="approve">
        <ThumbsUp className="h-4 w-4" />
        Approve &amp; sign
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
        Approving adjusts your contract price and schedule as shown above.
      </p>
    </form>
  );
}

function Outcome({
  icon: Icon,
  tone,
  title,
  body,
}: {
  icon: typeof CheckCircle2;
  tone: string;
  title: string;
  body: string;
}) {
  return (
    <div className="space-y-2 rounded-lg border bg-card p-6 text-center">
      <Icon className={`mx-auto h-8 w-8 ${tone}`} />
      <h2 className="text-lg font-bold">{title}</h2>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
