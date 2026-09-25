import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { getCatalogItem, getPriceHistory } from '@/lib/catalog/queries';
import {
  computeUnitCost,
  formatCost,
  formatUnitCost,
  toNum,
  type Unit,
} from '@/lib/catalog/catalog-core';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CatalogForm, type CatalogFormValues } from '@/components/catalog/catalog-form';
import { ItemActions } from './item-actions';

export const metadata = { title: 'Edit catalog item' };

export default async function EditCatalogItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAuthContext();
  if (ctx.configured && !ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) redirect('/cost-catalog');
  if (!can(ctx.activeOrg.roles, 'costs:read', ctx.activeOrg.extraPermissions))
    redirect('/cost-catalog');

  const orgId = ctx.activeOrg.organizationId;
  const mayWrite = can(ctx.activeOrg.roles, 'estimates:write', ctx.activeOrg.extraPermissions);

  const item = await getCatalogItem(orgId, id);
  if (!item) notFound();

  const isGlobal = item.organizationId === null;
  const editable = mayWrite && !isGlobal;
  const history = await getPriceHistory(orgId, id);

  const unitCost = computeUnitCost({
    defaultMaterialCost: item.defaultMaterialCost,
    defaultLaborHours: item.defaultLaborHours,
    defaultLaborRate: item.defaultLaborRate,
    equipmentCost: item.equipmentCost,
    wastePct: item.wastePct,
  });

  const values: CatalogFormValues = {
    id: item.id,
    name: item.name,
    trade: item.trade,
    description: item.description,
    unit: item.unit,
    defaultMaterialCost: item.defaultMaterialCost,
    defaultLaborHours: item.defaultLaborHours,
    defaultLaborRate: item.defaultLaborRate,
    equipmentCost: item.equipmentCost,
    wastePctPercent: item.wastePct ? String(toNum(item.wastePct) * 100) : '',
    vendor: item.vendor,
    vendorItemNumber: item.vendorItemNumber,
    region: item.region,
    tier: item.tier ?? 'standard',
    lastVerifiedDate: item.lastVerifiedDate,
    notes: item.notes,
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/cost-catalog"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Cost catalog
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{item.name}</h1>
          <p className="text-sm text-muted-foreground">
            {formatUnitCost(unitCost.total, item.unit as Unit)} · material{' '}
            {formatCost(unitCost.material)} · labor {formatCost(unitCost.labor)} · equipment{' '}
            {formatCost(unitCost.equipment)}
          </p>
        </div>
        {editable ? <ItemActions itemId={item.id} isActive={item.isActive} /> : null}
      </div>

      {isGlobal ? (
        <p className="rounded-md bg-secondary/60 px-3 py-2 text-sm text-muted-foreground">
          This is a shared platform item — read-only. Duplicate it into your catalog to customize
          the costs.
        </p>
      ) : null}

      {editable ? <CatalogForm mode="edit" values={values} /> : <ReadOnlyView values={values} />}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Price history</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No price changes recorded yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {history.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="text-muted-foreground">
                    {new Date(h.effectiveDate).toLocaleDateString('en-US', { timeZone: 'UTC' })}
                    {h.source ? ` · ${h.source}` : ''}
                  </span>
                  <span className="tabular-nums">
                    {h.materialCost !== null ? `material ${formatCost(h.materialCost)}` : ''}
                    {h.materialCost !== null && h.laborRate !== null ? ' · ' : ''}
                    {h.laborRate !== null ? `labor ${formatCost(h.laborRate)}/hr` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Read-only rendering for shared items or view-only users. */
function ReadOnlyView({ values }: { values: CatalogFormValues }) {
  const rows: [string, string | null | undefined][] = [
    ['Trade', values.trade],
    ['Unit', values.unit],
    ['Tier', values.tier],
    ['Material cost', formatCost(values.defaultMaterialCost)],
    ['Waste', values.wastePctPercent ? `${values.wastePctPercent}%` : '0%'],
    ['Labor hours', values.defaultLaborHours],
    ['Labor rate', formatCost(values.defaultLaborRate)],
    ['Equipment', formatCost(values.equipmentCost)],
    ['Vendor', values.vendor],
    ['Description', values.description],
  ];
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-lg border p-4 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </dt>
          <dd className="text-sm">{value || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
