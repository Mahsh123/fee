import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useTenant } from '../../components/tenant-provider';
import VerifyEmailChangePage from './page';

vi.mock('../../components/tenant-provider', () => ({ useTenant: vi.fn() }));

const mockUseTenant = vi.mocked(useTenant);

describe('email verification page', () => {
  it('uses platform language for platform-hosted verification', () => {
    mockUseTenant.mockReturnValue({ kind: 'platform' });
    const markup = renderToStaticMarkup(createElement(VerifyEmailChangePage));

    expect(markup).toContain('Verify your new email');
    expect(markup).toContain('ACCOUNT SECURITY');
  });

  it('renders the same neutral verification experience for tenant workspaces', () => {
    mockUseTenant.mockReturnValue({
      kind: 'tenant', slug: 'cedar-club', name: 'Cedar Club', enabledModules: [],
      branding: { organizationName: 'Cedar Club', email: null, logoUrl: null, primaryColor: '#123456', accentColor: '#654321', landingTitle: null, landingDescription: null, landingActionLabel: null },
    });
    const markup = renderToStaticMarkup(createElement(VerifyEmailChangePage));

    expect(markup).toContain('Verify your new email');
    expect(markup).toContain('ACCOUNT SECURITY');
    expect(markup).not.toContain('school');
  });
});
