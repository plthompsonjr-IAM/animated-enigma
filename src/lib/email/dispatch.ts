import { getDb, schema } from '@/db';
import { logger } from '@/lib/logger';
import { validateRecipients, type EmailKind, type EmailMessage, type SendResult } from './email-core';
import { NO_PROVIDER_MESSAGE, resolveProvider } from './provider';

/**
 * Deliberately NOT a server action. This module has no `'use server'`
 * directive, so nothing here is reachable from a browser. `dispatchEmail`
 * carries no permission check of its own — it trusts that whoever called it
 * already made one — and a function like that must never be an endpoint.
 * Server actions call it; the client never sees it.
 */

export interface DispatchArgs {
  organizationId: string;
  userId: string;
  senderName: string | null;
  kind: EmailKind;
  relatedId: string | null;
  projectId: string | null;
  clientId: string | null;
  message: EmailMessage;
}

/**
 * Resolve a provider, send, and log the attempt — success or failure.
 *
 * Logging both outcomes is the point: "did the client get it" needs an answer
 * either way, and a failure that leaves no trace is indistinguishable from
 * never having tried. The log row never carries the body.
 */
export async function dispatchEmail(args: DispatchArgs): Promise<SendResult> {
  const recipients = validateRecipients(args.message.to);
  if (recipients.error) return { ok: false, error: recipients.error };
  const message = { ...args.message, to: recipients.to };

  const provider = await resolveProvider(args.organizationId, args.userId, args.senderName);
  if (!provider) return { ok: false, error: NO_PROVIDER_MESSAGE };

  const result = await provider.send(message);

  try {
    await getDb()
      .insert(schema.emailLog)
      .values({
        organizationId: args.organizationId,
        projectId: args.projectId,
        clientId: args.clientId,
        sentBy: args.userId,
        kind: args.kind,
        relatedId: args.relatedId,
        provider: provider.name,
        providerMessageId: result.ok ? result.messageId : null,
        fromAddress: provider.from.email,
        toAddresses: message.to,
        subject: message.subject,
        status: result.ok ? 'sent' : 'failed',
        error: result.ok ? null : result.error,
        sentAt: result.ok ? new Date() : null,
      });
  } catch (error) {
    // The send already happened (or already failed); a logging failure must not
    // turn a delivered email into a reported failure. Say so in the log and move on.
    logger.error('email: could not record the attempt', {
      kind: args.kind,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return result;
}
