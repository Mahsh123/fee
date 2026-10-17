import { describe, expect, it, vi } from 'vitest';
import { CORE_TENANT_MODULES } from '@fee/types';
import { TenantContextService } from '../common/tenancy';
import { OrganizationService } from './organization';

function makeService(options: {
  branches?: Record<string, unknown>[];
  memberships?: Array<{ branchId: string; userId: string; isPrimary: boolean }>;
  assignments?: Record<string, unknown>[];
} = {}) {
  const context = new TenantContextService();
  const branchFindMany = vi.fn(async () => options.branches ?? []);
  const assignmentFindMany = vi.fn(async () => options.assignments ?? []);
  const database = {
    branch: { findMany: branchFindMany, count: vi.fn(async () => options.branches?.length ?? 0) },
    userBranchMembership: { findMany: vi.fn(async () => options.memberships ?? []) },
    user: { findMany: vi.fn(async () => []) },
    userAssignment: { findMany: assignmentFindMany, count: vi.fn(async () => options.assignments?.length ?? 0) },
  };
  const service = new OrganizationService({ db: database } as never, { record: vi.fn() } as never, context);
  const asTenantUser = <T>(work: () => T, roles: string[] = ['BRANCH_MANAGER']) => context.run({
    tenantId: 'tenant-a', userId: 'user-a', roles, requestId: 'organization-test-0001', isPlatformAdmin: false,
  }, work);
  return { service, context, database, branchFindMany, assignmentFindMany, asTenantUser };
}

describe('organization API tenant and branch scope', () => {
  it('lets a tenant administrator replace a user’s generic group memberships with audit and session revocation', async () => {
    const context = new TenantContextService();
    const unitFindMany = vi.fn(async () => [{ id: 'unit-a' }, { id: 'unit-b' }]);
    const existingFindMany = vi.fn(async () => [{ unitId: 'unit-a' }]);
    const deleteMany = vi.fn(async () => ({ count: 1 }));
    const createMany = vi.fn(async () => ({ count: 1 }));
    const refreshUpdateMany = vi.fn(async () => ({ count: 2 }));
    const auditRecord = vi.fn(async () => undefined);
    const tx = {
      userOrganizationMembership: { findMany: existingFindMany, deleteMany, createMany },
      refreshToken: { updateMany: refreshUpdateMany },
    };
    const service = new OrganizationService({
      db: { user: { findFirst: vi.fn(async () => ({ id: 'user-a' })) }, organizationUnit: { findMany: unitFindMany } },
      transactionWithRetry: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    } as never, { record: auditRecord } as never, context);

    const result = await context.run({ tenantId: 'tenant-a', userId: 'admin-a', roles: ['TENANT_ADMIN'], requestId: 'user-group-scope' }, () =>
      service.replaceUserOrganizationUnits('tenant-a', 'user-a', { unitIds: ['unit-a', 'unit-b'] }),
    );

    expect(result).toEqual({ userId: 'user-a', unitIds: ['unit-a', 'unit-b'] });
    expect(createMany).toHaveBeenCalledWith({ data: [{ tenantId: 'tenant-a', userId: 'user-a', unitId: 'unit-a' }, { tenantId: 'tenant-a', userId: 'user-a', unitId: 'unit-b' }] });
    expect(refreshUpdateMany).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a', userId: 'user-a', revokedAt: null }, data: { revokedAt: expect.any(Date) } });
    expect(auditRecord).toHaveBeenCalledWith(tx, expect.objectContaining({ action: 'user.organization_units.updated', before: { unitIds: ['unit-a'] }, after: { unitIds: ['unit-a', 'unit-b'] } }));
  });

  it('returns a generic dashboard filtered to a manager’s branch scope', async () => {
    const branchFindMany = vi.fn(async () => [{ id: 'branch-a' }]);
    const membershipFindMany = vi.fn(async () => [{ userId: 'user-a' }, { userId: 'user-b' }]);
    const userCount = vi.fn(async () => 1);
    const database = {
      tenant: {
        findUnique: vi.fn(async () => ({ name: 'North', organizationType: 'COMPANY', enabledModules: ['USERS', 'BRANCHES'], status: 'ACTIVE', subscriptionStatus: 'ACTIVE', trialEndsAt: null, subscriptionRenewalAt: null })),
        findFirst: vi.fn(async () => ({ name: 'North', organizationType: 'COMPANY', enabledModules: ['USERS', 'BRANCHES'], status: 'ACTIVE', subscriptionStatus: 'ACTIVE', trialEndsAt: null, subscriptionRenewalAt: null })),
      },
      tenantSubscription: { findFirst: vi.fn(async () => ({ status: 'ACTIVE', billingInterval: 'MONTHLY', trialEndsAt: null, currentPeriodEnd: new Date('2026-11-06'), plan: { key: 'team', name: 'Team', modules: [...CORE_TENANT_MODULES].map((moduleKey) => ({ moduleKey, enabled: true })) } })) },
      tenantModuleOverride: { findMany: vi.fn(async () => []) },
      branch: { findMany: branchFindMany },
      user: { count: userCount },
      userBranchMembership: { findMany: membershipFindMany },
      organizationUnit: { count: vi.fn(async () => 1) },
      userAssignment: { count: vi.fn(async () => 2) },
    };
    const context = new TenantContextService();
    const service = new OrganizationService({ db: database } as never, { record: vi.fn() } as never, context);

    const dashboard = await context.run({ tenantId: 'tenant-a', userId: 'user-a', roles: ['BRANCH_MANAGER'], requestId: 'organization-dashboard-scope', isPlatformAdmin: false }, () => service.dashboard('tenant-a'));

    expect(branchFindMany).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a', status: { not: 'ARCHIVED' }, memberships: { some: { userId: 'user-a' } } }, select: { id: true } });
    expect(userCount).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-a', id: 'user-a' }) }));
    expect(dashboard).toMatchObject({ organization: { name: 'North', type: 'COMPANY' }, subscription: { plan: 'Team', status: 'ACTIVE' }, modules: [...CORE_TENANT_MODULES].sort(), counts: { activeUsers: 1, branchCount: 1, organizationUnitCount: 1, visibleMembers: 2, openAssignments: 2 }, onboarding: [] });
    expect(dashboard).not.toHaveProperty('users');
  });

  it('limits a branch manager directory to branches where the actor has membership', async () => {
    const branch = { id: 'branch-a', tenantId: 'tenant-a', code: 'A', name: 'North', status: 'ACTIVE', managerId: null };
    const { service, branchFindMany, asTenantUser } = makeService({ branches: [branch], memberships: [{ branchId: 'branch-a', userId: 'user-a', isPrimary: true }] });

    const page = await asTenantUser(() => service.listBranches('tenant-a', {}));

    expect(branchFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-a', id: { in: ['branch-a'] } }) }));
    expect(page.items[0]).toMatchObject({ id: 'branch-a', memberCount: 1, members: [{ userId: 'user-a', isPrimary: true }] });
  });

  it('ignores a non-admin attempt to list another user’s assignments', async () => {
    const { service, assignmentFindMany, asTenantUser } = makeService();

    await asTenantUser(() => service.listAssignments('tenant-a', { userId: 'user-b' }));

    expect(assignmentFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-a', userId: 'user-a' }) }));
  });

  it('rejects a tenant id that differs from the authenticated request before querying', async () => {
    const { service, branchFindMany, asTenantUser } = makeService();

    await expect(asTenantUser(() => service.listBranches('tenant-b', {}))).rejects.toMatchObject({ status: 403 });
    expect(branchFindMany).not.toHaveBeenCalled();
  });

  it('rejects moving an organization unit beneath one of its descendants', async () => {
    const context = new TenantContextService();
    const root = { id: 'unit-root', tenantId: 'tenant-a', parentId: null, active: true, updatedAt: new Date() };
    const child = { id: 'unit-child', tenantId: 'tenant-a', parentId: 'unit-root', active: true, updatedAt: new Date() };
    const findUnit = vi.fn(async ({ where }: { where: { id: string } }) => where.id === child.id ? child : root);
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const tx = {
      organizationUnit: {
        findFirst: findUnit,
        findMany: vi.fn(async () => [root, child]),
        updateMany,
      },
    };
    const database = {
      organizationUnit: { findFirst: findUnit },
    };
    const service = new OrganizationService({ db: database, transactionWithRetry: (work: (client: typeof tx) => unknown) => work(tx) } as never, { record: vi.fn() } as never, context);

    await expect(context.run({ tenantId: 'tenant-a', userId: 'admin-a', roles: ['TENANT_ADMIN'], requestId: 'organization-cycle-check', isPlatformAdmin: false }, () =>
      service.updateOrganizationUnit('tenant-a', root.id, { parentId: child.id }),
    )).rejects.toMatchObject({ status: 422 });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('allows a tenant role with the organization-unit permission to create a unit', async () => {
    const context = new TenantContextService();
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'unit-new', ...data }));
    const tx = { organizationUnit: { create } };
    const service = new OrganizationService({ db: { organizationUnit: {} }, transactionWithRetry: (work: (client: typeof tx) => unknown) => work(tx) } as never, { record: vi.fn() } as never, context);

    const result = await context.run({ tenantId: 'tenant-a', userId: 'manager-a', roles: ['ORG_COORDINATOR'], permissions: ['organization.unit.manage'], requestId: 'organization-custom-permission', isPlatformAdmin: false }, () =>
      service.createOrganizationUnit('tenant-a', { code: 'OPS', name: 'Operations', unitType: 'department' }),
    );

    expect(result).toMatchObject({ id: 'unit-new', tenantId: 'tenant-a', code: 'OPS', unitType: 'DEPARTMENT' });
    expect(create).toHaveBeenCalledOnce();
  });

  it('returns organization-unit member identities only when the actor can read tenant users', async () => {
    const context = new TenantContextService();
    const unit = { id: 'unit-a', tenantId: 'tenant-a', memberships: [{ userId: 'user-secret' }], _count: { memberships: 1 } };
    const service = new OrganizationService({ db: { organizationUnit: { findMany: vi.fn(async () => [unit]), count: vi.fn(async () => 1) } } } as never, { record: vi.fn() } as never, context);

    const page = await context.run({ tenantId: 'tenant-a', userId: 'reader-a', roles: ['UNIT_READER'], permissions: ['organization.unit.read'], requestId: 'organization-member-privacy', isPlatformAdmin: false }, () =>
      service.listOrganizationUnits('tenant-a', {}),
    );

    expect(page.items[0]).toMatchObject({ memberCount: 1, memberships: [] });
    expect(page.items[0]).not.toHaveProperty('memberships.0.userId');
  });

  it('allows a role with assignment.manage to update another user’s assignment', async () => {
    const context = new TenantContextService();
    const current = { id: 'assignment-a', tenantId: 'tenant-a', userId: 'user-b', branchId: 'branch-a', status: 'ASSIGNED', dueAt: null, updatedAt: new Date() };
    const updated = { ...current, status: 'COMPLETED' };
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const findFirst = vi.fn(async () => current);
    const tx = { userAssignment: { updateMany, findFirst: vi.fn(async () => updated) } };
    const membershipFindFirst = vi.fn(async () => ({ id: 'membership-a' }));
    const service = new OrganizationService({ db: { userAssignment: { findFirst }, userBranchMembership: { findFirst: membershipFindFirst } }, transactionWithRetry: (work: (client: typeof tx) => unknown) => work(tx) } as never, { record: vi.fn() } as never, context);

    const result = await context.run({ tenantId: 'tenant-a', userId: 'manager-a', roles: ['ASSIGNMENT_COORDINATOR'], permissions: ['assignment.manage'], requestId: 'assignment-custom-permission', isPlatformAdmin: false }, () =>
      service.updateAssignment('tenant-a', current.id, { status: 'COMPLETED' }),
    );

    expect(result).toMatchObject({ id: current.id, userId: 'user-b', status: 'COMPLETED' });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant-a', id: current.id, updatedAt: current.updatedAt }, data: { status: 'COMPLETED' } }));
    expect(membershipFindFirst).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a', branchId: 'branch-a', userId: 'manager-a' }, select: { id: true } });
  });

  it('scopes assignment reads with assignment.read to the actor’s branches plus own resources', async () => {
    const context = new TenantContextService();
    const assignmentFindMany = vi.fn(async (_args: { where: Record<string, unknown> }) => []);
    const service = new OrganizationService({ db: {
      userBranchMembership: { findMany: vi.fn(async () => [{ branchId: 'branch-a' }]) },
      userAssignment: { findMany: assignmentFindMany, count: vi.fn(async () => 0) },
    } } as never, { record: vi.fn() } as never, context);

    await context.run({ tenantId: 'tenant-a', userId: 'manager-a', roles: ['ASSIGNMENT_COORDINATOR'], permissions: ['assignment.read'], requestId: 'assignment-read-branch-scope', isPlatformAdmin: false }, () =>
      service.listAssignments('tenant-a', {}),
    );

    const where = assignmentFindMany.mock.calls[0]![0].where as { tenantId: string; OR: Array<Record<string, unknown>> };
    expect(where.tenantId).toBe('tenant-a');
    expect(where.OR).toEqual([
      { branchId: { in: ['branch-a'] } },
      { userId: 'manager-a' },
    ]);
    expect(where.OR).not.toContainEqual({ branchId: { in: ['branch-b'] } });
    expect(where.OR).not.toContainEqual({ userId: 'user-b', branchId: null });
  });

  it('rejects creating a branch assignment outside the actor’s branch membership', async () => {
    const context = new TenantContextService();
    const create = vi.fn();
    const transactionWithRetry = vi.fn((work: (client: { userAssignment: { create: typeof create } }) => unknown) => work({ userAssignment: { create } }));
    const membershipFindFirst = vi.fn(async ({ where }: { where: { userId: string } }) => where.userId === 'user-b' ? { id: 'target-membership' } : null);
    const service = new OrganizationService({ db: {
      user: { findFirst: vi.fn(async () => ({ id: 'user-b' })) },
      branch: { findFirst: vi.fn(async () => ({ id: 'branch-b' })) },
      userBranchMembership: { findFirst: membershipFindFirst },
    }, transactionWithRetry } as never, { record: vi.fn() } as never, context);

    await expect(context.run({ tenantId: 'tenant-a', userId: 'manager-a', roles: ['ASSIGNMENT_COORDINATOR'], permissions: ['assignment.manage'], requestId: 'assignment-create-cross-branch', isPlatformAdmin: false }, () =>
      service.createAssignment('tenant-a', { userId: 'user-b', branchId: 'branch-b', resourceType: 'TASK', resourceId: 'task-1' }),
    )).rejects.toMatchObject({ status: 403 });
    expect(create).not.toHaveBeenCalled();
    expect(transactionWithRetry).not.toHaveBeenCalled();

    await expect(context.run({ tenantId: 'tenant-a', userId: 'manager-a', roles: ['ASSIGNMENT_COORDINATOR'], permissions: ['assignment.manage'], requestId: 'assignment-create-branchless-other', isPlatformAdmin: false }, () =>
      service.createAssignment('tenant-a', { userId: 'user-b', resourceType: 'TASK', resourceId: 'task-2' }),
    )).rejects.toMatchObject({ status: 403 });
    expect(transactionWithRetry).not.toHaveBeenCalled();
  });

  it('rejects updating another user’s assignment in a branch outside the actor’s scope', async () => {
    const context = new TenantContextService();
    const current = { id: 'assignment-b', tenantId: 'tenant-a', userId: 'user-b', branchId: 'branch-b', status: 'ASSIGNED', dueAt: null, updatedAt: new Date() };
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const membershipFindFirst = vi.fn(async () => null);
    const tx = { userAssignment: { updateMany, findFirst: vi.fn(async () => current) } };
    const service = new OrganizationService({ db: {
      userAssignment: { findFirst: vi.fn(async () => current) },
      userBranchMembership: { findFirst: membershipFindFirst },
    }, transactionWithRetry: (work: (client: typeof tx) => unknown) => work(tx) } as never, { record: vi.fn() } as never, context);

    await expect(context.run({ tenantId: 'tenant-a', userId: 'manager-a', roles: ['ASSIGNMENT_COORDINATOR'], permissions: ['assignment.manage'], requestId: 'assignment-update-cross-branch', isPlatformAdmin: false }, () =>
      service.updateAssignment('tenant-a', current.id, { status: 'COMPLETED' }),
    )).rejects.toMatchObject({ status: 403 });
    expect(membershipFindFirst).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a', branchId: 'branch-b', userId: 'manager-a' }, select: { id: true } });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('allows own branchless assignments and tenant admins to update branchless assignments for others', async () => {
    const current = { id: 'assignment-own', tenantId: 'tenant-a', userId: 'user-a', branchId: null, status: 'ASSIGNED', dueAt: null, updatedAt: new Date() };
    const makeUpdater = (userId: string) => {
      const context = new TenantContextService();
      const updateMany = vi.fn(async () => ({ count: 1 }));
      const updated = { ...current, userId, status: 'COMPLETED' };
      const tx = { userAssignment: { updateMany, findFirst: vi.fn(async () => updated) } };
      const service = new OrganizationService({ db: { userAssignment: { findFirst: vi.fn(async () => ({ ...current, userId })) } }, transactionWithRetry: (work: (client: typeof tx) => unknown) => work(tx) } as never, { record: vi.fn() } as never, context);
      return { context, service, updateMany };
    };
    const own = makeUpdater('user-a');
    const ownResult = await own.context.run({ tenantId: 'tenant-a', userId: 'user-a', roles: ['MEMBER'], requestId: 'assignment-own-branchless', isPlatformAdmin: false }, () =>
      own.service.updateAssignment('tenant-a', current.id, { status: 'COMPLETED' }),
    );
    expect(ownResult).toMatchObject({ userId: 'user-a', status: 'COMPLETED' });
    expect(own.updateMany).toHaveBeenCalledOnce();

    const unauthorized = makeUpdater('user-b');
    await expect(unauthorized.context.run({ tenantId: 'tenant-a', userId: 'manager-a', roles: ['ASSIGNMENT_COORDINATOR'], permissions: ['assignment.manage'], requestId: 'assignment-update-branchless-other', isPlatformAdmin: false }, () =>
      unauthorized.service.updateAssignment('tenant-a', current.id, { status: 'COMPLETED' }),
    )).rejects.toMatchObject({ status: 403 });
    expect(unauthorized.updateMany).not.toHaveBeenCalled();

    const admin = makeUpdater('user-b');
    const adminResult = await admin.context.run({ tenantId: 'tenant-a', userId: 'admin-a', roles: ['TENANT_ADMIN'], requestId: 'assignment-admin-branchless', isPlatformAdmin: false }, () =>
      admin.service.updateAssignment('tenant-a', current.id, { status: 'COMPLETED' }),
    );
    expect(adminResult).toMatchObject({ userId: 'user-b', status: 'COMPLETED' });
    expect(admin.updateMany).toHaveBeenCalledOnce();
  });

  it('requires branch membership for branch.manage actors to update a branch', async () => {
    const context = new TenantContextService();
    const transactionWithRetry = vi.fn();
    const service = new OrganizationService({ db: {
      branch: { findFirst: vi.fn(async () => ({ managerId: null })) },
      userBranchMembership: { findFirst: vi.fn(async () => null) },
    }, transactionWithRetry } as never, { record: vi.fn() } as never, context);

    await expect(context.run({ tenantId: 'tenant-a', userId: 'manager-a', roles: ['BRANCH_MANAGER'], permissions: ['branch.manage'], requestId: 'branch-update-cross-scope', isPlatformAdmin: false }, () =>
      service.updateBranch('tenant-a', 'branch-b', { name: 'Other branch' }),
    )).rejects.toMatchObject({ status: 403 });
    expect(transactionWithRetry).not.toHaveBeenCalled();
  });

  it('allows a branch.manage actor to update a branch where they have membership', async () => {
    const context = new TenantContextService();
    const current = { id: 'branch-a', tenantId: 'tenant-a', name: 'North', code: 'N', status: 'ACTIVE', updatedAt: new Date(), managerId: null };
    const updated = { ...current, name: 'North Hub' };
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const branchTx = { findFirst: vi.fn().mockResolvedValueOnce(current).mockResolvedValueOnce(updated), updateMany };
    const tx = { branch: branchTx };
    const service = new OrganizationService({ db: {
      branch: { findFirst: vi.fn(async () => ({ managerId: null })) },
      userBranchMembership: { findFirst: vi.fn(async () => ({ id: 'membership-a' })) },
    }, transactionWithRetry: (work: (client: typeof tx) => unknown) => work(tx) } as never, { record: vi.fn() } as never, context);

    const result = await context.run({ tenantId: 'tenant-a', userId: 'manager-a', roles: ['BRANCH_MANAGER'], permissions: ['branch.manage'], requestId: 'branch-update-own-scope', isPlatformAdmin: false }, () =>
      service.updateBranch('tenant-a', 'branch-a', { name: 'North Hub' }),
    );

    expect(result).toMatchObject({ id: 'branch-a', name: 'North Hub' });
    expect(updateMany).toHaveBeenCalledOnce();
  });
});
