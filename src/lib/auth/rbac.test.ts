import { describe, it, expect } from 'vitest';
import {
  can,
  assertCan,
  permissionsFor,
  AuthorizationError,
  ROLE_PERMISSIONS,
  ROLES,
} from './rbac';

describe('RBAC permission matrix', () => {
  it('administrators (owner) can manage the org, members, and see costs', () => {
    expect(can(['owner'], 'org:manage')).toBe(true);
    expect(can(['owner'], 'members:manage_roles')).toBe(true);
    expect(can(['owner'], 'costs:read')).toBe(true);
    expect(can(['owner'], 'audit:read')).toBe(true);
  });

  it('field staff never see internal costs or financials', () => {
    for (const role of ['field_foreman', 'technician'] as const) {
      expect(can([role], 'costs:read')).toBe(false);
      expect(can([role], 'financials:read')).toBe(false);
      expect(can([role], 'estimates:read')).toBe(false);
    }
  });

  it('sales sees selling prices but not internal costs', () => {
    expect(can(['sales_rep'], 'estimates:read')).toBe(true);
    expect(can(['sales_rep'], 'costs:read')).toBe(false);
  });

  it('clients hold only the client-portal permission — nothing internal', () => {
    const perms = permissionsFor(['client']);
    expect(perms.has('portal:client')).toBe(true);
    expect(perms.size).toBe(1);
  });

  it('subcontractors hold only the subcontractor-portal permission', () => {
    const perms = permissionsFor(['subcontractor']);
    expect(perms.has('portal:subcontractor')).toBe(true);
    expect(perms.size).toBe(1);
  });

  it('no internal role is granted a portal permission', () => {
    for (const role of ROLES.filter((r) => r !== 'client' && r !== 'subcontractor')) {
      expect(can([role], 'portal:client')).toBe(false);
      expect(can([role], 'portal:subcontractor')).toBe(false);
    }
  });

  it('effective permissions are the union of all held roles', () => {
    // A technician alone cannot read estimates; adding estimator grants it.
    expect(can(['technician'], 'estimates:read')).toBe(false);
    expect(can(['technician', 'estimator'], 'estimates:read')).toBe(true);
    // The union never loses what a single role had.
    expect(can(['technician', 'estimator'], 'tasks:write')).toBe(true);
  });

  it('owner-granted extra permissions extend a role; unknown slugs are ignored', () => {
    expect(can(['office_manager'], 'org:manage')).toBe(false);
    expect(can(['office_manager'], 'org:manage', ['org:manage'])).toBe(true);
    expect(can(['office_manager'], 'org:manage', ['made-up:perm'])).toBe(false);
  });

  it('assertCan throws AuthorizationError on missing permission', () => {
    expect(() => assertCan(['technician'], 'financials:write')).toThrow(AuthorizationError);
    expect(() => assertCan(['owner'], 'financials:write')).not.toThrow();
  });

  it('every role has an entry in the permission map', () => {
    for (const role of ROLES) {
      expect(ROLE_PERMISSIONS[role]).toBeDefined();
    }
  });
});
