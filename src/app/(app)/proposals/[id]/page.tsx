import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Printer } from 'lucide-react';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { getProposal, getProposalEvents, signatureForVersion } from '@/lib/proposals/queries';
import {
  PROPOSAL_EVENT_LABELS,
  isExpired,
  isLive,
  type ProposalSnapshot,
  type ProposalStatus,
} from '@/lib/proposals/proposal-core';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { ProposalStatusBadge } from '@/components/proposals/proposal-status-badge';
import { ProposalDocument } from '@/components/proposals/proposal-document';
import { ApprovalRecord } from '@/components/proposals/approval-record';
import { CopyProposalLink, MarkSentForm, RegenerateButton } from './proposal-actions';

export const metadata = { title: 'Proposal' };

export default async function ProposalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAuthContext();
  if (ctx.configured && !ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) redirect('/proposals');
  if (!can(ctx.activeOrg.roles, 'estimates:read', ctx.activeOrg.extraPermissions))
    redirect('/proposals');

  const orgId = ctx.activeOrg.organizationId;
  const mayWrite = can(ctx.activeOrg.roles, 'estimates:write', ctx.activeOrg.extraPermissions);

  const row = await getProposal(orgId, id);
  if (!row || !row.version) notFound();

  const proposal = row.proposal;
  const version = row.version;
  const snapshot = version.contentSnapshot as ProposalSnapshot | null;
  const status = proposal.status as ProposalStatus;
  const displayStatus: ProposalStatus =
    !['accepted', 'declined'].includes(status) && isExpired(proposal.expiresAt)
      ? 'expired'
      : status;

  const [events, signature] = await Promise.all([
    getProposalEvents(orgId, version.id),
    signatureForVersion(orgId, version.id),
  ]);
  // The raw share token is stashed on the version's creation/new-version event.
  const tokenEvent = events.find((e) => (e.metadata as { token?: string } | null)?.token);
  const token = (tokenEvent?.metadata as { token?: string } | null)?.token ?? null;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/proposals"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Proposals
          </Link>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{proposal.proposalNumber}</h1>
            <ProposalStatusBadge status={displayStatus} />
          </div>
          <p className="text-sm text-muted-foreground">
            <Link href={`/projects/${proposal.projectId}`} className="hover:underline">
              View project
            </Link>
          </p>
        </div>
      </div>

      {mayWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sharing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Send this secure link to your client. They can view the proposal and accept or decline
              — no login required.
            </p>
            {token ? <CopyProposalLink token={token} /> : null}
            <div className="flex flex-wrap items-center gap-3 border-t pt-3">
              {status === 'draft' ? <MarkSentForm proposalId={proposal.id} /> : null}
              {!isLive(status) && status !== 'draft' ? (
                <p className="text-xs text-muted-foreground">
                  {displayStatus === 'accepted'
                    ? 'The client accepted this proposal.'
                    : displayStatus === 'declined'
                      ? 'The client declined this proposal.'
                      : displayStatus === 'expired'
                        ? 'This proposal has expired. Regenerate to send a fresh one.'
                        : ''}
                </p>
              ) : null}
              <RegenerateButton proposalId={proposal.id} />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {signature ? <ApprovalRecord signature={signature} /> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2">
            {events.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 text-sm">
                <span>{PROPOSAL_EVENT_LABELS[e.eventType] ?? e.eventType}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(e.occurredAt).toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
              </li>
            ))}
            {events.length === 0 ? (
              <li className="text-sm text-muted-foreground">No activity yet.</li>
            ) : null}
          </ol>
        </CardContent>
      </Card>

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Client preview
          </h2>
          {token ? (
            <a
              href={`/proposal/${token}/print`}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <Printer className="h-4 w-4" />
              Download PDF
            </a>
          ) : null}
        </div>
        {snapshot ? (
          <ProposalDocument snapshot={snapshot} />
        ) : (
          <p className="text-sm text-muted-foreground">No snapshot.</p>
        )}
      </div>

      <div className="pt-1">
        <Link href="/proposals" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          Back to proposals
        </Link>
      </div>
    </div>
  );
}
