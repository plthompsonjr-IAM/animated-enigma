import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FolderOpen } from 'lucide-react';
import { getAuthContext } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { schedulableProjects } from '@/lib/schedule/queries';
import { listDocuments, listPhotos } from '@/lib/media/queries';
import { isStorageConfigured } from '@/lib/storage/supabase-storage';
import { formatBytes, summarizeMedia } from '@/lib/storage/storage-core';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PhotoGrid } from '@/components/media/photo-grid';
import { DocumentList } from '@/components/media/document-list';
import { DocumentsToolbar } from './documents-toolbar';

export const metadata = { title: 'Documents' };

interface SearchParams {
  project?: string;
  view?: string;
  shared?: string;
}

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await getAuthContext();
  if (ctx.configured && !ctx.userId) redirect('/login');
  if (!ctx.configured || !ctx.dbAvailable || !ctx.activeOrg) {
    return (
      <Empty title="Documents">
        Documents activate once authentication and the database are configured and an organization
        exists.
      </Empty>
    );
  }

  const { activeOrg } = ctx;
  if (!can(activeOrg.roles, 'documents:read', activeOrg.extraPermissions)) {
    return <Empty title="Documents">You don’t have permission to view project files.</Empty>;
  }
  const mayWrite = can(activeOrg.roles, 'documents:write', activeOrg.extraPermissions);

  const sp = await searchParams;
  const view = sp.view === 'photos' ? 'photos' : sp.view === 'documents' ? 'documents' : 'all';
  const sharedOnly = sp.shared === '1';
  const orgId = activeOrg.organizationId;

  const [photos, documents, projects] = await Promise.all([
    view === 'documents'
      ? Promise.resolve([])
      : listPhotos({
          organizationId: orgId,
          projectId: sp.project || undefined,
          clientVisibleOnly: sharedOnly,
        }),
    view === 'photos'
      ? Promise.resolve([])
      : listDocuments({
          organizationId: orgId,
          projectId: sp.project || undefined,
          clientVisibleOnly: sharedOnly,
        }),
    schedulableProjects(orgId),
  ]);

  const summary = summarizeMedia(photos, documents);
  const nothing = photos.length === 0 && documents.length === 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Documents</h1>
        <p className="text-sm text-muted-foreground">
          Photos, receipts, permits, and plans across every job. Upload from a project.
        </p>
      </div>

      <DocumentsToolbar projects={projects} view={view} shared={sharedOnly} />

      {!isStorageConfigured() ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">File storage isn’t connected yet.</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Set <code>SUPABASE_SERVICE_ROLE_KEY</code> and create a <strong>private</strong> bucket
            called <code>project-files</code> in Supabase. Existing records will show, but previews
            and downloads need the key.
          </p>
        </div>
      ) : null}

      {nothing ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <FolderOpen className="h-6 w-6" />
            </div>
            <div className="max-w-sm">
              <p className="font-medium">
                {sharedOnly ? 'Nothing shared with clients yet' : 'No files yet'}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {sharedOnly
                  ? 'Mark a photo or document as client-visible and it shows up here.'
                  : 'Open a project and add photos or documents from the jobsite.'}
              </p>
              <Link href="/projects" className="mt-2 inline-block text-sm underline">
                Go to projects
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Photos" value={String(summary.photos)} />
            <Stat label="Documents" value={String(summary.documents)} />
            <Stat label="Shared with clients" value={String(summary.clientVisible)} />
          </div>

          {photos.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Photos
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {photos.length}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <PhotoGrid photos={photos} mayWrite={mayWrite} showProject />
              </CardContent>
            </Card>
          ) : null}

          {documents.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Documents
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {documents.length}
                    {summary.totalBytes > 0 ? ` · ${formatBytes(summary.totalBytes)}` : ''}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <DocumentList documents={documents} mayWrite={mayWrite} showProject />
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-xl font-bold tabular-nums">{value}</div>
    </div>
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
