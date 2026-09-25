import Link from 'next/link';
import { Receipt } from 'lucide-react';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { listInvoices } from '@/lib/invoices/queries';
import {
  INVOICE_TYPE_LABELS,
  displayInvoiceStatus,
  formatMoney,
  summarizeReceivables,
} from '@/lib/invoices/invoices-core';
import { Card, CardContent } from '@/components/ui/card';
import { InvoiceStatusBadge } from '@/components/invoices/invoice-status-badge';

export const metadata = { title: 'Invoices' };

export default async function InvoicesPage() {
  const ctx = await getAuthContext();
  if (!ctx.configured || !ctx.dbAvailable || !ctx.activeOrg) return <NotReady />;

  const { activeOrg } = ctx;
  if (!can(activeOrg.roles, 'financials:read', activeOrg.extraPermissions)) {
    return (
      <Empty title="Invoices">
        You don’t have permission to view invoices. Ask an administrator.
      </Empty>
    );
  }

  const invoices = await listInvoices(activeOrg.organizationId);
  const summary = summarizeReceivables(
    invoices.map((i) => ({
      status: i.status,
      total: i.total,
      amountPaid: i.amountPaid,
      dueDate: i.dueDate,
    })),
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Invoices</h1>
        <p className="text-sm text-muted-foreground">
          What you’ve billed, what’s been paid, and what’s still owed.
        </p>
      </div>

      {invoices.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Invoiced" value={formatMoney(summary.invoiced)} />
          <Stat label="Paid" value={formatMoney(summary.paid)} />
          <Stat label="Outstanding" value={formatMoney(summary.outstanding)} />
          <Stat
            label="Overdue"
            value={formatMoney(summary.overdue)}
            tone={summary.overdue > 0 ? 'text-destructive' : undefined}
          />
        </div>
      ) : null}

      {invoices.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Receipt className="h-6 w-6" />
            </div>
            <div className="max-w-sm">
              <p className="font-medium">No invoices yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Bill a contract milestone or an approved change order to raise your first invoice.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <ul className="space-y-2 md:hidden">
            {invoices.map((invoice) => {
              const display = displayInvoiceStatus(invoice.status, {
                total: invoice.total,
                amountPaid: invoice.amountPaid,
                dueDate: invoice.dueDate,
              });
              return (
                <li key={invoice.id}>
                  <Link
                    href={`/invoices/${invoice.id}`}
                    className="block rounded-lg border bg-card p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{invoice.clientName ?? 'Client'}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {invoice.invoiceNumber} · {invoice.projectName ?? 'Project'}
                        </div>
                      </div>
                      <InvoiceStatusBadge status={display} />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-sm">
                      <span className="font-medium tabular-nums">{formatMoney(invoice.total)}</span>
                      <span className="text-xs text-muted-foreground">
                        {Number(invoice.balance) > 0
                          ? `${formatMoney(invoice.balance)} due`
                          : 'Settled'}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="hidden overflow-hidden rounded-lg border md:block">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Invoice</th>
                  <th className="px-4 py-2.5 font-semibold">Client</th>
                  <th className="px-4 py-2.5 font-semibold">Type</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Total</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {invoices.map((invoice) => {
                  const display = displayInvoiceStatus(invoice.status, {
                    total: invoice.total,
                    amountPaid: invoice.amountPaid,
                    dueDate: invoice.dueDate,
                  });
                  return (
                    <tr key={invoice.id} className="hover:bg-accent/40">
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/invoices/${invoice.id}`}
                          className="font-medium hover:underline"
                        >
                          {invoice.invoiceNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {invoice.clientName ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {INVOICE_TYPE_LABELS[invoice.invoiceType]}
                      </td>
                      <td className="px-4 py-2.5">
                        <InvoiceStatusBadge status={display} />
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                        {formatMoney(invoice.total)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {formatMoney(invoice.balance)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`mt-0.5 text-lg font-bold tabular-nums ${tone ?? ''}`}>{value}</div>
    </div>
  );
}

function NotReady() {
  return (
    <Empty title="Invoices">
      Invoicing activates once authentication and the database are configured and an organization
      exists.
    </Empty>
  );
}

function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
