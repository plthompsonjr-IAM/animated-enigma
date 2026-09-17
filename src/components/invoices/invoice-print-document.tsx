import {
  INVOICE_TYPE_LABELS,
  formatCalendarDate,
  formatMoney,
  lineAmount,
  type InvoiceLineInput,
  type InvoiceType,
} from '@/lib/invoices/invoices-core';

export interface InvoicePrintProps {
  org: { name: string; tagline: string | null };
  client: { name: string };
  project: { name: string; number: string | null; address: string | null };
  invoiceNumber: string;
  invoiceType: InvoiceType;
  issuedAt: string | Date | null;
  dueDate: string | null;
  lines: InvoiceLineInput[];
  subtotal: number;
  taxAmount: number;
  credits: number;
  total: number;
  amountPaid: number;
  balance: number;
  paymentInstructions: string | null;
  notes: string | null;
}

/**
 * The printable invoice. Same self-contained, theme-independent approach as the
 * proposal and contract documents so the saved PDF looks identical for everyone.
 */
export function InvoicePrintDocument({
  org,
  client,
  project,
  invoiceNumber,
  invoiceType,
  issuedAt,
  dueDate,
  lines,
  subtotal,
  taxAmount,
  credits,
  total,
  amountPaid,
  balance,
  paymentInstructions,
  notes,
}: InvoicePrintProps) {
  return (
    <div className="ptin">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      <header className="ptin-header">
        <div className="ptin-brand">
          <span className="ptin-mark">PT</span>
          <div>
            <div className="ptin-orgname">{org.name}</div>
            {org.tagline ? <div className="ptin-tagline">{org.tagline}</div> : null}
          </div>
        </div>
        <div className="ptin-doc">
          <div className="ptin-title">Invoice</div>
          <div className="ptin-number">{invoiceNumber}</div>
          <div className="ptin-type">{INVOICE_TYPE_LABELS[invoiceType]}</div>
        </div>
      </header>

      <section className="ptin-meta">
        <div>
          <div className="ptin-field-label">Bill to</div>
          <div className="ptin-field-value">{client.name}</div>
          {project.address ? <div className="ptin-field-sub">{project.address}</div> : null}
        </div>
        <div>
          <div className="ptin-field-label">Project</div>
          <div className="ptin-field-value">
            {project.number ? `${project.number} · ${project.name}` : project.name}
          </div>
        </div>
        <div>
          <div className="ptin-field-label">Issued</div>
          <div className="ptin-field-value">{formatCalendarDate(issuedAt)}</div>
        </div>
        <div>
          <div className="ptin-field-label">Due</div>
          <div className="ptin-field-value">{formatCalendarDate(dueDate, 'On receipt')}</div>
        </div>
      </section>

      <table className="ptin-table">
        <thead>
          <tr>
            <th>Description</th>
            <th className="ptin-right">Qty</th>
            <th className="ptin-right">Unit</th>
            <th className="ptin-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => (
            <tr key={i}>
              <td>{line.description}</td>
              <td className="ptin-right">{Number(line.quantity ?? 1)}</td>
              <td className="ptin-right">{formatMoney(line.unitPrice)}</td>
              <td className="ptin-right">{formatMoney(lineAmount(line))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="ptin-totals">
        <Row label="Subtotal" value={formatMoney(subtotal)} />
        {taxAmount > 0 ? <Row label="Tax" value={formatMoney(taxAmount)} /> : null}
        {credits > 0 ? <Row label="Credits" value={`-${formatMoney(credits)}`} /> : null}
        <Row label="Total" value={formatMoney(total)} strong />
        {amountPaid > 0 ? <Row label="Paid" value={`-${formatMoney(amountPaid)}`} /> : null}
        <div className="ptin-due">
          <span>Balance due</span>
          <strong>{formatMoney(balance)}</strong>
        </div>
      </section>

      {paymentInstructions ? (
        <section className="ptin-block">
          <div className="ptin-field-label">How to pay</div>
          <p className="ptin-p">{paymentInstructions}</p>
        </section>
      ) : null}

      {notes ? (
        <section className="ptin-block">
          <p className="ptin-p ptin-muted">{notes}</p>
        </section>
      ) : null}

      <footer className="ptin-footer">Thank you for your business — {org.name}</footer>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`ptin-total-row${strong ? ' ptin-total-strong' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

const PRINT_CSS = `
.ptin {
  color: hsl(20 14% 10%);
  background: #fff;
  font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  max-width: 720px;
  margin: 0 auto;
  padding: 36px 30px;
  line-height: 1.5;
}
.ptin * { box-sizing: border-box; }
.ptin-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; border-bottom: 2px solid hsl(20 6% 88%); padding-bottom: 14px; margin-bottom: 18px; }
.ptin-brand { display: flex; align-items: center; gap: 10px; }
.ptin-mark { display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; border-radius: 6px; background: hsl(24 94% 50%); color: #fff; font-weight: 800; font-size: 14px; flex: none; }
.ptin-orgname { font-size: 18px; font-weight: 800; }
.ptin-tagline { color: hsl(20 6% 45%); font-size: 11px; }
.ptin-doc { text-align: right; }
.ptin-title { font-size: 20px; font-weight: 800; }
.ptin-number { font-size: 12px; color: hsl(20 6% 45%); letter-spacing: 0.06em; text-transform: uppercase; }
.ptin-type { font-size: 11px; color: hsl(20 6% 45%); }
.ptin-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 18px; }
.ptin-field-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: hsl(20 6% 45%); font-weight: 600; }
.ptin-field-value { font-size: 13px; font-weight: 500; margin-top: 1px; }
.ptin-field-sub { font-size: 12px; color: hsl(20 6% 45%); }
.ptin-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 14px; }
.ptin-table th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: hsl(20 6% 45%); border-bottom: 1px solid hsl(20 6% 80%); padding: 6px 4px; }
.ptin-table td { padding: 7px 4px; border-bottom: 1px solid hsl(20 6% 92%); }
.ptin-right { text-align: right; font-variant-numeric: tabular-nums; }
.ptin-totals { margin-left: auto; width: 260px; font-size: 13px; }
.ptin-total-row { display: flex; justify-content: space-between; padding: 3px 0; color: hsl(20 6% 40%); }
.ptin-total-row span:last-child { font-variant-numeric: tabular-nums; }
.ptin-total-strong { color: hsl(20 14% 10%); font-weight: 700; border-top: 1px solid hsl(20 6% 80%); margin-top: 4px; padding-top: 6px; }
.ptin-due { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; padding: 10px 12px; border: 2px solid hsl(24 94% 50% / 0.35); background: hsl(24 94% 50% / 0.06); border-radius: 6px; font-size: 15px; }
.ptin-due strong { font-variant-numeric: tabular-nums; }
.ptin-block { margin-top: 18px; break-inside: avoid; }
.ptin-p { font-size: 13px; margin: 2px 0 0; }
.ptin-muted { color: hsl(20 6% 45%); }
.ptin-footer { border-top: 1px solid hsl(20 6% 88%); margin-top: 24px; padding-top: 10px; font-size: 11px; color: hsl(20 6% 45%); text-align: center; }

@page { margin: 16mm; }
@media print {
  html, body { background: #fff !important; }
  .ptin { max-width: none; margin: 0; padding: 0; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
}
`;
