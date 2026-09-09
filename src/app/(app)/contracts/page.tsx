import Link from 'next/link';
import { FileSignature } from 'lucide-react';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { listContracts } from '@/lib/contracts/queries';
import { formatMoney } from '@/lib/contracts/contracts-core';
import { Card, CardContent } from '@/components/ui/card';
import { ContractStatusBadge } from '@/components/contracts/contract-status-badge';

export const metadata = { title: 'Contracts' };

export default async function ContractsPage() {
  const ctx = await getAuthContext();
  if (!ctx.configured || !ctx.dbAvailable || !ctx.activeOrg) return <NotReady />;

  const { activeOrg } = ctx;
  if (!can(activeOrg.roles, 'financials:read', activeOrg.extraPermissions)) {
    return (
      <Empty title="Contracts">
        You don’t have permission to view contracts. Ask an administrator.
      </Empty>
    );
  }

  const contracts = await listContracts(activeOrg.organizationId);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Contracts</h1>
        <p className="text-sm text-muted-foreground">
          Signed agreements and their payment terms. Create one from an accepted proposal.
        </p>
      </div>

      {contracts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <FileSignature className="h-6 w-6" />
            </div>
            <div className="max-w-sm">
              <p className="font-medium">No contracts yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Once a client accepts and signs a proposal, open it and choose “Create contract”.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <ul className="space-y-2 md:hidden">
            {contracts.map((c) => (
              <li key={c.id}>
                <Link href={`/contracts/${c.id}`} className="block rounded-lg border bg-card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{c.clientName ?? 'Client'}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {c.contractNumber} · {c.projectName ?? 'Project'}
                      </div>
                    </div>
                    <ContractStatusBadge status={c.status} />
                  </div>
                  <div className="mt-2 text-sm font-medium tabular-nums">
                    {formatMoney(c.contractValue)}
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-hidden rounded-lg border md:block">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Contract</th>
                  <th className="px-4 py-2.5 font-semibold">Client</th>
                  <th className="px-4 py-2.5 font-semibold">Project</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {contracts.map((c) => (
                  <tr key={c.id} className="hover:bg-accent/40">
                    <td className="px-4 py-2.5">
                      <Link href={`/contracts/${c.id}`} className="font-medium hover:underline">
                        {c.contractNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{c.clientName ?? '—'}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{c.projectName ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      <ContractStatusBadge status={c.status} />
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                      {formatMoney(c.contractValue)}
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
    <Empty title="Contracts">
      Contracts activate once authentication and the database are configured and an organization
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
