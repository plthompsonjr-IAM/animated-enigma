import { and, eq, desc, asc, ilike, or, isNull, sql, type SQL } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import type { ClientSort, ClientType, DuplicateCandidate } from './clients-core';
import { normalizePhone } from './clients-core';

export interface ClientListParams {
  organizationId: string;
  search?: string;
  clientType?: ClientType | 'all';
  tag?: string;
  sort?: ClientSort;
  includeArchived?: boolean;
}

export interface ClientListRow {
  id: string;
  clientType: ClientType;
  displayName: string;
  companyName: string | null;
  primaryPhone: string | null;
  primaryEmail: string | null;
  tags: string[];
  propertyCount: number;
  projectCount: number;
  createdAt: Date;
}

/** List clients for the active org with search, type/tag filter, and sort. */
export async function listClients(params: ClientListParams): Promise<ClientListRow[]> {
  const db = getDb();
  const C = schema.clients;

  const filters: SQL[] = [eq(C.organizationId, params.organizationId)];
  if (!params.includeArchived) filters.push(isNull(C.deletedAt));
  if (params.clientType && params.clientType !== 'all') {
    filters.push(eq(C.clientType, params.clientType));
  }
  if (params.tag) filters.push(sql`${params.tag} = any(${C.tags})`);

  if (params.search) {
    const term = `%${params.search}%`;
    const digits = normalizePhone(params.search);
    const parts = [
      ilike(C.displayName, term),
      ilike(C.companyName, term),
      ilike(C.primaryEmail, term),
      ilike(C.primaryPhone, term),
    ];
    // A phone search should match regardless of stored formatting.
    if (digits.length >= 4) {
      parts.push(
        sql`regexp_replace(coalesce(${C.primaryPhone}, ''), '\\D', '', 'g') like ${'%' + digits + '%'}`,
      );
    }
    const match = or(...parts);
    if (match) filters.push(match);
  }

  const orderBy =
    params.sort === 'name'
      ? [asc(C.displayName)]
      : params.sort === 'oldest'
        ? [asc(C.createdAt)]
        : [desc(C.createdAt)];

  const P = schema.properties;
  const PR = schema.projects;
  const rows = await db
    .select({
      id: C.id,
      clientType: C.clientType,
      displayName: C.displayName,
      companyName: C.companyName,
      primaryPhone: C.primaryPhone,
      primaryEmail: C.primaryEmail,
      tags: C.tags,
      propertyCount: sql<number>`(select count(*)::int from ${P} where ${P.clientId} = ${C.id})`,
      projectCount: sql<number>`(select count(*)::int from ${PR} where ${PR.clientId} = ${C.id} and ${PR.deletedAt} is null)`,
      createdAt: C.createdAt,
    })
    .from(C)
    .where(and(...filters))
    .orderBy(...orderBy);

  return rows as ClientListRow[];
}

/** Distinct tags in use (for the tag filter dropdown). */
export async function clientTags(organizationId: string): Promise<string[]> {
  const db = getDb();
  const C = schema.clients;
  const rows = await db
    .select({ tag: sql<string>`distinct unnest(${C.tags})` })
    .from(C)
    .where(and(eq(C.organizationId, organizationId), isNull(C.deletedAt)));
  return rows.map((r) => r.tag).sort();
}

/** Full client record. */
export async function getClient(organizationId: string, clientId: string) {
  const db = getDb();
  const C = schema.clients;
  const [row] = await db
    .select()
    .from(C)
    .where(and(eq(C.organizationId, organizationId), eq(C.id, clientId)));
  return row ?? null;
}

/** Additional contacts on the client account, primary first. */
export async function getClientContacts(organizationId: string, clientId: string) {
  const db = getDb();
  const CC = schema.clientContacts;
  return db
    .select()
    .from(CC)
    .where(and(eq(CC.organizationId, organizationId), eq(CC.clientId, clientId)))
    .orderBy(desc(CC.isPrimary), asc(CC.name));
}

/** The client's properties, newest first. */
export async function getClientProperties(organizationId: string, clientId: string) {
  const db = getDb();
  const P = schema.properties;
  return db
    .select()
    .from(P)
    .where(and(eq(P.organizationId, organizationId), eq(P.clientId, clientId)))
    .orderBy(desc(P.createdAt));
}

/** One property (for the edit form). */
export async function getProperty(organizationId: string, propertyId: string) {
  const db = getDb();
  const P = schema.properties;
  const [row] = await db
    .select()
    .from(P)
    .where(and(eq(P.organizationId, organizationId), eq(P.id, propertyId)));
  return row ?? null;
}

export interface ClientHistory {
  leads: { id: string; leadName: string; status: string; createdAt: Date }[];
  projects: { id: string; projectNumber: string; name: string; status: string; createdAt: Date }[];
}

/** Interaction history: the client's leads and projects, newest first. */
export async function getClientHistory(
  organizationId: string,
  clientId: string,
): Promise<ClientHistory> {
  const db = getDb();
  const L = schema.leads;
  const PR = schema.projects;
  const [leads, projects] = await Promise.all([
    db
      .select({ id: L.id, leadName: L.leadName, status: L.status, createdAt: L.createdAt })
      .from(L)
      .where(
        and(eq(L.organizationId, organizationId), eq(L.clientId, clientId), isNull(L.deletedAt)),
      )
      .orderBy(desc(L.createdAt)),
    db
      .select({
        id: PR.id,
        projectNumber: PR.projectNumber,
        name: PR.name,
        status: PR.status,
        createdAt: PR.createdAt,
      })
      .from(PR)
      .where(
        and(eq(PR.organizationId, organizationId), eq(PR.clientId, clientId), isNull(PR.deletedAt)),
      )
      .orderBy(desc(PR.createdAt)),
  ]);
  return { leads, projects };
}

/**
 * Pre-filter for duplicate detection: existing clients whose phone, email, or
 * name loosely match the new input. The pure `findDuplicates` refines this
 * into per-record match reasons.
 */
export async function duplicateCandidates(
  organizationId: string,
  input: { displayName?: string | null; phone?: string | null; email?: string | null },
  excludeId?: string,
): Promise<DuplicateCandidate[]> {
  const db = getDb();
  const C = schema.clients;

  const parts: SQL[] = [];
  const digits = normalizePhone(input.phone);
  if (digits) {
    parts.push(sql`regexp_replace(coalesce(${C.primaryPhone}, ''), '\\D', '', 'g') = ${digits}`);
  }
  const email = (input.email ?? '').trim().toLowerCase();
  if (email) parts.push(sql`lower(coalesce(${C.primaryEmail}, '')) = ${email}`);
  if (input.displayName) {
    const name = ilike(C.displayName, input.displayName.trim());
    if (name) parts.push(name);
  }
  if (parts.length === 0) return [];

  const anyMatch = or(...parts);
  const filters: SQL[] = [eq(C.organizationId, organizationId), isNull(C.deletedAt)];
  if (anyMatch) filters.push(anyMatch);
  if (excludeId) filters.push(sql`${C.id} <> ${excludeId}`);

  const rows = await db
    .select({
      id: C.id,
      displayName: C.displayName,
      primaryPhone: C.primaryPhone,
      primaryEmail: C.primaryEmail,
    })
    .from(C)
    .where(and(...filters))
    .limit(5);
  return rows;
}
