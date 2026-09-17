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
import {
  balanceOf,
  formatInvoiceNumber,
  invoiceTotals,
  isEditable,
  isInvoiceType,
  isPaymentMethod,
  lineAmount,
  validateAllocations,
  validateInvoice,
  type InvoiceLineInput,
  type InvoiceStatus,
  type InvoiceType,
  type PaymentMethod,
} from './invoices-core';

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
    return { ok: false, error: 'You do not have permission to manage invoices.' };
  }
  return { ok: true, ctx: { ...ctx, orgId: ctx.activeOrg.organizationId, userId: ctx.userId } };
}

/** Allocate the next invoice number for the org. */
async function nextInvoiceNumber(tx: Tx, orgId: string): Promise<string> {
  const [{ count }] = (await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.invoices)
    .where(eq(schema.invoices.organizationId, orgId))) as [{ count: number }];
  return formatInvoiceNumber(new Date().getUTCFullYear(), count + 1);
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

/** Create a blank draft invoice for a project. */
export async function createInvoice(formData: FormData): Promise<void> {
  const auth = await requireFinancialsWrite();
  if (!auth.ok) return;
  const { orgId, userId } = auth.ctx;

  const projectId = uuidOrNull(formData.get('projectId'));
  const rawType = String(formData.get('invoiceType') ?? 'progress');
  const invoiceType: InvoiceType = isInvoiceType(rawType) ? rawType : 'progress';
  if (!projectId) return;

  let invoiceId: string | null = null;
  try {
    const db = getDb();
    invoiceId = await db.transaction(async (tx) => {
      const [project] = await tx
        .select({ id: schema.projects.id, clientId: schema.projects.clientId })
        .from(schema.projects)
        .where(and(eq(schema.projects.organizationId, orgId), eq(schema.projects.id, projectId)));
      if (!project) throw new Error('project not in org');

      const [created] = await tx
        .insert(schema.invoices)
        .values({
          organizationId: orgId,
          projectId: project.id,
          clientId: project.clientId,
          invoiceNumber: await nextInvoiceNumber(tx, orgId),
          invoiceType,
          status: 'draft',
          createdBy: userId,
        })
        .returning({ id: schema.invoices.id });
      if (!created) throw new Error('invoice insert failed');
      return created.id;
    });
  } catch (error) {
    logger.error('invoices: create failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  if (invoiceId) {
    revalidatePath('/invoices');
    redirect(`/invoices/${invoiceId}`);
  }
}

/**
 * Bill an approved change order. The invoice lines mirror the change order's
 * added/removed items so the client sees the same itemisation they approved.
 * Only for a positive net change — a credit is handled as a credit note, not an
 * invoice. Refuses to bill the same change order twice.
 */
export async function invoiceChangeOrder(formData: FormData): Promise<void> {
  const auth = await requireFinancialsWrite();
  if (!auth.ok) return;
  const { orgId, userId } = auth.ctx;

  const changeOrderId = uuidOrNull(formData.get('changeOrderId'));
  if (!changeOrderId) return;

  let invoiceId: string | null = null;
  try {
    const db = getDb();
    invoiceId = await db.transaction(async (tx) => {
      const [co] = await tx
        .select({
          id: schema.changeOrders.id,
          projectId: schema.changeOrders.projectId,
          status: schema.changeOrders.status,
          costChange: schema.changeOrders.costChange,
          changeOrderNumber: schema.changeOrders.changeOrderNumber,
        })
        .from(schema.changeOrders)
        .where(
          and(
            eq(schema.changeOrders.organizationId, orgId),
            eq(schema.changeOrders.id, changeOrderId),
          ),
        );
      if (!co) throw new Error('change order not in org');
      if (co.status !== 'approved' && co.status !== 'incorporated') {
        throw new Error('change order is not approved');
      }
      if (toNum(co.costChange) <= 0) throw new Error('change order is not billable');

      const [existing] = await tx
        .select({ id: schema.invoices.id })
        .from(schema.invoices)
        .where(
          and(
            eq(schema.invoices.organizationId, orgId),
            eq(schema.invoices.changeOrderId, changeOrderId),
          ),
        );
      if (existing) return existing.id;

      const [project] = await tx
        .select({ clientId: schema.projects.clientId })
        .from(schema.projects)
        .where(eq(schema.projects.id, co.projectId));
      if (!project) throw new Error('project not found');

      const coItems = await tx
        .select({
          direction: schema.changeOrderItems.direction,
          description: schema.changeOrderItems.description,
          amount: schema.changeOrderItems.amount,
          sortOrder: schema.changeOrderItems.sortOrder,
        })
        .from(schema.changeOrderItems)
        .where(eq(schema.changeOrderItems.changeOrderId, changeOrderId));

      // Added work becomes a billed line; removed work becomes a credit so the
      // invoice total matches the approved net change.
      const lines: InvoiceLineInput[] = coItems
        .filter((i) => i.direction !== 'removed')
        .map((i) => ({ description: i.description, quantity: 1, unitPrice: i.amount }));
      const creditTotal = coItems
        .filter((i) => i.direction === 'removed')
        .reduce((total, i) => total + Math.abs(toNum(i.amount)), 0);

      const totals = invoiceTotals(lines, 0, creditTotal);

      const [created] = await tx
        .insert(schema.invoices)
        .values({
          organizationId: orgId,
          projectId: co.projectId,
          clientId: project.clientId,
          invoiceNumber: await nextInvoiceNumber(tx, orgId),
          invoiceType: 'change_order',
          changeOrderId,
          status: 'draft',
          subtotal: String(totals.subtotal),
          taxRate: '0',
          taxAmount: String(totals.taxAmount),
          credits: String(totals.credits),
          total: String(totals.total),
          balance: String(totals.total),
          notes: `Approved change order ${co.changeOrderNumber}`,
          createdBy: userId,
        })
        .returning({ id: schema.invoices.id });
      if (!created) throw new Error('invoice insert failed');

      if (lines.length > 0) {
        await tx.insert(schema.invoiceLineItems).values(
          lines.map((line, i) => ({
            organizationId: orgId,
            invoiceId: created.id,
            description: line.description,
            quantity: '1',
            unitPrice: String(toNum(line.unitPrice)),
            amount: String(lineAmount(line)),
            taxable: true,
            sortOrder: i,
          })),
        );
      }
      return created.id;
    });
  } catch (error) {
    logger.error('invoices: change-order invoice failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  if (invoiceId) {
    revalidatePath(`/change-orders/${changeOrderId}`);
    redirect(`/invoices/${invoiceId}`);
  }
}

/** Bill a contract payment milestone. Refuses to bill the same one twice. */
export async function invoiceMilestone(formData: FormData): Promise<void> {
  const auth = await requireFinancialsWrite();
  if (!auth.ok) return;
  const { orgId, userId } = auth.ctx;

  const milestoneId = uuidOrNull(formData.get('milestoneId'));
  if (!milestoneId) return;

  let invoiceId: string | null = null;
  try {
    const db = getDb();
    invoiceId = await db.transaction(async (tx) => {
      const [milestone] = await tx
        .select({
          id: schema.paymentMilestones.id,
          name: schema.paymentMilestones.name,
          amount: schema.paymentMilestones.amount,
          percentage: schema.paymentMilestones.percentage,
          dueDate: schema.paymentMilestones.dueDate,
          scheduleId: schema.paymentMilestones.paymentScheduleId,
        })
        .from(schema.paymentMilestones)
        .where(
          and(
            eq(schema.paymentMilestones.organizationId, orgId),
            eq(schema.paymentMilestones.id, milestoneId),
          ),
        );
      if (!milestone) throw new Error('milestone not in org');

      const [existing] = await tx
        .select({ id: schema.invoices.id })
        .from(schema.invoices)
        .where(
          and(
            eq(schema.invoices.organizationId, orgId),
            eq(schema.invoices.milestoneId, milestoneId),
          ),
        );
      if (existing) return existing.id;

      const [schedule] = await tx
        .select({ contractId: schema.paymentSchedules.contractId })
        .from(schema.paymentSchedules)
        .where(eq(schema.paymentSchedules.id, milestone.scheduleId));
      if (!schedule) throw new Error('schedule not found');

      const [contract] = await tx
        .select({
          projectId: schema.contracts.projectId,
          contractValue: schema.contracts.contractValue,
          contractNumber: schema.contracts.contractNumber,
        })
        .from(schema.contracts)
        .where(eq(schema.contracts.id, schedule.contractId));
      if (!contract) throw new Error('contract not found');

      const [project] = await tx
        .select({ clientId: schema.projects.clientId })
        .from(schema.projects)
        .where(eq(schema.projects.id, contract.projectId));
      if (!project) throw new Error('project not found');

      // Resolve the milestone to dollars the same way the schedule displays it.
      const amount =
        milestone.amount !== null && milestone.amount !== undefined
          ? toNum(milestone.amount)
          : (toNum(milestone.percentage) / 100) * toNum(contract.contractValue);
      const rounded = Math.round((amount + Number.EPSILON) * 100) / 100;
      if (rounded <= 0) throw new Error('milestone has no amount');

      const line: InvoiceLineInput = {
        description: `${milestone.name} — contract ${contract.contractNumber}`,
        quantity: 1,
        unitPrice: rounded,
        taxable: false,
      };
      const totals = invoiceTotals([line], 0, 0);

      const [created] = await tx
        .insert(schema.invoices)
        .values({
          organizationId: orgId,
          projectId: contract.projectId,
          clientId: project.clientId,
          invoiceNumber: await nextInvoiceNumber(tx, orgId),
          invoiceType: 'milestone',
          milestoneId,
          status: 'draft',
          subtotal: String(totals.subtotal),
          taxAmount: '0',
          credits: '0',
          total: String(totals.total),
          balance: String(totals.total),
          dueDate: milestone.dueDate ?? null,
          createdBy: userId,
        })
        .returning({ id: schema.invoices.id });
      if (!created) throw new Error('invoice insert failed');

      await tx.insert(schema.invoiceLineItems).values({
        organizationId: orgId,
        invoiceId: created.id,
        description: line.description,
        quantity: '1',
        unitPrice: String(rounded),
        amount: String(rounded),
        taxable: false,
        sortOrder: 0,
      });

      return created.id;
    });
  } catch (error) {
    logger.error('invoices: milestone invoice failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  if (invoiceId) redirect(`/invoices/${invoiceId}`);
}

/** Save a draft invoice's lines, tax, credits, and terms. */
export async function saveInvoice(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await requireFinancialsWrite();
  if (!auth.ok) return { error: auth.error };
  const { orgId } = auth.ctx;

  const invoiceId = uuidOrNull(formData.get('invoiceId'));
  if (!invoiceId) return { error: 'Invoice not found.' };

  const taxRate = String(formData.get('taxRate') ?? '0');
  const credits = String(formData.get('credits') ?? '0');
  const dueDate = String(formData.get('dueDate') ?? '').trim();
  const paymentInstructions = String(formData.get('paymentInstructions') ?? '').trim();
  const lines = readLines(formData);
  const totals = invoiceTotals(lines, taxRate, credits);

  const check = validateInvoice(lines, totals);
  if (!check.ok) return { error: check.error ?? 'Please check the invoice.' };

  try {
    const db = getDb();
    const [existing] = await db
      .select({ id: schema.invoices.id, status: schema.invoices.status })
      .from(schema.invoices)
      .where(and(eq(schema.invoices.organizationId, orgId), eq(schema.invoices.id, invoiceId)));
    if (!existing) return { error: 'Invoice not found.' };
    if (!isEditable(existing.status as InvoiceStatus)) {
      return { error: 'This invoice has been issued — void and re-issue to change the amounts.' };
    }

    await db.transaction(async (tx) => {
      await tx
        .update(schema.invoices)
        .set({
          subtotal: String(totals.subtotal),
          taxRate: String(toNum(taxRate)),
          taxAmount: String(totals.taxAmount),
          credits: String(totals.credits),
          total: String(totals.total),
          balance: String(totals.total),
          dueDate: dueDate.length > 0 ? dueDate : null,
          paymentInstructions: paymentInstructions || null,
        })
        .where(eq(schema.invoices.id, invoiceId));

      await tx
        .delete(schema.invoiceLineItems)
        .where(eq(schema.invoiceLineItems.invoiceId, invoiceId));

      await tx.insert(schema.invoiceLineItems).values(
        lines.map((line, i) => ({
          organizationId: orgId,
          invoiceId,
          description: line.description.trim(),
          quantity: String(
            line.quantity === '' || line.quantity == null ? 1 : toNum(line.quantity),
          ),
          unitPrice: String(toNum(line.unitPrice)),
          amount: String(lineAmount(line)),
          taxable: line.taxable !== false,
          sortOrder: i,
        })),
      );
    });
  } catch (error) {
    logger.error('invoices: save failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { error: 'Something went wrong saving the invoice.' };
  }

  revalidatePath(`/invoices/${invoiceId}`);
  return { message: 'Invoice saved.' };
}

/** Issue, void, or mark an invoice — the lifecycle that isn't payment-driven. */
export async function setInvoiceStatus(formData: FormData): Promise<void> {
  const auth = await requireFinancialsWrite();
  if (!auth.ok) return;
  const { orgId } = auth.ctx;

  const invoiceId = uuidOrNull(formData.get('invoiceId'));
  const next = String(formData.get('status') ?? '') as InvoiceStatus;
  if (!invoiceId || (next !== 'sent' && next !== 'void')) return;

  try {
    const db = getDb();
    const [invoice] = await db
      .select({
        id: schema.invoices.id,
        status: schema.invoices.status,
        total: schema.invoices.total,
        amountPaid: schema.invoices.amountPaid,
      })
      .from(schema.invoices)
      .where(and(eq(schema.invoices.organizationId, orgId), eq(schema.invoices.id, invoiceId)));
    if (!invoice) return;

    const current = invoice.status as InvoiceStatus;
    if (next === 'sent' && current !== 'draft') return;
    // Never void an invoice that has money against it — refund it instead.
    if (next === 'void' && toNum(invoice.amountPaid) > 0) return;
    if (next === 'void' && (current === 'void' || current === 'paid')) return;

    const now = new Date();
    await db
      .update(schema.invoices)
      .set({
        status: next,
        ...(next === 'sent' ? { issuedAt: now, lockedAt: now } : {}),
      })
      .where(eq(schema.invoices.id, invoiceId));
  } catch (error) {
    logger.error('invoices: status change failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath('/invoices');
}

/**
 * Record a payment and apply it to one or more invoices, updating each
 * invoice's paid/balance cache and payment status in the same transaction.
 */
export async function recordPayment(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await requireFinancialsWrite();
  if (!auth.ok) return { error: auth.error };
  const { orgId, userId } = auth.ctx;

  const projectId = uuidOrNull(formData.get('projectId'));
  const amount = String(formData.get('amount') ?? '0');
  const rawMethod = String(formData.get('method') ?? 'check');
  const method: PaymentMethod = isPaymentMethod(rawMethod) ? rawMethod : 'other';
  const paymentDate = String(formData.get('paymentDate') ?? '').trim();
  const referenceNumber = String(formData.get('referenceNumber') ?? '').trim();
  const notes = String(formData.get('notes') ?? '').trim();
  if (!projectId) return { error: 'Project not found.' };

  const allocations = readAllocations(formData);

  try {
    const db = getDb();

    // Validate against live balances so a stale form cannot overpay.
    const balances: Record<string, number> = {};
    for (const allocation of allocations) {
      const [invoice] = await db
        .select({ balance: schema.invoices.balance, status: schema.invoices.status })
        .from(schema.invoices)
        .where(
          and(
            eq(schema.invoices.organizationId, orgId),
            eq(schema.invoices.id, allocation.invoiceId),
          ),
        );
      if (!invoice) return { error: 'One of the invoices could not be found.' };
      if (invoice.status === 'draft' || invoice.status === 'void') {
        return { error: 'Payments can only be applied to issued invoices.' };
      }
      balances[allocation.invoiceId] = toNum(invoice.balance);
    }

    const check = validateAllocations(amount, allocations, balances);
    if (!check.ok) return { error: check.error ?? 'Please check the payment.' };

    const [project] = await db
      .select({ clientId: schema.projects.clientId })
      .from(schema.projects)
      .where(and(eq(schema.projects.organizationId, orgId), eq(schema.projects.id, projectId)));

    await db.transaction(async (tx) => {
      const now = new Date();
      const [payment] = await tx
        .insert(schema.payments)
        .values({
          organizationId: orgId,
          projectId,
          clientId: project?.clientId ?? null,
          amount: String(toNum(amount)),
          paymentDate: paymentDate.length > 0 ? paymentDate : new Date().toISOString().slice(0, 10),
          method,
          referenceNumber: referenceNumber || null,
          notes: notes || null,
          lockedAt: now,
          createdBy: userId,
        })
        .returning({ id: schema.payments.id });
      if (!payment) throw new Error('payment insert failed');

      for (const allocation of allocations) {
        await tx.insert(schema.paymentAllocations).values({
          organizationId: orgId,
          paymentId: payment.id,
          invoiceId: allocation.invoiceId,
          amount: String(toNum(allocation.amount)),
          lockedAt: now,
        });

        // Recompute the invoice's paid total from its allocations rather than
        // incrementing, so the cache can't drift.
        const [{ paid }] = (await tx
          .select({ paid: sql<string>`coalesce(sum(amount), 0)::text` })
          .from(schema.paymentAllocations)
          .where(eq(schema.paymentAllocations.invoiceId, allocation.invoiceId))) as [
          { paid: string },
        ];

        const [invoice] = await tx
          .select({ total: schema.invoices.total, status: schema.invoices.status })
          .from(schema.invoices)
          .where(eq(schema.invoices.id, allocation.invoiceId));
        const total = toNum(invoice?.total);
        const amountPaid = toNum(paid);
        const balance = balanceOf(total, amountPaid);

        await tx
          .update(schema.invoices)
          .set({
            amountPaid: String(amountPaid),
            balance: String(balance),
            status: balance <= 0 ? 'paid' : 'partially_paid',
          })
          .where(eq(schema.invoices.id, allocation.invoiceId));
      }
    });
  } catch (error) {
    logger.error('invoices: record payment failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { error: 'Something went wrong recording the payment.' };
  }

  revalidatePath('/invoices');
  revalidatePath(`/projects/${projectId}`);
  return { message: 'Payment recorded.' };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function readLines(formData: FormData): InvoiceLineInput[] {
  const descriptions = formData.getAll('lineDescription').map(String);
  const quantities = formData.getAll('lineQuantity').map(String);
  const unitPrices = formData.getAll('lineUnitPrice').map(String);
  const taxables = formData.getAll('lineTaxable').map(String);

  return descriptions
    .map((description, i) => ({
      description,
      quantity: quantities[i] ?? '1',
      unitPrice: unitPrices[i] ?? '0',
      taxable: (taxables[i] ?? 'true') === 'true',
    }))
    .filter((line) => line.description.trim().length > 0 || toNum(line.unitPrice) !== 0);
}

function readAllocations(formData: FormData): { invoiceId: string; amount: string }[] {
  const ids = formData.getAll('allocationInvoiceId').map(String);
  const amounts = formData.getAll('allocationAmount').map(String);
  return ids
    .map((invoiceId, i) => ({ invoiceId, amount: amounts[i] ?? '0' }))
    .filter((a) => /^[0-9a-f-]{36}$/i.test(a.invoiceId) && toNum(a.amount) > 0);
}

function uuidOrNull(value: FormDataEntryValue | null): string | null {
  const s = typeof value === 'string' ? value : '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null;
}
