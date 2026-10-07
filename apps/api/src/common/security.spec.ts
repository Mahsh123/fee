import { describe, expect, it, vi } from 'vitest';
import { CORE_TENANT_MODULES } from '@fee/types';
import { AppError } from './errors';
import { JwtAuthGuard, ModuleEntitlementGuard, PlatformAdminGuard } from './security';
import { TenantContextService } from './tenancy';

function executionContext(request: Record<string, unknown>) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

describe('JwtAuthGuard tenant binding', () => {
  it('rejects a client tenant header that differs from the signed token', async () => {
    const tenantContext = new TenantContextService();
    const reflector = { getAllAndOverride: () => false };
    const tokens = {
      verifyAccessToken: vi.fn().mockResolvedValue({
        sub: 'user-a',
        tid: 'tenant-a',
        email: 'a@example.test',
        roles: [],
        perms: [],
        platform: false,
        typ: 'access',
      }),
    };
    const memberships = vi.fn().mockResolvedValue([{ branchId: 'branch-a' }]);
    const guard = new JwtAuthGuard(reflector as never, tokens as never, tenantContext, { db: { userBranchMembership: { findMany: memberships } } } as never);
    const request = {
      headers: { authorization: 'Bearer signed-token', 'x-tenant-id': 'tenant-b' },
      tenantHost: { kind: 'tenant', hostname: 'tenant-a.localhost', baseDomain: 'localhost', tenantId: 'tenant-a', slug: 'tenant-a', name: 'Tenant A', status: 'ACTIVE' },
      requestId: 'request-789',
    };

    await tenantContext.run(
      { requestId: 'request-789', isPlatformAdmin: false, tenantHost: request.tenantHost as never },
      async () => {
        await expect(guard.canActivate(executionContext(request))).rejects.toMatchObject({
          code: 'TENANT_MISMATCH',
        } satisfies Partial<AppError>);
        expect(tenantContext.peek()?.tenantId).toBeUndefined();
      },
    );
  });

  it('binds the request to the signed tenant and rejects duplicate tenant headers', async () => {
    const tenantContext = new TenantContextService();
    const reflector = { getAllAndOverride: () => false };
    const tokens = {
      verifyAccessToken: vi.fn().mockResolvedValue({
        sub: 'user-a',
        tid: 'tenant-a',
        email: 'a@example.test',
        roles: [],
        perms: ['organization.unit.manage'],
        platform: false,
        typ: 'access',
      }),
    };
    const memberships = vi.fn().mockResolvedValue([{ branchId: 'branch-a' }]);
    const guard = new JwtAuthGuard(reflector as never, tokens as never, tenantContext, { db: { userBranchMembership: { findMany: memberships } } } as never);

    const request = {
      headers: { authorization: 'Bearer signed-token', 'x-tenant-id': 'tenant-a' },
      tenantHost: { kind: 'tenant', hostname: 'tenant-a.localhost', baseDomain: 'localhost', tenantId: 'tenant-a', slug: 'tenant-a', name: 'Tenant A', status: 'ACTIVE' },
      requestId: 'request-abc',
    };
    await tenantContext.run(
      { requestId: 'request-abc', isPlatformAdmin: false, tenantHost: request.tenantHost as never },
      async () => {
        expect(await guard.canActivate(executionContext(request))).toBe(true);
        await Promise.resolve();
        expect(tenantContext.requireTenantId()).toBe('tenant-a');
        expect(tenantContext.require().permissions).toEqual(['organization.unit.manage']);
        expect(tenantContext.require()).toMatchObject({ branchScopeEnabled: true, branchIds: ['branch-a'] });
        expect(memberships).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a', userId: 'user-a' }, select: { branchId: true } });
        expect(request).toMatchObject({ tenantId: 'tenant-a', user: { id: 'user-a', tenantId: 'tenant-a' } });
      },
    );

    const duplicateHeader = { ...request, headers: { ...request.headers, 'x-tenant-id': ['tenant-a', 'tenant-a'] } };
    await tenantContext.run(
      { requestId: 'request-def', isPlatformAdmin: false, tenantHost: request.tenantHost as never },
      async () => {
        await expect(guard.canActivate(executionContext(duplicateHeader))).rejects.toMatchObject({
          code: 'TENANT_MISMATCH',
        });
      },
    );
  });

  it('rejects a valid token on a sibling tenant hostname', async () => {
    const tenantContext = new TenantContextService();
    const reflector = { getAllAndOverride: () => false };
    const tokens = {
      verifyAccessToken: vi.fn().mockResolvedValue({ sub: 'user-a', tid: 'tenant-a', email: 'a@example.test', roles: [], perms: [], platform: false, typ: 'access' }),
    };
    const guard = new JwtAuthGuard(reflector as never, tokens as never, tenantContext, { db: {} } as never);
    const host = { kind: 'tenant' as const, hostname: 'tenant-b.localhost', baseDomain: 'localhost', tenantId: 'tenant-b', slug: 'tenant-b', name: 'Tenant B', status: 'ACTIVE' as const };
    const request = { headers: { authorization: 'Bearer signed-token' }, tenantHost: host };

    await tenantContext.run({ requestId: 'request-host-binding', isPlatformAdmin: false, tenantHost: host }, async () => {
      await expect(guard.canActivate(executionContext(request))).rejects.toMatchObject({ code: 'TENANT_MISMATCH' });
      expect(tenantContext.peek()?.tenantId).toBeUndefined();
    });
  });

  it('rejects a platform administrator token on a tenant hostname even if its tenant id matches', async () => {
    const tenantContext = new TenantContextService();
    const reflector = { getAllAndOverride: () => false };
    const tokens = {
      verifyAccessToken: vi.fn().mockResolvedValue({ sub: 'admin', tid: 'tenant-a', email: 'admin@example.test', roles: ['PLATFORM_ADMIN'], perms: [], platform: true, typ: 'access' }),
    };
    const guard = new JwtAuthGuard(reflector as never, tokens as never, tenantContext, { db: {} } as never);
    const host = { kind: 'tenant' as const, hostname: 'tenant-a.localhost', baseDomain: 'localhost', tenantId: 'tenant-a', slug: 'tenant-a', name: 'Tenant A', status: 'ACTIVE' as const };
    const request = { headers: { authorization: 'Bearer platform-token' }, tenantHost: host };

    await tenantContext.run({ requestId: 'platform-token-tenant-host', tenantHost: host }, async () => {
      await expect(guard.canActivate(executionContext(request))).rejects.toThrow(/only use the platform hostname/);
      expect(tenantContext.peek()?.tenantId).toBeUndefined();
    });
  });

  it('requires the reserved platform tenant and a platform claim on the dedicated platform hostname', async () => {
    const tenantContext = new TenantContextService();
    const reflector = { getAllAndOverride: () => false };
    const tokens = {
      verifyAccessToken: vi.fn().mockResolvedValue({ sub: 'user-a', tid: 'tenant-a', email: 'a@example.test', roles: [], perms: [], platform: false, typ: 'access' }),
    };
    const tenantLookup = vi.fn(async () => ({ id: 'platform-tenant' }));
    const guard = new JwtAuthGuard(reflector as never, tokens as never, tenantContext, { db: { tenant: { findUnique: tenantLookup } } } as never);
    const host = { kind: 'platform' as const, hostname: 'platform.localhost', baseDomain: 'localhost' };
    const request = { headers: { authorization: 'Bearer tenant-token' }, tenantHost: host };

    await tenantContext.run({ requestId: 'platform-host-binding', tenantHost: host, isPlatformAdmin: false }, async () => {
      await expect(guard.canActivate(executionContext(request))).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      expect(tenantContext.peek()?.tenantId).toBeUndefined();
    });
    expect(tenantLookup).toHaveBeenCalledWith({ where: { slug: 'fee-platform' }, select: { id: true } });
  });
});

describe('PlatformAdminGuard', () => {
  const guard = new PlatformAdminGuard(
    { db: { user: { findFirst: vi.fn().mockResolvedValue({ status: 'ACTIVE', sessionVersion: 0 }) } } } as never,
    new TenantContextService(),
  );

  it('allows only an authenticated platform identity with the platform role', async () => {
    await expect(guard.canActivate(executionContext({ user: { id: 'user-1', tenantId: 'tenant-1', sessionVersion: 0, isPlatformAdmin: true, roles: ['PLATFORM_ADMIN'] } }))).resolves.toBe(true);
  });

  it('rejects a platform flag without the platform role', async () => {
    await expect(guard.canActivate(executionContext({ user: { id: 'user-1', tenantId: 'tenant-1', isPlatformAdmin: true, roles: ['TENANT_ADMIN'] } })))
      .rejects.toThrow(/Super administrator access is required/);
  });

  it('rejects a tenant role even when the request claims the platform role', async () => {
    await expect(guard.canActivate(executionContext({ user: { id: 'user-1', tenantId: 'tenant-1', isPlatformAdmin: false, roles: ['PLATFORM_ADMIN'] } })))
      .rejects.toThrow(/Super administrator access is required/);
  });
});

describe('ModuleEntitlementGuard', () => {
  it('resolves required modules from the current plan plus overrides instead of trusting a stale tenant projection', async () => {
    const context = new TenantContextService();
    const reflector = { getAllAndOverride: vi.fn(() => ['FEES']) };
    const findTenant = vi.fn(async () => ({ enabledModules: ['USERS', 'FEES'] }));
    const findSubscription = vi.fn(async () => ({ status: 'ACTIVE', plan: { modules: [...CORE_TENANT_MODULES, 'PAYMENTS'].map((moduleKey) => ({ moduleKey, enabled: true })) } }));
    const findOverrides = vi.fn(async () => [{ moduleKey: 'FEES', enabled: false }]);
    const guard = new ModuleEntitlementGuard(reflector as never, { db: {
      tenant: { findFirst: findTenant },
      tenantSubscription: { findFirst: findSubscription },
      tenantModuleOverride: { findMany: findOverrides },
    } } as never, context);
    const execution = executionContext({ user: { id: 'user-a', tenantId: 'tenant-a' } });

    await context.run({ requestId: 'module-guard-001', tenantId: 'tenant-a', userId: 'user-a' }, async () => {
      await expect(guard.canActivate(execution)).rejects.toThrow(/does not include: FEES/);
    });
    expect(findTenant).toHaveBeenCalledWith({ where: { id: 'tenant-a' }, select: { enabledModules: true } });
    expect(findSubscription).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a', isCurrent: true },
      select: { status: true, plan: { select: { modules: { select: { moduleKey: true, enabled: true } } } } },
    });

    findOverrides.mockResolvedValue([{ moduleKey: 'FEES', enabled: true }]);
    await context.run({ requestId: 'module-guard-002', tenantId: 'tenant-a', userId: 'user-a' }, async () => {
      await expect(guard.canActivate(execution)).resolves.toBe(true);
    });

    reflector.getAllAndOverride.mockReturnValue(['USERS']);
    findOverrides.mockResolvedValue([{ moduleKey: 'USERS', enabled: false }]);
    await context.run({ requestId: 'module-guard-003', tenantId: 'tenant-a', userId: 'user-a' }, async () => {
      await expect(guard.canActivate(execution)).resolves.toBe(true);
    });

    reflector.getAllAndOverride.mockReturnValue(['FEES']);
    findSubscription.mockResolvedValue({ status: 'ACTIVE', plan: { modules: [...CORE_TENANT_MODULES, 'FEES'].map((moduleKey) => ({ moduleKey, enabled: true })) } });
    findOverrides.mockResolvedValue([]);
    await context.run({ requestId: 'module-guard-004', tenantId: 'tenant-a', userId: 'user-a' }, async () => {
      await expect(guard.canActivate(execution)).rejects.toThrow(/does not include: FEES/);
    });
  });

  it('does not add database work for routes without an entitlement declaration', async () => {
    const findTenant = vi.fn();
    const guard = new ModuleEntitlementGuard({ getAllAndOverride: () => undefined } as never, { db: { tenant: { findFirst: findTenant } } } as never, new TenantContextService());
    await expect(guard.canActivate(executionContext({}))).resolves.toBe(true);
    expect(findTenant).not.toHaveBeenCalled();
  });
});
