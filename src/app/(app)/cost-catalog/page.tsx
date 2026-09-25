import Link from 'next/link';
import { Plus, Library } from 'lucide-react';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { listCatalogItems, catalogTrades, type CatalogItemRow } from '@/lib/catalog/queries';
import {
  CATALOG_SORTS,
  UNIT_ABBR,
  TIER_LABELS,
  TIER_STYLES,
  formatCost,
  type CatalogSort,
  type Tier,
} from '@/lib/catalog/catalog-core';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { CatalogToolbar } from './catalog-toolbar';

export const metadata = { title: 'Cost catalog' };

interface SearchParams {
  q?: string;
  trade?: string;
  tier?: string;
  sort?: string;
}

export default async function CostCatalogPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await getAuthContext();

  if (!ctx.configured || !ctx.dbAvailable || !ctx.activeOrg) {
    return <NotReady />;
  }

  const { activeOrg } = ctx;
  // Cost data — visible only to cost-cleared roles.
  const mayRead = can(activeOrg.roles, 'costs:read', activeOrg.extraPermissions);
  const mayWrite = can(activeOrg.roles, 'estimates:write', activeOrg.extraPermissions);
  if (!mayRead) {
    return (
      <Empty title="Cost catalog">
        You don’t have permission to view cost data. Ask an administrator.
      </Empty>
    );
  }

  const sp = await searchParams;
  const sort: CatalogSort = (CATALOG_SORTS as readonly string[]).includes(sp.sort ?? '')
    ? (sp.sort as CatalogSort)
    : 'name';

  const orgId = activeOrg.organizationId;
  const [items, trades] = await Promise.all([
    listCatalogItems({
      organizationId: orgId,
      search: sp.q?.trim() || undefined,
      trade: sp.trade || undefined,
      tier: (sp.tier as Tier | undefined) ?? 'all',
      sort,
    }),
    catalogTrades(orgId),
  ]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cost catalog</h1>
          <p className="text-sm text-muted-foreground">
            Your labor, material, and equipment costs — the building blocks for estimates.
          </p>
        </div>
        {mayWrite ? (
          <Link href="/cost-catalog/new" className={buttonVariants()}>
            <Plus className="h-4 w-4" />
            New item
          </Link>
        ) : null}
      </div>

      <CatalogToolbar trades={trades} />

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Library className="h-6 w-6" />
            </div>
            <div className="max-w-sm">
              <p className="font-medium">No catalog items match</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {sp.q || sp.trade || sp.tier
                  ? 'Try clearing filters or search.'
                  : 'Add your common labor and materials so estimates come together fast.'}
              </p>
            </div>
            {mayWrite && !sp.q && !sp.trade && !sp.tier ? (
              <Link href="/cost-catalog/new" className={buttonVariants()}>
                <Plus className="h-4 w-4" />
                New item
              </Link>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Mobile: cards */}
          <ul className="space-y-2 md:hidden">
            {items.map((item) => (
              <li key={item.id}>
                <ItemCard item={item} mayWrite={mayWrite} />
              </li>
            ))}
          </ul>

          {/* Desktop: table */}
          <div className="hidden overflow-hidden rounded-lg border md:block">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Item</th>
                  <th className="px-4 py-2.5 font-semibold">Trade</th>
                  <th className="px-4 py-2.5 font-semibold">Tier</th>
                  <th className="px-4 py-2.5 font-semibold">Unit</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Unit cost</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-accent/40">
                    <td className="px-4 py-2.5">
                      {mayWrite ? (
                        <Link
                          href={`/cost-catalog/${item.id}/edit`}
                          className="font-medium hover:underline"
                        >
                          {item.name}
                        </Link>
                      ) : (
                        <span className="font-medium">{item.name}</span>
                      )}
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {item.vendor ?? ''}
                        {item.isGlobal ? (
                          <span className="rounded bg-secondary px-1 py-0.5 text-[10px] font-semibold">
                            Shared
                          </span>
                        ) : null}
                        {!item.isActive ? (
                          <span className="rounded bg-amber-500/15 px-1 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                            Inactive
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{item.trade ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      <TierBadge tier={item.tier} />
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{UNIT_ABBR[item.unit]}</td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                      {formatCost(item.unitCost)}
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

function ItemCard({ item, mayWrite }: { item: CatalogItemRow; mayWrite: boolean }) {
  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{item.name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {item.trade ?? 'No trade'} · {UNIT_ABBR[item.unit]}
          </div>
        </div>
        <span className="font-medium tabular-nums">{formatCost(item.unitCost)}</span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <TierBadge tier={item.tier} />
        {item.isGlobal ? (
          <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
            Shared
          </span>
        ) : null}
        {!item.isActive ? (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
            Inactive
          </span>
        ) : null}
      </div>
    </>
  );

  return mayWrite ? (
    <Link href={`/cost-catalog/${item.id}/edit`} className="block rounded-lg border bg-card p-3">
      {inner}
    </Link>
  ) : (
    <div className="rounded-lg border bg-card p-3">{inner}</div>
  );
}

function TierBadge({ tier }: { tier: Tier }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
        TIER_STYLES[tier],
      )}
    >
      {TIER_LABELS[tier]}
    </span>
  );
}

function NotReady() {
  return (
    <Empty title="Cost catalog">
      The catalog activates once authentication and the database are configured and an organization
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
