import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { AlertTriangle, ArrowLeft, FilePlus2, Lock, Printer } from 'lucide-react';
import { getDb, schema } from '@/db';
import { resolveTerms, unresolvedBlanks } from '@/lib/contracts/terms-core';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { getContract, paymentScheduleFor } from '@/lib/contracts/queries';
import {
  formatMoney,
  isEditable,
  isPaymentStructure,
  type ContractStatus,
  type MilestoneInput,
  type PaymentStructure,
  milestoneAmount,
  MILESTONE_TRIGGER_LABELS,
  PAYMENT_STRUCTURE_LABELS,
} from '@/lib/contracts/contracts-core';
import { toNum } from '@/lib/catalog/catalog-core';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { ContractStatusBadge } from '@/components/contracts/contract-status-badge';
import { ChangeOrderStatusBadge } from '@/components/change-orders/change-order-status-badge';
import { changeOrdersForContract } from '@/lib/change-orders/queries';
import { createChangeOrder } from '@/lib/change-orders/actions';
import {
  formatScheduleChange,
  revisedContractValue,
  totalScheduleChange,
} from '@/lib/change-orders/change-orders-core';
import { ScheduleForm } from './schedule-form';
import { StatusActions } from './status-actions';

export const metadata = { title: 'Contract' };

export default async function ContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAuthContext();
  if (ctx.configured && !ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) redirect('/contracts');
  if (!can(ctx.activeOrg.roles, 'financials:read', ctx.activeOrg.extraPermissions)) {
    redirect('/contracts');
  }

  const orgId = ctx.activeOrg.organizationId;
  const mayWrite = can(ctx.activeOrg.roles, 'financials:write', ctx.activeOrg.extraPermissions);

  const row = await getContract(orgId, id);
  if (!row) notFound();

  const contract = row.contract;
  const status = contract.status as ContractStatus;
  const value = toNum(contract.contractValue);
  const editable = isEditable(status);

  const [org] = await getDb()
    .select({ contractTerms: schema.organizations.contractTerms })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, orgId));
  const termsBlanks = unresolvedBlanks(resolveTerms(org?.contractTerms));

  const changeOrders = await changeOrdersForContract(orgId, contract.id);
  const revised = revisedContractValue(value, changeOrders);
  const scheduleDays = totalScheduleChange(changeOrders);

  const { schedule, milestones } = await paymentScheduleFor(orgId, contract.id);
  const structure: PaymentStructure =
    schedule && isPaymentStructure(schedule.structureType)
      ? schedule.structureType
      : 'deposit_balance';
  const milestoneInputs: MilestoneInput[] = milestones.map((m) => ({
    name: m.name,
    amount: m.amount,
    percentage: m.percentage,
    triggerType: (m.triggerType as MilestoneInput['triggerType']) ?? null,
    dueDate: m.dueDate,
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link
          href="/contracts"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Contracts
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">{contract.contractNumber}</h1>
          <ContractStatusBadge status={status} />
          {!editable ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Lock className="h-3 w-3" />
              Terms locked
            </span>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {row.clientName ?? 'Client'} ·{' '}
            <Link href={`/projects/${contract.projectId}`} className="hover:underline">
              {row.projectNumber ? `${row.projectNumber} · ` : ''}
              {row.projectName ?? 'Project'}
            </Link>
          </p>
          <a
            href={`/contracts/${contract.id}/print`}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            <Printer className="h-4 w-4" />
            Print contract
          </a>
        </div>
      </div>

      {termsBlanks.length > 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="text-sm">
            <p className="font-medium">Your contract terms still have blanks to fill in.</p>
            <p className="mt-0.5 text-muted-foreground">
              The printable contract uses a starter template with placeholders for{' '}
              {termsBlanks.slice(0, 4).join(', ').toLowerCase()}
              {termsBlanks.length > 4 ? `, and ${termsBlanks.length - 4} more` : ''}. Have your
              terms reviewed by an attorney before sending this to a client.
            </p>
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Agreement</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-md border-2 border-primary/30 bg-primary/5 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {revised !== value ? 'Revised contract value' : 'Contract value'}
              </span>
              <span className="text-2xl font-bold tabular-nums">{formatMoney(revised)}</span>
            </div>
            {revised !== value ? (
              <div className="mt-2 space-y-0.5 border-t border-primary/20 pt-2 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <span>Original signed value</span>
                  <span className="tabular-nums">{formatMoney(value)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Approved change orders</span>
                  <span className="tabular-nums">{formatMoney(revised - value)}</span>
                </div>
                {scheduleDays !== 0 ? (
                  <div className="flex justify-between">
                    <span>Schedule impact</span>
                    <span>{formatScheduleChange(scheduleDays)}</span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {contract.scopeSummary ? (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Scope
              </div>
              <p className="text-sm">{contract.scopeSummary}</p>
            </div>
          ) : null}

          <dl className="grid gap-3 sm:grid-cols-2">
            {contract.proposalId ? (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Source
                </dt>
                <dd className="text-sm">
                  <Link href={`/proposals/${contract.proposalId}`} className="hover:underline">
                    View signed proposal
                  </Link>
                </dd>
              </div>
            ) : null}
            {contract.activatedAt ? (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Activated
                </dt>
                <dd className="text-sm">
                  {new Date(contract.activatedAt).toLocaleDateString('en-US')}
                </dd>
              </div>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payment schedule</CardTitle>
        </CardHeader>
        <CardContent>
          {editable && mayWrite ? (
            <ScheduleForm
              contractId={contract.id}
              contractValue={value}
              initialStructure={structure}
              initialMilestones={milestoneInputs}
            />
          ) : schedule ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{PAYMENT_STRUCTURE_LABELS[structure]}</p>
              {milestoneInputs.length > 0 ? (
                <ul className="divide-y rounded-md border">
                  {milestoneInputs.map((m, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 px-3 py-2">
                      <div>
                        <div className="text-sm font-medium">{m.name}</div>
                        {m.triggerType ? (
                          <div className="text-xs text-muted-foreground">
                            {MILESTONE_TRIGGER_LABELS[m.triggerType]}
                          </div>
                        ) : null}
                      </div>
                      <span className="text-sm font-medium tabular-nums">
                        {formatMoney(milestoneAmount(m, value))}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No payment schedule set{editable ? ' yet.' : ' before this contract was locked.'}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Change orders</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {changeOrders.length > 0 ? (
            <ul className="divide-y rounded-md border">
              {changeOrders.map((co) => (
                <li key={co.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <Link
                      href={`/change-orders/${co.id}`}
                      className="text-sm font-medium hover:underline"
                    >
                      {co.changeOrderNumber}
                    </Link>
                    <div className="truncate text-xs text-muted-foreground">
                      {co.reason ?? 'No reason given'}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-sm font-medium tabular-nums">
                      {formatMoney(co.costChange)}
                    </span>
                    <ChangeOrderStatusBadge status={co.status} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No change orders. Raise one when the scope, price, or schedule needs to change.
            </p>
          )}

          {mayWrite && !editable ? (
            <form action={createChangeOrder}>
              <input type="hidden" name="contractId" value={contract.id} />
              <Button type="submit" variant="outline" size="sm" className="w-auto">
                <FilePlus2 className="h-4 w-4" />
                New change order
              </Button>
            </form>
          ) : mayWrite ? (
            <p className="text-xs text-muted-foreground">
              This contract is still a draft — edit it directly instead of raising a change order.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {mayWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Status</CardTitle>
          </CardHeader>
          <CardContent>
            <StatusActions contractId={contract.id} status={status} />
          </CardContent>
        </Card>
      ) : null}

      <div className="pt-1">
        <Link href="/contracts" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          Back to contracts
        </Link>
      </div>
    </div>
  );
}
