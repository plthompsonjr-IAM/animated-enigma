import { logger } from '@/lib/logger';
import { toRawMessage, type EmailMessage, type Sender, type SendResult } from './email-core';
import type { EmailProvider } from './provider';

const GMAIL_SEND_ENDPOINT = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

/**
 * Sends as the connected account, from its own address, through Gmail's API.
 * The message is handed over as a complete RFC 2822 document so Gmail does no
 * interpretation of its own — what the tests assert is what leaves.
 */
export class GmailProvider implements EmailProvider {
  readonly name = 'gmail' as const;

  constructor(
    private readonly accessToken: string,
    readonly from: Sender,
  ) {}

  async send(message: EmailMessage): Promise<SendResult> {
    let response: Response;
    try {
      response = await fetch(GMAIL_SEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw: toRawMessage(message, this.from) }),
      });
    } catch (error) {
      logger.warn('email: gmail request failed', {
        message: error instanceof Error ? error.message : String(error),
      });
      return { ok: false, error: 'Could not reach Gmail. Try again in a minute, or copy the link.' };
    }

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string; status?: string };
      };
      logger.warn('email: gmail rejected the message', {
        status: response.status,
        reason: body.error?.status ?? body.error?.message,
      });
      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          error: 'Google no longer allows this app to send for you. Reconnect Google in Settings.',
        };
      }
      return { ok: false, error: 'Gmail refused the message. Copy the link and send it yourself.' };
    }

    const json = (await response.json()) as { id?: string };
    return { ok: true, provider: 'gmail', messageId: json.id ?? '' };
  }
}
