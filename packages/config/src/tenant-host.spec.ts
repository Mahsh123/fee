import { describe, expect, it } from 'vitest';
import { isAllowedTenantOrigin, resolveTenantHost } from './tenant-host';

describe('tenant hostname routing', () => {
  it('recognises the dedicated platform host and one tenant label locally and in production', () => {
    expect(resolveTenantHost('platform.localhost:3000', 'localhost')).toEqual({ kind: 'platform', hostname: 'platform.localhost' });
    expect(resolveTenantHost('localhost:3000', 'localhost').kind).toBe('unknown');
    expect(resolveTenantHost('demo.localhost:4100', 'localhost')).toEqual({ kind: 'tenant', hostname: 'demo.localhost', slug: 'demo' });
    expect(resolveTenantHost('platform.example.com', 'example.com')).toEqual({ kind: 'platform', hostname: 'platform.example.com' });
    expect(resolveTenantHost('demo.example.com', 'example.com')).toEqual({ kind: 'tenant', hostname: 'demo.example.com', slug: 'demo' });
    expect(resolveTenantHost('school.example.com', 'example.com')).toEqual({ kind: 'tenant', hostname: 'school.example.com', slug: 'school' });
  });

  it('uses the configured platform subdomain consistently for routing and CORS', () => {
    expect(resolveTenantHost('super.localhost:3000', 'localhost', 'super')).toEqual({ kind: 'platform', hostname: 'super.localhost' });
    expect(resolveTenantHost('platform.localhost:3000', 'localhost', 'super')).toEqual({ kind: 'tenant', hostname: 'platform.localhost', slug: 'platform' });
    expect(isAllowedTenantOrigin('http://super.localhost:3000', 'super.localhost:4100', 'localhost', ['http://super.localhost:3000'], 'http://super.localhost:3000', 'super')).toBe(true);
    expect(isAllowedTenantOrigin('http://tenant.localhost:3000', 'super.localhost:4100', 'localhost', ['http://super.localhost:3000'], 'http://super.localhost:3000', 'super')).toBe(false);
  });

  it('rejects nested labels, malformed hosts, and lookalike suffixes', () => {
    expect(resolveTenantHost('a.b.example.com', 'example.com').kind).toBe('unknown');
    expect(resolveTenantHost('demo.example.com.evil', 'example.com').kind).toBe('unknown');
    expect(resolveTenantHost('bad_slug.example.com', 'example.com').kind).toBe('unknown');
    expect(resolveTenantHost('https://demo.example.com/path', 'example.com').kind).toBe('unknown');
  });

  it('allows same-workspace CORS origins and rejects sibling tenant origins', () => {
    const roots = ['http://platform.localhost:3000'];
    expect(isAllowedTenantOrigin('http://platform.localhost:3000', 'platform.localhost:4100', 'localhost', roots, 'http://platform.localhost:3000')).toBe(true);
    expect(isAllowedTenantOrigin('http://demo.localhost:3000', 'demo.localhost:4100', 'localhost', roots, 'http://platform.localhost:3000')).toBe(true);
    expect(isAllowedTenantOrigin('http://school.localhost:3000', 'demo.localhost:4100', 'localhost', roots, 'http://platform.localhost:3000')).toBe(false);
    expect(isAllowedTenantOrigin('http://localhost:3000', 'localhost:4100', 'localhost', roots, 'http://platform.localhost:3000')).toBe(false);
    expect(isAllowedTenantOrigin('https://school.example.com', 'school.example.com', 'example.com', ['https://platform.example.com'], 'https://platform.example.com')).toBe(true);
    expect(isAllowedTenantOrigin('https://school.example.com.evil', 'school.example.com.evil', 'example.com', ['https://platform.example.com'], 'https://platform.example.com')).toBe(false);
    expect(isAllowedTenantOrigin('https://platform.example.com', 'school.example.com', 'example.com', ['https://platform.example.com'], 'https://platform.example.com')).toBe(false);
  });

  it('allows only same-host browser origins for custom tenant domains', () => {
    const configured = ['https://platform.example.com'];
    expect(isAllowedTenantOrigin('https://portal.customer.test', 'portal.customer.test:8080', 'example.com', configured, 'https://platform.example.com')).toBe(true);
    expect(isAllowedTenantOrigin('https://other.customer.test', 'portal.customer.test:8080', 'example.com', configured, 'https://platform.example.com')).toBe(false);
    expect(isAllowedTenantOrigin('https://portal.customer.test', undefined, 'example.com', configured, 'https://platform.example.com')).toBe(false);
  });
});
