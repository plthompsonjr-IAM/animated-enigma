'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { Bookmark } from 'lucide-react';
import { saveVersionAsTemplate } from '@/lib/scopes/template-actions';
import type { FormState } from '@/lib/auth/actions';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { SubmitButton, FormNotice } from '@/components/forms/form-bits';

const initial: FormState = {};

/** Collapsible "save this version as a reusable template" form. */
export function SaveAsTemplate({
  projectId,
  versionId,
  defaultProjectType,
}: {
  projectId: string;
  versionId: string;
  defaultProjectType?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useFormState(saveVersionAsTemplate, initial);

  if (state.message && open) setOpen(false);

  if (!open) {
    return (
      <div className="space-y-2">
        {state.message ? <FormNotice message={state.message} /> : null}
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Bookmark className="h-4 w-4" />
          Save as template
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-2 rounded-md border p-3">
      <FormNotice error={state.error} />
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="versionId" value={versionId} />
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Template name</label>
          <Input name="name" placeholder="e.g. Standard bathroom remodel" required />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">
            Project type (optional)
          </label>
          <Input
            name="projectType"
            defaultValue={defaultProjectType ?? ''}
            placeholder="Bathroom Remodel"
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <SubmitButton className="w-auto" pendingLabel="Saving…">
          Save template
        </SubmitButton>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
