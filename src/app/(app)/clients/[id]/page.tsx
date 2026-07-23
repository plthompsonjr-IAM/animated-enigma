import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { Phone, Mail, Pencil, Plus, MapPin, FolderOpen, Images } from 'lucide-react';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import {
  getClient,
  getClientContacts,
  getClientProperties,
  getClientHistory,
} from '@/lib/clients/queries';
import {
  CLIENT_TYPE_LABELS,
  CONTACT_METHOD_LABELS,
  OCCUPANCY_LABELS,
  formatAddress,
  formatPhone,
  type ClientType,
  type ContactMethod,
  type OccupancyStatus,
} from '@/lib/clients/clients-core';
import { StatusBadge } from '@/components/leads/lead-badges';
import type { LeadStatus } from '@/lib/leads/leads-core';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { AddContactForm, ContactRowActions, ArchiveClientButton } from './client-actions';

export const metadata = { title: 'Client' };

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAuthContext();
  if (ctx.configured && !ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) redirect('/clients');
  if (!can(ctx.activeOrg.roles, 'clients:read', ctx.activeOrg.extraPermissions)) {
    redirect('/clients');
  }

  const orgId = ctx.activeOrg.organizationId;
  const mayWrite = can(ctx.activeOrg.roles, 'clients:write', ctx.activeOrg.extraPermissions);

  const client = await getClient(orgId, id);
  if (!client) notFound();

  const [contacts, properties, history] = await Promise.all([
    getClientContacts(orgId, id),
    getClientProperties(orgId, id),
    getClientHistory(orgId, id),
  ]);

  const archived = Boolean(client.deletedAt);
  const billing = formatAddress(client.billingAddress);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{client.displayName}</h1>
            {archived ? (
              <span className="rounded bg-secondary px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                Archived
              </span>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {client.companyName ?? CLIENT_TYPE_LABELS[client.clientType as ClientType]}
            {client.tags.length > 0 ? ` · ${client.tags.join(', ')}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {mayWrite ? (
            <Link
              href={`/clients/${client.id}/edit`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <Pencil className="h-4 w-4" />
              Edit
            </Link>
          ) : null}
          {mayWrite ? <ArchiveClientButton clientId={client.id} archived={archived} /> : null}
        </div>
      </div>

      {/* Quick contact actions (mobile-first, thumb-reachable) */}
      {(client.primaryPhone || client.primaryEmail) && (
        <div className="flex gap-2">
          {client.primaryPhone ? (
            <a
              href={`tel:${client.primaryPhone}`}
              className={buttonVariants({ className: 'flex-1' })}
            >
              <Phone className="h-4 w-4" />
              Call
            </a>
          ) : null}
          {client.primaryEmail ? (
            <a
              href={`mailto:${client.primaryEmail}`}
              className={buttonVariants({ variant: 'outline', className: 'flex-1' })}
            >
              <Mail className="h-4 w-4" />
              Email
            </a>
          ) : null}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: properties + history + files */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Properties</CardTitle>
              {mayWrite ? (
                <Link
                  href={`/clients/${client.id}/properties/new`}
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  <Plus className="h-4 w-4" />
                  Add property
                </Link>
              ) : null}
            </CardHeader>
            <CardContent>
              {properties.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No properties yet. Add the client’s job site to attach projects and estimates to
                  it.
                </p>
              ) : (
                <ul className="space-y-3">
                  {properties.map((p) => (
                    <li key={p.id} className="rounded-md border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-start gap-2">
                          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <p className="font-medium">
                              {formatAddress(p.address) || 'Address on file'}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {[
                                p.propertyType,
                                p.squareFootage
                                  ? `${p.squareFootage.toLocaleString('en-US')} sq ft`
                                  : null,
                                p.yearBuilt ? `built ${p.yearBuilt}` : null,
                                p.occupancyStatus
                                  ? OCCUPANCY_LABELS[p.occupancyStatus as OccupancyStatus]
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(' · ') || 'No details yet'}
                            </p>
                          </div>
                        </div>
                        {mayWrite ? (
                          <Link
                            href={`/clients/${client.id}/properties/${p.id}/edit`}
                            className="text-xs font-medium text-primary hover:underline"
                          >
                            Edit
                          </Link>
                        ) : null}
                      </div>
                      {p.accessInstructions ? (
                        <p className="mt-2 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">Access:</span>{' '}
                          {p.accessInstructions}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Projects
                </h3>
                {history.projects.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No projects yet.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {history.projects.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="flex min-w-0 items-center gap-2">
                          <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <Link
                            href={`/projects/${p.id}`}
                            className="truncate font-medium hover:underline"
                          >
                            {p.projectNumber} — {p.name}
                          </Link>
                        </span>
                        <span className="shrink-0 text-xs capitalize text-muted-foreground">
                          {p.status.replace(/_/g, ' ')}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Leads
                </h3>
                {history.leads.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No linked leads.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {history.leads.map((l) => (
                      <li key={l.id} className="flex items-center justify-between gap-2 text-sm">
                        <Link
                          href={`/leads/${l.id}`}
                          className="truncate font-medium hover:underline"
                        >
                          {l.leadName}
                        </Link>
                        <StatusBadge status={l.status as LeadStatus} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Files &amp; photos</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                <Images className="h-5 w-5 shrink-0" />
                Document and photo uploads arrive with the Documents module (Task 26). Everything
                attached to this client’s projects will show here.
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: contact details + people */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Contact</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3">
                <Detail label="Phone" value={formatPhone(client.primaryPhone)} />
                <Detail label="Email" value={client.primaryEmail} />
                <Detail
                  label="Preferred contact"
                  value={
                    client.preferredContactMethod
                      ? CONTACT_METHOD_LABELS[client.preferredContactMethod as ContactMethod]
                      : null
                  }
                />
                <Detail label="Billing address" value={billing} />
                <Detail label="Notes" value={client.notes} multiline />
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>People</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {contacts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No additional contacts.</p>
              ) : (
                <ul className="space-y-2">
                  {contacts.map((c) => (
                    <li key={c.id} className="rounded-md border p-2.5 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium">
                            {c.name}
                            {c.isPrimary ? (
                              <span className="ml-1.5 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                                Primary
                              </span>
                            ) : null}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {[c.role, formatPhone(c.phone), c.email].filter(Boolean).join(' · ') ||
                              'No details'}
                          </p>
                        </div>
                        {mayWrite ? (
                          <ContactRowActions
                            clientId={client.id}
                            contactId={c.id}
                            isPrimary={c.isPrimary}
                          />
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {mayWrite && !archived ? <AddContactForm clientId={client.id} /> : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Detail({
  label,
  value,
  multiline,
}: {
  label: string;
  value: string | null | undefined;
  multiline?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={multiline ? 'whitespace-pre-wrap text-sm' : 'text-sm'}>{value || '—'}</dd>
    </div>
  );
}
