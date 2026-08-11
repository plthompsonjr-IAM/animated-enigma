import { Receipt, TrendingDown, TrendingUp } from 'lucide-react';
import {
  EXPENSE_CATEGORY_LABELS,
  TIME_ENTRY_STATUS_LABELS,
  TIME_ENTRY_STATUS_STYLES,
  formatHours,
  marginIsFinal,
  profitLabel,
  type JobCostPosition,
} from '@/lib/costing/costing-core';
import { formatMoney } from '@/lib/invoices/invoices-core';
import { setTimeEntryStatus } from '@/lib/costing/actions';
import type { ExpenseRow, TimeEntryRow } from '@/lib/costing/queries';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ClockControls, ExpenseForm } from './cost-forms';

/**
 * Job costing on a project. Only rendered for someone with `costs:read` — this
 * is the internal margin, not something a client or a field role sees.
 *
 * The headline number is labelled by phase, never just "margin": on a running
 * job, value-less-cost-so-far is not profit, and calling it that is how people
 * end up surprised at close-out.
 */
export function ProjectCostCard({
  projectId,
  position,
  timeEntries,
  expenses,
  openShiftId,
  mayLogTime,
  mayWriteCosts,
  uncostedMembers,
}: {
  projectId: string;
  position: JobCostPosition;
  timeEntries: TimeEntryRow[];
  expenses: ExpenseRow[];
  /** The caller's own open shift on this job, if any. */
  openShiftId: string | null;
  mayLogTime: boolean;
  mayWriteCosts: boolean;
  /** Active members with no cost rate — their labour isn't being costed. */
  uncostedMembers: number;
}) {
  const { cost } = position;
  const final = marginIsFinal(position.phase);
  const profitPositive = (position.grossProfit ?? 0) >= 0;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>Job costing</CardTitle>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {formatMoney(cost.total)} spent · {formatHours(cost.labourHours)} logged
            {position.spentPercent !== null ? ` · ${position.spentPercent}% of contract` : ''}
          </p>
        </div>
        <Receipt className="h-5 w-5 flex-none text-muted-foreground" />
      </CardHeader>

      <CardContent className="space-y-4">
        {position.contractValue !== null ? (
          <div
            className={cn(
              'rounded-md border-2 p-4',
              profitPositive ? 'border-primary/30 bg-primary/5' : 'border-red-500/40 bg-red-500/10',
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {profitLabel(position.phase)}
              </span>
              <span
                className={cn(
                  'text-2xl font-bold tabular-nums',
                  profitPositive ? '' : 'text-red-600 dark:text-red-400',
                )}
              >
                {formatMoney(position.grossProfit ?? 0)}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {formatMoney(position.contractValue)} contract − {formatMoney(cost.total)} cost
              </span>
              {position.marginPercent !== null ? <span>{position.marginPercent}%</span> : null}
            </div>
            {!final ? (
              <p className="mt-2 border-t border-border/50 pt-2 text-xs text-muted-foreground">
                This job is still running, so this is the gap so far — not the margin. Costs still
                to come will move it.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No contract on this job yet, so there’s nothing to measure the cost against. The spend
            below is still real.
          </p>
        )}

        {position.spendingAheadOfBilling ? (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <TrendingDown className="mt-0.5 h-4 w-4 flex-none text-amber-600 dark:text-amber-400" />
            <div>
              <p className="font-medium">Spending is running ahead of billing.</p>
              <p className="text-xs text-muted-foreground">
                {position.spentPercent}% of the contract spent against {position.billedPercent}%
                billed. Worth checking whether a draw is due.
              </p>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile label="Labour" value={formatMoney(cost.labour)} note={formatHours(cost.labourHours)} />
          <Tile label="Materials" value={formatMoney(cost.material)} />
          <Tile label="Subcontractors" value={formatMoney(cost.subcontractor)} />
          <Tile label="Other" value={formatMoney(cost.otherExpenses)} />
        </div>

        {uncostedMembers > 0 ? (
          <p className="rounded-md bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
            {uncostedMembers} active {uncostedMembers === 1 ? 'person has' : 'people have'} no
            hourly cost rate set, so their hours aren’t costed. Set rates under Settings → Team —
            until then labour cost is understated.
          </p>
        ) : null}

        <section className="space-y-2 border-t pt-4">
          <h3 className="text-sm font-semibold">Time</h3>
          {mayLogTime ? (
            <ClockControls projectId={projectId} openShiftId={openShiftId} />
          ) : null}
          {timeEntries.length > 0 ? (
            <ul className="divide-y rounded-md border">
              {timeEntries.slice(0, 10).map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium">
                        {entry.userName ?? entry.userEmail ?? 'Someone'}
                      </span>
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[10px] font-medium',
                          TIME_ENTRY_STATUS_STYLES[entry.status],
                        )}
                      >
                        {TIME_ENTRY_STATUS_LABELS[entry.status]}
                      </span>
                      {entry.isManual ? (
                        <span className="text-[10px] text-muted-foreground">entered by hand</span>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {entry.clockIn ? new Date(entry.clockIn).toLocaleString('en-US') : '—'}
                      {entry.clockOut
                        ? ` → ${new Date(entry.clockOut).toLocaleTimeString('en-US')}`
                        : ' · still on the clock'}
                      {entry.breakMinutes > 0 ? ` · ${entry.breakMinutes}m break` : ''}
                      {entry.taskTitle ? ` · ${entry.taskTitle}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium tabular-nums">
                      {entry.hours ? formatHours(entry.hours) : '—'}
                    </span>
                    {mayWriteCosts && entry.status === 'submitted' ? (
                      <div className="flex gap-1">
                        <form action={setTimeEntryStatus}>
                          <input type="hidden" name="entryId" value={entry.id} />
                          <input type="hidden" name="status" value="approved" />
                          <Button type="submit" size="sm" className="h-6 w-auto px-2 text-[10px]">
                            Approve
                          </Button>
                        </form>
                        <form action={setTimeEntryStatus}>
                          <input type="hidden" name="entryId" value={entry.id} />
                          <input type="hidden" name="status" value="rejected" />
                          <Button
                            type="submit"
                            size="sm"
                            variant="outline"
                            className="h-6 w-auto px-2 text-[10px]"
                          >
                            Reject
                          </Button>
                        </form>
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No time logged yet.</p>
          )}
          {timeEntries.length > 10 ? (
            <p className="text-xs text-muted-foreground">
              Showing the 10 most recent of {timeEntries.length}.
            </p>
          ) : null}
        </section>

        <section className="space-y-2 border-t pt-4">
          <h3 className="text-sm font-semibold">Expenses</h3>
          {expenses.length > 0 ? (
            <ul className="divide-y rounded-md border">
              {expenses.slice(0, 12).map((expense) => (
                <li
                  key={expense.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{expense.description}</div>
                    <div className="text-xs text-muted-foreground">
                      {EXPENSE_CATEGORY_LABELS[expense.category]}
                      {expense.vendor ? ` · ${expense.vendor}` : ''} ·{' '}
                      {new Date(`${expense.expenseDate}T12:00:00Z`).toLocaleDateString('en-US', {
                        timeZone: 'UTC',
                      })}
                      {expense.isBillable ? ' · billable' : ''}
                    </div>
                  </div>
                  <span
                    className={cn(
                      'text-sm font-medium tabular-nums',
                      Number(expense.amount) < 0 ? 'text-emerald-600 dark:text-emerald-400' : '',
                    )}
                  >
                    {formatMoney(expense.amount)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing spent on this job yet.</p>
          )}
          {mayWriteCosts ? <ExpenseForm projectId={projectId} /> : null}
        </section>
      </CardContent>
    </Card>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-md bg-secondary/50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
      {note ? <div className="text-[10px] text-muted-foreground">{note}</div> : null}
    </div>
  );
}

/** Exported so the financials page can reuse the same up/down treatment. */
export function MarginArrow({ positive }: { positive: boolean }) {
  return positive ? (
    <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
  ) : (
    <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" />
  );
}
