'use client';

import { useFormState } from 'react-dom';
import { Mail } from 'lucide-react';
import { sendDocumentEmail } from '@/lib/email/actions';
import type { EmailKind } from '@/lib/email/email-core';
import type { LastEmail } from '@/lib/email/queries';
import { Button } from '@/components/ui/button';

/**
 * One tap to email a document to its client, with the honest states around it.
 *
 * The button is the human-approval gate the PRD asks for, in its simplest
 * form: a person looks at the recipient, decides, and presses. When there is no
 * address on file the button doesn't pretend — it says where to add one. The
 * copy-link control always sits beside this one, so nothing is ever stuck.
 */
export function EmailToClient({
  kind,
  id,
  recipient,
  lastSent,
  disabledReason,
}: {
  kind: Exclude<EmailKind, 'invitation'>;
  id: string;
  /** The address it will go to, or null when the client record has none. */
  recipient: { name: string; email: string | null } | null;
  lastSent?: LastEmail | null;
  /** Why sending isn't possible right now (e.g. not yet marked sent). Renders instead of the button. */
  disabledReason?: string | null;
}) {
  const [state, action] = useFormState(sendDocumentEmail, {});
  const canSend = Boolean(recipient?.email) && !disabledReason;

  return (
    <div className="space-y-2">
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="id" value={id} />
        <Button type="submit" size="sm" disabled={!canSend}>
          <Mail className="h-4 w-4" />
          Email to client
        </Button>
        <span className="text-xs text-muted-foreground">
          {disabledReason
            ? disabledReason
            : recipient?.email
              ? `to ${recipient.email}`
              : recipient
                ? `${recipient.name} has no email on file — add one on the client record.`
                : 'No client on this document.'}
        </span>
      </form>

      {state.message ? (
        <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm">
          {state.message}
        </p>
      ) : null}
      {state.error ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          {state.error}
        </p>
      ) : null}

      {lastSent && !state.message ? (
        <p className="text-xs text-muted-foreground">
          Last emailed{' '}
          {new Date(lastSent.sentAt).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })}{' '}
          to {lastSent.to.join(', ')}.
        </p>
      ) : null}
    </div>
  );
}
