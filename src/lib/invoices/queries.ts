import { and, asc, desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import type { InvoiceStatus, InvoiceType } from './invoices-core';

export interface InvoiceListRow {
  id: string;
  invoiceNumber: string;
  invoiceType: InvoiceType;
  status: InvoiceStatus;
  total: string;
  amountPaid: string;
  balance: string;
  dueDate: string | null;
  projectId: string;
  projectName: string | null;
  clientName: string | null;
  updatedAt: Date;
}

/** All invoices for the org, newest first. */
export async function listInvoices(organizationId: string): Promise<InvoiceListRow[]> {
  const db = getDb();
  const I = schema.invoices;
  const PR = schema.projects;
  const CL = schema.clients;

  const rows = await db
    .select({
      id: I.id,
      invoiceNumber: I.invoiceNumber,
      invoiceType: I.invoiceType,
      status: I.status,
      total: I.total,
      amountPaid: I.amountPaid,
      balance: I.balance,
      dueDate: I.dueDate,
      projectId: I.projectId,
      projectName: PR.name,
      clientName: CL.displayName,
      updatedAt: I.updatedAt,
    })
    .from(I)
    .leftJoin(PR, eq(PR.id, I.projectId))
    .leftJoin(CL, eq(CL.id, I.clientId))
    .where(eq(I.organizationId, organizationId))
    .orderBy(desc(I.createdAt));

  return rows.map((r) => ({
    ...r,
    status: r.status as InvoiceStatus,
    invoiceType: r.invoiceType as InvoiceType,
  }));
}

/** Invoices for one project — feeds the project budget rollup. */
export async function invoicesForProject(organizationId: string, projectId: string) {
  const db = getDb();
  const I = schema.invoices;
  const rows = await db
    .select({
      id: I.id,
      invoiceNumber: I.invoiceNumber,
      status: I.status,
      total: I.total,
      amountPaid: I.amountPaid,
      balance: I.balance,
      dueDate: I.dueDate,
      invoiceType: I.invoiceType,
    })
    .from(I)
    .where(and(eq(I.organizationId, organizationId), eq(I.projectId, projectId)))
    .orderBy(desc(I.createdAt));
  return rows.map((r) => ({
    ...r,
    status: r.status as InvoiceStatus,
    invoiceType: r.invoiceType as InvoiceType,
  }));
}

/** One invoice with context, its lines, and the payments applied to it. */
export async function getInvoice(organizationId: string, invoiceId: string) {
  const db = getDb();
  const I = schema.invoices;
  const PR = schema.projects;
  const CL = schema.clients;

  const [row] = await db
    .select({
      invoice: I,
      projectName: PR.name,
      projectNumber: PR.projectNumber,
      clientName: CL.displayName,
    })
    .from(I)
    .leftJoin(PR, eq(PR.id, I.projectId))
    .leftJoin(CL, eq(CL.id, I.clientId))
    .where(and(eq(I.organizationId, organizationId), eq(I.id, invoiceId)));
  if (!row) return null;

  const lines = await db
    .select()
    .from(schema.invoiceLineItems)
    .where(
      and(
        eq(schema.invoiceLineItems.organizationId, organizationId),
        eq(schema.invoiceLineItems.invoiceId, invoiceId),
      ),
    )
    .orderBy(asc(schema.invoiceLineItems.sortOrder));

  const applied = await db
    .select({
      allocationId: schema.paymentAllocations.id,
      amount: schema.paymentAllocations.amount,
      paymentId: schema.payments.id,
      paymentDate: schema.payments.paymentDate,
      method: schema.payments.method,
      referenceNumber: schema.payments.referenceNumber,
      isRefund: schema.payments.isRefund,
    })
    .from(schema.paymentAllocations)
    .innerJoin(schema.payments, eq(schema.payments.id, schema.paymentAllocations.paymentId))
    .where(
      and(
        eq(schema.paymentAllocations.organizationId, organizationId),
        eq(schema.paymentAllocations.invoiceId, invoiceId),
      ),
    )
    .orderBy(desc(schema.payments.paymentDate));

  return { ...row, lines, applied };
}

/** Open (collectable) invoices on a project, for applying a payment. */
export async function openInvoicesForProject(organizationId: string, projectId: string) {
  const db = getDb();
  const I = schema.invoices;
  const rows = await db
    .select({
      id: I.id,
      invoiceNumber: I.invoiceNumber,
      total: I.total,
      balance: I.balance,
      status: I.status,
      dueDate: I.dueDate,
    })
    .from(I)
    .where(and(eq(I.organizationId, organizationId), eq(I.projectId, projectId)))
    .orderBy(asc(I.dueDate));
  return rows
    .map((r) => ({ ...r, status: r.status as InvoiceStatus }))
    .filter((r) => r.status !== 'draft' && r.status !== 'void' && Number(r.balance) > 0);
}

/**
 * Milestone → invoice map for a project, so the contract page can show which
 * milestones are already billed and not offer to bill them twice.
 */
export async function milestoneInvoiceMap(
  organizationId: string,
  projectId: string,
): Promise<Map<string, { id: string; invoiceNumber: string }>> {
  const db = getDb();
  const I = schema.invoices;
  const rows = await db
    .select({ id: I.id, invoiceNumber: I.invoiceNumber, milestoneId: I.milestoneId })
    .from(I)
    .where(and(eq(I.organizationId, organizationId), eq(I.projectId, projectId)));

  const map = new Map<string, { id: string; invoiceNumber: string }>();
  for (const row of rows) {
    if (row.milestoneId) {
      map.set(row.milestoneId, { id: row.id, invoiceNumber: row.invoiceNumber });
    }
  }
  return map;
}

/** Payments recorded against a project. */
export async function paymentsForProject(organizationId: string, projectId: string) {
  const db = getDb();
  const P = schema.payments;
  return db
    .select()
    .from(P)
    .where(and(eq(P.organizationId, organizationId), eq(P.projectId, projectId)))
    .orderBy(desc(P.paymentDate));
}
