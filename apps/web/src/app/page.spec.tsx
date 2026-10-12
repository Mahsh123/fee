import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useRouter } from 'next/navigation';
import { useTenant } from '../components/tenant-provider';
import { useSession } from '../components/session-provider';
import HomePage from './page';

vi.mock('../components/tenant-provider', () => ({ useTenant: vi.fn() }));
vi.mock('../components/session-provider', async (importOriginal) => ({ ...(await importOriginal<typeof import('../components/session-provider')>()), useSession: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: vi.fn() }));

const mockUseTenant = vi.mocked(useTenant);
const mockUseSession = vi.mocked(useSession);
const mockUseRouter = vi.mocked(useRouter);

describe('web application shell', () => {
  beforeEach(() => {
    mockUseSession.mockReturnValue({ user: null, loading: false, update: () => undefined });
    mockUseRouter.mockReturnValue({ replace: () => undefined } as ReturnType<typeof useRouter>);
  });

  it('renders the platform landing page on the dedicated platform host', () => {
    mockUseTenant.mockReturnValue({ kind: 'platform' });
    const markup = renderToStaticMarkup(createElement(HomePage));
    expect(markup).toContain('<main id="main-content"');
    expect(markup).toContain('Wasl — وصل. Connect. Track. Report.');
    expect(markup).toContain('WASL · ONE PLATFORM, INDEPENDENT WORKSPACES');
    expect(markup).toContain('Fee Collection, teams and reports in one place.');
    expect(markup).toContain('₹1,50,000');
    expect(markup).toContain('₹25,000');
    expect(markup).toContain('Super Admin sign in');
    expect(markup).not.toContain('Explore the platform');
    expect(markup).not.toContain('Demo tenant');
  });

  it('routes a signed-in platform administrator to the Super Admin control plane', () => {
    mockUseTenant.mockReturnValue({ kind: 'platform' });
    mockUseSession.mockReturnValue({
      user: { id: 'platform-admin', tenantSlug: 'fee-platform', isPlatformAdmin: true, mustChangePassword: false } as ReturnType<typeof useSession>['user'],
      loading: false,
      update: () => undefined,
    });
    const markup = renderToStaticMarkup(createElement(HomePage));
    expect(markup).toContain('Opening Super Admin control plane');
    expect(markup).toContain('href="/platform"');
    expect(markup).not.toContain('INSTITUTION OVERVIEW');
  });

  it('renders the tenant-configured landing content on a tenant host', () => {
    mockUseTenant.mockReturnValue({
      kind: 'tenant',
      slug: 'school',
      name: 'School',
      enabledModules: [],
      branding: {
        organizationName: 'Northstar School',
        email: 'admin@northstar.example.test',
        logoUrl: null,
        primaryColor: '#25214A',
        accentColor: '#6B5DD3',
        landingTitle: 'Welcome to Northstar',
        landingDescription: 'Tenant-specific content appears here.',
        landingActionLabel: 'Continue to Northstar',
      },
    });
    const markup = renderToStaticMarkup(createElement(HomePage));
    expect(markup).toContain('Welcome to Northstar');
    expect(markup).toContain('Tenant-specific content appears here.');
    expect(markup).toContain('Continue to Northstar');
    expect(markup).toContain('href="/login"');
    expect(markup).toContain('href="/register"');
  });

  it('shows the tenant landing to an account signed in on another tenant host', () => {
    mockUseTenant.mockReturnValue({ kind: 'tenant', slug: 'northstar', name: 'Northstar', enabledModules: [], branding: {
      organizationName: 'Northstar', email: null, logoUrl: null, primaryColor: '#123456', accentColor: '#654321', landingTitle: null, landingDescription: null, landingActionLabel: null,
    } });
    mockUseSession.mockReturnValue({ user: { id: 'foreign-user', tenantId: 'tenant-cedar', tenantSlug: 'cedar-club', isPlatformAdmin: false } as ReturnType<typeof useSession>['user'], loading: false, update: () => undefined });

    const markup = renderToStaticMarkup(createElement(HomePage));
    expect(markup).toContain('Welcome to Northstar');
    expect(markup).toContain('Request access');
    expect(markup).not.toContain('Active members');
  });
});
