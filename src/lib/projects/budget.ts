import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { toNum } from '@/lib/catalog/catalog-core';
import {
  revisedContractValue,
  totalScheduleChange,
  pendingIncorporation,
  type ChangeOrderStatus,
} from '@/lib/change-orders/change-orders-core';
import { summarizeReceivables, type InvoiceStatus } from '@/lib/invoices/invoices-core';

export interface ProjectBudget {
  contractNumber: string | null;
  contractId: string | null;
  /** The value the client originally signed. */
  originalValue: number;
  /** Original plus approved change orders. */
  revisedValue: number;
  changeOrderDelta: number;
  scheduleDays: number;
  pendingChangeOrders: number;
  invoiced: number;
  paid: number;
  outstanding: number;
  overdue: number;
  /** Revised contract value not yet invoiced — the work left to bill. */
  unbilled: number;
}

/**
 * The money picture for one project, assembled from the contract, its approved
 * change orders, and the invoice ledger (Task 22 rollup). Everything is derived,
 * so it can't drift from the underlying records.
 *
 * Returns null when the project has no contract yet — there's no budget to
 * report against until the work is under agreement.
 */
export async function projectBudget(
  organizationId: string,
  projectId: string,
): Promise<ProjectBudget | null> {
  const db = getDb();

  const [contract] = await db
    .select({
      id: schema.contracts.id,
      contractNumber: schema.contracts.contractNumber,
      contractValue: schema.contracts.contractValue,
    })
    .from(schema.contracts)
    .where(
      and(
        eq(schema.contracts.organizationId, organizationId),
        eq(schema.contracts.projectId, projectId),
      ),
    );
  if (!contract) return null;

  const changeOrders = await db
    .select({
      status: schema.changeOrders.status,
      costChange: schema.changeOrders.costChange,
      scheduleChangeDays: schema.changeOrders.scheduleChangeDays,
    })
    .from(schema.changeOrders)
    .where(
      and(
        eq(schema.changeOrders.organizationId, organizationId),
        eq(schema.changeOrders.projectId, projectId),
      ),
    );
  const typedChangeOrders = changeOrders.map((c) => ({
    ...c,
    status: c.status as ChangeOrderStatus,
  }));

  const invoices = await db
    .select({
      status: schema.invoices.status,
      total: schema.invoices.total,
      amountPaid: schema.invoices.amountPaid,
      dueDate: schema.invoices.dueDate,
    })
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.organizationId, organizationId),
        eq(schema.invoices.projectId, projectId),
      ),
    );

  const originalValue = toNum(contract.contractValue);
  const revisedValue = revisedContractValue(originalValue, typedChangeOrders);
  const receivables = summarizeReceivables(
    invoices.map((i) => ({
      status: i.status as InvoiceStatus,
      total: i.total,
      amountPaid: i.amountPaid,
      dueDate: i.dueDate,
    })),
  );

  return {
    contractId: contract.id,
    contractNumber: contract.contractNumber,
    originalValue,
    revisedValue,
    changeOrderDelta: round2(revisedValue - originalValue),
    scheduleDays: totalScheduleChange(typedChangeOrders),
    pendingChangeOrders: pendingIncorporation(typedChangeOrders),
    invoiced: receivables.invoiced,
    paid: receivables.paid,
    outstanding: receivables.outstanding,
    overdue: receivables.overdue,
    unbilled: round2(Math.max(0, revisedValue - receivables.invoiced)),
  };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
