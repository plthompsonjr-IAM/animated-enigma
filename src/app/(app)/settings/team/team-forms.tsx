'use client';

import { useFormState } from 'react-dom';
import { inviteMember, updateMemberRoles, type InviteState } from '@/lib/auth/org-actions';
import type { FormState } from '@/lib/auth/actions';
import { ASSIGNABLE_ROLES, ROLE_LABELS, type Role } from '@/lib/auth/rbac';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SubmitButton, FormNotice } from '@/components/forms/form-bits';

const inviteInitial: InviteState = {};
const rolesInitial: FormState = {};

function RoleCheckboxes({ name, defaults }: { name: string; defaults?: readonly Role[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
      {ASSIGNABLE_ROLES.map((role) => (
        <label key={role} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name={name}
            value={role}
            defaultChecked={defaults?.includes(role)}
            className="h-4 w-4 rounded border-input accent-[hsl(var(--primary))]"
          />
          {ROLE_LABELS[role]}
        </label>
      ))}
    </div>
  );
}

export function InviteMemberForm() {
  const [state, formAction] = useFormState(inviteMember, inviteInitial);

  return (
    <form action={formAction} className="space-y-3">
      <FormNotice error={state.error} message={state.message} />
      {state.inviteUrl ? (
        <p className="break-all rounded-md bg-secondary px-3 py-2 text-xs">
          Share this link with them: <span className="font-mono">{state.inviteUrl}</span>
        </p>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="invite-email">Email</Label>
        <Input
          id="invite-email"
          name="email"
          type="email"
          placeholder="teammate@example.com"
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label>Roles</Label>
        <RoleCheckboxes name="roles" />
      </div>
      <SubmitButton pendingLabel="Creating invite…">Send invitation</SubmitButton>
    </form>
  );
}

export function MemberRolesForm({
  memberId,
  roles,
  disabled,
}: {
  memberId: string;
  roles: readonly Role[];
  disabled?: boolean;
}) {
  const [state, formAction] = useFormState(updateMemberRoles, rolesInitial);

  if (disabled) {
    return (
      <p className="text-xs text-muted-foreground">{roles.map((r) => ROLE_LABELS[r]).join(', ')}</p>
    );
  }

  return (
    <form action={formAction} className="space-y-2">
      <FormNotice error={state.error} message={state.message} />
      <input type="hidden" name="memberId" value={memberId} />
      <RoleCheckboxes name="roles" defaults={roles} />
      <SubmitButton className="w-auto" pendingLabel="Saving…">
        Save roles
      </SubmitButton>
    </form>
  );
}
