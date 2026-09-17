import { notFound, redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { getClient, getProperty } from '@/lib/clients/queries';
import type { Address } from '@/lib/clients/clients-core';
import {
  PropertyForm,
  DeletePropertyButton,
  type PropertyFormValues,
} from '@/components/clients/property-form';

export const metadata = { title: 'Edit property' };

export default async function EditPropertyPage({
  params,
}: {
  params: Promise<{ id: string; propertyId: string }>;
}) {
  const { id, propertyId } = await params;
  const ctx = await getAuthContext();
  if (ctx.configured && !ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) redirect('/clients');
  if (!can(ctx.activeOrg.roles, 'clients:write', ctx.activeOrg.extraPermissions)) {
    redirect(`/clients/${id}`);
  }

  const orgId = ctx.activeOrg.organizationId;
  const [client, property] = await Promise.all([
    getClient(orgId, id),
    getProperty(orgId, propertyId),
  ]);
  if (!client || !property || property.clientId !== client.id) notFound();

  const address = (property.address ?? {}) as Address;
  const utilityInfo = property.utilityInfo as { summary?: string } | null;
  const values: PropertyFormValues = {
    id: property.id,
    addressLine1: address.line1 ?? null,
    addressLine2: address.line2 ?? null,
    addressCity: address.city ?? null,
    addressState: address.state ?? null,
    addressZip: address.zip ?? null,
    propertyType: property.propertyType,
    squareFootage: property.squareFootage,
    yearBuilt: property.yearBuilt,
    occupancyStatus: property.occupancyStatus,
    accessInstructions: property.accessInstructions,
    utilities: utilityInfo?.summary ?? null,
    permitJurisdiction: property.permitJurisdiction,
    notes: property.notes,
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Edit property</h1>
          <p className="text-sm text-muted-foreground">For {client.displayName}</p>
        </div>
        <DeletePropertyButton clientId={client.id} propertyId={property.id} />
      </div>
      <PropertyForm mode="edit" clientId={client.id} values={values} />
    </div>
  );
}
