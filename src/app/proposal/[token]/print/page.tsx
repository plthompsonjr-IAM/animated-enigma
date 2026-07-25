import { publicEnv } from '@/lib/env';
import { getProposalByToken } from '@/lib/proposals/queries';
import type { ProposalSnapshot } from '@/lib/proposals/proposal-core';
import { ProposalPrintDocument } from '@/components/proposals/proposal-print-document';
import { PrintToolbar } from '@/components/proposals/print-toolbar';

export const metadata = {
  title: 'Proposal',
  robots: { index: false, follow: false },
};

/**
 * Public, chrome-free print view of a proposal (Task 18). Resolves the proposal
 * by its secure token and renders the branded, client-safe document for the
 * browser's "Save as PDF". Available for any status (a client can keep a copy of
 * an accepted, declined, or expired proposal); it never records a view — that's
 * the interactive page's job.
 */
export default async function ProposalPrintPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!publicEnv.supabaseUrl || !process.env.DATABASE_URL) {
    return <Unavailable />;
  }

  const proposal = await getProposalByToken(token);
  if (!proposal || !proposal.snapshot) {
    return <Unavailable />;
  }

  const snapshot = proposal.snapshot as ProposalSnapshot;

  return (
    <div className="min-h-dvh bg-white">
      <PrintToolbar backHref={`/proposal/${token}`} title={proposal.proposalNumber} />
      <ProposalPrintDocument snapshot={snapshot} proposalNumber={proposal.proposalNumber} />
    </div>
  );
}

function Unavailable() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-secondary/40 p-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 text-center">
        <h1 className="text-lg font-bold">Proposal not available</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This link is invalid or has been replaced by a newer version. Please contact the sender
          for an up-to-date link.
        </p>
      </div>
    </div>
  );
}
