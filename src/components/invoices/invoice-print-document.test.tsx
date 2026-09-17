import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { InvoicePrintDocument, type InvoicePrintProps } from './invoice-print-document';

afterEach(cleanup);

const base: InvoicePrintProps = {
  org: { name: "PT's Tactical Renovations", tagline: 'Your Home, Our Mission.' },
  client: { name: 'Jane Dorsey' },
  project: { name: 'Hall bath remodel', number: 'PRJ-2026-0007', address: '123 Main St' },
  invoiceNumber: 'INV-2026-0012',
  invoiceType: 'milestone',
  issuedAt: '2026-07-24T15:00:00Z',
  dueDate: '2026-08-24',
  lines: [
    { description: 'Deposit — 30%', quantity: 1, unitPrice: 4350 },
    { description: 'Tile allowance', quantity: 2, unitPrice: 500 },
  ],
  subtotal: 5350,
  taxAmount: 0,
  credits: 0,
  total: 5350,
  amountPaid: 0,
  balance: 5350,
  paymentInstructions: 'Check payable to PTTR, or Zelle to the number on file.',
  notes: null,
};

describe('InvoicePrintDocument', () => {
  it('renders the branded invoice with its lines and balance', () => {
    render(<InvoicePrintDocument {...base} />);
    expect(screen.getByText("PT's Tactical Renovations")).toBeInTheDocument();
    expect(screen.getByText('INV-2026-0012')).toBeInTheDocument();
    expect(screen.getByText('Jane Dorsey')).toBeInTheDocument();
    expect(screen.getByText('Deposit — 30%')).toBeInTheDocument();
    expect(screen.getByText('$1,000.00')).toBeInTheDocument(); // 2 × $500
    expect(screen.getByText('Balance due')).toBeInTheDocument();
    expect(screen.getByText('Check payable to PTTR, or Zelle to the number on file.'))
      .toBeInTheDocument();
  });

  it('prints the due date as the calendar day it was entered', () => {
    render(<InvoicePrintDocument {...base} />);
    expect(screen.getByText('8/24/2026')).toBeInTheDocument();
  });

  it('says "On receipt" when there is no due date', () => {
    render(<InvoicePrintDocument {...base} dueDate={null} />);
    expect(screen.getByText('On receipt')).toBeInTheDocument();
  });

  it('shows tax, credits, and payments only when they apply', () => {
    const { container } = render(<InvoicePrintDocument {...base} />);
    const clean = () => {
      const clone = container.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('style').forEach((el) => el.remove());
      return clone.textContent ?? '';
    };
    expect(clean()).not.toContain('Tax');
    expect(clean()).not.toContain('Credits');
    expect(clean()).not.toContain('Paid');

    cleanup();
    render(
      <InvoicePrintDocument
        {...base}
        taxAmount={100}
        credits={50}
        total={5400}
        amountPaid={1400}
        balance={4000}
      />,
    );
    expect(screen.getByText('Tax')).toBeInTheDocument();
    expect(screen.getByText('Credits')).toBeInTheDocument();
    expect(screen.getByText('-$50.00')).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.getByText('-$1,400.00')).toBeInTheDocument();
    expect(screen.getByText('$4,000.00')).toBeInTheDocument();
  });

  it('never leaks internal cost or margin language', () => {
    const { container } = render(<InvoicePrintDocument {...base} />);
    const clone = container.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('style').forEach((el) => el.remove());
    const text = (clone.textContent ?? '').toLowerCase();
    for (const forbidden of ['cost', 'margin', 'overhead', 'profit', 'markup']) {
      expect(text).not.toContain(forbidden);
    }
  });
});
