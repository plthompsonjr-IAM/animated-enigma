import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Calculator } from 'lucide-react';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { getProject } from '@/lib/projects/queries';
import {
  listEstimateVersions,
  getEstimateVersion,
  getEstimateLines,
} from '@/lib/estimates/queries';
import { isEditable, formatMoney, formatMarginPct } from '@/lib/estimates/estimate-core';
import { createEstimate } from '@/lib/estimates/actions';
import { listCatalogItems } from '@/lib/catalog/queries';
import type { Unit } from '@/lib/catalog/catalog-core';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { EstimateStatusBadge } from '@/components/estimates/estimate-badges';
import { EstimateBuilder } from './estimate-builder';
import { EstimateVersionSwitcher, EstimateLifecycle, RateControls } from './estimate-controls';

export const metadata = { title: 'Estimate' };

export default async function EstimatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { id } = await params;
  const ctx = await getAuthContext();
  if (ctx.configured && !ctx.userId) redirect('/login');
  if (!ctx.dbAvailable || !ctx.activeOrg) redirect('/projects');
  // Estimates are cost data — require estimates:read.
  if (!can(ctx.activeOrg.roles, 'estimates:read', ctx.activeOrg.extraPermissions)) {
    redirect(`/projects/${id}`);
  }

  const orgId = ctx.activeOrg.organizationId;
  const mayWrite = can(ctx.activeOrg.roles, 'estimates:write', ctx.activeOrg.extraPermissions);

  const project = await getProject(orgId, id);
  if (!project) notFound();

  const versions = await listEstimateVersions(orgId, id);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <Link
          href={`/projects/${id}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {project.project.projectNumber} · {project.project.name}
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Estimate</h1>
      </div>

      {versions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-14 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Calculator className="h-6 w-6" />
            </div>
            <div className="max-w-sm">
              <p className="font-medium">No estimate yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Build a line-item estimate from your cost catalog. Add overhead, profit, and tax to
                get a client-ready price with margin.
              </p>
            </div>
            {mayWrite ? (
              <form action={createEstimate}>
                <input type="hidden" name="projectId" value={id} />
                <Button type="submit">Start estimate</Button>
              </form>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <EstimateBody
          projectId={id}
          orgId={orgId}
          versions={versions}
          requestedVersionId={(await searchParams).v}
          mayWrite={mayWrite}
        />
      )}
    </div>
  );
}

async function EstimateBody({
  projectId,
  orgId,
  versions,
  requestedVersionId,
  mayWrite,
}: {
  projectId: string;
  orgId: string;
  versions: Awaited<ReturnType<typeof listEstimateVersions>>;
  requestedVersionId?: string;
  mayWrite: boolean;
}) {
  const selectedRow =
    (requestedVersionId && versions.find((v) => v.id === requestedVersionId)) || versions[0]!;
  const selectedId = selectedRow.id;

  const [version, lines, catalogItems] = await Promise.all([
    getEstimateVersion(orgId, selectedId),
    getEstimateLines(orgId, selectedId),
    mayWrite ? listCatalogItems({ organizationId: orgId }) : Promise.resolve([]),
  ]);
  if (!version) notFound();

  const editable = mayWrite && isEditable(version.status);
  const catalog = catalogItems.map((c) => ({
    id: c.id,
    name: c.name,
    unitCost: c.unitCost,
    unit: c.unit as Unit,
    trade: c.trade,
  }));

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">
              Estimate v{version.versionNumber}
              {version.name ? ` · ${version.name}` : ''}
            </CardTitle>
            <EstimateStatusBadge status={version.status} />
          </div>
          {versions.length > 1 ? (
            <EstimateVersionSwitcher versions={versions} selectedId={selectedId} />
          ) : null}
        </CardHeader>
        <CardContent className="space-y-3">
          {mayWrite ? <EstimateLifecycle projectId={projectId} version={selectedRow} /> : null}
          {!editable && mayWrite ? (
            <p className="rounded-md bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
              This estimate is {version.status}. To change it, create a new version.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <EstimateBuilder
            projectId={projectId}
            versionId={selectedId}
            lines={lines}
            catalog={catalog}
            editable={editable}
          />
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Totals</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-1.5 text-sm">
                <Line label="Material" value={version.materialSubtotal} />
                <Line label="Labor" value={version.laborSubtotal} />
                <Line label="Equipment" value={version.equipmentSubtotal} />
                <Line label="Subcontractor" value={version.subcontractorSubtotal} />
                <div className="my-1 border-t" />
                <Line label="Direct cost" value={version.directCost} strong />
                <Line label="Overhead" value={version.overheadAmount} />
                <Line label="Profit" value={version.profitAmount} />
                <Line label="Tax" value={version.taxAmount} />
                <div className="my-1 border-t" />
                <Line label="Client price" value={version.finalPrice} strong />
                <div className="flex items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
                  <span>Gross margin</span>
                  <span className="font-medium">{formatMarginPct(version.grossMarginPct)}</span>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pricing</CardTitle>
            </CardHeader>
            <CardContent>
              <RateControls projectId={projectId} version={selectedRow} editable={editable} />
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="pt-1">
        <Link
          href={`/projects/${projectId}`}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          Back to project
        </Link>
      </div>
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string | null; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className={strong ? 'font-medium' : 'text-muted-foreground'}>{label}</dt>
      <dd className={strong ? 'font-semibold tabular-nums' : 'tabular-nums'}>
        {formatMoney(value)}
      </dd>
    </div>
  );
}
