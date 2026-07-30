import { describe, it, expect } from 'vitest';
import {
  AGING_BUCKETS,
  INVOICE_STATUSES,
  agingBucket,
  allocatedTotal,
  balanceOf,
  displayInvoiceStatus,
  formatInvoiceNumber,
  invoiceTotals,
  isCollectable,
  isEditable,
  isInvoiceType,
  isPastDue,
  isPaymentMethod,
  lineAmount,
  netPayments,
  overpayment,
  summarizeReceivables,
  unappliedAmount,
  validateAllocations,
  validateInvoice,
  type InvoiceLineInput,
} from './invoices-core';

describe('catalogs', () => {
  it('has the seven documented invoice statuses', () => {
    expect(INVOICE_STATUSES).toHaveLength(7);
  });
  it('guards form input', () => {
    expect(isInvoiceType('deposit')).toBe(true);
    expect(isInvoiceType('nonsense')).toBe(false);
    expect(isPaymentMethod('check')).toBe(true);
    expect(isPaymentMethod('bitcoin')).toBe(false);
  });
  it('only drafts are editable; issued unpaid invoices collect', () => {
    expect(isEditable('draft')).toBe(true);
    expect(isEditable('sent')).toBe(false);
    expect(isCollectable('sent')).toBe(true);
    expect(isCollectable('partially_paid')).toBe(true);
    expect(isCollectable('paid')).toBe(false);
    expect(isCollectable('void')).toBe(false);
    expect(isCollectable('draft')).toBe(false);
  });
});

describe('formatInvoiceNumber', () => {
  it('zero-pads to four digits', () => {
    expect(formatInvoiceNumber(2026, 8)).toBe('INV-2026-0008');
  });
});

describe('lineAmount', () => {
  it('multiplies quantity by unit price', () => {
    expect(lineAmount({ description: 'Tile', quantity: 40, unitPrice: 12.5 })).toBe(500);
  });
  it('defaults a missing quantity to one', () => {
    expect(lineAmount({ description: 'Permit', unitPrice: 250 })).toBe(250);
    expect(lineAmount({ description: 'Permit', quantity: '', unitPrice: 250 })).toBe(250);
  });
  it('rounds to cents', () => {
    expect(lineAmount({ description: 'x', quantity: 3, unitPrice: 33.333 })).toBe(100);
  });
  it('handles string values from the database', () => {
    expect(lineAmount({ description: 'x', quantity: '2', unitPrice: '99.99' })).toBe(199.98);
  });
});

describe('invoiceTotals', () => {
  const lines: InvoiceLineInput[] = [
    { description: 'Labor', quantity: 20, unitPrice: 75, taxable: false },
    { description: 'Tile', quantity: 40, unitPrice: 12.5, taxable: true },
  ];

  it('separates taxable from non-taxable subtotals', () => {
    const totals = invoiceTotals(lines, 0);
    expect(totals.subtotal).toBe(2000);
    expect(totals.taxableSubtotal).toBe(500);
  });

  it('taxes only the taxable portion', () => {
    const totals = invoiceTotals(lines, 6.75);
    expect(totals.taxAmount).toBe(33.75);
    expect(totals.total).toBe(2033.75);
  });

  it('treats lines as taxable unless told otherwise', () => {
    const totals = invoiceTotals([{ description: 'Materials', unitPrice: 100 }], 10);
    expect(totals.taxableSubtotal).toBe(100);
    expect(totals.taxAmount).toBe(10);
  });

  it('subtracts credits and treats them as a magnitude', () => {
    expect(invoiceTotals(lines, 0, 500).total).toBe(1500);
    expect(invoiceTotals(lines, 0, -500).total).toBe(1500);
  });

  it('is empty-safe', () => {
    expect(invoiceTotals([], 6.75).total).toBe(0);
  });
});

describe('balanceOf and overpayment', () => {
  it('computes what is still owed', () => {
    expect(balanceOf(1000, 250)).toBe(750);
    expect(balanceOf('1000.00', '1000.00')).toBe(0);
  });
  it('never reports a negative balance, but does surface an overpayment', () => {
    expect(balanceOf(1000, 1200)).toBe(0);
    expect(overpayment(1000, 1200)).toBe(200);
    expect(overpayment(1000, 900)).toBe(0);
  });
});

describe('validateInvoice', () => {
  const good: InvoiceLineInput[] = [{ description: 'Deposit', unitPrice: 5000 }];

  it('accepts a normal invoice', () => {
    expect(validateInvoice(good, invoiceTotals(good)).ok).toBe(true);
  });
  it('requires lines and descriptions', () => {
    expect(validateInvoice([], invoiceTotals([])).error).toBe('Add at least one line item.');
    const blank: InvoiceLineInput[] = [{ description: '  ', unitPrice: 10 }];
    expect(validateInvoice(blank, invoiceTotals(blank)).error).toBe(
      'Every line needs a description.',
    );
  });
  it('rejects negative lines, pointing at credits instead', () => {
    const negative: InvoiceLineInput[] = [{ description: 'Oops', unitPrice: -50 }];
    expect(validateInvoice(negative, invoiceTotals(negative)).error).toContain('credit');
  });
  it('rejects credits that exceed the invoice', () => {
    expect(validateInvoice(good, invoiceTotals(good, 0, 9000)).error).toContain(
      'Credits cannot exceed',
    );
  });
  it('rejects a zero-total invoice', () => {
    expect(validateInvoice(good, invoiceTotals(good, 0, 5000)).error).toContain('totals zero');
  });
});

describe('isPastDue', () => {
  const now = new Date('2026-07-25T12:00:00Z');
  it('is forgiving through the end of the due day', () => {
    expect(isPastDue('2026-07-25', now)).toBe(false);
    expect(isPastDue('2026-07-24', now)).toBe(true);
    expect(isPastDue('2026-08-01', now)).toBe(false);
  });
  it('has no opinion without a due date', () => {
    expect(isPastDue(null, now)).toBe(false);
    expect(isPastDue(undefined, now)).toBe(false);
    expect(isPastDue('not-a-date', now)).toBe(false);
  });
});

describe('displayInvoiceStatus', () => {
  const now = new Date('2026-07-25T12:00:00Z');

  it('respects draft and void regardless of dates', () => {
    expect(
      displayInvoiceStatus('draft', { total: 100, amountPaid: 0, dueDate: '2020-01-01', now }),
    ).toBe('draft');
    expect(
      displayInvoiceStatus('void', { total: 100, amountPaid: 0, dueDate: '2020-01-01', now }),
    ).toBe('void');
  });

  it('reports paid once the balance is cleared', () => {
    expect(displayInvoiceStatus('sent', { total: 100, amountPaid: 100, now })).toBe('paid');
    expect(displayInvoiceStatus('sent', { total: 100, amountPaid: 120, now })).toBe('paid');
  });

  it('paid beats overdue — a settled invoice is never late', () => {
    expect(
      displayInvoiceStatus('sent', { total: 100, amountPaid: 100, dueDate: '2020-01-01', now }),
    ).toBe('paid');
  });

  it('reports partial payment, or overdue when a partial payment is late', () => {
    expect(displayInvoiceStatus('sent', { total: 100, amountPaid: 40, now })).toBe(
      'partially_paid',
    );
    expect(
      displayInvoiceStatus('sent', { total: 100, amountPaid: 40, dueDate: '2026-07-01', now }),
    ).toBe('overdue');
  });

  it('flags an unpaid invoice past its due date', () => {
    expect(
      displayInvoiceStatus('sent', { total: 100, amountPaid: 0, dueDate: '2026-07-01', now }),
    ).toBe('overdue');
  });

  it('otherwise leaves the stored status alone', () => {
    expect(displayInvoiceStatus('viewed', { total: 100, amountPaid: 0, now })).toBe('viewed');
  });
});

describe('agingBucket', () => {
  const now = new Date('2026-07-25T12:00:00Z');
  it('buckets receivables by how late they are', () => {
    expect(agingBucket('2026-07-25', now)).toBe('current');
    expect(agingBucket(null, now)).toBe('current');
    expect(agingBucket('2026-07-10', now)).toBe('1_30');
    expect(agingBucket('2026-06-10', now)).toBe('31_60');
    expect(agingBucket('2026-05-10', now)).toBe('61_90');
    expect(agingBucket('2026-01-10', now)).toBe('90_plus');
  });
  it('covers every declared bucket', () => {
    expect(AGING_BUCKETS).toHaveLength(5);
  });
});

describe('allocations', () => {
  it('sums and reports the unapplied remainder', () => {
    const allocations = [
      { invoiceId: 'a', amount: 300 },
      { invoiceId: 'b', amount: 200 },
    ];
    expect(allocatedTotal(allocations)).toBe(500);
    expect(unappliedAmount(750, allocations)).toBe(250);
    expect(unappliedAmount(500, allocations)).toBe(0);
  });

  it('accepts a payment split across invoices within its balances', () => {
    const result = validateAllocations(
      500,
      [
        { invoiceId: 'a', amount: 300 },
        { invoiceId: 'b', amount: 200 },
      ],
      { a: 1000, b: 200 },
    );
    expect(result.ok).toBe(true);
  });

  it('refuses to spread a payment further than it goes', () => {
    const result = validateAllocations(500, [{ invoiceId: 'a', amount: 600 }], { a: 1000 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('exceeds the payment');
  });

  it('refuses to overpay a single invoice', () => {
    const result = validateAllocations(500, [{ invoiceId: 'a', amount: 500 }], { a: 200 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("invoice's balance");
  });

  it('requires a positive payment and at least one positive allocation', () => {
    expect(validateAllocations(0, [{ invoiceId: 'a', amount: 10 }]).error).toContain(
      'greater than zero',
    );
    expect(validateAllocations(100, []).error).toContain('at least one invoice');
    expect(validateAllocations(100, [{ invoiceId: 'a', amount: 0 }]).error).toContain(
      'greater than zero',
    );
  });

  it('tolerates sub-cent rounding when fully applying a payment', () => {
    expect(
      validateAllocations(
        100,
        [
          { invoiceId: 'a', amount: 33.33 },
          { invoiceId: 'b', amount: 33.33 },
          { invoiceId: 'c', amount: 33.34 },
        ],
        {},
      ).ok,
    ).toBe(true);
  });
});

describe('netPayments', () => {
  it('nets refunds against receipts', () => {
    expect(netPayments([{ amount: 1000 }, { amount: 250, isRefund: true }, { amount: 100 }])).toBe(
      850,
    );
  });
  it('treats a refund magnitude as negative regardless of sign', () => {
    expect(netPayments([{ amount: -250, isRefund: true }])).toBe(-250);
  });
});

describe('summarizeReceivables', () => {
  const now = new Date('2026-07-25T12:00:00Z');

  it('rolls up invoiced, paid, outstanding, and overdue', () => {
    const summary = summarizeReceivables(
      [
        { status: 'sent', total: 1000, amountPaid: 250, dueDate: '2026-07-01' },
        { status: 'sent', total: 500, amountPaid: 0, dueDate: '2026-08-30' },
        { status: 'paid', total: 2000, amountPaid: 2000, dueDate: '2026-06-01' },
      ],
      now,
    );
    expect(summary.invoiced).toBe(3500);
    expect(summary.paid).toBe(2250);
    expect(summary.outstanding).toBe(1250);
    // Only the late, still-unpaid balance counts as overdue.
    expect(summary.overdue).toBe(750);
  });

  it('excludes drafts and voids — neither is money owed', () => {
    const summary = summarizeReceivables(
      [
        { status: 'draft', total: 9999, amountPaid: 0 },
        { status: 'void', total: 8888, amountPaid: 0 },
        { status: 'sent', total: 100, amountPaid: 0 },
      ],
      now,
    );
    expect(summary.invoiced).toBe(100);
    expect(summary.outstanding).toBe(100);
  });

  it('is empty-safe', () => {
    expect(summarizeReceivables([], now)).toEqual({
      invoiced: 0,
      paid: 0,
      outstanding: 0,
      overdue: 0,
    });
  });
});
