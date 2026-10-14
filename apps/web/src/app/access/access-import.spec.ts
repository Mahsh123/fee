import { describe, expect, it } from 'vitest';
import { buildImportPreview } from '../../lib/user-import';

const roles = [
  { id: 'role-staff', key: 'STAFF', name: 'Staff', description: null, isSystem: true, active: true, permissionsConfigured: false, permissionKeys: [] },
  { id: 'role-member', key: 'TENANT_MEMBER', name: 'Member', description: null, isSystem: true, active: true, permissionsConfigured: false, permissionKeys: [] },
  { id: 'role-workspace-person', key: 'WORKSPACE_PERSON', name: 'Workspace Person', description: null, isSystem: true, active: true, permissionsConfigured: false, permissionKeys: [] },
];
const branches = [{ id: 'branch-main', code: 'MAIN', name: 'Main Office', status: 'ACTIVE' }];
const units = [{ id: 'unit-ops', code: 'OPS', name: 'Operations', unitType: 'DEPARTMENT', active: true }];

describe('tenant user CSV import preview', () => {
  it('parses quoted names and resolves role, branch, and group codes', () => {
    const preview = buildImportPreview(
      'firstName,lastName,email,phone,roleKeys,branchCodes,organizationUnitCodes\n"Asha, Kiran",Patel,asha@example.test,,STAFF|TENANT_MEMBER,MAIN,OPS',
      roles, branches, units,
    );

    expect(preview.globalError).toBe('');
    expect(preview.rows[0]).toMatchObject({
      line: 2, firstName: 'Asha, Kiran', lastName: 'Patel', email: 'asha@example.test',
      roleIds: ['role-staff', 'role-member'], branchIds: ['branch-main'], organizationUnitIds: ['unit-ops'], errors: [],
    });
  });

  it('blocks duplicate emails, unavailable mappings, and portal roles from bulk import', () => {
    const preview = buildImportPreview(
      'firstName,email,roleKeys,branchCodes\nAsha,asha@example.test,STUDENT,NOPE\nRavi,asha@example.test,STAFF,MAIN',
      roles, branches, units,
    );

    expect(preview.rows[0]?.errors).toEqual(expect.arrayContaining(['Portal roles must be linked individually', 'Unknown or inactive branch code', 'Duplicate email in file']));
    expect(preview.rows[1]?.errors).toContain('Duplicate email in file');
    expect(preview.rows[1]?.errors).not.toContain('Unknown or inactive branch code');
  });

  it('allows a generic person portal account only when its profile number is supplied', () => {
    const preview = buildImportPreview(
      'firstName,lastName,email,roleKeys,branchCodes,personNumber\nAsha,Patel,asha@example.test,WORKSPACE_PERSON,MAIN,MEM-1042\nRavi,Shah,ravi@example.test,WORKSPACE_PERSON,MAIN,',
      roles, branches, units,
    );

    expect(preview.rows[0]).toMatchObject({ personNumber: 'MEM-1042', errors: [] });
    expect(preview.rows[1]?.errors).toContain('Profile number required for Workspace Person');
  });

  it('requires the identifying columns and caps each import at 100 users', () => {
    expect(buildImportPreview('firstName,email\nAsha,asha@example.test', roles, branches, units).globalError).toContain('rolekeys, branchcodes');
    const rows = Array.from({ length: 101 }, (_, index) => `Person${index},p${index}@example.test,STAFF,MAIN`).join('\n');
    expect(buildImportPreview(`firstName,email,roleKeys,branchCodes\n${rows}`, roles, branches, units).globalError).toContain('up to 100 users');
  });
});
