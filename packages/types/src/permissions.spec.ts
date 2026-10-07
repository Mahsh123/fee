import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_GROUPS, PERMISSIONS, permissionsForRoles, roleHasPermission } from './permissions';
import type { RoleKey } from './enums';

describe('shared permission catalog', () => {
  it('groups every permission exactly once for role-editor presentation', () => {
    const catalog = Object.values(PERMISSIONS);
    const grouped = PERMISSION_GROUPS.flatMap((group) => group.permissions);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual([...catalog].sort());
  });

  it('keeps role defaults within the permission catalog and returns stable effective permissions', () => {
    const catalog = new Set(Object.values(PERMISSIONS));
    for (const permissions of Object.values(DEFAULT_ROLE_PERMISSIONS)) {
      expect(permissions.every((permission) => catalog.has(permission))).toBe(true);
    }
    const roles: RoleKey[] = ['COLLECTION_STAFF', 'REPORT_VIEWER'];
    expect(permissionsForRoles(roles)).toEqual([...new Set(permissionsForRoles(roles))].sort());
    expect(roleHasPermission('COLLECTION_STAFF', PERMISSIONS.PAYMENT_COLLECT)).toBe(true);
  });
});
