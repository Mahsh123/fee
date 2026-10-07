import { describe, expect, it, vi } from 'vitest';
import { CORE_TENANT_MODULES } from '@fee/types';
import { TenantContextService } from '../common/tenancy';
import { PublicTenantContextService } from './tenant-context';

describe('public tenant context projection', () => {
  it('returns only public branding for the host-resolved tenant and performs a scoped read', async () => {
    const context = new TenantContextService();
    let tenantIdAtQueryExecution: string | undefined;
    const branding = {
      organizationName: 'North School',
      email: 'office@north.example.test',
      logoUrl: '/tenant-brands/school.svg',
      primaryColor: '#123456',
      accentColor: '#654321',
      landingTitle: 'Welcome',
      landingDescription: 'A public description',
      landingActionLabel: 'Sign in',
      tenantId: 'must-not-leak',
      logoDocumentId: 'must-not-leak',
    };
    // Match PrismaPromise semantics: the database operation starts only when
    // the thenable is awaited, so execution must still be inside tenant scope.
    const findUnique = vi.fn(() => ({
      then: (resolve: (value: typeof branding) => unknown) => {
        tenantIdAtQueryExecution = context.peek()?.tenantId;
        return Promise.resolve(branding).then(resolve);
      },
    }) as unknown as Promise<typeof branding>);
    const settingsFindUnique = vi.fn(async () => ({ allowPublicRegistration: true }));
    const tenantFindFirst = vi.fn(() => ({
      then: (resolve: (value: { enabledModules: string[] }) => unknown) => {
        expect(context.peek()?.tenantId).toBe('tenant-a');
        return Promise.resolve({ enabledModules: ['USERS', 'FEES'] }).then(resolve);
      },
    }) as unknown as Promise<{ enabledModules: string[] }>);
    const findSubscription = vi.fn(async () => {
      expect(context.peek()?.tenantId).toBe('tenant-a');
      return { status: 'ACTIVE', plan: { modules: [...CORE_TENANT_MODULES, 'PAYMENTS', 'FEES'].map((moduleKey) => ({ moduleKey, enabled: true })) } };
    });
    const findOverrides = vi.fn(async () => [{ moduleKey: 'FEES', enabled: false }]);
    const service = new PublicTenantContextService({ db: {
      tenantBranding: { findUnique }, tenantSettings: { findUnique: settingsFindUnique }, tenant: { findFirst: tenantFindFirst },
      tenantSubscription: { findFirst: findSubscription }, tenantModuleOverride: { findMany: findOverrides },
    } } as never, context);
    const host = { kind: 'tenant' as const, hostname: 'north.localhost', baseDomain: 'localhost', tenantId: 'tenant-a', slug: 'north', name: 'North School', status: 'ACTIVE' as const };

    const result = await context.run({ requestId: 'public-context-0001', tenantHost: host, isPlatformAdmin: false }, () =>
      service.resolve({ requestId: 'public-context-0001', headers: { host: 'north.localhost' } } as never),
    );

    expect(findUnique).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a' },
      select: {
        organizationName: true,
        email: true,
        logoUrl: true,
        primaryColor: true,
        accentColor: true,
        landingTitle: true,
        landingDescription: true,
        landingActionLabel: true,
      },
    });
    expect(settingsFindUnique).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a' }, select: { allowPublicRegistration: true } });
    expect(tenantIdAtQueryExecution).toBe('tenant-a');
    expect(result).toEqual({ kind: 'tenant', slug: 'north', name: 'North School', enabledModules: [...CORE_TENANT_MODULES, 'PAYMENTS'].sort(), allowPublicRegistration: true, branding: {
      organizationName: 'North School', email: 'office@north.example.test', logoUrl: '/tenant-brands/school.svg', primaryColor: '#123456', accentColor: '#654321',
      landingTitle: 'Welcome', landingDescription: 'A public description', landingActionLabel: 'Sign in',
    } });
  });

  it('returns platform and missing-host states without reading branding', async () => {
    const findUnique = vi.fn(async () => null);
    const service = new PublicTenantContextService({ db: {
      tenantBranding: { findUnique }, tenantSettings: { findUnique: vi.fn(async () => null) }, tenant: { findFirst: vi.fn(async () => ({ enabledModules: [] })) },
      tenantSubscription: { findFirst: vi.fn(async () => null) }, tenantModuleOverride: { findMany: vi.fn(async () => []) },
    } } as never, new TenantContextService());

    await expect(service.resolve({ tenantHost: { kind: 'platform', hostname: 'platform.localhost', baseDomain: 'localhost' } } as never))
      .resolves.toEqual({ kind: 'platform' });
    await expect(service.resolve({ requestId: 'public-context-no-host' } as never)).resolves.toEqual({ kind: 'unknown' });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('handles missing branding defaults and returns explicit inactive/unknown states', async () => {
    const findUnique = vi.fn(async () => null);
    const db = {
      tenantBranding: { findUnique }, tenantSettings: { findUnique: vi.fn(async () => null) }, tenant: { findFirst: vi.fn(async () => ({ enabledModules: [] })) },
      tenantSubscription: { findFirst: vi.fn(async () => null) }, tenantModuleOverride: { findMany: vi.fn(async () => []) },
    };
    const service = new PublicTenantContextService({ db } as never, new TenantContextService());
    const request = (tenantHost: unknown) => ({ tenantHost, requestId: 'public-context-0002' } as never);

    const missingBranding = await service.resolve(request({ kind: 'tenant', hostname: 'demo.localhost', baseDomain: 'localhost', tenantId: 'tenant-demo', slug: 'demo', name: 'Demo Academy', status: 'TRIAL' }));
    expect(missingBranding).toEqual({
      kind: 'tenant',
      name: 'Demo Academy',
      slug: 'demo',
      enabledModules: [...CORE_TENANT_MODULES].sort(),
      allowPublicRegistration: false,
      branding: {
        organizationName: 'Demo Academy',
        email: null,
        logoUrl: null,
        primaryColor: '#0F172A',
        accentColor: '#2563EB',
        landingTitle: null,
        landingDescription: null,
        landingActionLabel: null,
      },
    });
    expect(findUnique).toHaveBeenCalledTimes(1);

    await expect(service.resolve(request({ kind: 'unknown', hostname: 'missing.localhost', baseDomain: 'localhost', slug: 'missing' }))).resolves.toEqual({ kind: 'unknown' });
    await expect(service.resolve(request({ kind: 'tenant', hostname: 'paused.localhost', baseDomain: 'localhost', tenantId: 'tenant-paused', slug: 'paused', name: 'Paused School', status: 'SUSPENDED' }))).resolves.toEqual({ kind: 'inactive', name: 'Paused School', slug: 'paused' });
    await expect(service.resolve(request({ kind: 'tenant', hostname: 'archived.localhost', baseDomain: 'localhost', tenantId: 'tenant-archived', slug: 'archived', name: 'Archived School', status: 'ARCHIVED' }))).resolves.toEqual({ kind: 'inactive', name: 'Archived School', slug: 'archived' });
    expect(findUnique).toHaveBeenCalledTimes(1);
  });
});
