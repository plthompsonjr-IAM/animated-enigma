import { CheckCircle2, XCircle, Clock } from 'lucide-react';
import { publicEnv } from '@/lib/env';
import { getProposalByToken } from '@/lib/proposals/queries';
import { recordProposalView } from '@/lib/proposals/actions';
import { canRespond, type ProposalSnapshot } from '@/lib/proposals/proposal-core';
import { ProposalDocument } from '@/components/proposals/proposal-document';
import { RespondForm } from './respond-form';

export const metadata = {
  title: 'Proposal',
  robots: { index: false, follow: false },
};

export default async function PublicProposalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!publicEnv.supabaseUrl || !process.env.DATABASE_URL) {
    return <Shell>This proposal isn’t available.</Shell>;
  }

  const proposal = await getProposalByToken(token);
  if (!proposal || !proposal.snapshot) {
    return (
      <Shell>
        <div className="space-y-2 text-center">
          <h1 className="text-lg font-bold">Proposal not available</h1>
          <p className="text-sm text-muted-foreground">
            This link is invalid or has been replaced by a newer version. Please contact the sender
            for an up-to-date link.
          </p>
        </div>
      </Shell>
    );
  }

  // Log the view (bumps sent → viewed). Best-effort; never blocks the render.
  await recordProposalView(token).catch(() => {});

  const snapshot = proposal.snapshot as ProposalSnapshot;
  const orgName = snapshot.org.name;
  const respondable = canRespond(proposal.displayStatus);

  return (
    <div className="min-h-dvh bg-secondary/40 px-4 py-10">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <ProposalDocument snapshot={snapshot} />

        {respondable ? (
          <RespondForm token={token} orgName={orgName} />
        ) : (
          <StatusBanner status={proposal.displayStatus} orgName={orgName} />
        )}

        <p className="text-center text-xs text-muted-foreground">
          Sent by {orgName}. Questions? Reply to the message that shared this link.
        </p>
      </div>
    </div>
  );
}

function StatusBanner({ status, orgName }: { status: string; orgName: string }) {
  const map: Record<
    string,
    { icon: typeof CheckCircle2; title: string; body: string; tone: string }
  > = {
    accepted: {
      icon: CheckCircle2,
      title: 'You accepted this proposal',
      body: `${orgName} has been notified and will be in touch about next steps.`,
      tone: 'text-emerald-600',
    },
    declined: {
      icon: XCircle,
      title: 'You declined this proposal',
      body: `${orgName} will follow up with you.`,
      tone: 'text-muted-foreground',
    },
    expired: {
      icon: Clock,
      title: 'This proposal has expired',
      body: `Please contact ${orgName} for an updated proposal.`,
      tone: 'text-amber-600',
    },
    draft: {
      icon: Clock,
      title: 'This proposal isn’t ready yet',
      body: `Please contact ${orgName}.`,
      tone: 'text-muted-foreground',
    },
  };
  const cfg = map[status] ?? map.draft!;
  const Icon = cfg.icon;
  return (
    <div className="space-y-2 rounded-lg border bg-card p-6 text-center">
      <Icon className={`mx-auto h-8 w-8 ${cfg.tone}`} />
      <h2 className="text-lg font-bold">{cfg.title}</h2>
      <p className="text-sm text-muted-foreground">{cfg.body}</p>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-secondary/40 p-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-6">{children}</div>
    </div>
  );
}
