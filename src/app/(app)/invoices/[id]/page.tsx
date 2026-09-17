import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Lock, Printer, Send, Ban } from 'lucide-react';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { getInvoice } from '@/lib/invoices/queries';
import { setInvoiceStatus } from '@/lib/invoices/actions';
import {
  INVOICE_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  balanceOf,
  displayInvoiceStatus,
  formatCalendarDate,
  formatMoney,
  isEditable,
  lineAmount,
  overpayment,
  type InvoiceLineInput,
  type InvoiceStatus,
  type InvoiceType,
  type PaymentMethod,
} from '@/lib/invoices/invoices-core';
import { toNum } from '@/lib/catalog/catalog-core';
import { lastEmailFor, recipientForClient } from '@/lib/email/queries';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { InvoiceStatusBadge } from '@/components/invoices/invoice-status-badge';
import { EmailToClient } from '@/components/email/email-to-client';
import { InvoiceForm } from './invoice-form';
import { PaymentForm } from './payment-form';

export const metadata = { title: 'Invoice' };

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAuthContext();
  if (ctx.configured && !ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) redirect('/invoices');
  if (!can(ctx.activeOrg.roles, 'financials:read', ctx.activeOrg.extraPermissions)) {
    redirect('/invoices');
  }

  const orgId = ctx.activeOrg.organizationId;
  const mayWrite = can(ctx.activeOrg.roles, 'financials:write', ctx.activeOrg.extraPermissions);

  const row = await getInvoice(orgId, id);
  if (!row) notFound();

  const invoice = row.invoice;
  const stored = invoice.status as InvoiceStatus;
  const total = toNum(invoice.total);
  const amountPaid = toNum(invoice.amountPaid);
  const balance = balanceOf(total, amountPaid);
  const extra = overpayment(total, amountPaid);
  const display = displayInvoiceStatus(stored, {
    total,
    amountPaid,
    dueDate: invoice.dueDate,
  });
  const editable = isEditable(stored);

  // Only an issued invoice is worth emailing: its amounts are locked. A draft's
  // can still change, so the Status card's "Issue invoice" stays the gate.
  const maySend = mayWrite && !editable && stored !== 'void';
  const [recipient, lastSent] = await Promise.all([
    maySend ? recipientForClient(orgId, invoice.clientId) : Promise.resolve(null),
    maySend ? lastEmailFor(orgId, 'invoice', invoice.id) : Promise.resolve(null),
  ]);

  const lines: InvoiceLineInput[] = row.lines.map((l) => ({
    description: l.description,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    taxable: l.taxable,
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link
          href="/invoices"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Invoices
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">{invoice.invoiceNumber}</h1>
          <InvoiceStatusBadge status={display} />
          {!editable ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Lock className="h-3 w-3" />
              Amounts locked
            </span>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {INVOICE_TYPE_LABELS[invoice.invoiceType as InvoiceType]} · {row.clientName ?? 'Client'} ·{' '}
          <Link href={`/projects/${invoice.projectId}`} className="hover:underline">
            {row.projectNumber ? `${row.projectNumber} · ` : ''}
            {row.projectName ?? 'Project'}
          </Link>
        </p>
        <div className="mt-3">
          <Link
            href={`/invoices/${invoice.id}/print`}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            <Printer className="h-4 w-4" />
            Print / PDF
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Amount</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-md border-2 border-primary/30 bg-primary/5 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {balance > 0 ? 'Balance due' : 'Total'}
              </span>
              <span className="text-2xl font-bold tabular-nums">
                {formatMoney(balance > 0 ? balance : total)}
              </span>
            </div>
            {amountPaid > 0 ? (
              <div className="mt-2 space-y-0.5 border-t border-primary/20 pt-2 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <span>Invoice total</span>
                  <span className="tabular-nums">{formatMoney(total)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Paid to date</span>
                  <span className="tabular-nums">{formatMoney(amountPaid)}</span>
                </div>
                {extra > 0 ? (
                  <div className="flex justify-between text-amber-600">
                    <span>Overpaid</span>
                    <span className="tabular-nums">{formatMoney(extra)}</span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {invoice.dueDate ? (
            <p className="text-sm text-muted-foreground">
              Due {formatCalendarDate(invoice.dueDate)}
            </p>
          ) : null}
          {invoice.notes ? <p className="text-sm">{invoice.notes}</p> : null}
        </CardContent>
      </Card>

      {maySend ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Send to client</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Emails the amount, due date, line items and payment instructions. There is no
              client link for an invoice — the email carries everything.
            </p>
            <EmailToClient
              kind="invoice"
              id={invoice.id}
              recipient={recipient ? { name: recipient.name, email: recipient.email } : null}
              lastSent={lastSent}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{editable && mayWrite ? 'Details' : 'Lines'}</CardTitle>
        </CardHeader>
        <CardContent>
          {editable && mayWrite ? (
            <InvoiceForm
              invoiceId={invoice.id}
              initial={{
                lines,
                taxRate: String(toNum(invoice.taxRate)),
                credits: String(toNum(invoice.credits)),
                dueDate: invoice.dueDate ?? '',
                paymentInstructions: invoice.paymentInstructions ?? '',
              }}
            />
          ) : (
            <div className="space-y-3">
              <ul className="divide-y rounded-md border">
                {lines.map((line, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div>
                      <div className="text-sm">{line.description}</div>
                      <div className="text-xs text-muted-foreground">
                        {toNum(line.quantity)} × {formatMoney(line.unitPrice)}
                        {line.taxable === false ? ' · not taxable' : ''}
                      </div>
                    </div>
                    <span className="text-sm font-medium tabular-nums">
                      {formatMoney(lineAmount(line))}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="space-y-1 rounded-md bg-secondary/50 px-3 py-2 text-sm">
                <Row label="Subtotal" value={formatMoney(invoice.subtotal)} />
                {toNum(invoice.taxAmount) > 0 ? (
                  <Row label="Tax" value={formatMoney(invoice.taxAmount)} />
                ) : null}
                {toNum(invoice.credits) > 0 ? (
                  <Row label="Credits" value={`−${formatMoney(invoice.credits)}`} />
                ) : null}
                <div className="flex items-center justify-between border-t pt-1 font-semibold">
                  <span>Total</span>
                  <span className="tabular-nums">{formatMoney(invoice.total)}</span>
                </div>
              </div>
              {invoice.paymentInstructions ? (
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Payment instructions
                  </div>
                  <p className="text-sm">{invoice.paymentInstructions}</p>
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      {!editable ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payments</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {row.applied.length > 0 ? (
              <ul className="divide-y rounded-md border">
                {row.applied.map((payment) => (
                  <li
                    key={payment.allocationId}
                    className="flex items-center justify-between gap-2 px-3 py-2"
                  >
                    <div>
                      <div className="text-sm">
                        {PAYMENT_METHOD_LABELS[payment.method as PaymentMethod]}
                        {payment.referenceNumber ? ` · ${payment.referenceNumber}` : ''}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatCalendarDate(payment.paymentDate)}
                        {payment.isRefund ? ' · refund' : ''}
                      </div>
                    </div>
                    <span className="text-sm font-medium tabular-nums">
                      {formatMoney(payment.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
            )}

            {mayWrite && balance > 0 && stored !== 'void' ? (
              <PaymentForm projectId={invoice.projectId} invoiceId={invoice.id} balance={balance} />
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {mayWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {editable ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Issuing locks the billed amounts. After that, corrections mean voiding this
                  invoice and raising a new one.
                </p>
                <form action={setInvoiceStatus}>
                  <input type="hidden" name="invoiceId" value={invoice.id} />
                  <input type="hidden" name="status" value="sent" />
                  <Button type="submit" size="sm" className="w-auto">
                    <Send className="h-4 w-4" />
                    Issue invoice
                  </Button>
                </form>
              </>
            ) : stored === 'void' ? (
              <p className="text-sm text-muted-foreground">This invoice has been voided.</p>
            ) : amountPaid > 0 ? (
              <p className="text-sm text-muted-foreground">
                This invoice has payments against it, so it can’t be voided. Record a refund to
                reverse it.
              </p>
            ) : (
              <form action={setInvoiceStatus}>
                <input type="hidden" name="invoiceId" value={invoice.id} />
                <input type="hidden" name="status" value="void" />
                <Button type="submit" variant="outline" size="sm" className="w-auto">
                  <Ban className="h-4 w-4" />
                  Void invoice
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      ) : null}

      <div className="pt-1">
        <Link href="/invoices" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          Back to invoices
        </Link>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-muted-foreground">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
