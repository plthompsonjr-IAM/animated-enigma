'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { Plus } from 'lucide-react';
import {
  addContact,
  deleteContact,
  makePrimaryContact,
  archiveClient,
  restoreClient,
  type ClientFormState,
} from '@/lib/clients/actions';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { SubmitButton, FormNotice } from '@/components/forms/form-bits';

const initial: ClientFormState = {};

/** Collapsible "add contact" form for the client's people list. */
export function AddContactForm({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useFormState(addContact, initial);

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Add contact
      </Button>
    );
  }

  return (
    <form action={formAction} className="space-y-2 rounded-md border p-3">
      <FormNotice error={state.error} message={state.message} />
      <input type="hidden" name="clientId" value={clientId} />
      <div className="grid gap-2 sm:grid-cols-2">
        <Input name="name" placeholder="Name" required aria-label="Contact name" />
        <Input name="role" placeholder="Role (spouse, tenant…)" aria-label="Contact role" />
        <Input name="phone" type="tel" placeholder="Phone" aria-label="Contact phone" />
        <Input name="email" type="email" placeholder="Email" aria-label="Contact email" />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isPrimary" value="true" className="h-4 w-4" />
        Primary contact
      </label>
      <div className="flex items-center gap-2">
        <SubmitButton className="w-auto" pendingLabel="Adding…">
          Add contact
        </SubmitButton>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
    </form>
  );
}

export function ContactRowActions({
  clientId,
  contactId,
  isPrimary,
}: {
  clientId: string;
  contactId: string;
  isPrimary: boolean;
}) {
  return (
    <span className="flex items-center gap-1">
      {!isPrimary ? (
        <form action={makePrimaryContact}>
          <input type="hidden" name="clientId" value={clientId} />
          <input type="hidden" name="contactId" value={contactId} />
          <Button type="submit" variant="ghost" size="sm" className="h-7 px-2 text-xs">
            Make primary
          </Button>
        </form>
      ) : null}
      <form action={deleteContact}>
        <input type="hidden" name="clientId" value={clientId} />
        <input type="hidden" name="contactId" value={contactId} />
        <Button type="submit" variant="ghost" size="sm" className="h-7 px-2 text-xs">
          Remove
        </Button>
      </form>
    </span>
  );
}

export function ArchiveClientButton({
  clientId,
  archived,
}: {
  clientId: string;
  archived: boolean;
}) {
  return (
    <form action={archived ? restoreClient : archiveClient}>
      <input type="hidden" name="clientId" value={clientId} />
      <Button type="submit" variant={archived ? 'outline' : 'ghost'} size="sm">
        {archived ? 'Restore client' : 'Archive client'}
      </Button>
    </form>
  );
}
