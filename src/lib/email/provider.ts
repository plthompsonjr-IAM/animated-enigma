import { serverEnv } from '@/lib/env';
import { hasScope } from '@/lib/google/google-core';
import { accessTokenFor } from '@/lib/google/tokens';
import { isEmailAddress, type EmailMessage, type EmailProviderName, type Sender, type SendResult } from './email-core';
import { GmailProvider } from './gmail';
import { ResendProvider } from './resend';

/**
 * The seam. Everything above this knows only `send(message)`; everything below
 * it knows one vendor. Swapping vendors is configuration, not a rewrite.
 */
export interface EmailProvider {
  readonly name: EmailProviderName;
  readonly from: Sender;
  send(message: EmailMessage): Promise<SendResult>;
}

/**
 * Which provider can send for this person right now, or null.
 *
 * Order is deliberate. A connected Google account wins because mail then leaves
 * from the business's real address, and the reply lands in the inbox the owner
 * actually reads. Resend is the fallback for a deployment with a key but no
 * connection. Null means nothing is configured — and every caller treats null
 * the same way: offer the copy-link path and say why.
 */
export async function resolveProvider(
  organizationId: string,
  userId: string,
  senderName: string | null,
): Promise<EmailProvider | null> {
  const grant = await accessTokenFor(organizationId, userId);
  if (grant && hasScope(grant.scopes, 'https://www.googleapis.com/auth/gmail.send')) {
    return new GmailProvider(grant.accessToken, { email: grant.googleEmail, name: senderName });
  }

  const env = serverEnv();
  const key = env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (key && from && isEmailAddress(from)) {
    return new ResendProvider(key, { email: from, name: senderName });
  }

  return null;
}

/** What to tell someone when `resolveProvider` came back null. */
export const NO_PROVIDER_MESSAGE =
  'Nothing is set up to send email yet. Connect Google in Settings, or copy the link and send it yourself.';
