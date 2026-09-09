import { and, eq, desc, asc } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { hashProposalToken } from './tokens';
import { isExpired, type ProposalStatus, type ProposalSnapshot } from './proposal-core';

export interface ProposalListRow {
  id: string;
  proposalNumber: string;
  status: ProposalStatus;
  displayStatus: ProposalStatus;
  projectId: string;
  projectName: string | null;
  clientName: string | null;
  price: number | null;
  expiresAt: Date | null;
  updatedAt: Date;
}

/** All proposals for the org, newest first, with project/client/price. */
export async function listProposals(organizationId: string): Promise<ProposalListRow[]> {
  const db = getDb();
  const P = schema.proposals;
  const PR = schema.projects;
  const C = schema.clients;
  const V = schema.proposalVersions;

  const rows = await db
    .select({
      id: P.id,
      proposalNumber: P.proposalNumber,
      status: P.status,
      projectId: P.projectId,
      projectName: PR.name,
      clientName: C.displayName,
      snapshot: V.contentSnapshot,
      expiresAt: P.expiresAt,
      updatedAt: P.updatedAt,
    })
    .from(P)
    .leftJoin(PR, eq(PR.id, P.projectId))
    .leftJoin(C, eq(C.id, PR.clientId))
    .leftJoin(V, eq(V.id, P.currentVersionId))
    .where(eq(P.organizationId, organizationId))
    .orderBy(desc(P.updatedAt));

  return rows.map((r) => {
    const status = r.status as ProposalStatus;
    const snapshot = r.snapshot as ProposalSnapshot | null;
    const displayStatus =
      !['accepted', 'declined'].includes(status) && isExpired(r.expiresAt) ? 'expired' : status;
    return {
      id: r.id,
      proposalNumber: r.proposalNumber,
      status,
      displayStatus,
      projectId: r.projectId,
      projectName: r.projectName,
      clientName: r.clientName,
      price: snapshot?.pricing?.total ?? null,
      expiresAt: r.expiresAt,
      updatedAt: r.updatedAt,
    };
  });
}

/** Proposals attached to a project (for the estimate page + project link). */
export async function proposalsForProject(organizationId: string, projectId: string) {
  const db = getDb();
  const P = schema.proposals;
  return db
    .select({
      id: P.id,
      proposalNumber: P.proposalNumber,
      status: P.status,
      expiresAt: P.expiresAt,
      createdAt: P.createdAt,
    })
    .from(P)
    .where(and(eq(P.organizationId, organizationId), eq(P.projectId, projectId)))
    .orderBy(desc(P.createdAt));
}

/** Full proposal with its current version snapshot + token hash. */
export async function getProposal(organizationId: string, proposalId: string) {
  const db = getDb();
  const P = schema.proposals;
  const V = schema.proposalVersions;
  const [row] = await db
    .select({
      proposal: P,
      version: V,
    })
    .from(P)
    .leftJoin(V, eq(V.id, P.currentVersionId))
    .where(and(eq(P.organizationId, organizationId), eq(P.id, proposalId)));
  return row ?? null;
}

/** Engagement timeline for a proposal's current version. */
export async function getProposalEvents(organizationId: string, versionId: string) {
  const db = getDb();
  const E = schema.proposalEvents;
  return db
    .select()
    .from(E)
    .where(and(eq(E.organizationId, organizationId), eq(E.proposalVersionId, versionId)))
    .orderBy(desc(E.occurredAt));
}

export interface PublicProposal {
  organizationId: string;
  proposalId: string;
  proposalNumber: string;
  versionId: string;
  status: ProposalStatus;
  displayStatus: ProposalStatus;
  snapshot: ProposalSnapshot | null;
  expiresAt: Date | null;
  /** The org's configured e-signature disclosure (Task 19); null → default. */
  disclosure: string | null;
}

/**
 * Resolve a proposal by its secure-link token (public, unauthenticated). Reads
 * through the app's postgres connection; no org scoping — possession of the
 * token is the credential.
 */
export async function getProposalByToken(token: string): Promise<PublicProposal | null> {
  const db = getDb();
  const V = schema.proposalVersions;
  const P = schema.proposals;
  const O = schema.organizations;
  const [row] = await db
    .select({
      organizationId: V.organizationId,
      proposalId: P.id,
      proposalNumber: P.proposalNumber,
      versionId: V.id,
      status: P.status,
      snapshot: V.contentSnapshot,
      expiresAt: P.expiresAt,
      currentVersionId: P.currentVersionId,
      disclosure: O.signatureDisclosure,
    })
    .from(V)
    .innerJoin(P, eq(P.id, V.proposalId))
    .innerJoin(O, eq(O.id, V.organizationId))
    .where(eq(V.secureLinkTokenHash, hashProposalToken(token)));
  if (!row) return null;
  // Only the current version's link is live.
  if (row.currentVersionId !== row.versionId) return null;

  const status = row.status as ProposalStatus;
  const displayStatus =
    !['accepted', 'declined'].includes(status) && isExpired(row.expiresAt) ? 'expired' : status;
  return {
    organizationId: row.organizationId,
    proposalId: row.proposalId,
    proposalNumber: row.proposalNumber,
    versionId: row.versionId,
    status,
    displayStatus,
    snapshot: row.snapshot as ProposalSnapshot | null,
    expiresAt: row.expiresAt,
    disclosure: row.disclosure,
  };
}

/**
 * The e-signature captured when a client accepted this proposal version (Task
 * 19). Null until they sign. Newest first in the unlikely event of duplicates —
 * signatures are append-only, so a re-sign adds a row rather than replacing one.
 */
export async function signatureForVersion(organizationId: string, versionId: string) {
  const db = getDb();
  const S = schema.signatures;
  const [row] = await db
    .select()
    .from(S)
    .where(
      and(
        eq(S.organizationId, organizationId),
        eq(S.signableType, 'proposal_version'),
        eq(S.signableId, versionId),
      ),
    )
    .orderBy(desc(S.signedAt));
  return row ?? null;
}

/** Scope sections (client-safe) for a scope version — feeds the snapshot. */
export async function scopeSectionsForSnapshot(organizationId: string, scopeVersionId: string) {
  const db = getDb();
  const S = schema.scopeSections;
  const I = schema.scopeItems;
  const sections = await db
    .select()
    .from(S)
    .where(and(eq(S.organizationId, organizationId), eq(S.scopeVersionId, scopeVersionId)))
    .orderBy(asc(S.sortOrder));
  const out: { sectionType: string; title: string; items: string[] }[] = [];
  for (const s of sections) {
    const items = await db
      .select({ description: I.description })
      .from(I)
      .where(and(eq(I.organizationId, organizationId), eq(I.scopeSectionId, s.id)))
      .orderBy(asc(I.sortOrder));
    out.push({
      sectionType: s.sectionType,
      title: s.title,
      items: items.map((i) => i.description),
    });
  }
  return out;
}
