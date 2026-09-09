'use client';

import { useFormState } from 'react-dom';
import { useState } from 'react';
import Link from 'next/link';
import { createProject, updateProject } from '@/lib/projects/actions';
import type { FormState } from '@/lib/auth/actions';
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  PERMIT_STATUSES,
  PERMIT_STATUS_LABELS,
  PAYMENT_STATES,
  PAYMENT_STATE_LABELS,
} from '@/lib/projects/projects-core';
import { formatAddress } from '@/lib/clients/clients-core';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { buttonVariants } from '@/components/ui/button';
import { SubmitButton, FormNotice } from '@/components/forms/form-bits';

export interface Member {
  id: string;
  name: string | null;
  email: string;
}

export interface ClientOption {
  id: string;
  name: string;
}

export interface PropertyOption {
  id: string;
  clientId: string;
  label: string;
}

export interface ProjectFormValues {
  id?: string;
  name?: string;
  clientId?: string;
  propertyId?: string | null;
  projectType?: string | null;
  status?: string;
  projectManagerId?: string | null;
  foremanId?: string | null;
  salespersonId?: string | null;
  contractValue?: string | null;
  budget?: string | null;
  expectedStart?: string | null;
  expectedCompletion?: string | null;
  actualStart?: string | null;
  actualCompletion?: string | null;
  permitStatus?: string;
  paymentState?: string;
  description?: string | null;
  internalNotes?: string | null;
}

const PROJECT_TYPES = [
  'Bathroom Remodel',
  'Kitchen Remodel',
  'Flooring',
  'Painting',
  'Roofing',
  'Siding',
  'Deck',
  'Fence',
  'Shed',
  'Plumbing Repair',
  'Electrical Repair',
  'General Renovation',
  'Commercial Project',
];

const initial: FormState = {};

export function ProjectForm({
  mode,
  members,
  clients,
  properties,
  values,
  showFinancials,
  lockClient,
}: {
  mode: 'create' | 'edit';
  members: Member[];
  clients: ClientOption[];
  properties: PropertyOption[];
  values?: ProjectFormValues;
  showFinancials: boolean;
  /** In edit mode the client can't be changed (projects don't move clients). */
  lockClient?: boolean;
}) {
  const [state, formAction] = useFormState(
    mode === 'create' ? createProject : updateProject,
    initial,
  );
  const v = values ?? {};
  const [clientId, setClientId] = useState(v.clientId ?? '');

  const clientProperties = properties.filter((p) => p.clientId === clientId);

  return (
    <form action={formAction} className="space-y-6">
      <FormNotice error={state.error} />
      {mode === 'edit' && v.id ? <input type="hidden" name="projectId" value={v.id} /> : null}

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Project
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Project name" htmlFor="name" required className="sm:col-span-2">
            <Input
              id="name"
              name="name"
              defaultValue={v.name ?? ''}
              placeholder="e.g. Dorsey hall bath remodel"
              required
            />
          </Field>
          <Field label="Client" htmlFor="clientId" required>
            {lockClient && v.clientId ? (
              <>
                <input type="hidden" name="clientId" value={v.clientId} />
                <Input
                  disabled
                  value={clients.find((c) => c.id === v.clientId)?.name ?? 'Selected client'}
                />
              </>
            ) : (
              <Select
                id="clientId"
                name="clientId"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                required
              >
                <option value="">Select a client…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Property" htmlFor="propertyId">
            <Select
              id="propertyId"
              name="propertyId"
              defaultValue={v.propertyId ?? ''}
              key={clientId}
            >
              <option value="">
                {clientProperties.length ? 'Select a property…' : 'No properties for this client'}
              </option>
              {clientProperties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Project type" htmlFor="projectType">
            <Select id="projectType" name="projectType" defaultValue={v.projectType ?? ''}>
              <option value="">Select…</option>
              {PROJECT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status" htmlFor="status">
            <Select id="status" name="status" defaultValue={v.status ?? 'planning'}>
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PROJECT_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Team
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Project manager" htmlFor="projectManagerId">
            <MemberSelect name="projectManagerId" members={members} value={v.projectManagerId} />
          </Field>
          <Field label="Field foreman" htmlFor="foremanId">
            <MemberSelect name="foremanId" members={members} value={v.foremanId} />
          </Field>
          <Field label="Salesperson" htmlFor="salespersonId">
            <MemberSelect name="salespersonId" members={members} value={v.salespersonId} />
          </Field>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Schedule &amp; permits
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Expected start" htmlFor="expectedStart">
            <Input
              id="expectedStart"
              name="expectedStart"
              type="date"
              defaultValue={v.expectedStart ?? ''}
            />
          </Field>
          <Field label="Expected completion" htmlFor="expectedCompletion">
            <Input
              id="expectedCompletion"
              name="expectedCompletion"
              type="date"
              defaultValue={v.expectedCompletion ?? ''}
            />
          </Field>
          <Field label="Actual start" htmlFor="actualStart">
            <Input
              id="actualStart"
              name="actualStart"
              type="date"
              defaultValue={v.actualStart ?? ''}
            />
          </Field>
          <Field label="Actual completion" htmlFor="actualCompletion">
            <Input
              id="actualCompletion"
              name="actualCompletion"
              type="date"
              defaultValue={v.actualCompletion ?? ''}
            />
          </Field>
          <Field label="Permit status" htmlFor="permitStatus">
            <Select
              id="permitStatus"
              name="permitStatus"
              defaultValue={v.permitStatus ?? 'not_required'}
            >
              {PERMIT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PERMIT_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Payment state" htmlFor="paymentState">
            <Select id="paymentState" name="paymentState" defaultValue={v.paymentState ?? 'none'}>
              {PAYMENT_STATES.map((s) => (
                <option key={s} value={s}>
                  {PAYMENT_STATE_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </section>

      {showFinancials ? (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Financials
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Contract value" htmlFor="contractValue">
              <Input
                id="contractValue"
                name="contractValue"
                type="number"
                min="0"
                step="100"
                defaultValue={v.contractValue ?? ''}
                placeholder="$"
              />
            </Field>
            <Field label="Internal budget" htmlFor="budget">
              <Input
                id="budget"
                name="budget"
                type="number"
                min="0"
                step="100"
                defaultValue={v.budget ?? ''}
                placeholder="$"
              />
            </Field>
          </div>
        </section>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Details
        </h2>
        <div className="grid gap-4">
          <Field label="Description" htmlFor="description">
            <Textarea
              id="description"
              name="description"
              defaultValue={v.description ?? ''}
              placeholder="What's the scope of this project?"
            />
          </Field>
          <Field label="Internal notes" htmlFor="internalNotes">
            <Textarea
              id="internalNotes"
              name="internalNotes"
              defaultValue={v.internalNotes ?? ''}
            />
          </Field>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <SubmitButton className="w-auto" pendingLabel="Saving…">
          {mode === 'create' ? 'Create project' : 'Save changes'}
        </SubmitButton>
        <Link
          href={mode === 'edit' && v.id ? `/projects/${v.id}` : '/projects'}
          className={buttonVariants({ variant: 'outline' })}
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

function MemberSelect({
  name,
  members,
  value,
}: {
  name: string;
  members: Member[];
  value?: string | null;
}) {
  return (
    <Select id={name} name={name} defaultValue={value ?? ''}>
      <option value="">Unassigned</option>
      {members.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name ?? m.email}
        </option>
      ))}
    </Select>
  );
}

/** Helper re-exported so pages can build the property option labels. */
export function propertyLabel(address: unknown): string {
  return formatAddress(address) || 'Property';
}

function Field({
  label,
  htmlFor,
  required,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor} className="mb-1.5 block">
        {label}
        {required ? <span className="text-primary"> *</span> : null}
      </Label>
      {children}
    </div>
  );
}
