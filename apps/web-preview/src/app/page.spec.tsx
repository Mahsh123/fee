import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useTenant } from '../components/tenant-provider';
import { useSession } from '../components/session-provider';
import HomePage from './page';

vi.mock('../components/tenant-provider', () => ({ useTenant: vi.fn() }));
vi.mock('../components/session-provider', () => ({ useSession: vi.fn() }));

const mockUseTenant = vi.mocked(useTenant);
const mockUseSession = vi.mocked(useSession);

describe('web application shell', () => {
  beforeEach(() => {
    mockUseSession.mockReturnValue({ user: null, loading: false, update: () => undefined });
  });

  it('renders the platform landing page on the dedicated platform host', () => {
    mockUseTenant.mockReturnValue({ kind: 'platform' });
    const markup = renderToStaticMarkup(createElement(HomePage));
    expect(markup).toContain('<main id="main-content"');
    expect(markup).toContain('FEE OPERATIONS FOR INSTITUTIONS');
    expect(markup).toContain('Know what is due, what is paid, and why.');
    expect(markup).not.toContain('Demo tenant');
  });

  it('renders the tenant-configured landing content on a tenant host', () => {
    mockUseTenant.mockReturnValue({
      kind: 'tenant',
      slug: 'school',
      name: 'School',
      branding: {
        organizationName: 'Northstar School',
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
  });
});
