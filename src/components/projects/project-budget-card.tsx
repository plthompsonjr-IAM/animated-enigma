import Link from 'next/link';
import { formatMoney } from '@/lib/invoices/invoices-core';
import { formatScheduleChange } from '@/lib/change-orders/change-orders-core';
import type { ProjectBudget } from '@/lib/projects/budget';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * The money picture for a project: what it's worth, what's been billed, and
 * what's still owed. Everything shown is derived from the contract, its approved
 * change orders, and the invoice ledger.
 */
export function ProjectBudgetCard({ budget }: { budget: ProjectBudget }) {
  const billedPercent =
    budget.revisedValue > 0
      ? Math.min(100, Math.round((budget.invoiced / budget.revisedValue) * 100))
      : 0;
  const paidPercent =
    budget.revisedValue > 0
      ? Math.min(100, Math.round((budget.paid / budget.revisedValue) * 100))
      : 0;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle>Budget</CardTitle>
        {budget.contractId ? (
          <Link
            href={`/contracts/${budget.contractId}`}
            className="text-sm text-muted-foreground hover:text-foreground hover:underline"
          >
            {budget.contractNumber}
          </Link>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border-2 border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {budget.changeOrderDelta !== 0 ? 'Revised contract value' : 'Contract value'}
            </span>
            <span className="text-2xl font-bold tabular-nums">
              {formatMoney(budget.revisedValue)}
            </span>
          </div>
          {budget.changeOrderDelta !== 0 ? (
            <div className="mt-2 space-y-0.5 border-t border-primary/20 pt-2 text-xs text-muted-foreground">
              <Row label="Original signed value" value={formatMoney(budget.originalValue)} />
              <Row label="Approved change orders" value={formatMoney(budget.changeOrderDelta)} />
              {budget.scheduleDays !== 0 ? (
                <Row label="Schedule impact" value={formatScheduleChange(budget.scheduleDays)} />
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Billing progress against the revised value. */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Billed {billedPercent}%</span>
            <span>Paid {paidPercent}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-secondary">
            <div className="relative h-full">
              <div
                className="absolute inset-y-0 left-0 bg-primary/30"
                style={{ width: `${billedPercent}%` }}
              />
              <div
                className="absolute inset-y-0 left-0 bg-primary"
                style={{ width: `${paidPercent}%` }}
              />
            </div>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <Figure label="Invoiced" value={formatMoney(budget.invoiced)} />
          <Figure label="Paid" value={formatMoney(budget.paid)} />
          <Figure label="Outstanding" value={formatMoney(budget.outstanding)} />
          <Figure
            label="Overdue"
            value={formatMoney(budget.overdue)}
            tone={budget.overdue > 0 ? 'text-destructive' : undefined}
          />
          <Figure label="Not yet billed" value={formatMoney(budget.unbilled)} />
          {budget.pendingChangeOrders > 0 ? (
            <Figure
              label="Approved, not incorporated"
              value={`${budget.pendingChangeOrders} change order${budget.pendingChangeOrders === 1 ? '' : 's'}`}
            />
          ) : null}
        </dl>
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`font-medium tabular-nums ${tone ?? ''}`}>{value}</dd>
    </div>
  );
}
