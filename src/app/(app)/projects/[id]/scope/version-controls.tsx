'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { changeVersionStatus, createNewVersion, updateVersionNotes } from '@/lib/scopes/actions';
import {
  allowedTransitions,
  VERSION_STATUS_LABELS,
  type VersionStatus,
} from '@/lib/scopes/scopes-core';
import type { ScopeVersionRow } from '@/lib/scopes/queries';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

/** Lifecycle buttons for the displayed version + "create new version". */
export function VersionControls({
  projectId,
  scopeId,
  version,
}: {
  projectId: string;
  scopeId: string;
  version: ScopeVersionRow;
}) {
  const transitions = allowedTransitions(version.status);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {transitions.map((to) => (
        <form action={changeVersionStatus} key={to}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="versionId" value={version.id} />
          <input type="hidden" name="status" value={to} />
          <Button type="submit" size="sm" variant={to === 'draft' ? 'outline' : 'default'}>
            {transitionLabel(version.status, to)}
          </Button>
        </form>
      ))}

      <form action={createNewVersion}>
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="scopeId" value={scopeId} />
        <input type="hidden" name="fromVersionId" value={version.id} />
        <Button type="submit" size="sm" variant="outline">
          New version from this
        </Button>
      </form>
    </div>
  );
}

function transitionLabel(from: VersionStatus, to: VersionStatus): string {
  if (to === 'in_review') return 'Send for review';
  if (to === 'approved') return 'Approve';
  if (to === 'locked') return 'Lock';
  if (to === 'draft') return from === 'approved' ? 'Reopen for edits' : 'Back to draft';
  return VERSION_STATUS_LABELS[to];
}

/** Version switcher — reflects the selected version into the URL (?v=…). */
export function VersionSwitcher({
  versions,
  selectedId,
}: {
  versions: ScopeVersionRow[];
  selectedId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <Select
      aria-label="Select version"
      value={selectedId}
      onChange={(e) => {
        const next = new URLSearchParams(params.toString());
        next.set('v', e.target.value);
        router.replace(`${pathname}?${next.toString()}`);
      }}
      className="w-auto"
    >
      {versions.map((v) => (
        <option key={v.id} value={v.id}>
          v{v.versionNumber} · {VERSION_STATUS_LABELS[v.status]}
        </option>
      ))}
    </Select>
  );
}

/** Version notes editor (draft only). */
export function VersionNotes({
  projectId,
  version,
  editable,
}: {
  projectId: string;
  version: ScopeVersionRow;
  editable: boolean;
}) {
  if (!editable) {
    return version.notes ? (
      <p className="whitespace-pre-wrap text-sm text-muted-foreground">{version.notes}</p>
    ) : (
      <p className="text-sm text-muted-foreground">No notes.</p>
    );
  }
  return (
    <form action={updateVersionNotes} className="space-y-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="versionId" value={version.id} />
      <Textarea
        name="notes"
        defaultValue={version.notes ?? ''}
        placeholder="Internal notes about this version…"
        className="min-h-[60px]"
      />
      <Button type="submit" size="sm" variant="outline">
        Save notes
      </Button>
    </form>
  );
}
