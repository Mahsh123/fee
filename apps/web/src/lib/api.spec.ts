import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadApiFor(apiBase: string, pageUrl: string, platformSubdomain = 'platform') {
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', apiBase);
  vi.stubEnv('NEXT_PUBLIC_PLATFORM_SUBDOMAIN', platformSubdomain);
  const location = new URL(pageUrl);
  vi.stubGlobal('window', { location: { href: location.href, hostname: location.hostname, origin: location.origin } });
  return import('./api');
}

describe('host-aware browser URLs', () => {
  it('uses the platform host for control-plane calls and the tenant host for tenant calls', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { kind: 'platform' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const platformApi = await loadApiFor('http://platform.localhost:8080/api/v1', 'http://platform.localhost:8080/login');
    await platformApi.getPublicTenantContext();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://platform.localhost:8080/api/v1/tenant-context');

    const tenantApi = await loadApiFor('http://platform.localhost:8080/api/v1', 'http://demo.localhost:8080/login');
    await tenantApi.getPublicTenantContext();
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://demo.localhost:8080/api/v1/tenant-context');
    expect(tenantApi.platformHomeHref()).toBe('http://platform.localhost:8080/');
    expect(tenantApi.tenantSignInHref('northstar')).toBe('http://northstar.localhost:8080/login');
    expect(tenantApi.platformSignInHref()).toBe('http://platform.localhost:8080/login');
  });

  it('keeps production tenant requests on their host and returns to platform.example.com', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { kind: 'tenant', slug: 'school', name: 'School', enabledModules: [], branding: {} } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const api = await loadApiFor('https://platform.example.com/api/v1', 'https://school.example.com/login');
    await api.getPublicTenantContext();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://school.example.com/api/v1/tenant-context');
    expect(api.platformHomeHref()).toBe('https://platform.example.com/');
  });

  it('routes custom-domain tenant API requests through the page hostname', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { kind: 'tenant', slug: 'customer', name: 'Customer', enabledModules: [], branding: {} } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const api = await loadApiFor('https://platform.example.com:8080/api/v1', 'https://portal.customer.test/login');
    await api.getPublicTenantContext();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://portal.customer.test:8080/api/v1/tenant-context');
    expect(api.platformSignInHref()).toBe('https://platform.example.com/login');
    expect(api.tenantSignInHref('northstar')).toBe('https://northstar.example.com/login');
  });

  it('uses a custom production platform label for control-plane and tenant sign-in URLs', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { kind: 'tenant', slug: 'cedar', name: 'Cedar', enabledModules: [], branding: {} } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const api = await loadApiFor('https://control.example.com/api/v1', 'https://cedar.example.com/login', 'control');

    await api.getPublicTenantContext();

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://cedar.example.com/api/v1/tenant-context');
    expect(api.platformHomeHref()).toBe('https://control.example.com/');
    expect(api.platformSignInHref()).toBe('https://control.example.com/login');
    expect(api.tenantSignInHref('northstar')).toBe('https://northstar.example.com/login');
  });

  it('uses a custom platform label on localhost', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { kind: 'tenant', slug: 'demo', name: 'Demo', enabledModules: [], branding: {} } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const api = await loadApiFor('http://control.localhost:8080/api/v1', 'http://demo.localhost:8080/login', 'control');

    await api.getPublicTenantContext();

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://demo.localhost:8080/api/v1/tenant-context');
    expect(api.platformHomeHref()).toBe('http://control.localhost:8080/');
    expect(api.platformSignInHref()).toBe('http://control.localhost:8080/login');
    expect(api.tenantSignInHref('northstar')).toBe('http://northstar.localhost:8080/login');
  });
});
