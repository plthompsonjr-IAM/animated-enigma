import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, FileText } from 'lucide-react';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { getProject } from '@/lib/projects/queries';
import {
  getScopeForProject,
  getScopeVersions,
  getVersionContent,
  resolveDisplayVersionId,
} from '@/lib/scopes/queries';
import { isEditable } from '@/lib/scopes/scopes-core';
import { createScope } from '@/lib/scopes/actions';
import { listTemplates } from '@/lib/scopes/template-queries';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { VersionStatusBadge } from '@/components/scopes/version-badges';
import { TemplatePicker } from '@/components/scopes/template-picker';
import { SaveAsTemplate } from '@/components/scopes/save-as-template';
import { ScopeBuilder } from './scope-builder';
import { VersionControls, VersionSwitcher, VersionNotes } from './version-controls';

export const metadata = { title: 'Scope of work' };

export default async function ScopePage({
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
  if (!can(ctx.activeOrg.roles, 'projects:read', ctx.activeOrg.extraPermissions))
    redirect('/projects');

  const orgId = ctx.activeOrg.organizationId;
  const mayEdit =
    can(ctx.activeOrg.roles, 'estimates:write', ctx.activeOrg.extraPermissions) ||
    can(ctx.activeOrg.roles, 'projects:write', ctx.activeOrg.extraPermissions);

  const project = await getProject(orgId, id);
  if (!project) notFound();

  const scope = await getScopeForProject(orgId, id);
  const templates = mayEdit
    ? await listTemplates(orgId, { projectType: project.project.projectType })
    : [];

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <Link
          href={`/projects/${id}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {project.project.projectNumber} · {project.project.name}
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Scope of work</h1>
      </div>

      {!scope ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-14 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <FileText className="h-6 w-6" />
            </div>
            <div className="max-w-sm">
              <p className="font-medium">No scope yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Build a versioned scope of work — what’s included, excluded, allowances, and more.
                Estimates and proposals build on it.
              </p>
            </div>
            {mayEdit ? (
              <div className="flex flex-col items-center gap-2 sm:flex-row">
                <form action={createScope}>
                  <input type="hidden" name="projectId" value={id} />
                  <input type="hidden" name="title" value="Scope of Work" />
                  <Button type="submit">Start blank</Button>
                </form>
                <TemplatePicker
                  projectId={id}
                  templates={templates}
                  label="Start from a template"
                />
              </div>
            ) : null}
            {mayEdit ? (
              <Link
                href="/scope-templates"
                className="text-xs text-muted-foreground underline hover:text-foreground"
              >
                Manage templates
              </Link>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <ScopeBody
          projectId={id}
          scopeId={scope.id}
          currentVersionId={scope.currentVersionId}
          requestedVersionId={(await searchParams).v}
          orgId={orgId}
          mayEdit={mayEdit}
          templates={templates}
          projectType={project.project.projectType}
        />
      )}
    </div>
  );
}

async function ScopeBody({
  projectId,
  scopeId,
  currentVersionId,
  requestedVersionId,
  orgId,
  mayEdit,
  templates,
  projectType,
}: {
  projectId: string;
  scopeId: string;
  currentVersionId: string | null;
  requestedVersionId?: string;
  orgId: string;
  mayEdit: boolean;
  templates: Awaited<ReturnType<typeof listTemplates>>;
  projectType: string | null;
}) {
  const versions = await getScopeVersions(orgId, scopeId);
  const fallbackId = await resolveDisplayVersionId(orgId, scopeId, currentVersionId);
  const selectedId =
    (requestedVersionId && versions.some((v) => v.id === requestedVersionId)
      ? requestedVersionId
      : fallbackId) ?? versions[0]?.id;

  if (!selectedId) return <p className="text-sm text-muted-foreground">No versions.</p>;

  const version = versions.find((v) => v.id === selectedId)!;
  const sections = await getVersionContent(orgId, selectedId);
  const editable = mayEdit && isEditable(version.status);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">Version {version.versionNumber}</CardTitle>
            <VersionStatusBadge status={version.status} />
          </div>
          <div className="flex items-center gap-2">
            {versions.length > 1 ? (
              <VersionSwitcher versions={versions} selectedId={selectedId} />
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Created {new Date(version.createdAt).toLocaleDateString('en-US')}
            {version.createdByName ? ` by ${version.createdByName}` : ''}
            {version.status === 'locked' && version.lockedAt
              ? ` · Locked ${new Date(version.lockedAt).toLocaleDateString('en-US')}`
              : ''}
          </p>
          {mayEdit ? (
            <VersionControls projectId={projectId} scopeId={scopeId} version={version} />
          ) : null}
          {!editable && mayEdit ? (
            <p className="rounded-md bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
              This version is {version.status}. To make changes, create a new version.
            </p>
          ) : null}
          {mayEdit ? (
            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <SaveAsTemplate
                projectId={projectId}
                versionId={selectedId}
                defaultProjectType={projectType}
              />
              <TemplatePicker
                projectId={projectId}
                templates={templates}
                label="New version from template"
              />
              <Link
                href="/scope-templates"
                className="text-xs text-muted-foreground underline hover:text-foreground"
              >
                Manage templates
              </Link>
            </div>
          ) : null}
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Version notes
            </h3>
            <VersionNotes projectId={projectId} version={version} editable={editable} />
          </div>
        </CardContent>
      </Card>

      <ScopeBuilder
        projectId={projectId}
        versionId={selectedId}
        sections={sections}
        editable={editable}
      />

      {!mayEdit ? (
        <p className="text-center text-xs text-muted-foreground">
          You have read-only access to this scope.
        </p>
      ) : null}

      <div className="pt-2">
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
