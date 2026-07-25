import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ProposalPrintDocument } from './proposal-print-document';
import type { ProposalSnapshot } from '@/lib/proposals/proposal-core';

afterEach(cleanup);

const snapshot: ProposalSnapshot = {
  org: { name: "PT's Tactical Renovations", tagline: 'Your Home, Our Mission.' },
  client: { name: 'Jane Dorsey' },
  project: {
    number: 'PRJ-2026-0007',
    name: 'Hall bath remodel',
    type: 'Bathroom Remodel',
    address: '123 Main St',
  },
  scope: {
    sections: [
      {
        sectionType: 'included',
        title: 'Included',
        items: ['Demo existing vanity', 'Install tile'],
      },
    ],
  },
  pricing: { total: 14500, expiresAt: '2026-08-24T00:00:00Z' },
  preparedBy: 'pat@ptt.com',
  preparedAt: '2026-07-24T00:00:00Z',
};

describe('ProposalPrintDocument', () => {
  it('renders the branded, client-safe document', () => {
    render(<ProposalPrintDocument snapshot={snapshot} proposalNumber="PROP-2026-0007" />);
    expect(screen.getByText("PT's Tactical Renovations")).toBeInTheDocument();
    expect(screen.getByText('PROP-2026-0007')).toBeInTheDocument();
    expect(screen.getByText('Jane Dorsey')).toBeInTheDocument();
    expect(screen.getByText('Demo existing vanity')).toBeInTheDocument();
    expect(screen.getByText('Install tile')).toBeInTheDocument();
    // The client sees exactly one number: the total.
    expect(screen.getByText('$14,500.00')).toBeInTheDocument();
  });

  it('never leaks internal cost/margin language', () => {
    const { container } = render(
      <ProposalPrintDocument snapshot={snapshot} proposalNumber="PROP-2026-0007" />,
    );
    // Read only the visible document text — the scoped <style> block uses CSS
    // properties like `margin`, which are not client-facing content.
    const clone = container.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('style').forEach((el) => el.remove());
    const text = (clone.textContent ?? '').toLowerCase();
    for (const forbidden of ['cost', 'margin', 'overhead', 'profit', 'markup']) {
      expect(text).not.toContain(forbidden);
    }
  });
});
