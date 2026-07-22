import Link from 'next/link';
import { Plus, Users } from 'lucide-react';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import {
  listLeads,
  leadStatusCounts,
  assignableMembers,
  type LeadListRow,
} from '@/lib/leads/queries';
import { LEAD_SORTS, type LeadSort, type LeadStatus } from '@/lib/leads/leads-core';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge, PriorityBadge, FollowUpText } from '@/components/leads/lead-badges';
import { LeadsToolbar } from './leads-toolbar';
import { StatusFilter } from './status-filter';

export const metadata = { title: 'Leads' };

interface SearchParams {
  q?: string;
  status?: string;
  assignee?: string;
  sort?: string;
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await getAuthContext();

  if (!ctx.configured || !ctx.dbAvailable || !ctx.activeOrg) {
    return <NotReady />;
  }

  const { activeOrg } = ctx;
  const mayRead = can(activeOrg.roles, 'leads:read', activeOrg.extraPermissions);
  const mayWrite = can(activeOrg.roles, 'leads:write', activeOrg.extraPermissions);
  if (!mayRead) {
    return (
      <Empty title="Leads">You don’t have permission to view leads. Ask an administrator.</Empty>
    );
  }

  const sp = await searchParams;
  const sort: LeadSort = (LEAD_SORTS as readonly string[]).includes(sp.sort ?? '')
    ? (sp.sort as LeadSort)
    : 'recent';

  const orgId = activeOrg.organizationId;
  const [leads, counts, members] = await Promise.all([
    listLeads({
      organizationId: orgId,
      search: sp.q?.trim() || undefined,
      status: (sp.status as LeadStatus | 'open' | undefined) ?? undefined,
      assignedTo: sp.assignee || undefined,
      sort,
    }),
    leadStatusCounts(orgId),
    assignableMembers(orgId),
  ]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Leads</h1>
          <p className="text-sm text-muted-foreground">
            Every opportunity from first contact to won.
          </p>
        </div>
        {mayWrite ? (
          <Link href="/leads/new" className={buttonVariants()}>
            <Plus className="h-4 w-4" />
            New lead
          </Link>
        ) : null}
      </div>

      <LeadsToolbar members={members} />
      <StatusFilter counts={counts} />

      {leads.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Users className="h-6 w-6" />
            </div>
            <div className="max-w-sm">
              <p className="font-medium">No leads match</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {sp.q || sp.status || sp.assignee
                  ? 'Try clearing filters or search.'
                  : 'Capture your first lead to start the pipeline.'}
              </p>
            </div>
            {mayWrite && !sp.q && !sp.status && !sp.assignee ? (
              <Link href="/leads/new" className={buttonVariants()}>
                <Plus className="h-4 w-4" />
                New lead
              </Link>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Mobile: cards */}
          <ul className="space-y-2 md:hidden">
            {leads.map((lead) => (
              <li key={lead.id}>
                <LeadCard lead={lead} />
              </li>
            ))}
          </ul>

          {/* Desktop: table */}
          <div className="hidden overflow-hidden rounded-lg border md:block">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Lead</th>
                  <th className="px-4 py-2.5 font-semibold">Type</th>
                  <th className="px-4 py-2.5 font-semibold">Budget</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5 font-semibold">Priority</th>
                  <th className="px-4 py-2.5 font-semibold">Follow-up</th>
                  <th className="px-4 py-2.5 font-semibold">Owner</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {leads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-accent/40">
                    <td className="px-4 py-2.5">
                      <Link href={`/leads/${lead.id}`} className="font-medium hover:underline">
                        {lead.leadName}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {lead.clientName ?? lead.phone ?? '—'}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{lead.projectType ?? '—'}</td>
                    <td className="tabular-nums px-4 py-2.5 text-muted-foreground">
                      {formatBudget(lead.estimatedBudget)}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={lead.status} />
                    </td>
                    <td className="px-4 py-2.5">
                      <PriorityBadge priority={lead.priority} />
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      <FollowUpText date={lead.nextFollowUpDate} />
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {lead.assignedToName ?? 'Unassigned'}
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

function LeadCard({ lead }: { lead: LeadListRow }) {
  return (
    <Link href={`/leads/${lead.id}`} className="block rounded-lg border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{lead.leadName}</div>
          <div className="truncate text-xs text-muted-foreground">
            {lead.clientName ?? '—'} · {lead.projectType ?? 'Unspecified'}
          </div>
        </div>
        <StatusBadge status={lead.status} />
      </div>
      <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="tabular-nums">{formatBudget(lead.estimatedBudget)}</span>
        <FollowUpText date={lead.nextFollowUpDate} />
        <PriorityBadge priority={lead.priority} />
      </div>
    </Link>
  );
}

function formatBudget(value: string | null): string {
  if (!value) return '—';
  const n = Number(value);
  if (Number.isNaN(n)) return '—';
  return `$${n.toLocaleString('en-US')}`;
}

function NotReady() {
  return (
    <Empty title="Leads">
      Lead management activates once authentication and the database are configured and an
      organization exists.
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
