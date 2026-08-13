/**
 * Role-based access control.
 *
 * Roles come from the Task 4 schema (`user_role` enum). The Task 6 minimum set
 * maps onto them: Administrator → owner, Office → office_manager, Sales →
 * sales_rep, Estimator, Project Manager, Field Staff → field_foreman +
 * technician, Client → client. A member's effective permissions are the UNION
 * of their roles' permissions plus any owner-granted extra permissions.
 *
 * This module is pure (no IO) so the permission matrix is unit-testable and can
 * be enforced identically in server actions, route handlers, and UI gating.
 * Postgres RLS remains the hard tenant boundary underneath it.
 */

export const ROLES = [
  'owner',
  'office_manager',
  'estimator',
  'project_manager',
  'field_foreman',
  'technician',
  'sales_rep',
  'client',
  'subcontractor',
] as const;

export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  // organization administration
  'org:manage', // settings, branding, billing
  'members:invite',
  'members:manage_roles',
  'audit:read',
  // CRM
  'leads:read',
  'leads:write',
  'clients:read',
  'clients:write',
  // delivery
  'projects:read',
  'projects:write',
  'tasks:read',
  'tasks:write',
  'documents:read',
  'documents:write',
  'schedule:read',
  'schedule:write',
  // money — costs/margins are a separate, stricter permission than prices
  'estimates:read',
  'estimates:write',
  'financials:read',
  'financials:write',
  'costs:read', // internal cost & margin visibility
  // AI
  'ai:use',
  // portals
  'portal:client',
  'portal:subcontractor',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL_INTERNAL: Permission[] = PERMISSIONS.filter(
  (p) => p !== 'portal:client' && p !== 'portal:subcontractor',
);

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: ALL_INTERNAL,
  office_manager: [
    'members:invite',
    'leads:read',
    'leads:write',
    'clients:read',
    'clients:write',
    'projects:read',
    'projects:write',
    'tasks:read',
    'tasks:write',
    'documents:read',
    'documents:write',
    'schedule:read',
    'schedule:write',
    'estimates:read',
    'financials:read',
    'financials:write',
    'costs:read',
    'ai:use',
  ],
  estimator: [
    'leads:read',
    'clients:read',
    'projects:read',
    'documents:read',
    'documents:write',
    'schedule:read',
    'estimates:read',
    'estimates:write',
    'costs:read',
    'ai:use',
  ],
  project_manager: [
    'leads:read',
    'clients:read',
    'projects:read',
    'projects:write',
    'tasks:read',
    'tasks:write',
    'documents:read',
    'documents:write',
    'schedule:read',
    'schedule:write',
    'estimates:read',
    'financials:read',
    'costs:read',
    'ai:use',
  ],
  field_foreman: [
    'projects:read', // scope & schedule, never costs
    'tasks:read',
    'tasks:write',
    'documents:read',
    'documents:write',
    'schedule:read',
    'ai:use',
  ],
  technician: ['tasks:read', 'tasks:write', 'documents:write', 'schedule:read'],
  sales_rep: [
    'leads:read',
    'leads:write',
    'clients:read',
    'clients:write',
    'schedule:read',
    'schedule:write',
    'estimates:read', // selling prices; costs:read deliberately absent
    'ai:use',
  ],
  client: ['portal:client'],
  subcontractor: ['portal:subcontractor'],
};

/** Compute the effective permission set for a member. */
export function permissionsFor(
  roles: readonly Role[],
  extraPermissions: readonly string[] = [],
): Set<Permission> {
  const set = new Set<Permission>();
  for (const role of roles) {
    for (const p of ROLE_PERMISSIONS[role] ?? []) set.add(p);
  }
  for (const extra of extraPermissions) {
    if ((PERMISSIONS as readonly string[]).includes(extra)) set.add(extra as Permission);
  }
  return set;
}

export function can(
  roles: readonly Role[],
  permission: Permission,
  extraPermissions: readonly string[] = [],
): boolean {
  return permissionsFor(roles, extraPermissions).has(permission);
}

export class AuthorizationError extends Error {
  constructor(permission: Permission) {
    super(`Missing permission: ${permission}`);
    this.name = 'AuthorizationError';
  }
}

export function assertCan(
  roles: readonly Role[],
  permission: Permission,
  extraPermissions: readonly string[] = [],
): void {
  if (!can(roles, permission, extraPermissions)) throw new AuthorizationError(permission);
}

/** Human labels for the UI (Task 6 naming). */
export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Administrator',
  office_manager: 'Office',
  estimator: 'Estimator',
  project_manager: 'Project Manager',
  field_foreman: 'Field Staff (Foreman)',
  technician: 'Field Staff (Technician)',
  sales_rep: 'Sales',
  client: 'Client',
  subcontractor: 'Subcontractor',
};

/** Roles assignable from the team screen (portal roles are provisioned via their own flows). */
export const ASSIGNABLE_ROLES: readonly Role[] = [
  'owner',
  'office_manager',
  'sales_rep',
  'estimator',
  'project_manager',
  'field_foreman',
  'technician',
];
