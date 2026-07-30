'use client';

import { useFormState } from 'react-dom';
import { updateOrganizationSettings } from '@/lib/auth/org-actions';
import { DEFAULT_SIGNATURE_DISCLOSURE } from '@/lib/signatures/signature-core';
import { DEFAULT_CONTRACT_TERMS, serializeTerms } from '@/lib/contracts/terms-core';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SubmitButton, FormNotice } from '@/components/forms/form-bits';

const initial = {} as { error?: string; message?: string };

/**
 * Organization settings. The two legal texts get real editors here because the
 * client-facing documents depend on them — leaving either blank falls back to
 * the built-in default, and the starter contract terms are pre-loaded so the
 * contractor edits rather than starts from nothing.
 */
export function SettingsForm({
  org,
}: {
  org: {
    name: string;
    tagline: string;
    timezone: string;
    signatureDisclosure: string;
    contractTerms: string;
  };
}) {
  const [state, formAction] = useFormState(updateOrganizationSettings, initial);

  return (
    <form action={formAction} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="name" className="mb-1.5 block">
            Company name
          </Label>
          <Input id="name" name="name" defaultValue={org.name} required />
        </div>
        <div>
          <Label htmlFor="tagline" className="mb-1.5 block">
            Tagline
          </Label>
          <Input
            id="tagline"
            name="tagline"
            defaultValue={org.tagline}
            placeholder="Your Home, Our Mission."
          />
        </div>
        <div>
          <Label htmlFor="timezone" className="mb-1.5 block">
            Timezone
          </Label>
          <Input id="timezone" name="timezone" defaultValue={org.timezone} required />
        </div>
      </div>

      <div>
        <Label htmlFor="signatureDisclosure" className="mb-1.5 block">
          E-signature disclosure
        </Label>
        <Textarea
          id="signatureDisclosure"
          name="signatureDisclosure"
          rows={5}
          defaultValue={org.signatureDisclosure}
          placeholder={DEFAULT_SIGNATURE_DISCLOSURE}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Shown next to the consent checkbox when a client signs a proposal or change order, and
          recorded verbatim on every signature. Leave blank to use the built-in default (shown as
          placeholder text). Have this reviewed by an attorney — disclosure requirements vary by
          state.
        </p>
      </div>

      <div>
        <Label htmlFor="contractTerms" className="mb-1.5 block">
          Contract terms &amp; conditions
        </Label>
        <Textarea
          id="contractTerms"
          name="contractTerms"
          rows={16}
          defaultValue={org.contractTerms}
          className="font-mono text-xs"
          placeholder={serializeTerms(DEFAULT_CONTRACT_TERMS)}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Printed on every contract. Format: a short heading line, then the clause text, with a
          blank line between clauses. Placeholders <code>{'{{org_name}}'}</code>,{' '}
          <code>{'{{client_name}}'}</code>, <code>{'{{contract_value}}'}</code>,{' '}
          <code>{'{{project_name}}'}</code>, <code>{'{{project_address}}'}</code>,{' '}
          <code>{'{{contract_number}}'}</code>, and <code>{'{{today}}'}</code> are filled in
          automatically. Leave blank to use the starter template — which contains{' '}
          <strong>[BRACKETED] blanks that must be completed and reviewed by an attorney</strong>{' '}
          before you send a contract to a client.
        </p>
      </div>

      <FormNotice error={state.error} message={state.message} />
      <SubmitButton className="sm:w-auto sm:px-6" pendingLabel="Saving…">
        Save settings
      </SubmitButton>
    </form>
  );
}
