/**
 * Email (Task 32): the pure parts of sending a client a link.
 *
 * Three decisions shape this module.
 *
 * **Templates are functions of plain values.** A proposal email takes a number,
 * a price, a link, and an expiry — not a proposal row. So every template can be
 * tested exhaustively, and the action that assembles the values is the only
 * place that knows what a row looks like.
 *
 * **Nothing here decides a document's status.** Emailing a proposal does not
 * mark it sent; that gate already exists, a person clicks it, and this module
 * respects it. The invoice email carries the amount and payment instructions in
 * its body because an invoice has no public link — the print view sits behind
 * login — and inventing one is a different task.
 *
 * **Headers are sanitised, always.** A subject or address containing a line
 * break is how header injection works: an attacker-controlled client name
 * becomes an extra `Bcc:` line. Every value that lands in a header goes through
 * `headerSafe` first, and non-ASCII subjects are RFC 2047 encoded rather than
 * sent raw.
 *
 * Pure. No I/O.
 */

import { formatCalendarDate, formatMoney } from '@/lib/invoices/invoices-core';

// ── Kinds ────────────────────────────────────────────────────────────────────

export const EMAIL_KINDS = ['invitation', 'proposal', 'change_order', 'invoice'] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

export function isEmailKind(value: string): value is EmailKind {
  return (EMAIL_KINDS as readonly string[]).includes(value);
}

export const EMAIL_PROVIDERS = ['gmail', 'resend'] as const;
export type EmailProviderName = (typeof EMAIL_PROVIDERS)[number];

export const PROVIDER_LABELS: Record<EmailProviderName, string> = {
  gmail: 'your Google account',
  resend: 'the company sending address',
};

// ── Message shape ────────────────────────────────────────────────────────────

export interface EmailMessage {
  to: string[];
  subject: string;
  /** Plain text. Deliberately no HTML in this version — it delivers, and it reads. */
  text: string;
  replyTo?: string;
}

export interface Sender {
  email: string;
  name?: string | null;
}

// ── Addresses ────────────────────────────────────────────────────────────────

/**
 * Pragmatic address check: something@something.tld, no whitespace, no line
 * breaks. Not the RFC 5322 grammar — that accepts things no mail server will —
 * but strict enough that a header cannot be smuggled through it.
 */
export function isEmailAddress(value: string): boolean {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (v.length === 0 || v.length > 254) return false;
  if (/[\s<>,;"'\\]/.test(v)) return false;
  return /^[^@]+@[^@]+\.[^@]+$/.test(v);
}

export function normaliseAddress(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * The first problem, phrased for a phone. An empty list is a problem; a bad
 * address is a problem; a duplicate is silently dropped rather than reported,
 * because nobody wants to be told off for pasting the same address twice.
 */
export function validateRecipients(to: readonly string[]): { error?: string; to: string[] } {
  const cleaned: string[] = [];
  for (const raw of to) {
    const v = normaliseAddress(raw ?? '');
    if (!v) continue;
    if (!isEmailAddress(v)) return { error: `"${raw.trim()}" isn't a valid email address.`, to: [] };
    if (!cleaned.includes(v)) cleaned.push(v);
  }
  if (cleaned.length === 0) return { error: 'No email address to send to.', to: [] };
  if (cleaned.length > 10) return { error: 'Send to ten addresses at most.', to: [] };
  return { to: cleaned };
}

// ── Header safety ────────────────────────────────────────────────────────────

/** Strip anything that could start a new header line. */
export function headerSafe(value: string): string {
  return value.replace(/[\r\n\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** RFC 2047 "B" encoding for a header value, applied only when needed. */
export function encodeHeaderValue(value: string): string {
  const safe = headerSafe(value);
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(safe)) return safe;
  return `=?UTF-8?B?${Buffer.from(safe, 'utf8').toString('base64')}?=`;
}

/** `"Display Name" <address>` with the name quoted and quote-safe. */
export function formatMailbox(sender: Sender): string {
  const address = normaliseAddress(sender.email);
  const name = sender.name ? headerSafe(sender.name).replace(/"/g, "'") : '';
  if (!name) return address;
  return `${encodeHeaderValue(`"${name}"`)} <${address}>`;
}

// ── Templates ────────────────────────────────────────────────────────────────

const SIGN_OFF = (orgName: string) => `\n\n— ${orgName}`;

export function inviteEmail(args: {
  orgName: string;
  inviteUrl: string;
  expiresInDays: number;
}): EmailMessage {
  return {
    to: [],
    subject: `You're invited to ${args.orgName} on PT's Tactical Foreman`,
    text:
      `You've been invited to join ${args.orgName}.\n\n` +
      `Accept here: ${args.inviteUrl}\n\n` +
      `This link expires in ${args.expiresInDays} ${args.expiresInDays === 1 ? 'day' : 'days'}.` +
      SIGN_OFF(args.orgName),
  };
}

export function proposalEmail(args: {
  orgName: string;
  clientName: string | null;
  proposalNumber: string;
  projectName: string | null;
  price: number | null;
  link: string;
  /** A calendar day or an instant; formatted in the org's local day. Null when there is no expiry. */
  expiresOn: string | Date | null;
}): EmailMessage {
  const greeting = args.clientName ? `Hi ${args.clientName},` : 'Hello,';
  const what = args.projectName ? `your proposal for ${args.projectName}` : 'your proposal';
  const price = args.price !== null && args.price > 0 ? ` The total is ${formatMoney(args.price)}.` : '';
  const expiry = args.expiresOn
    ? `\n\nThis proposal is valid until ${formatCalendarDate(args.expiresOn)}.`
    : '';
  return {
    to: [],
    subject: `Proposal ${args.proposalNumber} from ${args.orgName}`,
    text:
      `${greeting}\n\n` +
      `Here is ${what} (${args.proposalNumber}).${price}\n\n` +
      `Review it, and accept or decline, here — no login needed:\n${args.link}` +
      expiry +
      `\n\nReply to this email with any questions.` +
      SIGN_OFF(args.orgName),
  };
}

export function changeOrderEmail(args: {
  orgName: string;
  clientName: string | null;
  changeOrderNumber: string;
  projectName: string | null;
  netChange: number;
  scheduleChangeDays: number;
  link: string;
}): EmailMessage {
  const greeting = args.clientName ? `Hi ${args.clientName},` : 'Hello,';
  const where = args.projectName ? ` on ${args.projectName}` : '';
  const money =
    args.netChange > 0
      ? `This adds ${formatMoney(args.netChange)} to the contract.`
      : args.netChange < 0
        ? `This is a credit of ${formatMoney(Math.abs(args.netChange))} against the contract.`
        : 'This does not change the contract amount.';
  const days = args.scheduleChangeDays;
  const schedule =
    days > 0
      ? ` It adds ${days} ${days === 1 ? 'day' : 'days'} to the schedule.`
      : days < 0
        ? ` It takes ${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'} off the schedule.`
        : '';
  return {
    to: [],
    subject: `Change order ${args.changeOrderNumber} needs your approval`,
    text:
      `${greeting}\n\n` +
      `There's a change to the work${where} that needs your approval before we proceed (${args.changeOrderNumber}). ${money}${schedule}\n\n` +
      `Review and approve it here — no login needed:\n${args.link}\n\n` +
      `Nothing on this change starts until you've approved it.` +
      SIGN_OFF(args.orgName),
  };
}

export function invoiceEmail(args: {
  orgName: string;
  clientName: string | null;
  invoiceNumber: string;
  projectName: string | null;
  total: number;
  balance: number;
  /** Calendar day or null. */
  dueDate: string | null;
  paymentInstructions: string | null;
  lines: { description: string; amount: number }[];
}): EmailMessage {
  const greeting = args.clientName ? `Hi ${args.clientName},` : 'Hello,';
  const where = args.projectName ? ` for ${args.projectName}` : '';
  const due = args.dueDate ? ` It's due ${formatCalendarDate(args.dueDate)}.` : '';
  const partial =
    args.balance > 0 && args.balance < args.total
      ? `\n\nBalance remaining: ${formatMoney(args.balance)}.`
      : '';
  const itemised =
    args.lines.length > 0
      ? '\n\n' + args.lines.map((l) => `  ${l.description} — ${formatMoney(l.amount)}`).join('\n')
      : '';
  const pay = args.paymentInstructions
    ? `\n\nHow to pay:\n${args.paymentInstructions}`
    : '';
  return {
    to: [],
    subject: `Invoice ${args.invoiceNumber} from ${args.orgName} — ${formatMoney(args.balance > 0 ? args.balance : args.total)}`,
    text:
      `${greeting}\n\n` +
      `Invoice ${args.invoiceNumber}${where} is attached below. Total: ${formatMoney(args.total)}.${due}` +
      itemised +
      partial +
      pay +
      `\n\nReply to this email with any questions.` +
      SIGN_OFF(args.orgName),
  };
}

// ── Wire format ──────────────────────────────────────────────────────────────

/**
 * The message as Gmail's API wants it: an RFC 2822 document, base64url encoded.
 *
 * Plain text, base64 transfer encoding, 76-column lines — the most conservative
 * shape there is, which is the point: it survives every mail server ever built.
 * Every header value passes through `headerSafe`/`encodeHeaderValue`; the body
 * cannot inject a header because it is base64.
 */
export function toRawMessage(msg: EmailMessage, from: Sender): string {
  const headers: string[] = [
    `From: ${formatMailbox(from)}`,
    `To: ${msg.to.map((a) => normaliseAddress(a)).join(', ')}`,
    `Subject: ${encodeHeaderValue(msg.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ];
  if (msg.replyTo && isEmailAddress(msg.replyTo)) {
    headers.push(`Reply-To: ${normaliseAddress(msg.replyTo)}`);
  }
  const body = Buffer.from(msg.text, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  const raw = headers.join('\r\n') + '\r\n\r\n' + body;
  return Buffer.from(raw, 'utf8').toString('base64url');
}

/** Inverse of `toRawMessage`, for tests and for reading the log. */
export function decodeRawMessage(raw: string): { headers: Record<string, string>; text: string } {
  const doc = Buffer.from(raw, 'base64url').toString('utf8');
  const split = doc.indexOf('\r\n\r\n');
  const head = split === -1 ? doc : doc.slice(0, split);
  const body = split === -1 ? '' : doc.slice(split + 4);
  const headers: Record<string, string> = {};
  for (const line of head.split('\r\n')) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  const text = Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8');
  return { headers, text };
}

// ── Outcome ──────────────────────────────────────────────────────────────────

export type SendResult =
  | { ok: true; provider: EmailProviderName; messageId: string }
  | { ok: false; error: string };

/** What the screen says after a send, in one sentence. */
export function sendOutcomeMessage(result: SendResult, to: readonly string[]): string {
  if (result.ok) {
    return `Sent to ${to.join(', ')} from ${PROVIDER_LABELS[result.provider]}.`;
  }
  return result.error;
}
