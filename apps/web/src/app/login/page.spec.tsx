import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useRouter } from 'next/navigation';
import { useSession } from '../../components/session-provider';
import { useTenant } from '../../components/tenant-provider';
import LoginPage from './page';

vi.mock('next/navigation', () => ({ useRouter: vi.fn() }));
vi.mock('../../components/session-provider', () => ({ useSession: vi.fn() }));
vi.mock('../../components/tenant-provider', () => ({ useTenant: vi.fn() }));

const mockUseRouter = vi.mocked(useRouter);
const mockUseSession = vi.mocked(useSession);
const mockUseTenant = vi.mocked(useTenant);

describe('workspace sign-in', () => {
  beforeEach(() => {
    mockUseRouter.mockReturnValue({ replace: () => undefined } as ReturnType<typeof useRouter>);
    mockUseSession.mockReturnValue({ user: null, loading: false, update: () => undefined });
  });

  it('uses generic organization language and neutral email examples', () => {
    mockUseTenant.mockReturnValue({
      kind: 'tenant', slug: 'cedar-club', name: 'Cedar Club', enabledModules: [],
      branding: { organizationName: 'Cedar Club', email: null, logoUrl: null, primaryColor: '#123456', accentColor: '#654321', landingTitle: null, landingDescription: null, landingActionLabel: null },
    });
    const markup = renderToStaticMarkup(createElement(LoginPage));

    expect(markup).toContain('manage your organization, team, and enabled workflows');
    expect(markup).toContain('placeholder="name@example.com"');
    expect(markup).not.toContain('school.edu');
    expect(markup).not.toContain('students, fee schedules');
    expect(markup).toContain('aria-busy="false"');
    expect(markup).toContain('href="/register"');
  });

  it('states clearly when the requested tenant hostname is unknown', () => {
    mockUseTenant.mockReturnValue({ kind: 'unknown' });
    const markup = renderToStaticMarkup(createElement(LoginPage));

    expect(markup).toContain('aria-labelledby="workspace-error-title"');
    expect(markup).toContain('Workspace not found');
    expect(markup).toContain('contact your organization');
  });

  it('states clearly when a tenant is inactive', () => {
    mockUseTenant.mockReturnValue({ kind: 'inactive', slug: 'cedar-club', name: 'Cedar Club' });
    const markup = renderToStaticMarkup(createElement(LoginPage));

    expect(markup).toContain('This organization is not accepting sign-ins right now');
    expect(markup).toContain('Return to platform sign in');
  });

  it('provides a retry action when tenant context cannot be reached', () => {
    mockUseTenant.mockReturnValue({ kind: 'error' });
    const markup = renderToStaticMarkup(createElement(LoginPage));

    expect(markup).toContain('Workspace information is unavailable');
    expect(markup).toContain('Try again');
  });
});
