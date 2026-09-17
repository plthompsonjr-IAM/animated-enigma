'use client';

import { useFormState } from 'react-dom';
import { useState } from 'react';
import { Camera, FilePlus } from 'lucide-react';
import { uploadDocument, uploadPhotos } from '@/lib/media/actions';
import {
  ALLOWED_DOCUMENT_TYPES,
  ALLOWED_IMAGE_TYPES,
  DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABELS,
  MAX_DOCUMENT_BYTES,
  MAX_PHOTO_BYTES,
  PHOTO_CATEGORIES,
  PHOTO_CATEGORY_LABELS,
  formatBytes,
} from '@/lib/storage/storage-core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { SubmitButton, FormNotice } from '@/components/forms/form-bits';

const initial = {} as { error?: string; message?: string };

/**
 * Photo upload. `capture="environment"` opens the rear camera straight from the
 * page on a phone, which is how most of these will actually be taken — the
 * alternative is shoot, leave the app, come back, find the file.
 */
export function PhotoUploadForm({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useFormState(uploadPhotos, initial);

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-auto"
        onClick={() => setOpen(true)}
      >
        <Camera className="h-4 w-4" />
        Add photos
      </Button>
    );
  }

  return (
    <form action={formAction} className="space-y-3 rounded-md border p-3">
      <input type="hidden" name="projectId" value={projectId} />

      <div>
        <Label htmlFor="photo-files" className="mb-1.5 block">
          Photos
        </Label>
        <Input
          id="photo-files"
          name="files"
          type="file"
          accept={ALLOWED_IMAGE_TYPES.join(',')}
          capture="environment"
          multiple
          required
          className="h-auto py-2"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Up to 20 at a time, {formatBytes(MAX_PHOTO_BYTES)} each. JPEG, PNG, WebP, or HEIC.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="photo-category" className="mb-1.5 block">
            Category
          </Label>
          <Select id="photo-category" name="category" defaultValue="progress">
            {PHOTO_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {PHOTO_CATEGORY_LABELS[category]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="photo-caption" className="mb-1.5 block">
            Caption
          </Label>
          <Input
            id="photo-caption"
            name="caption"
            placeholder="Optional — used when you upload one photo."
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="clientVisible" className="h-4 w-4 rounded border-input" />
        Show these to the client
      </label>

      <FormNotice error={state.error} message={state.message} />

      <div className="flex flex-wrap gap-2">
        <SubmitButton className="sm:w-auto sm:px-6" pendingLabel="Uploading…">
          Upload
        </SubmitButton>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-auto"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Document upload — receipts, permits, plans, specs. */
export function DocumentUploadForm({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useFormState(uploadDocument, initial);

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-auto"
        onClick={() => setOpen(true)}
      >
        <FilePlus className="h-4 w-4" />
        Add document
      </Button>
    );
  }

  return (
    <form action={formAction} className="space-y-3 rounded-md border p-3">
      <input type="hidden" name="projectId" value={projectId} />

      <div>
        <Label htmlFor="doc-file" className="mb-1.5 block">
          File
        </Label>
        <Input
          id="doc-file"
          name="file"
          type="file"
          accept={ALLOWED_DOCUMENT_TYPES.join(',')}
          required
          className="h-auto py-2"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Up to {formatBytes(MAX_DOCUMENT_BYTES)}. PDF, image, text, or Office document.
        </p>
      </div>

      <div>
        <Label htmlFor="doc-category" className="mb-1.5 block">
          Category
        </Label>
        <Select id="doc-category" name="category" defaultValue="">
          <option value="">Work it out from the filename</option>
          {DOCUMENT_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {DOCUMENT_CATEGORY_LABELS[category]}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <Label htmlFor="doc-notes" className="mb-1.5 block">
          Notes
        </Label>
        <Textarea id="doc-notes" name="notes" rows={2} placeholder="Optional." />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="clientVisible" className="h-4 w-4 rounded border-input" />
        Show this to the client
      </label>

      <FormNotice error={state.error} message={state.message} />

      <div className="flex flex-wrap gap-2">
        <SubmitButton className="sm:w-auto sm:px-6" pendingLabel="Uploading…">
          Upload
        </SubmitButton>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-auto"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
