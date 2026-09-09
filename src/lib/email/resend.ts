import { logger } from '@/lib/logger';
import { formatMailbox, headerSafe, type EmailMessage, type Sender, type SendResult } from './email-core';
import type { EmailProvider } from './provider';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * The fallback provider. Behaviour-preserving extraction of the one inline
 * Resend call that used to live in `inviteMember` — same endpoint, same shape —
 * now behind the seam so the action no longer knows who carries the mail.
 */
export class ResendProvider implements EmailProvider {
  readonly name = 'resend' as const;

  constructor(
    private readonly apiKey: string,
    readonly from: Sender,
  ) {}

  async send(message: EmailMessage): Promise<SendResult> {
    let response: Response;
    try {
      response = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: formatMailbox(this.from),
          to: message.to,
          subject: headerSafe(message.subject),
          text: message.text,
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        }),
      });
    } catch (error) {
      logger.warn('email: resend request failed', {
        message: error instanceof Error ? error.message : String(error),
      });
      return { ok: false, error: 'Could not reach the email service. Try again, or copy the link.' };
    }

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: string; name?: string };
      logger.warn('email: resend rejected the message', { status: response.status, reason: body.name });
      return { ok: false, error: 'The email service refused the message. Copy the link and send it yourself.' };
    }

    const json = (await response.json()) as { id?: string };
    return { ok: true, provider: 'resend', messageId: json.id ?? '' };
  }
}
