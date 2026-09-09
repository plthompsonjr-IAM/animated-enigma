import Link from 'next/link';
import { Plus, Contact } from 'lucide-react';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { listClients, clientTags, type ClientListRow } from '@/lib/clients/queries';
import {
  CLIENT_SORTS,
  CLIENT_TYPE_LABELS,
  formatPhone,
  type ClientSort,
  type ClientType,
} from '@/lib/clients/clients-core';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ClientsToolbar } from './clients-toolbar';

export const metadata = { title: 'Clients' };

interface SearchParams {
  q?: string;
  type?: string;
  tag?: string;
  sort?: string;
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await getAuthContext();

  if (!ctx.configured || !ctx.dbAvailable || !ctx.activeOrg) {
    return <NotReady />;
  }

  const { activeOrg } = ctx;
  const mayRead = can(activeOrg.roles, 'clients:read', activeOrg.extraPermissions);
  const mayWrite = can(activeOrg.roles, 'clients:write', activeOrg.extraPermissions);
  if (!mayRead) {
    return (
      <Empty title="Clients">
        You don’t have permission to view clients. Ask an administrator.
      </Empty>
    );
  }

  const sp = await searchParams;
  const sort: ClientSort = (CLIENT_SORTS as readonly string[]).includes(sp.sort ?? '')
    ? (sp.sort as ClientSort)
    : 'name';

  const orgId = activeOrg.organizationId;
  const [clients, tags] = await Promise.all([
    listClients({
      organizationId: orgId,
      search: sp.q?.trim() || undefined,
      clientType: (sp.type as ClientType | undefined) ?? 'all',
      tag: sp.tag || undefined,
      sort,
    }),
    clientTags(orgId),
  ]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Clients</h1>
          <p className="text-sm text-muted-foreground">
            Every customer, their properties, and their history.
          </p>
        </div>
        {mayWrite ? (
          <Link href="/clients/new" className={buttonVariants()}>
            <Plus className="h-4 w-4" />
            New client
          </Link>
        ) : null}
      </div>

      <ClientsToolbar tags={tags} />

      {clients.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Contact className="h-6 w-6" />
            </div>
            <div className="max-w-sm">
              <p className="font-medium">No clients match</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {sp.q || sp.type || sp.tag
                  ? 'Try clearing filters or search.'
                  : 'Add your first client, or convert a won lead.'}
              </p>
            </div>
            {mayWrite && !sp.q && !sp.type && !sp.tag ? (
              <Link href="/clients/new" className={buttonVariants()}>
                <Plus className="h-4 w-4" />
                New client
              </Link>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Mobile: cards */}
          <ul className="space-y-2 md:hidden">
            {clients.map((client) => (
              <li key={client.id}>
                <ClientCard client={client} />
              </li>
            ))}
          </ul>

          {/* Desktop: table */}
          <div className="hidden overflow-hidden rounded-lg border md:block">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Client</th>
                  <th className="px-4 py-2.5 font-semibold">Type</th>
                  <th className="px-4 py-2.5 font-semibold">Phone</th>
                  <th className="px-4 py-2.5 font-semibold">Email</th>
                  <th className="px-4 py-2.5 font-semibold">Properties</th>
                  <th className="px-4 py-2.5 font-semibold">Projects</th>
                  <th className="px-4 py-2.5 font-semibold">Tags</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {clients.map((client) => (
                  <tr key={client.id} className="hover:bg-accent/40">
                    <td className="px-4 py-2.5">
                      <Link href={`/clients/${client.id}`} className="font-medium hover:underline">
                        {client.displayName}
                      </Link>
                      {client.companyName ? (
                        <div className="text-xs text-muted-foreground">{client.companyName}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {CLIENT_TYPE_LABELS[client.clientType]}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                      {formatPhone(client.primaryPhone) || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {client.primaryEmail ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                      {client.propertyCount}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                      {client.projectCount}
                    </td>
                    <td className="px-4 py-2.5">
                      <TagChips tags={client.tags} />
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

function ClientCard({ client }: { client: ClientListRow }) {
  return (
    <Link href={`/clients/${client.id}`} className="block rounded-lg border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{client.displayName}</div>
          <div className="truncate text-xs text-muted-foreground">
            {client.companyName ?? CLIENT_TYPE_LABELS[client.clientType]}
          </div>
        </div>
        <TagChips tags={client.tags} />
      </div>
      <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="tabular-nums">{formatPhone(client.primaryPhone) || 'No phone'}</span>
        <span>
          {client.propertyCount} {client.propertyCount === 1 ? 'property' : 'properties'}
        </span>
        <span>
          {client.projectCount} {client.projectCount === 1 ? 'project' : 'projects'}
        </span>
      </div>
    </Link>
  );
}

function TagChips({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {tags.slice(0, 3).map((tag) => (
        <span
          key={tag}
          className="rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
        >
          {tag}
        </span>
      ))}
      {tags.length > 3 ? (
        <span className="text-[11px] text-muted-foreground">+{tags.length - 3}</span>
      ) : null}
    </span>
  );
}

function NotReady() {
  return (
    <Empty title="Clients">
      Client management activates once authentication and the database are configured and an
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
