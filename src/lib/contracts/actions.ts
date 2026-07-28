'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { logger } from '@/lib/logger';
import { getAuthContext, type AuthContext } from '@/lib/auth/session';
import { assertCan } from '@/lib/auth/rbac';
import type { FormState } from '@/lib/auth/actions';
import { toNum } from '@/lib/catalog/catalog-core';
import type { ProposalSnapshot } from '@/lib/proposals/proposal-core';
import {
  canTransition,
  defaultMilestones,
  formatContractNumber,
  isEditable,
  isPaymentStructure,
  validateSchedule,
  type ContractStatus,
  type MilestoneInput,
  type MilestoneTrigger,
} from './contracts-core';

async function requireFinancialsWrite(): Promise<
  { ok: true; ctx: AuthContext & { orgId: string; userId: string } } | { ok: false; error: string }
> {
  const ctx = await getAuthContext();
  if (!ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) {
    return { ok: false, error: 'Database or organization is not configured yet.' };
  }
  try {
    assertCan(ctx.activeOrg.roles, 'financials:write', ctx.activeOrg.extraPermissions);
  } catch {
    return { ok: false, error: 'You do not have permission to manage contracts.' };
  }
  return { ok: true, ctx: { ...ctx, orgId: ctx.activeOrg.organizationId, userId: ctx.userId } };
}

/**
 * Turn an accepted proposal into a draft contract. The contract value and scope
 * summary come from the proposal's frozen snapshot — the same numbers the client
 * agreed to — and the client's signature is linked as the basis of the
 * agreement. Refuses to run twice for the same proposal.
 */
export async function createContractFromProposal(formData: FormData): Promise<void> {
  const auth = await requireFinancialsWrite();
  if (!auth.ok) return;
  const { orgId, userId } = auth.ctx;

  const proposalId = uuidOrNull(formData.get('proposalId'));
  if (!proposalId) return;

  let contractId: string | null = null;
  try {
    const db = getDb();
    contractId = await db.transaction(async (tx) => {
      const [proposal] = await tx
        .select({
          id: schema.proposals.id,
          projectId: schema.proposals.projectId,
          status: schema.proposals.status,
          currentVersionId: schema.proposals.currentVersionId,
        })
        .from(schema.proposals)
        .where(
          and(eq(schema.proposals.organizationId, orgId), eq(schema.proposals.id, proposalId)),
        );
      if (!proposal) throw new Error('proposal not in org');
      if (proposal.status !== 'accepted') throw new Error('proposal is not accepted');
      if (!proposal.currentVersionId) throw new Error('proposal has no current version');

      const [existing] = await tx
        .select({ id: schema.contracts.id })
        .from(schema.contracts)
        .where(
          and(
            eq(schema.contracts.organizationId, orgId),
            eq(schema.contracts.proposalId, proposalId),
          ),
        );
      if (existing) return existing.id;

      const [version] = await tx
        .select({ snapshot: schema.proposalVersions.contentSnapshot })
        .from(schema.proposalVersions)
        .where(eq(schema.proposalVersions.id, proposal.currentVersionId));
      const snapshot = version?.snapshot as ProposalSnapshot | null;

      // The signature the client gave on this exact version is the contract's basis.
      const [signature] = await tx
        .select({ id: schema.signatures.id })
        .from(schema.signatures)
        .where(
          and(
            eq(schema.signatures.organizationId, orgId),
            eq(schema.signatures.signableType, 'proposal_version'),
            eq(schema.signatures.signableId, proposal.currentVersionId),
          ),
        );

      const year = new Date().getUTCFullYear();
      const [{ count }] = (await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.contracts)
        .where(eq(schema.contracts.organizationId, orgId))) as [{ count: number }];

      const [contract] = await tx
        .insert(schema.contracts)
        .values({
          organizationId: orgId,
          projectId: proposal.projectId,
          proposalId,
          contractNumber: formatContractNumber(year, count + 1),
          status: 'draft',
          contractValue: String(snapshot?.pricing?.total ?? 0),
          scopeSummary: summarizeScope(snapshot),
          signedSignatureId: signature?.id ?? null,
          createdBy: userId,
        })
        .returning({ id: schema.contracts.id });
      if (!contract) throw new Error('contract insert failed');
      return contract.id;
    });
  } catch (error) {
    logger.error('contracts: create failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  if (contractId) {
    revalidatePath('/contracts');
    redirect(`/contracts/${contractId}`);
  }
}

/**
 * Replace the payment schedule. Draft-only: the DB enforces this too, but we
 * validate here to return a friendly message instead of a 500.
 */
export async function savePaymentSchedule(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const auth = await requireFinancialsWrite();
  if (!auth.ok) return { error: auth.error };
  const { orgId } = auth.ctx;

  const contractId = uuidOrNull(formData.get('contractId'));
  const structureType = String(formData.get('structureType') ?? '');
  if (!contractId || !isPaymentStructure(structureType)) {
    return { error: 'Please choose a payment structure.' };
  }

  const milestones = readMilestones(formData);

  try {
    const db = getDb();
    const [contract] = await db
      .select({
        id: schema.contracts.id,
        status: schema.contracts.status,
        contractValue: schema.contracts.contractValue,
      })
      .from(schema.contracts)
      .where(and(eq(schema.contracts.organizationId, orgId), eq(schema.contracts.id, contractId)));
    if (!contract) return { error: 'Contract not found.' };
    if (!isEditable(contract.status as ContractStatus)) {
      return { error: 'This contract is no longer a draft — payment terms are locked.' };
    }

    const check = validateSchedule(milestones, toNum(contract.contractValue), structureType);
    if (!check.ok) return { error: check.error ?? 'Please check the payment schedule.' };

    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: schema.paymentSchedules.id })
        .from(schema.paymentSchedules)
        .where(
          and(
            eq(schema.paymentSchedules.organizationId, orgId),
            eq(schema.paymentSchedules.contractId, contractId),
          ),
        );

      let scheduleId = existing?.id;
      if (scheduleId) {
        await tx
          .update(schema.paymentSchedules)
          .set({ structureType })
          .where(eq(schema.paymentSchedules.id, scheduleId));
        await tx
          .delete(schema.paymentMilestones)
          .where(eq(schema.paymentMilestones.paymentScheduleId, scheduleId));
      } else {
        const [created] = await tx
          .insert(schema.paymentSchedules)
          .values({ organizationId: orgId, contractId, structureType })
          .returning({ id: schema.paymentSchedules.id });
        scheduleId = created?.id;
      }
      if (!scheduleId) throw new Error('schedule upsert failed');

      if (milestones.length > 0) {
        await tx.insert(schema.paymentMilestones).values(
          milestones.map((m, i) => ({
            organizationId: orgId,
            paymentScheduleId: scheduleId,
            name: m.name.trim(),
            sortOrder: i,
            amount:
              m.amount !== null && m.amount !== undefined && m.amount !== ''
                ? String(m.amount)
                : null,
            percentage:
              m.percentage !== null && m.percentage !== undefined && m.percentage !== ''
                ? String(m.percentage)
                : null,
            triggerType: m.triggerType ?? null,
            dueDate: m.dueDate && m.dueDate.length > 0 ? m.dueDate : null,
          })),
        );
      }
    });
  } catch (error) {
    logger.error('contracts: save schedule failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { error: 'Something went wrong saving the payment schedule.' };
  }

  revalidatePath(`/contracts/${contractId}`);
  return { message: 'Payment schedule saved.' };
}

/** Advance the contract lifecycle (draft → active → completed / cancelled). */
export async function changeContractStatus(formData: FormData): Promise<void> {
  const auth = await requireFinancialsWrite();
  if (!auth.ok) return;
  const { orgId } = auth.ctx;

  const contractId = uuidOrNull(formData.get('contractId'));
  const next = String(formData.get('status') ?? '') as ContractStatus;
  if (!contractId) return;

  try {
    const db = getDb();
    const [contract] = await db
      .select({ id: schema.contracts.id, status: schema.contracts.status })
      .from(schema.contracts)
      .where(and(eq(schema.contracts.organizationId, orgId), eq(schema.contracts.id, contractId)));
    if (!contract) return;

    const from = contract.status as ContractStatus;
    if (!canTransition(from, next)) return;

    // Activating freezes the contract: stamp the lock so the record shows when
    // the terms became binding.
    const now = new Date();
    await db
      .update(schema.contracts)
      .set({
        status: next,
        ...(next === 'active' ? { activatedAt: now, lockedAt: now } : {}),
      })
      .where(eq(schema.contracts.id, contractId));
  } catch (error) {
    logger.error('contracts: status change failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  revalidatePath(`/contracts/${contractId}`);
  revalidatePath('/contracts');
}

/** Prefill the schedule form with the structure's conventional split. */
export async function suggestMilestones(structure: string): Promise<MilestoneInput[]> {
  return isPaymentStructure(structure) ? defaultMilestones(structure) : [];
}

// ── helpers ──────────────────────────────────────────────────────────────────

function readMilestones(formData: FormData): MilestoneInput[] {
  const names = formData.getAll('milestoneName').map(String);
  const amounts = formData.getAll('milestoneAmount').map(String);
  const percentages = formData.getAll('milestonePercentage').map(String);
  const triggers = formData.getAll('milestoneTrigger').map(String);
  const dueDates = formData.getAll('milestoneDueDate').map(String);

  return names
    .map((name, i) => ({
      name,
      amount: amounts[i] ?? '',
      percentage: percentages[i] ?? '',
      triggerType: (triggers[i] as MilestoneTrigger) || null,
      dueDate: dueDates[i] ?? null,
      sortOrder: i,
    }))
    .filter((m) => m.name.trim().length > 0 || m.amount !== '' || m.percentage !== '');
}

/** A short, client-safe scope line for the contract header. */
function summarizeScope(snapshot: ProposalSnapshot | null): string | null {
  if (!snapshot) return null;
  const included = snapshot.scope?.sections?.find((s) => s.sectionType === 'included');
  const source = included ?? snapshot.scope?.sections?.[0];
  if (!source || source.items.length === 0) return snapshot.project?.name ?? null;
  return source.items.slice(0, 6).join('; ');
}

function uuidOrNull(value: FormDataEntryValue | null): string | null {
  const s = typeof value === 'string' ? value : '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null;
}
