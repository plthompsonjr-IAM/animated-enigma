import { and, eq, isNull } from 'drizzle-orm';
import { getDb, schema } from '@/db';

/**
 * A person's own connection, ciphertext included. This is the only query that
 * returns the ciphertext column, and it is scoped to the caller — there is no
 * path in this codebase that reads someone else's token, by construction.
 */
export async function ownConnection(organizationId: string, userId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.googleConnections)
    .where(
      and(
        eq(schema.googleConnections.organizationId, organizationId),
        eq(schema.googleConnections.userId, userId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Own connection only if it is still live. Null once revoked. */
export async function ownLiveConnection(organizationId: string, userId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.googleConnections)
    .where(
      and(
        eq(schema.googleConnections.organizationId, organizationId),
        eq(schema.googleConnections.userId, userId),
        isNull(schema.googleConnections.revokedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Who on the team has connected — for an administrator's view. Deliberately
 * never selects the ciphertext: row-level security decides which rows an owner
 * may see, and this query decides which columns. Both hold, independently.
 */
export async function teamConnections(organizationId: string) {
  const db = getDb();
  return db
    .select({
      userId: schema.googleConnections.userId,
      googleEmail: schema.googleConnections.googleEmail,
      scopes: schema.googleConnections.scopes,
      connectedAt: schema.googleConnections.connectedAt,
      revokedAt: schema.googleConnections.revokedAt,
    })
    .from(schema.googleConnections)
    .where(eq(schema.googleConnections.organizationId, organizationId))
    .orderBy(schema.googleConnections.connectedAt);
}
