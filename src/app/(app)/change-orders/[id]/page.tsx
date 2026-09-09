import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Link2, Lock, Receipt } from 'lucide-react';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { invoiceChangeOrder } from '@/lib/invoices/actions';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { getChangeOrder, signatureForChangeOrder } from '@/lib/change-orders/queries';
import { changeChangeOrderStatus, shareChangeOrder } from '@/lib/change-orders/actions';
import {
  CHANGE_ORDER_STATUS_LABELS,
  allowedTransitions,
  costBreakdown,
  countsTowardContract,
  formatScheduleChange,
  isFrozen,
  isEditable,
  isItemDirection,
  itemDelta,
  type ChangeOrderItemInput,
  type ChangeOrderStatus,
} from '@/lib/change-orders/change-orders-core';
import { formatMoney } from '@/lib/invoices/invoices-core';
import { lastEmailFor, latestChangeOrderToken, recipientForProject } from '@/lib/email/queries';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { ChangeOrderStatusBadge } from '@/components/change-orders/change-order-status-badge';
import { ApprovalRecord } from '@/components/proposals/approval-record';
import { EmailToClient } from '@/components/email/email-to-client';
import { ChangeOrderForm } from './change-order-form';
import { CopyChangeOrderLink } from './copy-link';

export const metadata = { title: 'Change order' };

const INTENT: Record<ChangeOrderStatus, string> = {
  draft: 'Return to draft',
  internal_review: 'Send for internal review',
  sent: 'Send to client',
  viewed: 'Mark viewed',
  approved: 'Record client approval',
  declined: 'Record client decline',
  incorporated: 'Incorporate into contract',
  canceled: 'Cancel',
};

export default async function ChangeOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getAuthContext();
  if (ctx.configured && !ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) redirect('/contracts');
  if (!can(ctx.activeOrg.roles, 'financials:read', ctx.activeOrg.extraPermissions)) {
    redirect('/contracts');
  }

  const orgId = ctx.activeOrg.organizationId;
  const mayWrite = can(ctx.activeOrg.roles, 'financials:write', ctx.activeOrg.extraPermissions);

  const row = await getChangeOrder(orgId, id);
  if (!row) notFound();

  const co = row.changeOrder;
  const status = co.status as ChangeOrderStatus;
  const editable = isEditable(status);
  const items: ChangeOrderItemInput[] = row.items.map((i) => ({
    direction: isItemDirection(i.direction) ? i.direction : 'added',
    description: i.description,
    amount: i.amount,
  }));
  const totals = costBreakdown(items);

  // The share token is surfaced once via the share-event log. "Emailed" events
  // land in the same log with no token, so the lookup is by newest row that
  // actually carries one — not simply the newest row.
  const [signature, shareToken, recipient, lastSent] = await Promise.all([
    signatureForChangeOrder(orgId, co.id),
    latestChangeOrderToken(orgId, co.id),
    mayWrite ? recipientForProject(orgId, co.projectId) : Promise.resolve(null),
    mayWrite ? lastEmailFor(orgId, 'change_order', co.id) : Promise.resolve(null),
  ]);

  // Has this change order already been billed?
  const [invoice] = countsTowardContract(status)
    ? await getDb()
        .select({
          id: schema.invoices.id,
          invoiceNumber: schema.invoices.invoiceNumber,
          total: schema.invoices.total,
          status: schema.invoices.status,
        })
        .from(schema.invoices)
        .where(
          and(eq(schema.invoices.organizationId, orgId), eq(schema.invoices.changeOrderId, co.id)),
        )
    : [];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link
          href={co.contractId ? `/contracts/${co.contractId}` : '/contracts'}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {co.contractId ? 'Contract' : 'Contracts'}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">{co.changeOrderNumber}</h1>
          <ChangeOrderStatusBadge status={status} />
          {!editable ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Lock className="h-3 w-3" />
              Locked
            </span>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {row.clientName ?? 'Client'} ·{' '}
          <Link href={`/projects/${co.projectId}`} className="hover:underline">
            {row.projectNumber ? `${row.projectNumber} · ` : ''}
            {row.projectName ?? 'Project'}
          </Link>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Impact</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between rounded-md border-2 border-primary/30 bg-primary/5 p-4">
            <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Net cost change
            </span>
            <span className="text-2xl font-bold tabular-nums">{formatMoney(totals.net)}</span>
          </div>
          <p className="text-sm text-muted-foreground">
            {formatScheduleChange(co.scheduleChangeDays ?? 0)}
          </p>
          {co.reason ? (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Reason
              </div>
              <p className="text-sm">{co.reason}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {editable && mayWrite ? 'Details' : 'Itemisation'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {editable && mayWrite ? (
            <ChangeOrderForm
              changeOrderId={co.id}
              initial={{
                reason: co.reason ?? '',
                requestedBy: co.requestedBy ?? '',
                clientExplanation: co.clientExplanation ?? '',
                internalNotes: co.internalNotes ?? '',
                scheduleChangeDays: co.scheduleChangeDays ?? 0,
                items,
              }}
            />
          ) : (
            <div className="space-y-3">
              {items.length > 0 ? (
                <ul className="divide-y rounded-md border">
                  {items.map((item, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 px-3 py-2">
                      <div>
                        <div className="text-sm">{item.description}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.direction === 'removed' ? 'Removed work' : 'Added work'}
                        </div>
                      </div>
                      <span
                        className={`text-sm font-medium tabular-nums ${
                          itemDelta(item) < 0 ? 'text-emerald-600' : ''
                        }`}
                      >
                        {formatMoney(itemDelta(item))}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No line items.</p>
              )}
              {co.clientExplanation ? (
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Client explanation
                  </div>
                  <p className="text-sm">{co.clientExplanation}</p>
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      {mayWrite && !isFrozen(status) && !countsTowardContract(status) ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Client approval</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Send the client a secure link to review, approve, and sign this change order — no
              login required. Approving records their signature the same way a proposal does.
            </p>
            {shareToken ? <CopyChangeOrderLink token={shareToken} /> : null}
            <EmailToClient
              kind="change_order"
              id={co.id}
              recipient={recipient ? { name: recipient.name, email: recipient.email } : null}
              lastSent={lastSent}
              disabledReason={shareToken ? null : 'Create the approval link first, then send it.'}
            />
            <form action={shareChangeOrder}>
              <input type="hidden" name="changeOrderId" value={co.id} />
              <Button
                type="submit"
                variant={shareToken ? 'outline' : 'default'}
                size="sm"
                className="w-auto"
              >
                <Link2 className="h-4 w-4" />
                {shareToken ? 'Regenerate link' : 'Create approval link'}
              </Button>
            </form>
            {shareToken ? (
              <p className="text-xs text-muted-foreground">
                Regenerating invalidates the previous link.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {signature ? <ApprovalRecord signature={signature} /> : null}

      {countsTowardContract(status) ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Billing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {invoice ? (
              <p className="text-sm">
                <Link href={`/invoices/${invoice.id}`} className="font-medium hover:underline">
                  {invoice.invoiceNumber}
                </Link>{' '}
                <span className="text-muted-foreground">
                  — {formatMoney(invoice.total)} ({invoice.status}).
                </span>
              </p>
            ) : totals.net > 0 && mayWrite ? (
              <form action={invoiceChangeOrder} className="space-y-2">
                <input type="hidden" name="changeOrderId" value={co.id} />
                <p className="text-sm text-muted-foreground">
                  Bill the client for this approved change. The invoice mirrors the itemisation
                  above, with removed work applied as a credit.
                </p>
                <Button type="submit" size="sm" className="w-auto">
                  <Receipt className="h-4 w-4" />
                  Create invoice
                </Button>
              </form>
            ) : totals.net <= 0 ? (
              <p className="text-sm text-muted-foreground">
                This change order is a credit of {formatMoney(Math.abs(totals.net))} — nothing to
                invoice. Apply it as a credit on the next invoice instead.
              </p>
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
            {status === 'approved' ? (
              <p className="text-sm text-muted-foreground">
                Approved
                {co.approvedAt ? ` on ${new Date(co.approvedAt).toLocaleDateString('en-US')}` : ''}.
                This amount already counts toward the revised contract total. Marking it
                incorporated records that the work has been folded into the job.
              </p>
            ) : null}
            {allowedTransitions(status).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                This change order is {CHANGE_ORDER_STATUS_LABELS[status].toLowerCase()} and has no
                further steps.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {allowedTransitions(status).map((next) => (
                  <form key={next} action={changeChangeOrderStatus}>
                    <input type="hidden" name="changeOrderId" value={co.id} />
                    <input type="hidden" name="status" value={next} />
                    <Button
                      type="submit"
                      size="sm"
                      variant={next === 'canceled' || next === 'declined' ? 'outline' : 'default'}
                      className="w-auto"
                    >
                      {INTENT[next]}
                    </Button>
                  </form>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <div className="pt-1">
        <Link
          href={co.contractId ? `/contracts/${co.contractId}` : '/contracts'}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          Back to contract
        </Link>
      </div>
    </div>
  );
}
