import { and, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { toNum } from '@/lib/catalog/catalog-core';
import type { AgingInvoice, JobBillingInput } from './financials-core';

/**
 * Every invoice in the org with the context an aging report needs. Loaded whole
 * rather than aggregated in SQL because the bucketing rules — "end of the due
 * day is still on time", drafts and voids excluded — already exist as tested
 * pure functions, and having two implementations of that is how they drift.
 */
export async function invoicesForAging(organizationId: string): Promise<AgingInvoice[]> {
  const I = schema.invoices;
  const rows = await getDb()
    .select({
      id: I.id,
      invoiceNumber: I.invoiceNumber,
      status: I.status,
      total: I.total,
      amountPaid: I.amountPaid,
      dueDate: I.dueDate,
      clientId: I.clientId,
      clientName: schema.clients.displayName,
      projectId: I.projectId,
      projectName: schema.projects.name,
    })
    .from(I)
    .leftJoin(schema.clients, eq(schema.clients.id, I.clientId))
    .leftJoin(schema.projects, eq(schema.projects.id, I.projectId))
    .where(eq(I.organizationId, organizationId));

  return rows.map((r) => ({ ...r, status: r.status as AgingInvoice['status'] }));
}

/**
 * Billing position per job. The contract value and the approved change-order
 * delta come from the contract records, and the billed/collected figures from
 * the invoice ledger, so nothing here is a stored total that can drift.
 */
export async function jobBillingInputs(organizationId: string): Promise<JobBillingInput[]> {
  const PR = schema.projects;

  const rows = await getDb()
    .select({
      projectId: PR.id,
      projectName: PR.name,
      projectNumber: PR.projectNumber,
      clientName: schema.clients.displayName,
      status: PR.status,
      contractValue: sql<string | null>`(
        select c.contract_value from contracts c
        where c.project_id = ${PR.id} and c.status <> 'cancelled'
        order by c.created_at desc limit 1
      )`,
      // Only approved and incorporated change orders count toward the contract.
      changeOrderDelta: sql<string>`coalesce((
        select sum(co.cost_change) from change_orders co
        where co.project_id = ${PR.id}
          and co.status in ('approved','incorporated')
      ), 0)`,
      invoiced: sql<string>`coalesce((
        select sum(i.total) from invoices i
        where i.project_id = ${PR.id} and i.status not in ('draft','void')
      ), 0)`,
      paid: sql<string>`coalesce((
        select sum(i.amount_paid) from invoices i
        where i.project_id = ${PR.id} and i.status not in ('draft','void')
      ), 0)`,
    })
    .from(PR)
    .leftJoin(schema.clients, eq(schema.clients.id, PR.clientId))
    .where(and(eq(PR.organizationId, organizationId), sql`${PR.deletedAt} is null`));

  return rows.map((r) => ({
    projectId: r.projectId,
    projectName: r.projectName,
    projectNumber: r.projectNumber,
    clientName: r.clientName,
    status: r.status as string,
    contractValue: r.contractValue === null ? null : toNum(r.contractValue),
    changeOrderDelta: toNum(r.changeOrderDelta),
    invoiced: toNum(r.invoiced),
    paid: toNum(r.paid),
  }));
}

/** Payments received in a window, for a simple cash-in view. */
export async function paymentsReceived(organizationId: string, from: string) {
  const P = schema.payments;
  const rows = await getDb()
    .select({
      total: sql<string>`coalesce(sum(case when ${P.isRefund} then -${P.amount} else ${P.amount} end), 0)`,
      count: sql<number>`count(*)::int`,
    })
    .from(P)
    .where(and(eq(P.organizationId, organizationId), sql`${P.paymentDate} >= ${from}`));

  return { total: toNum(rows[0]?.total ?? 0), count: rows[0]?.count ?? 0 };
}
