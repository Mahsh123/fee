import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Breadcrumbs from './breadcrumbs';

describe('application breadcrumbs', () => {
  it('shows the workspace, feature, and record hierarchy on nested tenant pages', () => {
    const markup = renderToStaticMarkup(createElement(Breadcrumbs, {
      pathname: '/students/cmfdt8dkd0000a1b2c3d4e5f6',
      workspaceName: 'Greenfield Academy',
      items: [
        { href: '/', label: 'Overview', section: 'WORKSPACE' },
        { href: '/students', label: 'Students', section: 'ADMISSIONS' },
      ],
    }));

    expect(markup).toContain('aria-label="Breadcrumb"');
    expect(markup).toContain('Greenfield Academy');
    expect(markup).toContain('href="/students"');
    expect(markup).toContain('Students');
    expect(markup).toContain('aria-current="page">Record details');
  });

  it('keeps tenant administration nested under the platform tenant directory', () => {
    const markup = renderToStaticMarkup(createElement(Breadcrumbs, {
      pathname: '/platform/tenants/tenant-123',
      workspaceName: 'Wasl Platform',
      items: [
        { href: '/platform', label: 'Overview', section: 'PLATFORM' },
        { href: '/platform/tenants', label: 'Organisations', section: 'WORKSPACES' },
      ],
    }));

    expect(markup).toContain('href="/platform"');
    expect(markup).toContain('href="/platform/tenants"');
    expect(markup).toContain('aria-current="page">Tenant details');
  });
});
