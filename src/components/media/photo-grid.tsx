import { Eye, EyeOff, ImageOff, Trash2 } from 'lucide-react';
import {
  PHOTO_CATEGORY_LABELS,
  PHOTO_CATEGORY_STYLES,
  groupPhotosByCategory,
} from '@/lib/storage/storage-core';
import { deletePhoto, togglePhotoVisibility } from '@/lib/media/actions';
import type { PhotoRow } from '@/lib/media/queries';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Jobsite photos, grouped the way a job runs — before, progress, completion,
 * damage. Two taps per photo: show the client, or remove it.
 *
 * Images are served from short-lived signed URLs; if one can't be signed the
 * tile degrades to a placeholder rather than a broken image.
 */
export function PhotoGrid({
  photos,
  mayWrite,
  showProject = false,
}: {
  photos: PhotoRow[];
  mayWrite: boolean;
  showProject?: boolean;
}) {
  if (photos.length === 0) {
    return <p className="text-sm text-muted-foreground">No photos yet.</p>;
  }

  const groups = groupPhotosByCategory(photos);

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section key={group.category} className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {group.label}
            <span className="ml-1.5 font-normal">{group.photos.length}</span>
          </h3>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {group.photos.map((photo) => (
              <PhotoTile
                key={photo.id}
                photo={photo}
                mayWrite={mayWrite}
                showProject={showProject}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function PhotoTile({
  photo,
  mayWrite,
  showProject,
}: {
  photo: PhotoRow;
  mayWrite: boolean;
  showProject: boolean;
}) {
  return (
    <li className="overflow-hidden rounded-md border">
      <div className="relative aspect-square bg-secondary">
        {photo.url ? (
          // A signed URL to a private bucket: next/image would need the host
          // allow-listed and would cache a URL that expires in minutes.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo.url}
            alt={photo.caption ?? `${PHOTO_CATEGORY_LABELS[photo.category]} photo`}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
            <ImageOff className="h-6 w-6" />
            <span className="px-2 text-center text-[10px]">Preview unavailable</span>
          </div>
        )}
        <span
          className={cn(
            'absolute left-1 top-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
            PHOTO_CATEGORY_STYLES[photo.category],
          )}
        >
          {PHOTO_CATEGORY_LABELS[photo.category]}
        </span>
        {photo.clientVisible ? (
          <span className="absolute right-1 top-1 rounded bg-emerald-500/90 px-1.5 py-0.5 text-[10px] font-medium text-white">
            Client
          </span>
        ) : null}
      </div>

      <div className="space-y-1 p-2">
        {photo.caption ? <p className="text-xs">{photo.caption}</p> : null}
        <p className="text-[10px] text-muted-foreground">
          {new Date(photo.createdAt).toLocaleDateString('en-US')}
          {photo.uploaderName ? ` · ${photo.uploaderName}` : ''}
          {showProject && photo.projectName ? ` · ${photo.projectName}` : ''}
        </p>

        {mayWrite ? (
          <div className="flex gap-1 pt-0.5">
            <form action={togglePhotoVisibility}>
              <input type="hidden" name="photoId" value={photo.id} />
              <input type="hidden" name="visible" value={String(!photo.clientVisible)} />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                className="h-6 w-auto px-1.5 text-[10px]"
                title={
                  photo.clientVisible ? 'Hide this from the client' : 'Show this to the client'
                }
              >
                {photo.clientVisible ? (
                  <EyeOff className="h-3 w-3" />
                ) : (
                  <Eye className="h-3 w-3" />
                )}
                {photo.clientVisible ? 'Hide' : 'Share'}
              </Button>
            </form>
            <form action={deletePhoto}>
              <input type="hidden" name="photoId" value={photo.id} />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                className="h-6 w-auto px-1.5 text-[10px] text-destructive"
                title="Remove this photo"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </form>
          </div>
        ) : null}
      </div>
    </li>
  );
}
