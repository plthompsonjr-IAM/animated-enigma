'use client';

import { useState } from 'react';
import { LayoutTemplate } from 'lucide-react';
import { startScopeFromTemplate } from '@/lib/scopes/template-actions';
import type { TemplateRow } from '@/lib/scopes/template-queries';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';

/** Collapsible picker that applies a template as a new draft version. `label`
 * lets the empty state say "Start from a template" and the version card say
 * "New version from template". */
export function TemplatePicker({
  projectId,
  templates,
  label,
  variant = 'outline',
}: {
  projectId: string;
  templates: TemplateRow[];
  label: string;
  variant?: 'default' | 'outline';
}) {
  const [open, setOpen] = useState(false);

  if (templates.length === 0) return null;

  if (!open) {
    return (
      <Button type="button" variant={variant} size="sm" onClick={() => setOpen(true)}>
        <LayoutTemplate className="h-4 w-4" />
        {label}
      </Button>
    );
  }

  return (
    <form action={startScopeFromTemplate} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <Select
        name="templateId"
        defaultValue={templates[0]?.id}
        aria-label="Template"
        className="w-auto"
      >
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
            {t.projectType ? ` · ${t.projectType}` : ''} ({t.summary.sectionCount} sec,{' '}
            {t.summary.itemCount} lines){t.isGlobal ? ' · shared' : ''}
          </option>
        ))}
      </Select>
      <Button type="submit" size="sm">
        Apply
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </form>
  );
}
