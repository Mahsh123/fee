import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { usePathname, useRouter } from 'next/navigation';
import { PLATFORM_SYSTEM_TENANT_SLUG } from '@fee/types';
import { ApplicationShell } from './application-shell';
import { useSession } from './session-provider';
import { useTenant } from './tenant-provider';

vi.mock('next/navigation', () => ({ usePathname: vi.fn(), useRouter: vi.fn() }));
vi.mock('./session-provider', () => ({ useSession: vi.fn() }));
vi.mock('./tenant-provider', () => ({ useTenant: vi.fn() }));
vi.mock('../lib/api', () => ({ platformSignInHref: () => '/login', signOut: vi.fn(), tenantSignInHref: () => '/login' }));

const mockPathname = vi.mocked(usePathname);
const mockRouter = vi.mocked(useRouter);
const mockSession = vi.mocked(useSession);
const mockTenant = vi.mocked(useTenant);

describe('application hierarchy navigation', () => {
  beforeEach(() => {
    mockPathname.mockReturnValue('/');
    mockRouter.mockReturnValue({ replace: () => undefined, push: () => undefined } as ReturnType<typeof useRouter>);
  });

  it('shows tenant organization navigation without platform controls', () => {
    mockTenant.mockReturnValue({ kind: 'tenant', slug: 'northstar', name: 'Northstar', enabledModules: ['BRANCHES', 'ORGANIZATION', 'ASSIGNMENTS', 'USERS', 'ADMISSIONS', 'PORTAL', 'FEES', 'PAYMENTS', 'REPORTS', 'NOTIFICATIONS'], branding: { organizationName: 'Northstar', email: null, logoUrl: null, primaryColor: '#123456', accentColor: '#654321', landingTitle: null, landingDescription: null, landingActionLabel: null } });
    mockSession.mockReturnValue({
      user: { id: 'tenant-admin', tenantName: 'Northstar', firstName: 'Admin', lastName: null, email: 'admin@example.com', roles: ['TENANT_ADMIN'], permissions: ['branch.read', 'user.read'], isPlatformAdmin: false, mustChangePassword: false } as ReturnType<typeof useSession>['user'],
      loading: false,
      update: () => undefined,
    });

    const markup = renderToStaticMarkup(createElement(ApplicationShell, null, createElement('main', null, 'Tenant content')));

    expect(markup).toContain('Northstar');
    expect(markup).toContain('ORGANIZATION &amp; ACCESS');
    expect(markup).toContain('Branches and groups');
    expect(markup).toContain('Users and roles');
    expect(markup).not.toContain('Super Admins');
    expect(markup).not.toContain('Tenant directory');
  });

  it('hides tenant navigation for modules excluded from the current plan', () => {
    mockTenant.mockReturnValue({ kind: 'tenant', slug: 'northstar', name: 'Northstar', enabledModules: ['USERS'], branding: { organizationName: 'Northstar', email: null, logoUrl: null, primaryColor: '#123456', accentColor: '#654321', landingTitle: null, landingDescription: null, landingActionLabel: null } });
    mockSession.mockReturnValue({
      user: { id: 'tenant-admin', tenantName: 'Northstar', firstName: 'Admin', lastName: null, email: 'admin@example.com', roles: ['TENANT_ADMIN'], permissions: ['branch.read', 'user.read'], isPlatformAdmin: false, mustChangePassword: false } as ReturnType<typeof useSession>['user'],
      loading: false,
      update: () => undefined,
    });

    const markup = renderToStaticMarkup(createElement(ApplicationShell, null, createElement('main', null, 'Tenant content')));

    expect(markup).toContain('Users and roles');
    expect(markup).not.toContain('Fee catalog');
    expect(markup).not.toContain('Payments');
    expect(markup).not.toContain('Reports');
  });

  it('shows only platform control-plane navigation on the platform host', () => {
    mockPathname.mockReturnValue('/platform');
    mockTenant.mockReturnValue({ kind: 'platform' });
    mockSession.mockReturnValue({
      user: { id: 'platform-admin', tenantName: 'Fee Platform', tenantSlug: PLATFORM_SYSTEM_TENANT_SLUG, firstName: 'Platform', lastName: 'Admin', email: 'platform@example.com', roles: ['PLATFORM_ADMIN'], permissions: [], isPlatformAdmin: true, mustChangePassword: false } as ReturnType<typeof useSession>['user'],
      loading: false,
      update: () => undefined,
    });

    const markup = renderToStaticMarkup(createElement(ApplicationShell, null, createElement('main', null, 'Platform content')));

    expect(markup).toContain('Platform control plane');
    expect(markup).toContain('Tenant directory');
    expect(markup).toContain('Provision a tenant');
    expect(markup).toContain('Super Admins');
    expect(markup).toContain('href="/platform#overview"');
    expect(markup).not.toContain('Students');
    expect(markup).not.toContain('Fee demands');
  });

  it('does not render tenant navigation for a platform account on a tenant host', () => {
    mockPathname.mockReturnValue('/organization');
    mockTenant.mockReturnValue({ kind: 'tenant', slug: 'northstar', name: 'Northstar', enabledModules: ['BRANCHES', 'ORGANIZATION', 'ASSIGNMENTS', 'USERS', 'ADMISSIONS', 'PORTAL', 'FEES', 'PAYMENTS', 'REPORTS', 'NOTIFICATIONS'], branding: { organizationName: 'Northstar', email: null, logoUrl: null, primaryColor: '#123456', accentColor: '#654321', landingTitle: null, landingDescription: null, landingActionLabel: null } });
    mockSession.mockReturnValue({
      user: { id: 'platform-admin', tenantName: 'Fee Platform', tenantSlug: PLATFORM_SYSTEM_TENANT_SLUG, firstName: 'Platform', lastName: 'Admin', email: 'platform@example.com', roles: ['PLATFORM_ADMIN'], permissions: [], isPlatformAdmin: true, mustChangePassword: false } as ReturnType<typeof useSession>['user'],
      loading: false,
      update: () => undefined,
    });

    const markup = renderToStaticMarkup(createElement(ApplicationShell, null, createElement('main', null, 'Tenant content')));

    expect(markup).toContain('ACCOUNT SCOPE');
    expect(markup).toContain('dedicated platform address');
    expect(markup).not.toContain('Branches and assignments');
    expect(markup).not.toContain('Tenant directory');
  });

  it('explains a tenant account scope mismatch on a different tenant hostname', () => {
    mockPathname.mockReturnValue('/organization');
    mockTenant.mockReturnValue({ kind: 'tenant', slug: 'northstar', name: 'Northstar', enabledModules: ['USERS'], branding: { organizationName: 'Northstar', email: null, logoUrl: null, primaryColor: '#123456', accentColor: '#654321', landingTitle: null, landingDescription: null, landingActionLabel: null } });
    mockSession.mockReturnValue({
      user: { id: 'tenant-user', tenantName: 'Cedar Club', tenantSlug: 'cedar-club', firstName: 'Member', lastName: null, email: 'member@example.com', roles: ['TENANT_ADMIN'], permissions: ['user.read'], isPlatformAdmin: false, mustChangePassword: false } as ReturnType<typeof useSession>['user'],
      loading: false,
      update: () => undefined,
    });
    const markup = renderToStaticMarkup(createElement(ApplicationShell, null, createElement('main', null, 'Tenant content')));

    expect(markup).toContain('This account belongs to another workspace');
    expect(markup).toContain('This address belongs to Northstar. Your account is scoped to Cedar Club.');
    expect(markup).not.toContain('Tenant content');
  });

  it('keeps the tenant sign-in form reachable when a different tenant account is cached', () => {
    mockPathname.mockReturnValue('/login');
    mockTenant.mockReturnValue({ kind: 'tenant', slug: 'northstar', name: 'Northstar', enabledModules: ['USERS'], branding: { organizationName: 'Northstar', email: null, logoUrl: null, primaryColor: '#123456', accentColor: '#654321', landingTitle: null, landingDescription: null, landingActionLabel: null } });
    mockSession.mockReturnValue({
      user: { id: 'cedar-user', tenantName: 'Cedar Club', tenantSlug: 'cedar-club', firstName: 'Member', lastName: null, email: 'member@example.com', roles: ['TENANT_MEMBER'], permissions: [], isPlatformAdmin: false, mustChangePassword: false } as ReturnType<typeof useSession>['user'],
      loading: false,
      update: () => undefined,
    });
    const markup = renderToStaticMarkup(createElement(ApplicationShell, null, createElement('form', null, 'Northstar sign-in form')));

    expect(markup).toContain('Northstar sign-in form');
    expect(markup).not.toContain('ACCOUNT SCOPE');
  });

  it('allows invite acceptance without requiring an existing sign-in', () => {
    mockPathname.mockReturnValue('/accept-invitation');
    mockTenant.mockReturnValue({ kind: 'tenant', slug: 'northstar', name: 'Northstar', enabledModules: ['USERS'], branding: { organizationName: 'Northstar', email: null, logoUrl: null, primaryColor: '#123456', accentColor: '#654321', landingTitle: null, landingDescription: null, landingActionLabel: null } });
    mockSession.mockReturnValue({ user: null, loading: false, update: () => undefined });
    const markup = renderToStaticMarkup(createElement(ApplicationShell, null, createElement('main', null, 'Invitation registration form')));

    expect(markup).toContain('Invitation registration form');
    expect(markup).not.toContain('Taking you to sign in');
  });

  it('shows the public tenant page instead of the previous tenant account on the root route', () => {
    mockPathname.mockReturnValue('/');
    mockTenant.mockReturnValue({ kind: 'tenant', slug: 'northstar', name: 'Northstar', enabledModules: ['USERS'], branding: { organizationName: 'Northstar', email: null, logoUrl: null, primaryColor: '#123456', accentColor: '#654321', landingTitle: null, landingDescription: null, landingActionLabel: null } });
    mockSession.mockReturnValue({
      user: { id: 'cedar-user', tenantName: 'Cedar Club', tenantSlug: 'cedar-club', firstName: 'Member', lastName: null, email: 'member@example.com', roles: ['TENANT_MEMBER'], permissions: [], isPlatformAdmin: false, mustChangePassword: false } as ReturnType<typeof useSession>['user'],
      loading: false,
      update: () => undefined,
    });
    const markup = renderToStaticMarkup(createElement(ApplicationShell, null, createElement('main', null, 'Northstar tenant landing')));

    expect(markup).toContain('Northstar tenant landing');
    expect(markup).not.toContain('ACCOUNT SCOPE');
    expect(markup).not.toContain('Cedar Club');
  });

  it('shows an accessible recovery state for an unresolved host', () => {
    mockPathname.mockReturnValue('/organization');
    mockTenant.mockReturnValue({ kind: 'unknown' });
    mockSession.mockReturnValue({ user: null, loading: false, update: () => undefined });
    const markup = renderToStaticMarkup(createElement(ApplicationShell, null, createElement('main', null, 'Tenant content')));

    expect(markup).toContain('aria-labelledby="workspace-unavailable-title"');
    expect(markup).toContain('Workspace not found');
    expect(markup).toContain('Return to platform sign in');
    expect(markup).not.toContain('Tenant content');
  });

  it('keeps host resolution failures retryable and accessible', () => {
    mockTenant.mockReturnValue({ kind: 'error' });
    mockSession.mockReturnValue({ user: null, loading: false, update: () => undefined });
    const markup = renderToStaticMarkup(createElement(ApplicationShell, null, createElement('main', null, 'Tenant content')));

    expect(markup).toContain('Workspace information is unavailable');
    expect(markup).toContain('Try again');
    expect(markup).not.toContain('Tenant content');
  });
});
