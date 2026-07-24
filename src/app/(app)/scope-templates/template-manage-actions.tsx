'use client';

import { deleteTemplate, setTemplateActive } from '@/lib/scopes/template-actions';
import { Button } from '@/components/ui/button';

/** Activate/deactivate + delete controls for an org-owned template. */
export function TemplateManageActions({
  templateId,
  isActive,
}: {
  templateId: string;
  isActive: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <form action={setTemplateActive}>
        <input type="hidden" name="templateId" value={templateId} />
        <input type="hidden" name="active" value={(!isActive).toString()} />
        <Button type="submit" variant="ghost" size="sm" className="h-7 px-2 text-xs">
          {isActive ? 'Deactivate' : 'Activate'}
        </Button>
      </form>
      <form action={deleteTemplate}>
        <input type="hidden" name="templateId" value={templateId} />
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
        >
          Delete
        </Button>
      </form>
    </div>
  );
}
