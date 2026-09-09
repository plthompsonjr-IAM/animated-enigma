import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import type { EmailKind } from './email-core';

export interface Recipient {
  clientId: string;
  name: string;
  /** Null when the client record has no address anywhere — the screen says so. */
  email: string | null;
}

/**
 * Where a client's mail goes. The client's own address first; failing that,
 * the primary contact; failing that, any contact with an address. Null email
 * means "add one on the client record" — never a guess, never a placeholder.
 */
export async function recipientForClient(
  organizationId: string,
  clientId: string,
): Promise<Recipient | null> {
  const db = getDb();
  const [client] = await db
    .select({
      id: schema.clients.id,
      name: schema.clients.displayName,
      email: schema.clients.primaryEmail,
    })
    .from(schema.clients)
    .where(and(eq(schema.clients.organizationId, organizationId), eq(schema.clients.id, clientId)))
    .limit(1);
  if (!client) return null;
  if (client.email?.trim()) {
    return { clientId: client.id, name: client.name, email: client.email.trim() };
  }

  const contacts = await db
    .select({ email: schema.clientContacts.email, isPrimary: schema.clientContacts.isPrimary })
    .from(schema.clientContacts)
    .where(
      and(
        eq(schema.clientContacts.organizationId, organizationId),
        eq(schema.clientContacts.clientId, clientId),
        isNotNull(schema.clientContacts.email),
      ),
    )
    .orderBy(desc(schema.clientContacts.isPrimary));
  const contact = contacts.find((c) => c.email?.trim());
  return { clientId: client.id, name: client.name, email: contact?.email?.trim() ?? null };
}

/** The recipient for anything attached to a project — via the project's client. */
export async function recipientForProject(
  organizationId: string,
  projectId: string,
): Promise<Recipient | null> {
  const db = getDb();
  const [project] = await db
    .select({ clientId: schema.projects.clientId })
    .from(schema.projects)
    .where(and(eq(schema.projects.organizationId, organizationId), eq(schema.projects.id, projectId)))
    .limit(1);
  if (!project) return null;
  return recipientForClient(organizationId, project.clientId);
}

export interface LastEmail {
  sentAt: Date;
  to: string[];
  provider: string;
}

/** When this document was last successfully emailed, if ever. */
export async function lastEmailFor(
  organizationId: string,
  kind: EmailKind,
  relatedId: string,
): Promise<LastEmail | null> {
  const db = getDb();
  const [row] = await db
    .select({
      sentAt: schema.emailLog.sentAt,
      to: schema.emailLog.toAddresses,
      provider: schema.emailLog.provider,
    })
    .from(schema.emailLog)
    .where(
      and(
        eq(schema.emailLog.organizationId, organizationId),
        eq(schema.emailLog.kind, kind),
        eq(schema.emailLog.relatedId, relatedId),
        eq(schema.emailLog.status, 'sent'),
      ),
    )
    .orderBy(desc(schema.emailLog.sentAt))
    .limit(1);
  if (!row || !row.sentAt) return null;
  return { sentAt: row.sentAt, to: row.to, provider: row.provider };
}

/**
 * The newest share token for a change order. Filtered to rows that carry one:
 * "emailed" events are logged in the same table with a null token, and the
 * latest event is not necessarily the latest link.
 */
export async function latestChangeOrderToken(
  organizationId: string,
  changeOrderId: string,
): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ token: schema.changeOrderShareEvents.token })
    .from(schema.changeOrderShareEvents)
    .where(
      and(
        eq(schema.changeOrderShareEvents.organizationId, organizationId),
        eq(schema.changeOrderShareEvents.changeOrderId, changeOrderId),
        isNotNull(schema.changeOrderShareEvents.token),
      ),
    )
    .orderBy(desc(schema.changeOrderShareEvents.occurredAt))
    .limit(1);
  return row?.token ?? null;
}
