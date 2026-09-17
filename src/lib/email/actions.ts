'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getDb, schema } from '@/db';
import { publicEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import { getAuthContext, type AuthContext } from '@/lib/auth/session';
import { can, type Permission } from '@/lib/auth/rbac';
import type { FormState } from '@/lib/auth/actions';
import { toNum } from '@/lib/catalog/catalog-core';
import { getProposal, getProposalEvents } from '@/lib/proposals/queries';
import { isLive, type ProposalSnapshot, type ProposalStatus } from '@/lib/proposals/proposal-core';
import { getChangeOrder } from '@/lib/change-orders/queries';
import {
  costBreakdown,
  isItemDirection,
  type ChangeOrderItemInput,
} from '@/lib/change-orders/change-orders-core';
import { getInvoice } from '@/lib/invoices/queries';
import { balanceOf, isEditable, lineAmount, type InvoiceStatus } from '@/lib/invoices/invoices-core';
import {
  changeOrderEmail,
  invoiceEmail,
  isEmailKind,
  proposalEmail,
  sendOutcomeMessage,
  type EmailKind,
} from './email-core';
import { dispatchEmail } from './dispatch';
import { latestChangeOrderToken, recipientForClient, recipientForProject } from './queries';

// ── Sending a document to its client ─────────────────────────────────────────
//
// Every export of this file is a server action — an endpoint the browser can
// call. So every export gates on the caller's permission before touching a
// document, and the unguarded send-and-log path lives in ./dispatch, which is
// not an action and cannot be reached from a client.

const formSchema = z.object({
  kind: z.string().refine(isEmailKind, 'Unknown document type.'),
  id: z.string().uuid('Unknown document.'),
});

const PERMISSION: Record<Exclude<EmailKind, 'invitation'>, Permission> = {
  proposal: 'estimates:write',
  change_order: 'financials:write',
  invoice: 'financials:write',
};

type Ready = { ok: true; ctx: AuthContext; orgId: string; userId: string; orgName: string };

async function requireSender(kind: Exclude<EmailKind, 'invitation'>): Promise<Ready | FormState> {
  const ctx = await getAuthContext();
  if (!ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) {
    return { error: 'Database or organization is not configured yet.' };
  }
  if (!can(ctx.activeOrg.roles, PERMISSION[kind], ctx.activeOrg.extraPermissions)) {
    return { error: 'You do not have permission to send this.' };
  }
  return {
    ok: true,
    ctx,
    orgId: ctx.activeOrg.organizationId,
    userId: ctx.userId,
    orgName: ctx.activeOrg.organizationName,
  };
}

/**
 * Email a proposal, change order, or invoice to the client on its project.
 *
 * Every branch respects a gate that already exists and that a person clicks:
 * a proposal must have been marked sent (that is what makes its link live), a
 * change order must have an approval link, an invoice must have been issued
 * (so the amounts are locked). Emailing never advances a status — it sends what
 * a person already decided to send, and records that it did.
 */
export async function sendDocumentEmail(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = formSchema.safeParse({ kind: formData.get('kind'), id: formData.get('id') });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the form.' };
  const { id } = parsed.data;
  const kind = parsed.data.kind as EmailKind;
  if (kind === 'invitation') return { error: 'Invitations are sent from the Team page.' };

  const auth = await requireSender(kind);
  if (!('ok' in auth)) return auth;
  const { orgId, userId, orgName } = auth;

  try {
    if (kind === 'proposal') return await sendProposal(orgId, userId, orgName, id);
    if (kind === 'change_order') return await sendChangeOrder(orgId, userId, orgName, id);
    return await sendInvoice(orgId, userId, orgName, id);
  } catch (error) {
    logger.error('email: send failed', {
      kind,
      message: error instanceof Error ? error.message : String(error),
    });
    return { error: 'Something went wrong. Nothing was sent.' };
  }
}

async function sendProposal(
  orgId: string,
  userId: string,
  orgName: string,
  proposalId: string,
): Promise<FormState> {
  const row = await getProposal(orgId, proposalId);
  if (!row || !row.version) return { error: 'That proposal isn’t available.' };
  const { proposal, version } = row;

  if (!isLive(proposal.status as ProposalStatus)) {
    return { error: 'Mark the proposal as sent first — that’s what makes the client link live.' };
  }

  const events = await getProposalEvents(orgId, version.id);
  const token =
    (events.find((e) => (e.metadata as { token?: string } | null)?.token)?.metadata as {
      token?: string;
    } | null)?.token ?? null;
  if (!token) return { error: 'This proposal has no share link. Regenerate it, then send.' };

  const recipient = await recipientForProject(orgId, proposal.projectId);
  if (!recipient?.email) {
    return { error: 'This client has no email address on file. Add one on the client record first.' };
  }

  const snapshot = version.contentSnapshot as ProposalSnapshot | null;
  const message = proposalEmail({
    orgName,
    clientName: recipient.name,
    proposalNumber: proposal.proposalNumber,
    projectName: snapshot?.project.name ?? null,
    price: snapshot ? snapshot.pricing.total : null,
    link: `${publicEnv.appUrl}/proposal/${token}`,
    expiresOn: proposal.expiresAt ?? null,
  });
  message.to = [recipient.email];

  const result = await dispatchEmail({
    organizationId: orgId,
    userId,
    senderName: orgName,
    kind: 'proposal',
    relatedId: proposal.id,
    projectId: proposal.projectId,
    clientId: recipient.clientId,
    message,
  });

  if (result.ok) {
    await getDb().insert(schema.proposalEvents).values({
      organizationId: orgId,
      proposalVersionId: version.id,
      eventType: 'emailed',
      metadata: { to: message.to, provider: result.provider },
    });
  }

  revalidatePath(`/proposals/${proposal.id}`);
  return result.ok ? { message: sendOutcomeMessage(result, message.to) } : { error: result.error };
}

async function sendChangeOrder(
  orgId: string,
  userId: string,
  orgName: string,
  changeOrderId: string,
): Promise<FormState> {
  const row = await getChangeOrder(orgId, changeOrderId);
  if (!row) return { error: 'That change order isn’t available.' };
  const co = row.changeOrder;

  const token = await latestChangeOrderToken(orgId, co.id);
  if (!token) return { error: 'Create the approval link first, then send it.' };

  const recipient = await recipientForProject(orgId, co.projectId);
  if (!recipient?.email) {
    return { error: 'This client has no email address on file. Add one on the client record first.' };
  }

  const items: ChangeOrderItemInput[] = row.items.map((i) => ({
    direction: isItemDirection(i.direction) ? i.direction : 'added',
    description: i.description,
    amount: i.amount,
  }));
  const message = changeOrderEmail({
    orgName,
    clientName: recipient.name,
    changeOrderNumber: co.changeOrderNumber,
    projectName: row.projectName ?? null,
    netChange: costBreakdown(items).net,
    scheduleChangeDays: co.scheduleChangeDays ?? 0,
    link: `${publicEnv.appUrl}/change-order/${token}`,
  });
  message.to = [recipient.email];

  const result = await dispatchEmail({
    organizationId: orgId,
    userId,
    senderName: orgName,
    kind: 'change_order',
    relatedId: co.id,
    projectId: co.projectId,
    clientId: recipient.clientId,
    message,
  });

  if (result.ok) {
    await getDb().insert(schema.changeOrderShareEvents).values({
      organizationId: orgId,
      changeOrderId: co.id,
      eventType: 'emailed',
      token: null,
    });
  }

  revalidatePath(`/change-orders/${co.id}`);
  return result.ok ? { message: sendOutcomeMessage(result, message.to) } : { error: result.error };
}

async function sendInvoice(
  orgId: string,
  userId: string,
  orgName: string,
  invoiceId: string,
): Promise<FormState> {
  const row = await getInvoice(orgId, invoiceId);
  if (!row) return { error: 'That invoice isn’t available.' };
  const invoice = row.invoice;
  const status = invoice.status as InvoiceStatus;

  if (isEditable(status)) {
    return { error: 'Issue the invoice first — emailing a draft would send amounts that can still change.' };
  }
  if (status === 'void') return { error: 'This invoice is void. Nothing to send.' };

  const recipient = await recipientForClient(orgId, invoice.clientId);
  if (!recipient?.email) {
    return { error: 'This client has no email address on file. Add one on the client record first.' };
  }

  const total = toNum(invoice.total);
  const message = invoiceEmail({
    orgName,
    clientName: recipient.name,
    invoiceNumber: invoice.invoiceNumber,
    projectName: row.projectName ?? null,
    total,
    balance: balanceOf(total, toNum(invoice.amountPaid)),
    dueDate: invoice.dueDate ?? null,
    paymentInstructions: invoice.paymentInstructions ?? null,
    lines: row.lines.map((l) => ({ description: l.description, amount: lineAmount(l) })),
  });
  message.to = [recipient.email];

  const result = await dispatchEmail({
    organizationId: orgId,
    userId,
    senderName: orgName,
    kind: 'invoice',
    relatedId: invoice.id,
    projectId: invoice.projectId,
    clientId: recipient.clientId,
    message,
  });

  revalidatePath(`/invoices/${invoice.id}`);
  return result.ok ? { message: sendOutcomeMessage(result, message.to) } : { error: result.error };
}
