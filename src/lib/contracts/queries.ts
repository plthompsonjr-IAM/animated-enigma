import { and, asc, desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import type { ContractStatus } from './contracts-core';

export interface ContractListRow {
  id: string;
  contractNumber: string;
  status: ContractStatus;
  contractValue: string;
  projectId: string;
  projectName: string | null;
  clientName: string | null;
  activatedAt: Date | null;
  updatedAt: Date;
}

/** All contracts for the org, newest first, with project/client context. */
export async function listContracts(organizationId: string): Promise<ContractListRow[]> {
  const db = getDb();
  const C = schema.contracts;
  const PR = schema.projects;
  const CL = schema.clients;

  const rows = await db
    .select({
      id: C.id,
      contractNumber: C.contractNumber,
      status: C.status,
      contractValue: C.contractValue,
      projectId: C.projectId,
      projectName: PR.name,
      clientName: CL.displayName,
      activatedAt: C.activatedAt,
      updatedAt: C.updatedAt,
    })
    .from(C)
    .leftJoin(PR, eq(PR.id, C.projectId))
    .leftJoin(CL, eq(CL.id, PR.clientId))
    .where(eq(C.organizationId, organizationId))
    .orderBy(desc(C.updatedAt));

  return rows.map((r) => ({ ...r, status: r.status as ContractStatus }));
}

/** One contract with its project/client context. */
export async function getContract(organizationId: string, contractId: string) {
  const db = getDb();
  const C = schema.contracts;
  const PR = schema.projects;
  const CL = schema.clients;
  const [row] = await db
    .select({
      contract: C,
      projectName: PR.name,
      projectNumber: PR.projectNumber,
      clientName: CL.displayName,
    })
    .from(C)
    .leftJoin(PR, eq(PR.id, C.projectId))
    .leftJoin(CL, eq(CL.id, PR.clientId))
    .where(and(eq(C.organizationId, organizationId), eq(C.id, contractId)));
  return row ?? null;
}

/** The contract created from a proposal, if any (one per proposal). */
export async function contractForProposal(organizationId: string, proposalId: string) {
  const db = getDb();
  const C = schema.contracts;
  const [row] = await db
    .select({ id: C.id, contractNumber: C.contractNumber, status: C.status })
    .from(C)
    .where(and(eq(C.organizationId, organizationId), eq(C.proposalId, proposalId)));
  return row ?? null;
}

/** Contracts attached to a project. */
export async function contractsForProject(organizationId: string, projectId: string) {
  const db = getDb();
  const C = schema.contracts;
  return db
    .select({
      id: C.id,
      contractNumber: C.contractNumber,
      status: C.status,
      contractValue: C.contractValue,
    })
    .from(C)
    .where(and(eq(C.organizationId, organizationId), eq(C.projectId, projectId)))
    .orderBy(desc(C.createdAt));
}

/** The payment schedule and its milestones, in display order. */
export async function paymentScheduleFor(organizationId: string, contractId: string) {
  const db = getDb();
  const S = schema.paymentSchedules;
  const M = schema.paymentMilestones;
  const [scheduleRow] = await db
    .select()
    .from(S)
    .where(and(eq(S.organizationId, organizationId), eq(S.contractId, contractId)));
  if (!scheduleRow) return { schedule: null, milestones: [] };

  const milestones = await db
    .select()
    .from(M)
    .where(and(eq(M.organizationId, organizationId), eq(M.paymentScheduleId, scheduleRow.id)))
    .orderBy(asc(M.sortOrder));
  return { schedule: scheduleRow, milestones };
}
