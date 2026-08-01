import { FolderOpen } from 'lucide-react';
import { formatBytes, summarizeMedia } from '@/lib/storage/storage-core';
import type { DocumentRow, PhotoRow } from '@/lib/media/queries';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PhotoGrid } from './photo-grid';
import { DocumentList } from './document-list';
import { DocumentUploadForm, PhotoUploadForm } from './upload-forms';

/**
 * Photos and documents on a project. Two sections rather than one merged list:
 * a photo is something you look at and a document is something you open, and
 * they're wanted at different moments.
 */
export function ProjectMediaCard({
  projectId,
  photos,
  documents,
  mayWrite,
  storageConfigured,
}: {
  projectId: string;
  photos: PhotoRow[];
  documents: DocumentRow[];
  mayWrite: boolean;
  /** False until the storage bucket and service key are in place. */
  storageConfigured: boolean;
}) {
  const summary = summarizeMedia(photos, documents);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>Photos &amp; documents</CardTitle>
          {summary.photos + summary.documents > 0 ? (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {summary.photos} {summary.photos === 1 ? 'photo' : 'photos'} · {summary.documents}{' '}
              {summary.documents === 1 ? 'document' : 'documents'}
              {summary.totalBytes > 0 ? ` · ${formatBytes(summary.totalBytes)}` : ''}
              {summary.clientVisible > 0 ? ` · ${summary.clientVisible} shared` : ''}
            </p>
          ) : null}
        </div>
        <FolderOpen className="h-5 w-5 flex-none text-muted-foreground" />
      </CardHeader>

      <CardContent className="space-y-5">
        {!storageConfigured ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <p className="font-medium">File storage isn’t connected yet.</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Set <code>SUPABASE_SERVICE_ROLE_KEY</code> and create a{' '}
              <strong>private</strong> bucket called <code>project-files</code> in Supabase.
              Uploads stay disabled until then.
            </p>
          </div>
        ) : null}

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Photos</h3>
          <PhotoGrid photos={photos} mayWrite={mayWrite} />
          {mayWrite && storageConfigured ? <PhotoUploadForm projectId={projectId} /> : null}
        </section>

        <section className="space-y-3 border-t pt-4">
          <h3 className="text-sm font-semibold">Documents</h3>
          <DocumentList documents={documents} mayWrite={mayWrite} />
          {mayWrite && storageConfigured ? <DocumentUploadForm projectId={projectId} /> : null}
        </section>
      </CardContent>
    </Card>
  );
}
