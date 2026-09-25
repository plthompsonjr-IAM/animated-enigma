import { describe, it, expect } from 'vitest';
import {
  normalizePhone,
  formatPhone,
  normalizeName,
  findDuplicates,
  formatAddress,
  sortClients,
  type DuplicateCandidate,
  type SortableClient,
} from './clients-core';

describe('normalizePhone', () => {
  it('strips formatting to digits', () => {
    expect(normalizePhone('(410) 555-1234')).toBe('4105551234');
    expect(normalizePhone('410.555.1234')).toBe('4105551234');
  });
  it('drops a leading US country code', () => {
    expect(normalizePhone('1-410-555-1234')).toBe('4105551234');
    expect(normalizePhone('+1 410 555 1234')).toBe('4105551234');
  });
  it('handles empty input', () => {
    expect(normalizePhone(null)).toBe('');
    expect(normalizePhone('')).toBe('');
  });
});

describe('formatPhone', () => {
  it('formats a US 10-digit number', () => {
    expect(formatPhone('4105551234')).toBe('(410) 555-1234');
    expect(formatPhone('1-410-555-1234')).toBe('(410) 555-1234');
  });
  it('passes through non-standard numbers unchanged', () => {
    expect(formatPhone('011 44 20 7946 0958')).toBe('011 44 20 7946 0958');
  });
});

describe('normalizeName', () => {
  it('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normalizeName("  Jane   O'Brien ")).toBe('jane obrien');
    expect(normalizeName('JANE OBRIEN')).toBe('jane obrien');
  });
});

describe('findDuplicates', () => {
  const existing: DuplicateCandidate[] = [
    {
      id: 'a',
      displayName: 'Jane Dorsey',
      primaryPhone: '(410) 555-1234',
      primaryEmail: 'jane@example.com',
    },
    { id: 'b', displayName: 'Bob Karl', primaryPhone: null, primaryEmail: 'bob@example.com' },
    {
      id: 'c',
      displayName: 'Acme Property Group',
      primaryPhone: '443-555-9999',
      primaryEmail: null,
    },
  ];

  it('matches phone across different formatting', () => {
    const hits = findDuplicates(existing, { phone: '1 (410) 555 1234' });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ id: 'a', reasons: ['phone'] });
  });

  it('matches email case-insensitively', () => {
    const hits = findDuplicates(existing, { email: 'BOB@Example.COM' });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.id).toBe('b');
  });

  it('matches name ignoring case and punctuation', () => {
    const hits = findDuplicates(existing, { displayName: 'jane dorsey' });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.reasons).toEqual(['name']);
  });

  it('collects multiple reasons on one record', () => {
    const hits = findDuplicates(existing, {
      displayName: 'Jane Dorsey',
      phone: '4105551234',
      email: 'jane@example.com',
    });
    expect(hits[0]?.reasons).toEqual(['phone', 'email', 'name']);
  });

  it('ranks strong signals (phone/email) above name-only matches', () => {
    const hits = findDuplicates(existing, {
      displayName: 'Acme Property Group',
      email: 'bob@example.com',
    });
    expect(hits.map((h) => h.id)).toEqual(['b', 'c']);
  });

  it('returns nothing when nothing matches', () => {
    expect(findDuplicates(existing, { displayName: 'Zed', phone: '999', email: 'z@z.io' })).toEqual(
      [],
    );
  });

  it('ignores empty input fields', () => {
    expect(findDuplicates(existing, {})).toEqual([]);
  });
});

describe('formatAddress', () => {
  it('joins the parts that exist', () => {
    expect(
      formatAddress({ line1: '123 Main St', city: 'Edgewood', state: 'MD', zip: '21040' }),
    ).toBe('123 Main St, Edgewood, MD 21040');
  });
  it('includes line2 when present', () => {
    expect(formatAddress({ line1: '123 Main St', line2: 'Unit 2', city: 'Edgewood' })).toBe(
      '123 Main St, Unit 2, Edgewood',
    );
  });
  it('handles null/invalid values', () => {
    expect(formatAddress(null)).toBe('');
    expect(formatAddress('string')).toBe('');
    expect(formatAddress({})).toBe('');
  });
});

describe('sortClients', () => {
  const rows: SortableClient[] = [
    { displayName: 'Charlie', createdAt: '2026-07-10' },
    { displayName: 'Alpha', createdAt: '2026-07-15' },
    { displayName: 'Bravo', createdAt: '2026-07-12' },
  ];

  it('name = alphabetical', () => {
    expect(sortClients(rows, 'name').map((r) => r.displayName)).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
    ]);
  });
  it('recent = newest createdAt first', () => {
    expect(sortClients(rows, 'recent').map((r) => r.displayName)).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
    ]);
  });
  it('oldest = earliest createdAt first', () => {
    expect(sortClients(rows, 'oldest').map((r) => r.displayName)).toEqual([
      'Charlie',
      'Bravo',
      'Alpha',
    ]);
  });
  it('does not mutate the input array', () => {
    const before = rows.map((r) => r.displayName);
    sortClients(rows, 'name');
    expect(rows.map((r) => r.displayName)).toEqual(before);
  });
});
