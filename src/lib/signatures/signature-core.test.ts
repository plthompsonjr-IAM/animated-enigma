import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SIGNATURE_DISCLOSURE,
  SIGNABLE_TYPES,
  buildSignatureRecord,
  clientIpFromForwardedFor,
  formatSignedAt,
  isValidSignerName,
  normalizeSignerName,
  resolveDisclosure,
  truncateUserAgent,
} from './signature-core';

describe('signable catalog', () => {
  it('covers proposals, change orders, and contracts', () => {
    expect(SIGNABLE_TYPES).toEqual(['proposal_version', 'change_order', 'contract']);
  });
});

describe('resolveDisclosure', () => {
  it('falls back to the default when unset or blank', () => {
    expect(resolveDisclosure(null)).toBe(DEFAULT_SIGNATURE_DISCLOSURE);
    expect(resolveDisclosure('   ')).toBe(DEFAULT_SIGNATURE_DISCLOSURE);
    expect(resolveDisclosure(undefined)).toBe(DEFAULT_SIGNATURE_DISCLOSURE);
  });
  it("uses the org's configured text when present, trimming surrounding space", () => {
    expect(resolveDisclosure('  Ohio-specific terms.  ')).toBe('Ohio-specific terms.');
  });
});

describe('normalizeSignerName', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeSignerName('  Jane   Dorsey ')).toBe('Jane Dorsey');
    expect(normalizeSignerName('Jane\t\nDorsey')).toBe('Jane Dorsey');
  });
});

describe('isValidSignerName', () => {
  it('accepts real names, including non-ASCII', () => {
    expect(isValidSignerName('Jane Dorsey')).toBe(true);
    expect(isValidSignerName('Jo')).toBe(true);
    expect(isValidSignerName('José Ramírez')).toBe(true);
  });
  it('rejects blanks, single characters, and letterless input', () => {
    expect(isValidSignerName('   ')).toBe(false);
    expect(isValidSignerName('J')).toBe(false);
    expect(isValidSignerName('--')).toBe(false);
    expect(isValidSignerName('12345')).toBe(false);
  });
  it('rejects absurdly long input', () => {
    expect(isValidSignerName('a'.repeat(201))).toBe(false);
  });
});

describe('clientIpFromForwardedFor', () => {
  it('takes the left-most (original client) address', () => {
    expect(clientIpFromForwardedFor('203.0.113.5, 70.41.3.18, 150.172.238.178')).toBe(
      '203.0.113.5',
    );
    expect(clientIpFromForwardedFor('203.0.113.5')).toBe('203.0.113.5');
  });
  it('never invents an address', () => {
    expect(clientIpFromForwardedFor(null)).toBeNull();
    expect(clientIpFromForwardedFor('')).toBeNull();
    expect(clientIpFromForwardedFor('  ')).toBeNull();
  });
});

describe('truncateUserAgent', () => {
  it('caps length and normalizes empties to null', () => {
    expect(truncateUserAgent('Mozilla/5.0')).toBe('Mozilla/5.0');
    expect(truncateUserAgent('')).toBeNull();
    expect(truncateUserAgent(null)).toBeNull();
    expect(truncateUserAgent('x'.repeat(500))).toHaveLength(400);
  });
});

describe('buildSignatureRecord', () => {
  const base = {
    organizationId: '0000000a-0000-4000-8000-000000000001',
    signableType: 'proposal_version' as const,
    signableId: '00210aaa-0000-4000-8000-000000000001',
    signerName: '  Jane   Dorsey ',
  };

  it('normalizes the name and captures the resolved disclosure', () => {
    const record = buildSignatureRecord({ ...base, disclosure: null });
    expect(record.signerName).toBe('Jane Dorsey');
    expect(record.disclosureText).toBe(DEFAULT_SIGNATURE_DISCLOSURE);
    expect(record.signableType).toBe('proposal_version');
  });

  it("copies the org's disclosure verbatim so we can prove what was agreed to", () => {
    const record = buildSignatureRecord({ ...base, disclosure: 'Custom Ohio disclosure.' });
    expect(record.disclosureText).toBe('Custom Ohio disclosure.');
  });

  it('lower-cases the email and treats blank as absent', () => {
    expect(buildSignatureRecord({ ...base, signerEmail: '  Jane@Example.COM ' }).signerEmail).toBe(
      'jane@example.com',
    );
    expect(buildSignatureRecord({ ...base, signerEmail: '' }).signerEmail).toBeNull();
    expect(buildSignatureRecord({ ...base }).signerEmail).toBeNull();
  });

  it('carries audit metadata through, defaulting to null', () => {
    const record = buildSignatureRecord({
      ...base,
      ipAddress: '203.0.113.5',
      userAgent: 'Mozilla/5.0',
    });
    expect(record.ipAddress).toBe('203.0.113.5');
    expect(record.userAgent).toBe('Mozilla/5.0');
    expect(buildSignatureRecord(base).ipAddress).toBeNull();
    expect(buildSignatureRecord(base).userAgent).toBeNull();
  });

  it('refuses to build a record for an invalid signature', () => {
    expect(() => buildSignatureRecord({ ...base, signerName: '  ' })).toThrow(
      /invalid signer name/,
    );
    expect(() => buildSignatureRecord({ ...base, signerName: '123' })).toThrow(
      /invalid signer name/,
    );
  });
});

describe('formatSignedAt', () => {
  it('renders a date and returns empty for missing/invalid input', () => {
    expect(formatSignedAt('2026-07-24T15:30:00Z')).toContain('2026');
    expect(formatSignedAt(null)).toBe('');
    expect(formatSignedAt(undefined)).toBe('');
    expect(formatSignedAt('not-a-date')).toBe('');
  });
});
