import { describe, expect, it } from 'vitest';
import { PLATFORM_SYSTEM_TENANT_SLUG } from '@fee/types';
import type { SessionUser, PublicTenantContext } from '../lib/api';
import { sessionMatchesHost } from './session-provider';

const tenantUser = (overrides: Partial<SessionUser> = {}): SessionUser => ({
  id: 'user-1', tenantId: 'tenant-1', tenantSlug: 'northstar', tenantName: 'Northstar', email: 'user@example.com',
  firstName: 'Team', lastName: 'Member', roles: ['TENANT_ADMIN'], permissions: [], isPlatformAdmin: false,
  studentId: null, guardianId: null, mustChangePassword: false, ...overrides,
});

describe('session host scope', () => {
  it('accepts only the matching tenant account on a tenant host', () => {
    const host: PublicTenantContext = { kind: 'tenant', slug: 'northstar', name: 'Northstar', enabledModules: [], branding: { organizationName: 'Northstar', email: null, logoUrl: null, primaryColor: '#000000', accentColor: '#ffffff', landingTitle: null, landingDescription: null, landingActionLabel: null } };
    expect(sessionMatchesHost(tenantUser(), host)).toBe(true);
    expect(sessionMatchesHost(tenantUser({ tenantSlug: 'cedar-club' }), host)).toBe(false);
    expect(sessionMatchesHost(tenantUser({ isPlatformAdmin: true }), host)).toBe(false);
    expect(sessionMatchesHost(null, host)).toBe(false);
  });

  it('accepts platform accounts only on the reserved platform workspace', () => {
    const host: PublicTenantContext = { kind: 'platform' };
    expect(sessionMatchesHost(tenantUser({ tenantSlug: PLATFORM_SYSTEM_TENANT_SLUG, isPlatformAdmin: true }), host)).toBe(true);
    expect(sessionMatchesHost(tenantUser({ tenantSlug: 'northstar', isPlatformAdmin: true }), host)).toBe(false);
    expect(sessionMatchesHost(tenantUser({ tenantSlug: PLATFORM_SYSTEM_TENANT_SLUG, isPlatformAdmin: false }), host)).toBe(false);
  });
});
