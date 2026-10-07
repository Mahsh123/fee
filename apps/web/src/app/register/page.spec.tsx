import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useTenant } from '../../components/tenant-provider';
import RegisterPage from './page';

vi.mock('../../components/tenant-provider', () => ({ useTenant: vi.fn() }));

const mockUseTenant = vi.mocked(useTenant);

describe('tenant registration entry point', () => {
  it('uses the tenant name and published organization email for a safe invitation request', () => {
    mockUseTenant.mockReturnValue({
      kind: 'tenant', slug: 'cedar-club', name: 'Cedar Club', enabledModules: [], allowPublicRegistration: false,
      branding: { organizationName: 'Cedar Club', email: 'hello@cedar.example.test', logoUrl: null, primaryColor: '#123456', accentColor: '#654321', landingTitle: null, landingDescription: null, landingActionLabel: null },
    });

    const markup = renderToStaticMarkup(createElement(RegisterPage));

    expect(markup).toContain('Request workspace access');
    expect(markup).toContain('Cedar Club');
    expect(markup).toContain('mailto:hello%40cedar.example.test');
    expect(markup).toContain('finish registration and set your password');
    expect(markup).toContain('href="/login"');
  });

  it('explains how to request an invite when no public contact email is configured', () => {
    mockUseTenant.mockReturnValue({
      kind: 'tenant', slug: 'cedar-club', name: 'Cedar Club', enabledModules: [], allowPublicRegistration: false,
      branding: { organizationName: 'Cedar Club', email: null, logoUrl: null, primaryColor: '#123456', accentColor: '#654321', landingTitle: null, landingDescription: null, landingActionLabel: null },
    });

    const markup = renderToStaticMarkup(createElement(RegisterPage));

    expect(markup).toContain('This organization has not published a contact email');
    expect(markup).not.toContain('mailto:');
  });

  it('shows a self-registration form only when the tenant explicitly enables it', () => {
    mockUseTenant.mockReturnValue({
      kind: 'tenant', slug: 'cedar-club', name: 'Cedar Club', enabledModules: [], allowPublicRegistration: true,
      branding: { organizationName: 'Cedar Club', email: null, logoUrl: null, primaryColor: '#123456', accentColor: '#654321', landingTitle: null, landingDescription: null, landingActionLabel: null },
    });

    const markup = renderToStaticMarkup(createElement(RegisterPage));

    expect(markup).toContain('Create your workspace account');
    expect(markup).toContain('First name');
    expect(markup).toContain('Email address');
    expect(markup).toContain('Send verification link');
    expect(markup).not.toContain('This organization has not published a contact email');
  });
});
