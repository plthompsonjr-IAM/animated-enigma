import { and, asc, desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import type { ChangeOrderStatus } from './change-orders-core';
import { hashChangeOrderToken } from './tokens';

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

export interface PublicChangeOrder {
  organizationId: string;
  changeOrderId: string;
  changeOrderNumber: string;
  status: ChangeOrderStatus;
  reason: string | null;
  clientExplanation: string | null;
  costChange: string;
  scheduleChangeDays: number | null;
  contractId: string | null;
  orgName: string;
  orgTagline: string | null;
  clientName: string | null;
  projectName: string | null;
  projectNumber: string | null;
  items: { direction: string; description: string; amount: string }[];
}

/**
 * Resolve a change order by its secure link (public, unauthenticated).
 * Possession of the token is the credential — deliberately no org scoping,
 * exactly as the proposal share link works. Internal notes are never selected.
 */
export async function getChangeOrderByToken(token: string): Promise<PublicChangeOrder | null> {
  const db = getDb();
  const CO = schema.changeOrders;
  const O = schema.organizations;
  const PR = schema.projects;
  const CL = schema.clients;

  const [row] = await db
    .select({
      organizationId: CO.organizationId,
      changeOrderId: CO.id,
      changeOrderNumber: CO.changeOrderNumber,
      status: CO.status,
      reason: CO.reason,
      clientExplanation: CO.clientExplanation,
      costChange: CO.costChange,
      scheduleChangeDays: CO.scheduleChangeDays,
      contractId: CO.contractId,
      orgName: O.name,
      orgTagline: O.tagline,
      clientName: CL.displayName,
      projectName: PR.name,
      projectNumber: PR.projectNumber,
    })
    .from(CO)
    .innerJoin(O, eq(O.id, CO.organizationId))
    .leftJoin(PR, eq(PR.id, CO.projectId))
    .leftJoin(CL, eq(CL.id, PR.clientId))
    .where(eq(CO.secureLinkTokenHash, hashChangeOrderToken(token)));
  if (!row) return null;

  const items = await db
    .select({
      direction: schema.changeOrderItems.direction,
      description: schema.changeOrderItems.description,
      amount: schema.changeOrderItems.amount,
    })
    .from(schema.changeOrderItems)
    .where(eq(schema.changeOrderItems.changeOrderId, row.changeOrderId))
    .orderBy(asc(schema.changeOrderItems.sortOrder));

  return { ...row, status: row.status as ChangeOrderStatus, items };
}

/** The signature captured when a client approved a change order. */
export async function signatureForChangeOrder(organizationId: string, changeOrderId: string) {
  const db = getDb();
  const S = schema.signatures;
  const [row] = await db
    .select()
    .from(S)
    .where(
      and(
        eq(S.organizationId, organizationId),
        eq(S.signableType, 'change_order'),
        eq(S.signableId, changeOrderId),
      ),
    )
    .orderBy(desc(S.signedAt));
  return row ?? null;
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
