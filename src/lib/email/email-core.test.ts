import { describe, it, expect } from 'vitest';
import {
  EMAIL_KINDS,
  isEmailKind,
  isEmailAddress,
  normaliseAddress,
  validateRecipients,
  headerSafe,
  encodeHeaderValue,
  formatMailbox,
  inviteEmail,
  proposalEmail,
  changeOrderEmail,
  invoiceEmail,
  toRawMessage,
  decodeRawMessage,
  sendOutcomeMessage,
} from './email-core';

describe('kinds', () => {
  it('knows the four things that get emailed', () => {
    expect(EMAIL_KINDS).toEqual(['invitation', 'proposal', 'change_order', 'invoice']);
    expect(isEmailKind('proposal')).toBe(true);
    expect(isEmailKind('newsletter')).toBe(false);
  });
});

describe('addresses', () => {
  it('accepts ordinary addresses', () => {
    expect(isEmailAddress('pat@example.com')).toBe(true);
    expect(isEmailAddress('first.last+tag@sub.example.co')).toBe(true);
  });

  it('rejects the shapes that smuggle headers', () => {
    expect(isEmailAddress('pat@example.com\r\nBcc: x@y.z')).toBe(false);
    expect(isEmailAddress('pat <pat@example.com>')).toBe(false);
    expect(isEmailAddress('a@b.c, d@e.f')).toBe(false);
    expect(isEmailAddress('"pat"@example.com')).toBe(false);
  });

  it('rejects the obviously wrong', () => {
    expect(isEmailAddress('')).toBe(false);
    expect(isEmailAddress('pat')).toBe(false);
    expect(isEmailAddress('pat@')).toBe(false);
    expect(isEmailAddress('@example.com')).toBe(false);
    expect(isEmailAddress('pat@example')).toBe(false);
    expect(isEmailAddress('a'.repeat(250) + '@x.io')).toBe(false);
  });

  it('normalises case and whitespace', () => {
    expect(normaliseAddress('  Pat@Example.COM ')).toBe('pat@example.com');
  });
});

describe('validateRecipients', () => {
  it('returns the cleaned list on the happy path', () => {
    expect(validateRecipients(['Pat@Example.com', ' jo@example.com '])).toEqual({
      to: ['pat@example.com', 'jo@example.com'],
    });
  });

  it('names the bad address rather than saying "invalid input"', () => {
    const r = validateRecipients(['pat@example.com', 'not an address']);
    expect(r.error).toBe('"not an address" isn\'t a valid email address.');
    expect(r.to).toEqual([]);
  });

  it('says plainly when there is nobody to send to', () => {
    expect(validateRecipients([]).error).toBe('No email address to send to.');
    expect(validateRecipients(['', '  ']).error).toBe('No email address to send to.');
  });

  it('drops duplicates silently', () => {
    expect(validateRecipients(['a@b.co', 'A@B.CO']).to).toEqual(['a@b.co']);
  });

  it('caps the list', () => {
    const many = Array.from({ length: 11 }, (_, i) => `p${i}@example.com`);
    expect(validateRecipients(many).error).toContain('ten');
  });
});

describe('header safety', () => {
  it('flattens line breaks so a value cannot become a new header', () => {
    expect(headerSafe('Hello\r\nBcc: evil@x.y')).toBe('Hello Bcc: evil@x.y');
    expect(headerSafe('a b')).toBe('a b');
  });

  it('leaves plain ASCII alone', () => {
    expect(encodeHeaderValue('Proposal PRO-2026-0007')).toBe('Proposal PRO-2026-0007');
  });

  it('RFC 2047 encodes anything non-ASCII', () => {
    const v = encodeHeaderValue('Devis — café');
    expect(v.startsWith('=?UTF-8?B?')).toBe(true);
    expect(v.endsWith('?=')).toBe(true);
    expect(Buffer.from(v.slice(10, -2), 'base64').toString('utf8')).toBe('Devis — café');
  });

  it('formats a mailbox with a quoted, quote-safe name', () => {
    expect(formatMailbox({ email: 'Pat@Example.com', name: 'Pat "PT" Thompson' })).toBe(
      '"Pat \'PT\' Thompson" <pat@example.com>',
    );
    expect(formatMailbox({ email: 'pat@example.com' })).toBe('pat@example.com');
    expect(formatMailbox({ email: 'pat@example.com', name: '  ' })).toBe('pat@example.com');
  });
});

describe('templates', () => {
  it('invite carries the link and the expiry', () => {
    const m = inviteEmail({ orgName: 'PTTR', inviteUrl: 'https://x/invite/abc', expiresInDays: 7 });
    expect(m.subject).toBe("You're invited to PTTR on PT's Tactical Foreman");
    expect(m.text).toContain('https://x/invite/abc');
    expect(m.text).toContain('expires in 7 days');
    expect(m.text).toContain('— PTTR');
  });

  it('invite uses the singular for one day', () => {
    expect(inviteEmail({ orgName: 'X', inviteUrl: 'u', expiresInDays: 1 }).text).toContain('in 1 day.');
  });

  it('proposal greets by name, states the price, links, and gives the expiry', () => {
    const m = proposalEmail({
      orgName: 'PTTR',
      clientName: 'Jane Dorsey',
      proposalNumber: 'PRO-2026-0007',
      projectName: 'Hall bath remodel',
      price: 14500,
      link: 'https://x/proposal/tok',
      expiresOn: '2026-10-09',
    });
    expect(m.subject).toBe('Proposal PRO-2026-0007 from PTTR');
    expect(m.text).toContain('Hi Jane Dorsey,');
    expect(m.text).toContain('your proposal for Hall bath remodel (PRO-2026-0007)');
    expect(m.text).toContain('$14,500.00');
    expect(m.text).toContain('https://x/proposal/tok');
    expect(m.text).toContain('valid until');
    expect(m.text).toContain('no login needed');
  });

  it('proposal says nothing about price or expiry when it has neither', () => {
    const m = proposalEmail({
      orgName: 'PTTR',
      clientName: null,
      proposalNumber: 'P-1',
      projectName: null,
      price: null,
      link: 'l',
      expiresOn: null,
    });
    expect(m.text).toContain('Hello,');
    expect(m.text).toContain('Here is your proposal (P-1).');
    expect(m.text).not.toContain('$');
    expect(m.text).not.toContain('valid until');
  });

  it('change order explains money and schedule in plain words', () => {
    const up = changeOrderEmail({
      orgName: 'PTTR',
      clientName: 'Jane',
      changeOrderNumber: 'CO-3',
      projectName: 'Kitchen',
      netChange: 2400,
      scheduleChangeDays: 3,
      link: 'l',
    });
    expect(up.subject).toBe('Change order CO-3 needs your approval');
    expect(up.text).toContain('adds $2,400.00 to the contract');
    expect(up.text).toContain('adds 3 days to the schedule');
    expect(up.text).toContain("Nothing on this change starts until you've approved it.");

    const credit = changeOrderEmail({
      orgName: 'PTTR',
      clientName: null,
      changeOrderNumber: 'CO-4',
      projectName: null,
      netChange: -500,
      scheduleChangeDays: -1,
      link: 'l',
    });
    expect(credit.text).toContain('credit of $500.00');
    expect(credit.text).toContain('takes 1 day off the schedule');

    const flat = changeOrderEmail({
      orgName: 'PTTR',
      clientName: null,
      changeOrderNumber: 'CO-5',
      projectName: null,
      netChange: 0,
      scheduleChangeDays: 0,
      link: 'l',
    });
    expect(flat.text).toContain('does not change the contract amount');
    expect(flat.text).not.toContain('schedule.');
  });

  it('invoice carries the amount, due date, lines, and how to pay — no link needed', () => {
    const m = invoiceEmail({
      orgName: 'PTTR',
      clientName: 'Jane',
      invoiceNumber: 'INV-12',
      projectName: 'Hall bath',
      total: 5350,
      balance: 5350,
      dueDate: '2026-08-24',
      paymentInstructions: 'Check payable to PTTR.',
      lines: [
        { description: 'Deposit — 30%', amount: 4350 },
        { description: 'Tile allowance', amount: 1000 },
      ],
    });
    expect(m.subject).toBe('Invoice INV-12 from PTTR — $5,350.00');
    expect(m.text).toContain("It's due");
    expect(m.text).toContain('Deposit — 30% — $4,350.00');
    expect(m.text).toContain('How to pay:\nCheck payable to PTTR.');
    expect(m.text).not.toContain('Balance remaining');
  });

  it('invoice shows the remaining balance after a part payment, and puts it in the subject', () => {
    const m = invoiceEmail({
      orgName: 'PTTR',
      clientName: null,
      invoiceNumber: 'INV-13',
      projectName: null,
      total: 1000,
      balance: 250,
      dueDate: null,
      paymentInstructions: null,
      lines: [],
    });
    expect(m.subject).toContain('$250.00');
    expect(m.text).toContain('Balance remaining: $250.00');
    expect(m.text).not.toContain("It's due");
    expect(m.text).not.toContain('How to pay');
  });
});

describe('raw message', () => {
  const msg = {
    to: ['Jane@Example.com', 'bob@example.com'],
    subject: 'Proposal — café',
    text: 'Hi Jane,\n\nHere is the link: https://x/proposal/tok\n\n— PTTR',
    replyTo: 'pat@example.com',
  };
  const from = { email: 'pat@example.com', name: "PT's Tactical" };

  it('round-trips through the decoder', () => {
    const raw = toRawMessage(msg, from);
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    const { headers, text } = decodeRawMessage(raw);
    expect(text).toBe(msg.text);
    expect(headers['to']).toBe('jane@example.com, bob@example.com');
    expect(headers['reply-to']).toBe('pat@example.com');
    expect(headers['from']).toContain('<pat@example.com>');
    expect(headers['mime-version']).toBe('1.0');
    expect(headers['content-transfer-encoding']).toBe('base64');
  });

  it('encodes a non-ASCII subject so it survives every relay', () => {
    const { headers } = decodeRawMessage(toRawMessage(msg, from));
    expect(headers['subject']).toMatch(/^=\?UTF-8\?B\?/);
  });

  it('cannot be used to inject a header through the subject', () => {
    const evil = { ...msg, subject: 'Hi\r\nBcc: attacker@evil.test' };
    const { headers } = decodeRawMessage(toRawMessage(evil, from));
    expect(headers['bcc']).toBeUndefined();
    expect(headers['subject']).not.toContain('\r');
  });

  it('cannot be used to inject a header through the sender name', () => {
    const { headers } = decodeRawMessage(
      toRawMessage(msg, { email: 'pat@example.com', name: 'PT\r\nBcc: attacker@evil.test' }),
    );
    expect(headers['bcc']).toBeUndefined();
  });

  it('drops an invalid reply-to rather than emitting a broken header', () => {
    const { headers } = decodeRawMessage(toRawMessage({ ...msg, replyTo: 'nope' }, from));
    expect(headers['reply-to']).toBeUndefined();
  });

  it('wraps the body at 76 columns', () => {
    const long = { ...msg, text: 'x'.repeat(500) };
    const doc = Buffer.from(toRawMessage(long, from), 'base64url').toString('utf8');
    const body = doc.slice(doc.indexOf('\r\n\r\n') + 4);
    for (const line of body.split('\r\n')) expect(line.length).toBeLessThanOrEqual(76);
    expect(decodeRawMessage(toRawMessage(long, from)).text).toBe(long.text);
  });

  it('round-trips unicode in the body', () => {
    const u = { ...msg, text: 'Devis — café ☕ 日本' };
    expect(decodeRawMessage(toRawMessage(u, from)).text).toBe(u.text);
  });
});

describe('sendOutcomeMessage', () => {
  it('says where it went and how', () => {
    expect(sendOutcomeMessage({ ok: true, provider: 'gmail', messageId: 'm1' }, ['a@b.co'])).toBe(
      'Sent to a@b.co from your Google account.',
    );
  });

  it('passes a failure through as-is', () => {
    expect(sendOutcomeMessage({ ok: false, error: 'No email on file.' }, ['a@b.co'])).toBe(
      'No email on file.',
    );
  });
});
