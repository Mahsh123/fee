import { describe, expect, it, vi } from 'vitest';
import { createPrismaClient, type DatabaseClient } from '@fee/database';
import { TenantContextService } from './tenancy';
import { createTenantScopedClient, createTenantScopedDatabaseHandle } from './scoped-prisma';
import { TransactionExecutorContext } from '@fee/database';

type QueryArgs = { model?: string; operation: string; args: Record<string, unknown>; query: (args: unknown) => Promise<unknown> };
type CapturedExtension = { query: { $allModels: { $allOperations: (input: QueryArgs) => Promise<unknown> } } };
const permissionMutations = [
  'create', 'createMany', 'createManyAndReturn', 'update', 'updateMany',
  'updateManyAndReturn', 'delete', 'deleteMany', 'upsert',
];

function createHarness() {
  let extension: CapturedExtension | undefined;
  const _runtimeDataModel = {
    models: {
      Student: { fields: [{ name: 'tenant', kind: 'object' }, { name: 'userRoles', kind: 'object' }] },
      Payment: { fields: [
        { name: 'tenantId', kind: 'scalar' },
        { name: 'branchId', kind: 'scalar' },
        { name: 'tenant', kind: 'object', type: 'Tenant', relationFromFields: ['tenantId'], relationToFields: ['id'] },
        { name: 'allocations', kind: 'object', type: 'PaymentAllocation', relationName: 'PaymentToAllocations', relationFromFields: [], relationToFields: [] },
      ] },
      FeeCategory: { fields: [{ name: 'tenant', kind: 'object' }] },
      UserRole: { fields: [{ name: 'tenant', kind: 'object' }, { name: 'user', kind: 'object' }, { name: 'role', kind: 'object' }] },
      User: { fields: [{ name: 'tenant', kind: 'object' }, { name: 'userRoles', kind: 'object' }] },
      Role: { fields: [{ name: 'tenant', kind: 'object' }, { name: 'userRoles', kind: 'object' }] },
      FeeDemandItem: { fields: [] },
      PaymentAllocation: { fields: [
        { name: 'tenantId', kind: 'scalar' },
        { name: 'payment', kind: 'object', type: 'Payment', relationName: 'PaymentToAllocations', relationFromFields: ['tenantId', 'paymentId'], relationToFields: ['tenantId', 'id'] },
      ] },
      Guardian: { fields: [{ name: 'students', kind: 'object' }] },
      Branch: { fields: [{ name: 'memberships', kind: 'object' }] },
      FeeAssignment: { fields: [] },
      FeeStructure: { fields: [] },
      IdempotencyKey: { fields: [] },
      Permission: { fields: [{ name: 'rolePermissions', kind: 'object' }] },
      Tenant: { fields: [{ name: 'id', kind: 'scalar' }, { name: 'users', kind: 'object' }, { name: 'domains', kind: 'object' }] },
      Plan: { fields: [{ name: 'modules', kind: 'object' }, { name: 'entitlements', kind: 'object' }, { name: 'subscriptions', kind: 'object' }] },
      PlanModule: { fields: [{ name: 'plan', kind: 'object' }] },
      PlanEntitlement: { fields: [{ name: 'plan', kind: 'object' }] },
      AuditSigningKey: { fields: [] },
      SchemaIndexBuild: { fields: [] },
    },
  };
  const onlyTenantAIds = ({ where }: { where: Record<string, unknown> }) => {
    if (where.tenantId !== 'tenant-a') return [];
    const [field, predicate] = Object.entries(where).find(([name]) => name !== 'tenantId') ?? [];
    const ids = typeof predicate === 'object' && predicate !== null && 'in' in predicate
      ? (predicate as { in: unknown }).in
      : [];
    if (typeof field !== 'string' || !Array.isArray(ids)) return [];
    return ids.filter((id): id is string => typeof id === 'string' && id.endsWith('-a')).map((id) => ({ [field]: id }));
  };
  const delegates = new Map<string, { findMany: ReturnType<typeof vi.fn> }>();
  const target: Record<string, unknown> = {
    _runtimeDataModel,
    $extends: (input: unknown) => {
      extension = input as CapturedExtension;
      return client;
    },
  };
  const client = new Proxy(target, {
    get(base, key, receiver) {
      if (typeof key !== 'string') return Reflect.get(base, key, receiver);
      if (key in base) return Reflect.get(base, key, receiver);
      let delegate = delegates.get(key);
      if (!delegate) {
        delegate = { findMany: vi.fn(onlyTenantAIds) };
        delegates.set(key, delegate);
      }
      return delegate;
    },
  }) as unknown as DatabaseClient;
  const context = new TenantContextService();
  const transactionContext = new TransactionExecutorContext();
  createTenantScopedClient(client, context, transactionContext);
  const run = (input: Omit<QueryArgs, 'query'>, query = vi.fn(async (args: unknown) => args)) => {
    if (!extension) throw new Error('Prisma extension was not captured');
    return extension.query.$allModels.$allOperations({ ...input, query });
  };
  return { context, transactionContext, client, run, delegates };
}

describe('tenant-scoped Prisma boundary', () => {
  it('adds the current tenant to reads and tenant-owned writes', async () => {
    const { context, run } = createHarness();
    await context.run({ requestId: 'request-scope', isPlatformAdmin: false }, async () => {
      context.establish({ tenantId: 'tenant-a', isPlatformAdmin: false });

      await expect(run({ model: 'Student', operation: 'findMany', args: { where: { status: 'ACTIVE' } } })).resolves.toMatchObject({
        where: { status: 'ACTIVE', tenantId: 'tenant-a' },
      });
      await expect(run({ model: 'Payment', operation: 'create', args: { data: { amount: '10.0000' } } })).resolves.toMatchObject({
        data: { amount: '10.0000', tenantId: 'tenant-a' },
      });
    });
  });

  it('adds live branch membership predicates to branch-owned reads', async () => {
    const { context, run } = createHarness();
    await context.run({ requestId: 'branch-read-scope', isPlatformAdmin: false }, async () => {
      context.establish({ tenantId: 'tenant-a', isPlatformAdmin: false, branchScopeEnabled: true, branchIds: ['branch-a'] });
      await expect(run({ model: 'Payment', operation: 'findMany', args: { where: { status: 'SUCCESS', branchId: 'branch-b' } } })).resolves.toMatchObject({
        where: {
          tenantId: 'tenant-a',
          status: 'SUCCESS',
          branchId: 'branch-b',
          AND: [{ branchId: { in: ['branch-a'] } }],
        },
      });
      await expect(run({ model: 'Payment', operation: 'findUnique', args: { where: { id: 'payment-a' } } })).resolves.toMatchObject({
        where: { id: 'payment-a', tenantId: 'tenant-a', AND: [{ branchId: { in: ['branch-a'] } }] },
      });
      await expect(run({ model: 'PaymentAllocation', operation: 'findMany', args: { where: { paymentId: 'payment-a' } } })).resolves.toMatchObject({
        where: { tenantId: 'tenant-a', paymentId: 'payment-a', AND: [{ payment: { is: { branchId: { in: ['branch-a'] } } } }] },
      });
      await expect(run({ model: 'UserRole', operation: 'findMany', args: { where: { userId: 'user-a' } } })).resolves.toMatchObject({
        where: { tenantId: 'tenant-a', userId: 'user-a', AND: [{ user: { is: { branchMemberships: { some: { branchId: { in: ['branch-a'] } } } } } }] },
      });
      await expect(run({ model: 'Guardian', operation: 'findMany', args: { where: { id: 'guardian-a' } } })).resolves.toMatchObject({
        where: { tenantId: 'tenant-a', id: 'guardian-a', AND: [{ students: { some: { student: { is: { branchId: { in: ['branch-a'] } } } } } }] },
      });
      await expect(run({ model: 'Branch', operation: 'findMany', args: { where: { status: 'ACTIVE' } } })).resolves.toMatchObject({
        where: { tenantId: 'tenant-a', status: 'ACTIVE', AND: [{ memberships: { some: { branchId: { in: ['branch-a'] } } } }] },
      });
    });
  });

  it('fails closed for branchless reads and rejects writes outside live memberships', async () => {
    const { context, run } = createHarness();
    await context.run({ requestId: 'branch-write-scope', isPlatformAdmin: false }, async () => {
      context.establish({ tenantId: 'tenant-a', isPlatformAdmin: false, branchScopeEnabled: true, branchIds: [] });
      await expect(run({ model: 'Payment', operation: 'findMany', args: {} })).resolves.toMatchObject({
        where: { tenantId: 'tenant-a', AND: [{ branchId: { in: [] } }] },
      });
      await expect(run({ model: 'Payment', operation: 'create', args: { data: { amount: '10.0000', branchId: 'branch-a' } } })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });
    await context.run({ requestId: 'branch-write-allowed', isPlatformAdmin: false }, async () => {
      context.establish({ tenantId: 'tenant-a', isPlatformAdmin: false, branchScopeEnabled: true, branchIds: ['branch-a'] });
      await expect(run({ model: 'Payment', operation: 'create', args: { data: { amount: '10.0000', branchId: 'branch-b' } } })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      await expect(run({ model: 'Payment', operation: 'create', args: { data: { amount: '10.0000' } } })).resolves.toMatchObject({
        data: { amount: '10.0000', tenantId: 'tenant-a', branchId: 'branch-a' },
      });
      await expect(run({ model: 'Payment', operation: 'create', args: { data: { amount: '10.0000', branchId: 'branch-a' } } })).resolves.toMatchObject({
        data: { amount: '10.0000', tenantId: 'tenant-a', branchId: 'branch-a' },
      });
    });
    await context.run({ requestId: 'multi-branch-write-scope', isPlatformAdmin: false }, async () => {
      context.establish({ tenantId: 'tenant-a', isPlatformAdmin: false, branchScopeEnabled: true, branchIds: ['branch-a', 'branch-b'] });
      await expect(run({ model: 'Payment', operation: 'create', args: { data: { amount: '10.0000' } } })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });
  });

  it('rejects conflicting tenant predicates and write data', async () => {
    const { context, run } = createHarness();
    await context.run({ requestId: 'request-scope', isPlatformAdmin: false }, async () => {
      context.establish({ tenantId: 'tenant-a', isPlatformAdmin: false });

      await expect(run({ model: 'Student', operation: 'findMany', args: { where: { tenantId: 'tenant-b' } } })).rejects.toMatchObject({
        code: 'TENANT_MISMATCH',
      });
      await expect(run({ model: 'Student', operation: 'create', args: { data: { tenantId: 'tenant-b' } } })).rejects.toMatchObject({
        code: 'TENANT_MISMATCH',
      });
    });
  });

  it('fails closed outside tenant context and leaves global catalog models available', async () => {
    const { context, run } = createHarness();
    await expect(run({ model: 'Student', operation: 'findMany', args: {} })).rejects.toThrow(/authenticated tenant context/i);
    await expect(run({ model: 'Permission', operation: 'findMany', args: {} })).resolves.toEqual({});
    for (const operation of permissionMutations) {
      await expect(run({ model: 'Permission', operation, args: {} })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    }
  });

  it('allows only the exact public lookup for a verified tenant domain', async () => {
    const { context, run } = createHarness();
    const args = {
      where: { domains: { some: { domain: 'portal.example.test', verifiedAt: { not: null } } } },
      select: { id: true, slug: true, name: true, status: true },
    };
    await expect(run({ model: 'Tenant', operation: 'findFirst', args })).resolves.toEqual(args);
    await expect(run({
      model: 'Tenant', operation: 'findFirst',
      args: { ...args, where: { domains: { some: { domain: 'portal.example.test', verifiedAt: null } } } },
    })).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    await context.run({ tenantId: 'tenant-a', requestId: 'tenant-domain-scope', isPlatformAdmin: false }, async () => {
      await expect(run({ model: 'Tenant', operation: 'findFirst', args })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });
  });

  it('serves the global plan catalog read-only to tenant sessions and protects privileged catalog relations', async () => {
    const { context, run } = createHarness();
    const planRead = { include: { modules: true, entitlements: true } };
    await context.run({ tenantId: 'tenant-a', requestId: 'plan-read', isPlatformAdmin: false }, async () => {
      await expect(run({ model: 'Plan', operation: 'findMany', args: planRead })).resolves.toEqual(planRead);
      await expect(run({ model: 'Plan', operation: 'update', args: { where: { id: 'plan-a' }, data: { active: false } } }))
        .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      await expect(run({ model: 'Plan', operation: 'findMany', args: { include: { _count: { select: { subscriptions: true } } } } }))
        .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    });
    await context.run({ tenantId: 'platform', userId: 'admin', requestId: 'plan-write', isPlatformAdmin: true }, async () => {
      await expect(run({ model: 'Plan', operation: 'create', args: { data: { key: 'team', modules: { create: [] }, entitlements: { create: [] } } } }))
        .resolves.toMatchObject({ data: { key: 'team', modules: { create: [] }, entitlements: { create: [] } } });
      await expect(run({ model: 'AuditSigningKey', operation: 'findMany', args: {} })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });
  });

  it('scopes updateManyAndReturn and rejects conflicting tenant predicates or data', async () => {
    const { context, run } = createHarness();
    await context.run({ requestId: 'request-scope', isPlatformAdmin: false }, async () => {
      context.establish({ tenantId: 'tenant-a', isPlatformAdmin: false });
      await expect(
        run({ model: 'Student', operation: 'updateManyAndReturn', args: { where: { status: 'ACTIVE' }, data: { status: 'INACTIVE' } } }),
      ).resolves.toMatchObject({ where: { status: 'ACTIVE', tenantId: 'tenant-a' }, data: { status: 'INACTIVE', tenantId: 'tenant-a' } });
      await expect(
        run({ model: 'Student', operation: 'updateManyAndReturn', args: { where: { tenantId: 'tenant-b' }, data: { status: 'INACTIVE' } } }),
      ).rejects.toMatchObject({ code: 'TENANT_MISMATCH' });
      await expect(
        run({ model: 'Student', operation: 'updateManyAndReturn', args: { where: {}, data: { tenantId: 'tenant-b' } } }),
      ).rejects.toMatchObject({ code: 'TENANT_MISMATCH' });
    });
  });

  it('fails closed for relation reads, relation predicates, and nested writes', async () => {
    const { context, run } = createHarness();
    await context.run({ requestId: 'request-scope', isPlatformAdmin: false }, async () => {
      context.establish({ tenantId: 'tenant-a', isPlatformAdmin: false });
      await expect(run({ model: 'Student', operation: 'findMany', args: { include: { userRoles: true } } })).rejects.toMatchObject({
        code: 'INTERNAL_ERROR',
      });
      await expect(
        run({ model: 'Student', operation: 'findMany', args: { select: { id: true, _count: { select: { userRoles: true } } } } }),
      ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
      await expect(
        run({ model: 'Student', operation: 'findMany', args: { select: { _count: { select: { userRoles: { where: { id: 'role-b' } } } } } } }),
      ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
      await expect(
        run({ model: 'Student', operation: 'findMany', args: { where: { AND: [{ userRoles: { some: { id: 'role-link' } } }] } } }),
      ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
      await expect(
        run({ model: 'Student', operation: 'create', args: { data: { userRoles: { create: { roleId: 'role-b' } } } } }),
      ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    });
  });

  it('allows reads over verified composite tenant relations while still rejecting nested relation writes', async () => {
    const { context, run } = createHarness();
    await context.run({ requestId: 'composite-relation-scope', isPlatformAdmin: false }, async () => {
      context.establish({ tenantId: 'tenant-a', isPlatformAdmin: false });
      await expect(run({ model: 'Payment', operation: 'findMany', args: { include: { allocations: true } } })).resolves.toMatchObject({
        where: { tenantId: 'tenant-a' }, include: { allocations: true },
      });
      await expect(
        run({
          model: 'Payment',
          operation: 'findMany',
          args: { where: { allocations: { some: { id: 'allocation-a' } } } },
        }),
      ).resolves.toMatchObject({
        where: { allocations: { some: { id: 'allocation-a' } }, tenantId: 'tenant-a' },
      });
      await expect(
        run({ model: 'Payment', operation: 'create', args: { data: { allocations: { create: [] } } } }),
      ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    });
  });

  it('checks scalar tenant-owned foreign keys against the current tenant before writing', async () => {
    const { context, transactionContext, client, run, delegates } = createHarness();
    await context.run({ requestId: 'request-scope', isPlatformAdmin: false }, async () => {
      context.establish({ tenantId: 'tenant-a', isPlatformAdmin: false });

      await expect(
        run({ model: 'UserRole', operation: 'create', args: { data: { userId: 'user-a', roleId: 'role-a' } } }),
      ).resolves.toMatchObject({ data: { userId: 'user-a', roleId: 'role-a', tenantId: 'tenant-a' } });
      await expect(
        run({ model: 'UserRole', operation: 'create', args: { data: { userId: 'user-a', roleId: 'role-b' } } }),
      ).rejects.toMatchObject({ code: 'TENANT_MISMATCH' });
    });

    const txUserFind = vi.fn(async () => [{ id: 'user-a' }]);
    const txRoleFind = vi.fn(async () => [{ id: 'role-a' }]);
    const transactionClient = { user: { findMany: txUserFind }, role: { findMany: txRoleFind } };
    delegates.get('user')!.findMany.mockClear();
    delegates.get('role')!.findMany.mockClear();
    await transactionContext.run(transactionClient as never, () =>
      context.run({ requestId: 'transaction-request', isPlatformAdmin: false }, async () => {
        context.establish({ tenantId: 'tenant-a', isPlatformAdmin: false });
        await expect(
          run({ model: 'UserRole', operation: 'create', args: { data: { userId: 'user-a', roleId: 'role-a' } } }),
        ).resolves.toBeDefined();
      }),
    );
    expect(txUserFind).toHaveBeenCalledOnce();
    expect(txRoleFind).toHaveBeenCalledOnce();
    expect(delegates.get('user')!.findMany).not.toHaveBeenCalled();
  });

  it('rejects cross-tenant financial references and UUID-array members', async () => {
    const { context, run, delegates, client } = createHarness();
    void (client as unknown as { studentGroup: unknown }).studentGroup;
    delegates.get('studentGroup')!.findMany.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
      const ids = (where.id as { in: string[] }).in;
      return where.tenantId === 'tenant-a' && ids.includes('group-a') ? [{ id: 'group-a' }] : [];
    });
    await context.run({ requestId: 'financial-reference-check', isPlatformAdmin: false }, async () => {
      context.establish({ tenantId: 'tenant-a', isPlatformAdmin: false });

      await expect(
        run({ model: 'FeeDemandItem', operation: 'create', args: { data: { demandId: 'demand-a', feeTypeId: 'fee-type-b' } } }),
      ).rejects.toMatchObject({ code: 'TENANT_MISMATCH' });
      await expect(
        run({ model: 'Payment', operation: 'create', args: { data: { methodId: 'method-b', payerStudentId: 'student-a' } } }),
      ).rejects.toMatchObject({ code: 'TENANT_MISMATCH' });
      await expect(
        run({ model: 'PaymentAllocation', operation: 'create', args: { data: { paymentId: 'payment-a', demandId: 'demand-b' } } }),
      ).rejects.toMatchObject({ code: 'TENANT_MISMATCH' });
      await expect(
        run({ model: 'FeeAssignment', operation: 'create', args: { data: { targetStudentIds: ['student-a', 'student-b'] } } }),
      ).rejects.toMatchObject({ code: 'TENANT_MISMATCH' });
      await expect(
        run({ model: 'FeeAssignment', operation: 'create', args: { data: { targetStudentIds: ['student-a'] } } }),
      ).resolves.toBeDefined();
      await expect(
        run({ model: 'FeeAssignment', operation: 'create', args: { data: { targetStudentIds: { set: ['student-a'] } } } }),
      ).resolves.toBeDefined();
      await expect(
        run({ model: 'FeeAssignment', operation: 'update', args: { where: { id: 'assignment-a' }, data: { targetStudentIds: { set: ['student-a'] } } } }),
      ).resolves.toBeDefined();
      await expect(
        run({ model: 'FeeAssignment', operation: 'create', args: { data: { targetType: 'CUSTOM_GROUP', targetId: 'student-a' } } }),
      ).rejects.toMatchObject({ code: 'TENANT_MISMATCH' });
      await expect(
        run({ model: 'FeeAssignment', operation: 'create', args: { data: { targetType: 'CUSTOM_GROUP', targetId: 'group-a' } } }),
      ).resolves.toBeDefined();
      await expect(
        run({ model: 'FeeAssignment', operation: 'update', args: { where: { id: 'assignment-a' }, data: { targetType: 'STUDENT' } } }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(
        run({ model: 'FeeAssignment', operation: 'update', args: { where: { id: 'assignment-a' }, data: { targetType: 'STUDENT', targetId: undefined } } }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(
        run({ model: 'FeeAssignment', operation: 'update', args: { where: { id: 'assignment-a' }, data: { targetType: 'STUDENT', targetId: { set: undefined } } } }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(
        run({ model: 'FeeStructure', operation: 'create', args: { data: { targetUnitId: 'unit-a' } } }),
      ).resolves.toBeDefined();
      await expect(
        run({ model: 'FeeStructure', operation: 'create', args: { data: { targetType: 'STUDENT', targetUnitId: 'student-a' } } }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(
        run({ model: 'IdempotencyKey', operation: 'create', args: { data: { resourceType: 'Payment', resourceId: 'payment-b' } } }),
      ).rejects.toMatchObject({ code: 'TENANT_MISMATCH' });
      await expect(
        run({ model: 'IdempotencyKey', operation: 'create', args: { data: { resourceType: 'Payment', resourceId: 'payment-a' } } }),
      ).resolves.toBeDefined();
      await expect(
        run({ model: 'IdempotencyKey', operation: 'create', args: { data: { resourceId: 'payment-a' } } }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(
        run({ model: 'IdempotencyKey', operation: 'update', args: { where: { id: 'reservation-a' }, data: { resourceType: 'Payment', resourceId: undefined } } }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(
        run({ model: 'IdempotencyKey', operation: 'update', args: { where: { id: 'reservation-a' }, data: { resourceType: 'Payment', resourceId: { set: undefined } } } }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(
        run({ model: 'FeeDemandItem', operation: 'create', args: { data: { demandId: 'demand-a', feeTypeId: 'fee-type-a' } } }),
      ).resolves.toMatchObject({ data: { demandId: 'demand-a', feeTypeId: 'fee-type-a', tenantId: 'tenant-a' } });
    });
  });

  it('hides Prisma raw SQL and lifecycle methods from the runtime application handle', async () => {
    const findMany = vi.fn(async () => []);
    const delegate: Record<string, unknown> = { findMany };
    const rawMethods = [
      '$connect', '$disconnect', '$on', '$transaction', '$use', '$extends',
      '$queryRaw', '$queryRawUnsafe', '$executeRaw', '$executeRawUnsafe',
      '$executeRawInternal', '_request', '_executeRequest', '_runtimeDataModel',
    ];
    const rawClient = Object.fromEntries(rawMethods.map((method) => [method, vi.fn()])) as Record<string, unknown>;
    rawClient._runtimeDataModel = { models: { Student: {} } };
    delegate.$parent = rawClient;
    rawClient.student = delegate;
    const handle = createTenantScopedDatabaseHandle(rawClient as unknown as DatabaseClient);

    for (const method of rawMethods) expect((handle as unknown as Record<string, unknown>)[method]).toBeUndefined();
    for (const method of rawMethods) expect(Object.getOwnPropertyDescriptor(handle, method)).toBeUndefined();
    expect(Reflect.ownKeys(handle)).toEqual([]);
    expect(Reflect.getPrototypeOf(handle)).toBeNull();
    const safeDelegate = handle.student as unknown as Record<string, unknown>;
    expect(safeDelegate).not.toBe(delegate);
    expect(safeDelegate.$parent).toBeUndefined();
    for (const method of rawMethods) expect(safeDelegate[method]).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(safeDelegate, '$parent')).toBeUndefined();
    expect(Reflect.ownKeys(safeDelegate)).toEqual([]);
    expect(Reflect.getPrototypeOf(safeDelegate)).toBeNull();
    expect(safeDelegate.findMany).toBeTypeOf('function');
    expect(safeDelegate.$queryRaw).toBeUndefined();
    await expect((safeDelegate.findMany as () => Promise<unknown>)()).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledOnce();
  });

  it('rejects fluent relation queries before they can bypass the relation guard', async () => {
    const baseClient = createPrismaClient({ databaseUrl: 'postgresql://fee:fee@127.0.0.1:1/fee' });
    const context = new TenantContextService();
    const scoped = createTenantScopedClient(baseClient, context, new TransactionExecutorContext());
    try {
      const query = context.run({ requestId: 'fluent-relation', isPlatformAdmin: false }, async () => {
        context.establish({ tenantId: 'tenant-a', isPlatformAdmin: false });
        const safe = createTenantScopedDatabaseHandle(scoped);
        const fluentQuery = safe.user.findUnique({ where: { id: 'user-a' } });
        const querySurface = fluentQuery as unknown as Record<string, unknown>;
        for (const internal of ['$parent', '$queryRawUnsafe', '$executeRawInternal', '_request', '_executeRequest']) {
          expect(querySurface[internal]).toBeUndefined();
        }
        return (fluentQuery as unknown as { userRoles: () => unknown }).userRoles();
      });
      await expect(query).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    } finally {
      await baseClient.$disconnect();
    }
  });

  it('rejects undefined polymorphic IDs through the generated Prisma client before database access', async () => {
    const baseClient = createPrismaClient({ databaseUrl: 'postgresql://fee:fee@127.0.0.1:1/fee' });
    const context = new TenantContextService();
    const scoped = createTenantScopedClient(baseClient, context, new TransactionExecutorContext());
    try {
      await context.run({ requestId: 'undefined-polymorphic-reference', isPlatformAdmin: false }, async () => {
        context.establish({ tenantId: 'tenant-a', isPlatformAdmin: false });
        await expect(scoped.feeAssignment.update({
          where: { id: '00000000-0000-4000-8000-000000000001' },
          data: { targetType: 'STUDENT', targetId: undefined },
        })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
        await expect(scoped.feeAssignment.update({
          where: { id: '00000000-0000-4000-8000-000000000001' },
          data: { targetType: 'STUDENT', targetId: { set: undefined } },
        })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
        await expect(scoped.idempotencyKey.update({
          where: { id: '00000000-0000-4000-8000-000000000002' },
          data: { resourceType: 'Payment', resourceId: undefined },
        })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
        await expect(scoped.idempotencyKey.update({
          where: { id: '00000000-0000-4000-8000-000000000002' },
          data: { resourceType: 'Payment', resourceId: { set: undefined } },
        })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      });
    } finally {
      await baseClient.$disconnect();
    }
  });

  it('limits tenant-directory access to public slug, own ID, or platform-admin lookups', async () => {
    const { context, run } = createHarness();
    await context.run({ requestId: 'public-request', isPlatformAdmin: false }, async () => {
      await expect(
        run({ model: 'Tenant', operation: 'findUnique', args: { where: { slug: 'north-school' }, select: { id: true, slug: true, name: true, status: true } } }),
      ).resolves.toMatchObject({ where: { slug: 'north-school' } });
      await expect(run({ model: 'Tenant', operation: 'findMany', args: {} })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      await expect(
        run({ model: 'Tenant', operation: 'findUnique', args: { where: { slug: 'north-school' } } }),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });

    await context.run({ requestId: 'tenant-request', isPlatformAdmin: false }, async () => {
      context.establish({ tenantId: 'tenant-a', isPlatformAdmin: false });
      await expect(
        run({ model: 'Tenant', operation: 'findUnique', args: { where: { id: 'tenant-a' }, select: { id: true, slug: true, name: true } } }),
      ).resolves.toMatchObject({ where: { id: 'tenant-a' } });
      await expect(
        run({ model: 'Tenant', operation: 'findFirst', args: { where: { id: 'tenant-a' }, select: { enabledModules: true } } }),
      ).resolves.toMatchObject({ where: { id: 'tenant-a' } });
      await expect(
        run({ model: 'Tenant', operation: 'findFirst', args: { where: { id: 'tenant-b' }, select: { enabledModules: true } } }),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      await expect(
        run({ model: 'Tenant', operation: 'findFirst', args: { where: { id: 'tenant-a' }, select: { enabledModules: true, name: true } } }),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      await expect(
        run({ model: 'Tenant', operation: 'findUnique', args: { where: { id: 'tenant-b' }, select: { id: true } } }),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });

    await context.run({ requestId: 'platform-request', isPlatformAdmin: true }, async () => {
      await expect(run({ model: 'Tenant', operation: 'findMany', args: {} })).resolves.toEqual({});
      for (const operation of permissionMutations) {
        await expect(run({ model: 'Permission', operation, args: {} })).resolves.toEqual({});
      }
    });
  });

  it('scopes both branches of an upsert', async () => {
    const { context, run } = createHarness();
    await context.run({ requestId: 'request-scope', isPlatformAdmin: false }, async () => {
      context.establish({ tenantId: 'tenant-a', isPlatformAdmin: false });
      await expect(
        run({
          model: 'FeeCategory',
          operation: 'upsert',
          args: { where: { id: 'category-a' }, create: { name: 'Academic' }, update: { name: 'Tuition' } },
        }),
      ).resolves.toMatchObject({
        where: { id: 'category-a', tenantId: 'tenant-a' },
        create: { name: 'Academic', tenantId: 'tenant-a' },
        update: { name: 'Tuition', tenantId: 'tenant-a' },
      });
    });
  });
});
