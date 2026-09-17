import { describe, it, expect } from 'vitest';
import {
  formatProposalNumber,
  isExpired,
  isLive,
  isClosed,
  canRespond,
  buildProposalSnapshot,
  snapshotLeaksCost,
  PROPOSAL_STATUSES,
  type ProposalSnapshotInput,
} from './proposal-core';

describe('status model', () => {
  it('has seven statuses', () => {
    expect(PROPOSAL_STATUSES).toHaveLength(7);
  });
  it('live only while sent/viewed; client can respond only then', () => {
    expect(isLive('sent')).toBe(true);
    expect(isLive('viewed')).toBe(true);
    expect(isLive('draft')).toBe(false);
    expect(canRespond('viewed')).toBe(true);
    expect(canRespond('accepted')).toBe(false);
  });
  it('accepted/declined/expired are closed', () => {
    expect(isClosed('accepted')).toBe(true);
    expect(isClosed('declined')).toBe(true);
    expect(isClosed('expired')).toBe(true);
    expect(isClosed('sent')).toBe(false);
  });
});

describe('formatProposalNumber', () => {
  it('zero-pads to four digits', () => {
    expect(formatProposalNumber(2026, 7)).toBe('PROP-2026-0007');
    expect(formatProposalNumber(2026, 1234)).toBe('PROP-2026-1234');
  });
});

describe('isExpired', () => {
  const now = new Date('2026-07-24T12:00:00Z');
  it('is false without a date', () => {
    expect(isExpired(null, now)).toBe(false);
  });
  it('flags past dates', () => {
    expect(isExpired('2026-07-23T12:00:00Z', now)).toBe(true);
  });
  it('is false for future dates', () => {
    expect(isExpired('2026-08-01T12:00:00Z', now)).toBe(false);
  });
});

describe('buildProposalSnapshot', () => {
  const input: ProposalSnapshotInput = {
    org: { name: "PT's Tactical Renovations", tagline: 'Your Home, Our Mission.' },
    client: { name: 'Jane Dorsey' },
    project: {
      number: 'PRJ-2026-0007',
      name: 'Hall bath remodel',
      type: 'Bathroom Remodel',
      address: '123 Main St',
    },
    scope: {
      sections: [{ sectionType: 'included', title: 'Included', items: ['Demo', 'Install vanity'] }],
    },
    price: 14500,
    expiresAt: '2026-08-24T00:00:00Z',
    preparedBy: 'pat@ptt.com',
    preparedAt: '2026-07-24T00:00:00Z',
  };

  it('captures the client-safe fields', () => {
    const snap = buildProposalSnapshot(input);
    expect(snap.org.name).toBe("PT's Tactical Renovations");
    expect(snap.client.name).toBe('Jane Dorsey');
    expect(snap.project.number).toBe('PRJ-2026-0007');
    expect(snap.scope.sections[0]?.items).toEqual(['Demo', 'Install vanity']);
    expect(snap.pricing.total).toBe(14500);
  });

  it('exposes only the price — no cost/margin fields anywhere', () => {
    const snap = buildProposalSnapshot(input);
    expect(snapshotLeaksCost(snap)).toBe(false);
    // The only money in the snapshot is the client total.
    const json = JSON.stringify(snap);
    expect(json).toContain('14500');
  });

  it('rounds the price to cents and tolerates a missing scope', () => {
    const snap = buildProposalSnapshot({ ...input, price: 14500.239, scope: null });
    expect(snap.pricing.total).toBe(14500.24);
    expect(snap.scope.sections).toEqual([]);
  });
});

describe('snapshotLeaksCost', () => {
  it('catches a snapshot that accidentally carries cost/margin', () => {
    expect(snapshotLeaksCost({ pricing: { total: 100, directCost: 60 } })).toBe(true);
    expect(snapshotLeaksCost({ margin: 0.4 })).toBe(true);
    expect(snapshotLeaksCost({ overheadAmount: 10 })).toBe(true);
  });
  it('passes a clean snapshot', () => {
    expect(snapshotLeaksCost({ pricing: { total: 100 }, client: { name: 'x' } })).toBe(false);
  });
});
