import { and, asc, desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import type { ChangeOrderStatus } from './change-orders-core';

/** Change orders raised against a contract, newest first. */
export async function changeOrdersForContract(organizationId: string, contractId: string) {
  const db = getDb();
  const CO = schema.changeOrders;
  const rows = await db
    .select({
      id: CO.id,
      changeOrderNumber: CO.changeOrderNumber,
      status: CO.status,
      costChange: CO.costChange,
      scheduleChangeDays: CO.scheduleChangeDays,
      reason: CO.reason,
      approvedAt: CO.approvedAt,
      createdAt: CO.createdAt,
    })
    .from(CO)
    .where(and(eq(CO.organizationId, organizationId), eq(CO.contractId, contractId)))
    .orderBy(desc(CO.createdAt));
  return rows.map((r) => ({ ...r, status: r.status as ChangeOrderStatus }));
}

/** Change orders on a project, regardless of contract. */
export async function changeOrdersForProject(organizationId: string, projectId: string) {
  const db = getDb();
  const CO = schema.changeOrders;
  const rows = await db
    .select({
      id: CO.id,
      changeOrderNumber: CO.changeOrderNumber,
      status: CO.status,
      costChange: CO.costChange,
      scheduleChangeDays: CO.scheduleChangeDays,
      createdAt: CO.createdAt,
    })
    .from(CO)
    .where(and(eq(CO.organizationId, organizationId), eq(CO.projectId, projectId)))
    .orderBy(desc(CO.createdAt));
  return rows.map((r) => ({ ...r, status: r.status as ChangeOrderStatus }));
}

/** One change order with project/client context and its line items. */
export async function getChangeOrder(organizationId: string, changeOrderId: string) {
  const db = getDb();
  const CO = schema.changeOrders;
  const PR = schema.projects;
  const CL = schema.clients;

  const [row] = await db
    .select({
      changeOrder: CO,
      projectName: PR.name,
      projectNumber: PR.projectNumber,
      clientName: CL.displayName,
    })
    .from(CO)
    .leftJoin(PR, eq(PR.id, CO.projectId))
    .leftJoin(CL, eq(CL.id, PR.clientId))
    .where(and(eq(CO.organizationId, organizationId), eq(CO.id, changeOrderId)));
  if (!row) return null;

  const items = await db
    .select()
    .from(schema.changeOrderItems)
    .where(
      and(
        eq(schema.changeOrderItems.organizationId, organizationId),
        eq(schema.changeOrderItems.changeOrderId, changeOrderId),
      ),
    )
    .orderBy(asc(schema.changeOrderItems.sortOrder));

  return { ...row, items };
}
