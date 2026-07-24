'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useFormState } from 'react-dom';
import {
  changeEstimateStatus,
  createNewEstimateVersion,
  updateRates,
} from '@/lib/estimates/actions';
import type { FormState } from '@/lib/auth/actions';
import {
  allowedTransitions,
  VERSION_STATUS_LABELS,
  type VersionStatus,
} from '@/lib/estimates/estimate-core';
import type { EstimateVersionRow } from '@/lib/estimates/queries';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { SubmitButton, FormNotice } from '@/components/forms/form-bits';

/** Version switcher — reflects the selected estimate into the URL (?v=…). */
export function EstimateVersionSwitcher({
  versions,
  selectedId,
}: {
  versions: EstimateVersionRow[];
  selectedId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <Select
      aria-label="Select estimate version"
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
          v{v.versionNumber}
          {v.name ? ` · ${v.name}` : ''} · {VERSION_STATUS_LABELS[v.status]}
        </option>
      ))}
    </Select>
  );
}

/** Lifecycle buttons + "new version from this". */
export function EstimateLifecycle({
  projectId,
  version,
}: {
  projectId: string;
  version: EstimateVersionRow;
}) {
  const transitions = allowedTransitions(version.status);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {transitions.map((to) => (
        <form action={changeEstimateStatus} key={to}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="versionId" value={version.id} />
          <input type="hidden" name="status" value={to} />
          <Button type="submit" size="sm" variant={to === 'draft' ? 'outline' : 'default'}>
            {transitionLabel(version.status, to)}
          </Button>
        </form>
      ))}
      <form action={createNewEstimateVersion}>
        <input type="hidden" name="projectId" value={projectId} />
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

const initial: FormState = {};

/** Estimate name + overhead/profit/tax rate controls (draft only). */
export function RateControls({
  projectId,
  version,
  editable,
}: {
  projectId: string;
  version: EstimateVersionRow;
  editable: boolean;
}) {
  const [state, formAction] = useFormState(updateRates, initial);
  const pct = (v: string | null) => (v ? String(Math.round(Number(v) * 1000) / 10) : '0');

  if (!editable) {
    return (
      <dl className="space-y-1.5 text-sm">
        <Row label="Name" value={version.name ?? '—'} />
        <Row label="Overhead" value={`${pct(version.overheadPct)}%`} />
        <Row label="Profit" value={`${pct(version.profitPct)}%`} />
        <Row label="Tax" value={`${pct(version.taxRate)}%`} />
      </dl>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <FormNotice error={state.error} message={state.message} />
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="estimateVersionId" value={version.id} />
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">Estimate name (optional)</label>
        <Input name="name" defaultValue={version.name ?? ''} placeholder="e.g. Better" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <RateField label="Overhead %" name="overheadPct" defaultValue={pct(version.overheadPct)} />
        <RateField label="Profit %" name="profitPct" defaultValue={pct(version.profitPct)} />
        <RateField label="Tax %" name="taxRate" defaultValue={pct(version.taxRate)} />
      </div>
      <SubmitButton className="w-auto" pendingLabel="Saving…">
        Save rates
      </SubmitButton>
    </form>
  );
}

function RateField({
  label,
  name,
  defaultValue,
}: {
  label: string;
  name: string;
  defaultValue: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      <Input name={name} type="number" min="0" max="100" step="0.1" defaultValue={defaultValue} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
