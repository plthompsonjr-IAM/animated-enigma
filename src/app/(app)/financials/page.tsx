import Link from 'next/link';
import { redirect } from 'next/navigation';
import { DollarSign } from 'lucide-react';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { addDays, today } from '@/lib/schedule/schedule-core';
import { formatMoney } from '@/lib/invoices/invoices-core';
import { invoicesForAging, jobBillingInputs, paymentsReceived } from '@/lib/financials/queries';
import {
  agingReport,
  balancesByClient,
  collectionSummary,
  formatPercent,
  jobBillingRows,
  openReceivables,
  portfolioTotals,
} from '@/lib/financials/financials-core';
import { costLinesByProject, membersWithoutCostRate } from '@/lib/costing/queries';
import { jobCostPosition, portfolioCost, formatHours } from '@/lib/costing/costing-core';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Financials' };

/**
 * The money screen: receivables aging, who owes what, billing position per job,
 * and — for anyone cleared to see cost — real margin from logged time and
 * recorded spend.
 *
 * The margin headline is computed from *finished* jobs only. A half-built job
 * has most of its revenue recognised and only some of its cost, so blending it
 * in produces a number that looks like a margin and behaves like noise.
 */
export default async function FinancialsPage() {
  const ctx = await getAuthContext();
  if (ctx.configured && !ctx.userId) redirect('/login');

  if (!ctx.configured || !ctx.dbAvailable || !ctx.activeOrg) {
    return (
      <Empty title="Financials">
        Financials activate once authentication and the database are configured and an organization
        exists.
      </Empty>
    );
  }

  const { activeOrg } = ctx;
  if (!can(activeOrg.roles, 'financials:read', activeOrg.extraPermissions)) {
    return (
      <Empty title="Financials">
        You don’t have permission to view financials. Ask an administrator.
      </Empty>
    );
  }

  const orgId = activeOrg.organizationId;
  const thirtyDaysAgo = addDays(today(), -30) ?? today();
  // Cost and margin are a stricter permission than the money a client is billed.
  const showCosts = can(activeOrg.roles, 'costs:read', activeOrg.extraPermissions);

  const [invoices, jobs, cash, costLines, uncostedMembers] = await Promise.all([
    invoicesForAging(orgId),
    jobBillingInputs(orgId),
    paymentsReceived(orgId, thirtyDaysAgo),
    showCosts ? costLinesByProject(orgId) : Promise.resolve(new Map()),
    showCosts ? membersWithoutCostRate(orgId) : Promise.resolve(0),
  ]);

  const receivables = openReceivables(invoices);
  const aging = agingReport(receivables);
  const clients = balancesByClient(receivables);
  const collection = collectionSummary(invoices);
  const rows = jobBillingRows(jobs);
  const totals = portfolioTotals(rows);

  // A job's margin is only real once it's finished; portfolioCost knows that and
  // computes the company margin from completed work alone.
  const positions = showCosts
    ? rows.map((row) => {
        const lines = costLines.get(row.projectId) ?? { labour: [], expenses: [] };
        return {
          row,
          position: jobCostPosition({
            phase:
              row.status === 'completed' || row.status === 'closed' ? 'complete' : 'in_progress',
            labour: lines.labour,
            expenses: lines.expenses,
            contractValue: row.revisedValue,
            invoiced: row.invoiced,
          }),
        };
      })
    : [];
  const companyCost = showCosts ? portfolioCost(positions.map((p) => p.position)) : null;

  const nothing = invoices.length === 0 && jobs.length === 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Financials</h1>
        <p className="text-sm text-muted-foreground">
          What you’re owed, how old it is, and where each job stands on billing.
        </p>
      </div>

      {nothing ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <DollarSign className="h-6 w-6" />
            </div>
            <div className="max-w-sm">
              <p className="font-medium">Nothing to report yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Once a job is under contract and invoiced, the money picture shows up here.
              </p>
              <Link href="/projects" className="mt-2 inline-block text-sm underline">
                Go to projects
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Outstanding" value={formatMoney(collection.outstanding)} />
            <Stat
              label="Past due"
              value={formatMoney(collection.overdue)}
              note={
                collection.averageDaysLate > 0
                  ? `avg ${collection.averageDaysLate} days late`
                  : undefined
              }
              tone={collection.overdue > 0 ? 'bad' : undefined}
            />
            <Stat
              label="Collected (30 days)"
              value={formatMoney(cash.total)}
              note={cash.count > 0 ? `${cash.count} payments` : undefined}
            />
            <Stat
              label="Collection rate"
              value={formatPercent(collection.collectionRate)}
              note={`${formatMoney(collection.collected)} of ${formatMoney(collection.billed)}`}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Receivables aging</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {collection.outstanding === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing outstanding. Every invoice is settled.</p>
              ) : (
                <>
                  {/* A single stacked bar reads faster than five numbers. */}
                  <div className="flex h-3 overflow-hidden rounded-full bg-secondary">
                    {aging.map((row) =>
                      row.percent > 0 ? (
                        <div
                          key={row.bucket}
                          className={cn('h-full', BUCKET_FILLS[row.bucket])}
                          style={{ width: `${row.percent}%` }}
                          title={`${row.label}: ${formatMoney(row.amount)}`}
                        />
                      ) : null,
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[420px] text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                          <th className="py-1.5 pr-2 font-medium">Age</th>
                          <th className="py-1.5 pr-2 text-right font-medium">Invoices</th>
                          <th className="py-1.5 pr-2 text-right font-medium">Amount</th>
                          <th className="py-1.5 text-right font-medium">Share</th>
                        </tr>
                      </thead>
                      <tbody>
                        {aging.map((row) => (
                          <tr key={row.bucket} className="border-b last:border-0">
                            <td className="py-1.5 pr-2">
                              <span className="inline-flex items-center gap-1.5">
                                <span
                                  className={cn('h-2 w-2 rounded-full', BUCKET_FILLS[row.bucket])}
                                />
                                {row.label}
                              </span>
                            </td>
                            <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">
                              {row.count}
                            </td>
                            <td
                              className={cn(
                                'py-1.5 pr-2 text-right font-medium tabular-nums',
                                row.bucket !== 'current' && row.amount > 0
                                  ? 'text-red-600 dark:text-red-400'
                                  : '',
                              )}
                            >
                              {formatMoney(row.amount)}
                            </td>
                            <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                              {row.percent}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {clients.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Who owes what</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y rounded-md border">
                  {clients.map((client) => (
                    <li
                      key={client.clientId ?? 'unknown'}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium">
                          {client.clientId ? (
                            <Link href={`/clients/${client.clientId}`} className="hover:underline">
                              {client.clientName ?? 'Client'}
                            </Link>
                          ) : (
                            (client.clientName ?? 'Unattached')
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {client.invoiceCount} open{' '}
                          {client.invoiceCount === 1 ? 'invoice' : 'invoices'}
                          {client.oldestDaysLate > 0
                            ? ` · oldest ${client.oldestDaysLate} days late`
                            : ''}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold tabular-nums">
                          {formatMoney(client.balance)}
                        </div>
                        {client.overdue > 0 ? (
                          <div className="text-xs font-medium tabular-nums text-red-600 dark:text-red-400">
                            {formatMoney(client.overdue)} past due
                          </div>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Billing by job</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <MiniStat label="Under contract" value={formatMoney(totals.underContract)} />
                <MiniStat label="Invoiced" value={formatMoney(totals.invoiced)} />
                <MiniStat label="Collected" value={formatMoney(totals.collected)} />
                <MiniStat label="Left to bill" value={formatMoney(totals.unbilled)} />
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-1.5 pr-2 font-medium">Job</th>
                      <th className="py-1.5 pr-2 text-right font-medium">Contract</th>
                      <th className="py-1.5 pr-2 text-right font-medium">Invoiced</th>
                      <th className="py-1.5 pr-2 text-right font-medium">Owed</th>
                      <th className="py-1.5 text-right font-medium">Left to bill</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.projectId} className="border-b last:border-0">
                        <td className="py-1.5 pr-2">
                          <Link
                            href={`/projects/${row.projectId}`}
                            className="font-medium hover:underline"
                          >
                            {row.projectNumber ?? row.projectName ?? 'Project'}
                          </Link>
                          <div className="text-xs text-muted-foreground">
                            {row.clientName ?? '—'}
                            {row.billedPercent !== null ? ` · ${row.billedPercent}% billed` : ''}
                          </div>
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">
                          {row.revisedValue === null ? (
                            <span className="text-muted-foreground">No contract</span>
                          ) : (
                            formatMoney(row.revisedValue)
                          )}
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">
                          {formatMoney(row.invoiced)}
                        </td>
                        <td
                          className={cn(
                            'py-1.5 pr-2 text-right tabular-nums',
                            row.outstanding > 0 ? 'font-medium' : 'text-muted-foreground',
                          )}
                        >
                          {formatMoney(row.outstanding)}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                          {row.unbilled === null ? '—' : formatMoney(row.unbilled)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totals.jobsWithoutContract > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {totals.jobsWithoutContract}{' '}
                  {totals.jobsWithoutContract === 1 ? 'job has' : 'jobs have'} no contract yet, so
                  there’s no value to bill against.
                </p>
              ) : null}
            </CardContent>
          </Card>

          {companyCost ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Cost &amp; margin</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <MiniStat label="Labour" value={formatMoney(companyCost.labour)} />
                  <MiniStat label="Hours logged" value={formatHours(companyCost.labourHours)} />
                  <MiniStat label="Expenses" value={formatMoney(companyCost.expenses)} />
                  <MiniStat label="Total cost" value={formatMoney(companyCost.total)} />
                </div>

                <div className="rounded-md border-2 border-primary/30 bg-primary/5 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Margin on completed jobs
                    </span>
                    <span className="text-2xl font-bold tabular-nums">
                      {formatPercent(companyCost.completedMarginPercent)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {companyCost.completedRevenue > 0
                      ? `${formatMoney(companyCost.completedRevenue)} of finished work at ${formatMoney(companyCost.completedCost)} cost.`
                      : 'No finished jobs yet, so there is no settled margin to report.'}{' '}
                    Running jobs are excluded on purpose — a half-built job flatters the number and
                    then takes it back.
                  </p>
                </div>

                {uncostedMembers > 0 ? (
                  <p className="rounded-md bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
                    {uncostedMembers} active {uncostedMembers === 1 ? 'person has' : 'people have'}{' '}
                    no hourly cost rate, so their hours aren’t costed. Until that’s set, labour cost
                    — and every margin here — is understated.
                  </p>
                ) : null}

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="py-1.5 pr-2 font-medium">Job</th>
                        <th className="py-1.5 pr-2 text-right font-medium">Cost</th>
                        <th className="py-1.5 pr-2 text-right font-medium">Spent</th>
                        <th className="py-1.5 pr-2 text-right font-medium">Billed</th>
                        <th className="py-1.5 text-right font-medium">Gap</th>
                      </tr>
                    </thead>
                    <tbody>
                      {positions.map(({ row, position }) => (
                        <tr key={row.projectId} className="border-b last:border-0">
                          <td className="py-1.5 pr-2">
                            <Link
                              href={`/projects/${row.projectId}`}
                              className="font-medium hover:underline"
                            >
                              {row.projectNumber ?? row.projectName ?? 'Project'}
                            </Link>
                            <div className="text-xs text-muted-foreground">
                              {position.phase === 'complete' ? 'Finished' : 'Running'}
                              {position.spendingAheadOfBilling ? ' · spending ahead of billing' : ''}
                            </div>
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">
                            {formatMoney(position.cost.total)}
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">
                            {formatPercent(position.spentPercent)}
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">
                            {formatPercent(position.billedPercent)}
                          </td>
                          <td
                            className={cn(
                              'py-1.5 text-right tabular-nums',
                              (position.grossProfit ?? 0) < 0
                                ? 'font-medium text-red-600 dark:text-red-400'
                                : '',
                            )}
                          >
                            {position.grossProfit === null
                              ? '—'
                              : formatMoney(position.grossProfit)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p className="text-xs text-muted-foreground">
                  &ldquo;Gap&rdquo; is contract value less cost. On a finished job that is the
                  actual gross profit; on a running one it is only the gap so far, and costs still
                  to come will move it.
                </p>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}

const BUCKET_FILLS: Record<string, string> = {
  current: 'bg-emerald-500',
  '1_30': 'bg-amber-400',
  '31_60': 'bg-amber-500',
  '61_90': 'bg-orange-500',
  '90_plus': 'bg-red-500',
};

function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: 'bad';
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={cn(
          'text-xl font-bold tabular-nums',
          tone === 'bad' && 'text-red-600 dark:text-red-400',
        )}
      >
        {value}
      </div>
      {note ? <div className="text-[11px] text-muted-foreground">{note}</div> : null}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-secondary/50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
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
