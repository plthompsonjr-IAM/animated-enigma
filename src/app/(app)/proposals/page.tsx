import Link from 'next/link';
import { FileText } from 'lucide-react';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { listProposals } from '@/lib/proposals/queries';
import { formatMoney } from '@/lib/proposals/proposal-core';
import { Card, CardContent } from '@/components/ui/card';
import { ProposalStatusBadge } from '@/components/proposals/proposal-status-badge';

export const metadata = { title: 'Proposals' };

export default async function ProposalsPage() {
  const ctx = await getAuthContext();
  if (!ctx.configured || !ctx.dbAvailable || !ctx.activeOrg) return <NotReady />;

  const { activeOrg } = ctx;
  if (!can(activeOrg.roles, 'estimates:read', activeOrg.extraPermissions)) {
    return (
      <Empty title="Proposals">
        You don’t have permission to view proposals. Ask an administrator.
      </Empty>
    );
  }

  const proposals = await listProposals(activeOrg.organizationId);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Proposals</h1>
        <p className="text-sm text-muted-foreground">
          Client-facing proposals and their delivery status. Create one from a project’s estimate.
        </p>
      </div>

      {proposals.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <FileText className="h-6 w-6" />
            </div>
            <div className="max-w-sm">
              <p className="font-medium">No proposals yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Open a project’s estimate and choose “Create proposal” to turn it into a
                client-ready document.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <ul className="space-y-2 md:hidden">
            {proposals.map((p) => (
              <li key={p.id}>
                <Link href={`/proposals/${p.id}`} className="block rounded-lg border bg-card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{p.clientName ?? 'Client'}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {p.proposalNumber} · {p.projectName ?? 'Project'}
                      </div>
                    </div>
                    <ProposalStatusBadge status={p.displayStatus} />
                  </div>
                  <div className="mt-2 text-sm font-medium tabular-nums">
                    {p.price != null ? formatMoney(p.price) : '—'}
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-hidden rounded-lg border md:block">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Proposal</th>
                  <th className="px-4 py-2.5 font-semibold">Client</th>
                  <th className="px-4 py-2.5 font-semibold">Project</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Price</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {proposals.map((p) => (
                  <tr key={p.id} className="hover:bg-accent/40">
                    <td className="px-4 py-2.5">
                      <Link href={`/proposals/${p.id}`} className="font-medium hover:underline">
                        {p.proposalNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{p.clientName ?? '—'}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{p.projectName ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      <ProposalStatusBadge status={p.displayStatus} />
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                      {p.price != null ? formatMoney(p.price) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function NotReady() {
  return (
    <Empty title="Proposals">
      Proposals activate once authentication and the database are configured and an organization
      exists.
    </Empty>
  );
}

function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
