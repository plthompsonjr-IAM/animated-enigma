'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { logger } from '@/lib/logger';
import { getAuthContext, type AuthContext } from '@/lib/auth/session';
import { assertCan } from '@/lib/auth/rbac';
import type { FormState } from '@/lib/auth/actions';
import { toNum } from '@/lib/catalog/catalog-core';
import { formatAddress } from '@/lib/clients/clients-core';
import { generateProposalToken, hashProposalToken } from './tokens';
import {
  buildProposalSnapshot,
  formatProposalNumber,
  canRespond,
  isExpired,
  type ProposalStatus,
} from './proposal-core';
import {
  buildSignatureRecord,
  clientIpFromForwardedFor,
  isValidSignerName,
  normalizeSignerName,
  truncateUserAgent,
} from '@/lib/signatures/signature-core';
import { scopeSectionsForSnapshot } from './queries';
import { createProposalSchema, markSentSchema, respondSchema } from './schema';

async function requireProposalWrite(): Promise<
  { ok: true; ctx: AuthContext & { orgId: string; userId: string } } | { ok: false; error: string }
> {
  const ctx = await getAuthContext();
  if (!ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) {
    return { ok: false, error: 'Database or organization is not configured yet.' };
  }
  try {
    assertCan(ctx.activeOrg.roles, 'estimates:write', ctx.activeOrg.extraPermissions);
  } catch {
    return { ok: false, error: 'You do not have permission to manage proposals.' };
  }
  return { ok: true, ctx: { ...ctx, orgId: ctx.activeOrg.organizationId, userId: ctx.userId } };
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

/** Assemble the client-safe snapshot from an estimate + its scope + context. */
async function buildSnapshotForEstimate(
  tx: Tx,
  orgId: string,
  estimateVersionId: string,
  preparedBy: string | null,
) {
  const [estimate] = await tx
    .select({
      finalPrice: schema.estimateVersions.finalPrice,
      scopeVersionId: schema.estimateVersions.scopeVersionId,
      projectId: schema.estimateVersions.projectId,
    })
    .from(schema.estimateVersions)
    .where(
      and(
        eq(schema.estimateVersions.organizationId, orgId),
        eq(schema.estimateVersions.id, estimateVersionId),
      ),
    );
  if (!estimate) throw new Error('estimate not in org');

  const [project] = await tx
    .select({
      id: schema.projects.id,
      number: schema.projects.projectNumber,
      name: schema.projects.name,
      type: schema.projects.projectType,
      clientId: schema.projects.clientId,
      propertyId: schema.projects.propertyId,
    })
    .from(schema.projects)
    .where(
      and(eq(schema.projects.organizationId, orgId), eq(schema.projects.id, estimate.projectId)),
    );
  if (!project) throw new Error('project not found');

  const [org] = await tx
    .select({ name: schema.organizations.name })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, orgId));

  const [client] = await tx
    .select({ name: schema.clients.displayName })
    .from(schema.clients)
    .where(and(eq(schema.clients.organizationId, orgId), eq(schema.clients.id, project.clientId)));

  let address: string | null = null;
  if (project.propertyId) {
    const [property] = await tx
      .select({ address: schema.properties.address })
      .from(schema.properties)
      .where(
        and(
          eq(schema.properties.organizationId, orgId),
          eq(schema.properties.id, project.propertyId),
        ),
      );
    address = property ? formatAddress(property.address) || null : null;
  }

  const sections = estimate.scopeVersionId
    ? await scopeSectionsForSnapshot(orgId, estimate.scopeVersionId)
    : [];

  const snapshot = buildProposalSnapshot({
    org: { name: org?.name ?? 'Our Company', tagline: null },
    client: { name: client?.name ?? 'Client' },
    project: { number: project.number, name: project.name, type: project.type, address },
    scope: { sections },
    price: toNum(estimate.finalPrice),
    preparedBy,
    preparedAt: new Date().toISOString(),
  });

  return { snapshot, projectId: estimate.projectId, scopeVersionId: estimate.scopeVersionId };
}

// ── Create ───────────────────────────────────────────────────────────────────

export async function createProposal(formData: FormData): Promise<void> {
  const auth = await requireProposalWrite();
  if (!auth.ok) return;
  const { orgId, userId } = auth.ctx;

  const parsed = createProposalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const { estimateVersionId } = parsed.data;

  let proposalId: string | null = null;
  try {
    const db = getDb();
    proposalId = await db.transaction(async (tx) => {
      const { snapshot, projectId, scopeVersionId } = await buildSnapshotForEstimate(
        tx,
        orgId,
        estimateVersionId,
        auth.ctx.email ?? null,
      );

      const year = new Date().getUTCFullYear();
      const [{ count }] = (await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.proposals)
        .where(eq(schema.proposals.organizationId, orgId))) as [{ count: number }];
      const proposalNumber = formatProposalNumber(year, count + 1);

      const [proposal] = await tx
        .insert(schema.proposals)
        .values({
          organizationId: orgId,
          projectId,
          proposalNumber,
          estimateVersionId,
          scopeVersionId: scopeVersionId ?? null,
          status: 'draft',
          createdBy: userId,
        })
        .returning({ id: schema.proposals.id });
      if (!proposal) throw new Error('proposal insert failed');

      const { token, tokenHash } = generateProposalToken();
      const [version] = await tx
        .insert(schema.proposalVersions)
        .values({
          organizationId: orgId,
          proposalId: proposal.id,
          versionNumber: 1,
          contentSnapshot: snapshot,
          secureLinkTokenHash: tokenHash,
          createdBy: userId,
        })
        .returning({ id: schema.proposalVersions.id });
      if (!version) throw new Error('version insert failed');

      await tx
        .update(schema.proposals)
        .set({ currentVersionId: version.id })
        .where(eq(schema.proposals.id, proposal.id));

      // Stash the raw token on the proposal row's activity? Store on the version
      // is by hash only; the raw token is surfaced once via the event metadata
      // so the internal user can copy the link.
      await tx.insert(schema.proposalEvents).values({
        organizationId: orgId,
        proposalVersionId: version.id,
        eventType: 'created',
        metadata: { token },
      });

      return proposal.id;
    });
  } catch (error) {
    logger.error('proposals: create failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  if (proposalId) {
    revalidatePath('/proposals');
    redirect(`/proposals/${proposalId}`);
  }
}

// ── Send / regenerate ──────────────────────────────────────────────────────────

export async function markSent(formData: FormData): Promise<void> {
  const auth = await requireProposalWrite();
  if (!auth.ok) return;
  const orgId = auth.ctx.orgId;

  const parsed = markSentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;

  const db = getDb();
  await db.transaction(async (tx) => {
    const [proposal] = await tx
      .select({
        id: schema.proposals.id,
        currentVersionId: schema.proposals.currentVersionId,
        status: schema.proposals.status,
      })
      .from(schema.proposals)
      .where(
        and(
          eq(schema.proposals.organizationId, orgId),
          eq(schema.proposals.id, parsed.data.proposalId),
        ),
      );
    if (!proposal || !proposal.currentVersionId) return;

    const expiresAt = new Date(Date.now() + parsed.data.expiresInDays * 86_400_000);
    await tx
      .update(schema.proposals)
      .set({ status: 'sent', expiresAt })
      .where(eq(schema.proposals.id, proposal.id));
    await tx.insert(schema.proposalEvents).values({
      organizationId: orgId,
      proposalVersionId: proposal.currentVersionId,
      eventType: 'sent',
    });
  });

  revalidatePath(`/proposals/${parsed.data.proposalId}`);
  revalidatePath('/proposals');
}

/** Re-snapshot the linked estimate into a fresh version with a new link. */
export async function regenerateProposal(formData: FormData): Promise<void> {
  const auth = await requireProposalWrite();
  if (!auth.ok) return;
  const { orgId, userId } = auth.ctx;
  const proposalId = z_uuid(formData.get('proposalId'));
  if (!proposalId) return;

  const db = getDb();
  await db.transaction(async (tx) => {
    const [proposal] = await tx
      .select({ id: schema.proposals.id, estimateVersionId: schema.proposals.estimateVersionId })
      .from(schema.proposals)
      .where(and(eq(schema.proposals.organizationId, orgId), eq(schema.proposals.id, proposalId)));
    if (!proposal || !proposal.estimateVersionId) return;

    const { snapshot } = await buildSnapshotForEstimate(
      tx,
      orgId,
      proposal.estimateVersionId,
      auth.ctx.email ?? null,
    );

    const [{ max }] = (await tx
      .select({ max: sql<number>`coalesce(max(${schema.proposalVersions.versionNumber}), 0)::int` })
      .from(schema.proposalVersions)
      .where(
        and(
          eq(schema.proposalVersions.organizationId, orgId),
          eq(schema.proposalVersions.proposalId, proposalId),
        ),
      )) as [{ max: number }];
    const { token, tokenHash } = generateProposalToken();
    const [version] = await tx
      .insert(schema.proposalVersions)
      .values({
        organizationId: orgId,
        proposalId,
        versionNumber: (max ?? 0) + 1,
        contentSnapshot: snapshot,
        secureLinkTokenHash: tokenHash,
        createdBy: userId,
      })
      .returning({ id: schema.proposalVersions.id });
    if (!version) return;

    await tx
      .update(schema.proposals)
      .set({ currentVersionId: version.id, status: 'draft', expiresAt: null })
      .where(eq(schema.proposals.id, proposalId));
    await tx.insert(schema.proposalEvents).values({
      organizationId: orgId,
      proposalVersionId: version.id,
      eventType: 'new_version',
      metadata: { token },
    });
  });

  revalidatePath(`/proposals/${proposalId}`);
}

// ── Public: view + respond (no auth) ──────────────────────────────────────────

/** Record a client view (idempotent-ish: bumps sent→viewed, logs an event). */
export async function recordProposalView(token: string): Promise<void> {
  const db = getDb();
  const V = schema.proposalVersions;
  const P = schema.proposals;
  const [row] = await db
    .select({
      orgId: V.organizationId,
      versionId: V.id,
      proposalId: P.id,
      status: P.status,
      currentVersionId: P.currentVersionId,
    })
    .from(V)
    .innerJoin(P, eq(P.id, V.proposalId))
    .where(eq(V.secureLinkTokenHash, hashProposalToken(token)));
  if (!row || row.currentVersionId !== row.versionId) return;

  const headerList = await headers();
  await db.transaction(async (tx) => {
    await tx.insert(schema.proposalEvents).values({
      organizationId: row.orgId,
      proposalVersionId: row.versionId,
      eventType: 'viewed',
      ipAddress: clientIpFromForwardedFor(headerList.get('x-forwarded-for')),
      userAgent: truncateUserAgent(headerList.get('user-agent')),
    });
    if (row.status === 'sent') {
      await tx
        .update(schema.proposals)
        .set({ status: 'viewed' })
        .where(eq(schema.proposals.id, row.proposalId));
    }
  });
}

export async function respondToProposal(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = respondSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Please check the form.' };
  }
  const { token, decision, signerName, signerEmail } = parsed.data;
  if (!isValidSignerName(signerName)) {
    return { error: 'Please enter your full name as your signature.' };
  }

  // Audit metadata for the signature record — captured server-side so the
  // client cannot forge it.
  const headerList = await headers();
  const ipAddress = clientIpFromForwardedFor(headerList.get('x-forwarded-for'));
  const userAgent = headerList.get('user-agent');

  try {
    const db = getDb();
    const V = schema.proposalVersions;
    const P = schema.proposals;
    const O = schema.organizations;
    const [row] = await db
      .select({
        orgId: V.organizationId,
        versionId: V.id,
        proposalId: P.id,
        status: P.status,
        expiresAt: P.expiresAt,
        currentVersionId: P.currentVersionId,
        disclosure: O.signatureDisclosure,
      })
      .from(V)
      .innerJoin(P, eq(P.id, V.proposalId))
      .innerJoin(O, eq(O.id, V.organizationId))
      .where(eq(V.secureLinkTokenHash, hashProposalToken(token)));
    if (!row || row.currentVersionId !== row.versionId) {
      return { error: 'This proposal link is no longer valid.' };
    }
    if (isExpired(row.expiresAt)) return { error: 'This proposal has expired. Please contact us.' };
    if (!canRespond(row.status as ProposalStatus)) {
      return { error: 'This proposal has already been responded to.' };
    }

    const newStatus = decision === 'accept' ? 'accepted' : 'declined';
    await db.transaction(async (tx) => {
      // Accepting is a signing act: capture an immutable signature record with
      // the signer, timestamp, network/device metadata, and the exact
      // disclosure text that was shown. Declining is only an audit event.
      let signatureId: string | null = null;
      if (decision === 'accept') {
        const record = buildSignatureRecord({
          organizationId: row.orgId,
          signableType: 'proposal_version',
          signableId: row.versionId,
          signerName,
          signerEmail,
          disclosure: row.disclosure,
          ipAddress,
          userAgent,
        });
        const [signature] = await tx
          .insert(schema.signatures)
          .values(record)
          .returning({ id: schema.signatures.id });
        signatureId = signature?.id ?? null;
      }

      await tx.insert(schema.proposalEvents).values({
        organizationId: row.orgId,
        proposalVersionId: row.versionId,
        eventType: newStatus,
        actorEmail: signerEmail && signerEmail.length > 0 ? signerEmail : null,
        ipAddress,
        userAgent: truncateUserAgent(userAgent),
        metadata: { signerName: normalizeSignerName(signerName), signatureId },
      });
      await tx
        .update(schema.proposals)
        .set({ status: newStatus })
        .where(eq(schema.proposals.id, row.proposalId));
    });
  } catch (error) {
    logger.error('proposals: respond failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { error: 'Something went wrong. Please try again.' };
  }

  return { message: parsed.data.decision === 'accept' ? 'accepted' : 'declined' };
}

function z_uuid(v: FormDataEntryValue | null): string | null {
  const s = typeof v === 'string' ? v : '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null;
}
