import { describe, expect, it, vi } from 'vitest';
import { TenantHostResolutionMiddleware } from './tenant-host';
import { TenantContextService } from './tenancy';

function invoke(middleware: TenantHostResolutionMiddleware, host: string, path = '/') {
  const request = { headers: { host }, path, requestId: 'tenant-host-test-001' };
  const response = { vary: vi.fn() };
  const next = vi.fn();
  return middleware.use(request as never, response as never, next).then(() => ({ request, response, next }));
}

describe('TenantHostResolutionMiddleware', () => {
  it('routes the configured platform subdomain to the platform host kind', async () => {
    const tenantFindUnique = vi.fn();
    const tenantFindFirst = vi.fn();
    const middleware = new TenantHostResolutionMiddleware(
      { db: { tenant: { findUnique: tenantFindUnique, findFirst: tenantFindFirst } } } as never,
      { tenantBaseDomain: 'localhost', platformSubdomain: 'super' } as never,
      new TenantContextService(),
    );
    const context = new TenantContextService();

    const result = await context.run({ requestId: 'tenant-host-test-001' }, () => invoke(middleware, 'super.localhost:4100'));

    expect(result.request).toMatchObject({ tenantHost: { kind: 'platform', hostname: 'super.localhost', baseDomain: 'localhost' } });
    expect(result.next).toHaveBeenCalledOnce();
    expect(tenantFindUnique).not.toHaveBeenCalled();
    expect(tenantFindFirst).not.toHaveBeenCalled();
  });

  it('does not query Neon to resolve an unversioned health probe host', async () => {
    const tenantFindFirst = vi.fn();
    const tenantFindUnique = vi.fn();
    const middleware = new TenantHostResolutionMiddleware(
      { db: { tenant: { findUnique: tenantFindUnique, findFirst: tenantFindFirst } } } as never,
      { tenantBaseDomain: 'localhost', platformSubdomain: 'platform' } as never,
      new TenantContextService(),
    );
    const context = new TenantContextService();

    const result = await context.run({ requestId: 'tenant-host-test-001' }, () => invoke(middleware, '127.0.0.1:4000', '/health/ready'));

    expect(result.request).toMatchObject({ tenantHost: { kind: 'unknown', hostname: '127.0.0.1', baseDomain: 'localhost' } });
    expect(result.next).toHaveBeenCalledOnce();
    expect(tenantFindUnique).not.toHaveBeenCalled();
    expect(tenantFindFirst).not.toHaveBeenCalled();
  });

  it('resolves only ownership-verified custom domains and carries tenant status into host scope', async () => {
    const tenantFindFirst = vi.fn(async () => ({ id: 'tenant-a', slug: 'northstar', name: 'Northstar', status: 'SUSPENDED' }));
    const middleware = new TenantHostResolutionMiddleware(
      { db: { tenant: { findUnique: vi.fn(), findFirst: tenantFindFirst } } } as never,
      { tenantBaseDomain: 'example.com', platformSubdomain: 'platform' } as never,
      new TenantContextService(),
    );
    const context = new TenantContextService();

    const result = await context.run({ requestId: 'tenant-host-test-001' }, () => invoke(middleware, 'portal.customer.example.net:443'));

    expect(tenantFindFirst).toHaveBeenCalledWith({
      where: { domains: { some: { domain: 'portal.customer.example.net', verifiedAt: { not: null } } } },
      select: { id: true, slug: true, name: true, status: true },
    });
    expect(result.request).toMatchObject({ tenantHost: { kind: 'tenant', tenantId: 'tenant-a', status: 'SUSPENDED', hostname: 'portal.customer.example.net' } });
  });

  it('leaves an unverified custom domain unknown', async () => {
    const tenantFindFirst = vi.fn(async () => null);
    const middleware = new TenantHostResolutionMiddleware(
      { db: { tenant: { findUnique: vi.fn(), findFirst: tenantFindFirst } } } as never,
      { tenantBaseDomain: 'example.com', platformSubdomain: 'platform' } as never,
      new TenantContextService(),
    );
    const context = new TenantContextService();

    const result = await context.run({ requestId: 'tenant-host-test-001' }, () => invoke(middleware, 'unverified.customer.example.net'));

    expect(result.request).toMatchObject({ tenantHost: { kind: 'unknown', hostname: 'unverified.customer.example.net' } });
    expect(tenantFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { domains: { some: { domain: 'unverified.customer.example.net', verifiedAt: { not: null } } } },
    }));
  });
});
