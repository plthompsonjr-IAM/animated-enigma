import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Lock } from 'lucide-react';
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
import { buttonVariants } from '@/components/ui/button';
import { ContractStatusBadge } from '@/components/contracts/contract-status-badge';
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
        <p className="text-sm text-muted-foreground">
          {row.clientName ?? 'Client'} ·{' '}
          <Link href={`/projects/${contract.projectId}`} className="hover:underline">
            {row.projectNumber ? `${row.projectNumber} · ` : ''}
            {row.projectName ?? 'Project'}
          </Link>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Agreement</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between rounded-md border-2 border-primary/30 bg-primary/5 p-4">
            <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Contract value
            </span>
            <span className="text-2xl font-bold tabular-nums">{formatMoney(value)}</span>
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
