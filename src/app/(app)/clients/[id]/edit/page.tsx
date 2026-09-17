import { notFound, redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { getClient } from '@/lib/clients/queries';
import type { Address } from '@/lib/clients/clients-core';
import { ClientForm, type ClientFormValues } from '@/components/clients/client-form';

export const metadata = { title: 'Edit client' };

export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAuthContext();
  if (ctx.configured && !ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) redirect('/clients');
  if (!can(ctx.activeOrg.roles, 'clients:write', ctx.activeOrg.extraPermissions)) {
    redirect(`/clients/${id}`);
  }

  const client = await getClient(ctx.activeOrg.organizationId, id);
  if (!client) notFound();

  const billing = (client.billingAddress ?? {}) as Address;
  const values: ClientFormValues = {
    id: client.id,
    clientType: client.clientType,
    displayName: client.displayName,
    companyName: client.companyName,
    primaryPhone: client.primaryPhone,
    primaryEmail: client.primaryEmail,
    addressLine1: billing.line1 ?? null,
    addressLine2: billing.line2 ?? null,
    addressCity: billing.city ?? null,
    addressState: billing.state ?? null,
    addressZip: billing.zip ?? null,
    preferredContactMethod: client.preferredContactMethod,
    tags: client.tags,
    notes: client.notes,
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Edit client</h1>
        <p className="text-sm text-muted-foreground">{client.displayName}</p>
      </div>
      <ClientForm mode="edit" values={values} />
    </div>
  );
}
