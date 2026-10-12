import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ProvisionTenantWizard, { buildTenantProvisionPayload, slugFromOrganizationName } from './provision-tenant-wizard';
import { ORGANIZATION_CATEGORIES } from '@fee/types';

const plans = [{
  id: 'plan-starter',
  key: 'starter',
  name: 'Starter',
  monthlyPrice: '100',
  currency: 'INR',
  active: true,
  trialDays: 14,
  entitlements: [{ entitlementKey: 'USERS', limitValue: 100 }],
  modules: [
    { moduleKey: 'WORKSPACE', enabled: true },
    { moduleKey: 'ORGANIZATION', enabled: true },
    { moduleKey: 'USERS', enabled: true },
    { moduleKey: 'ACCESS', enabled: true },
    { moduleKey: 'AUDIT', enabled: true },
    { moduleKey: 'PAYMENTS', enabled: true },
    { moduleKey: 'MEMBERSHIPS', enabled: true },
  ],
}];

describe('Super Admin tenant provisioning wizard', () => {
  it('maps review form values to the existing provisioning request shape', () => {
    const values = new FormData();
    for (const [key, value] of Object.entries({
      name: '  Cedar Club  ', slug: 'cedar-club', organizationType: 'club_association', contactEmail: '', contactPhone: ' 555-0100 ', countryCode: 'in',
      currency: 'inr', currencySymbol: '₹', currencyMinorUnits: '2', timezone: 'Asia/Kolkata', locale: 'en-IN',
      tenantAdminEmail: 'admin@cedar.test', tenantAdminFirstName: 'Asha', tenantAdminLastName: '',
      planId: 'plan-starter', billingInterval: 'YEARLY',
    })) values.append(key, value);
    for (const module of ['WORKSPACE', 'ORGANIZATION', 'USERS', 'ACCESS', 'AUDIT', 'PAYMENTS', 'MEMBERSHIPS']) values.append('enabledModules', module);

    const payload = buildTenantProvisionPayload(values);

    expect(payload).toMatchObject({
      name: 'Cedar Club', slug: 'cedar-club', organizationType: 'club_association', contactEmail: null, contactPhone: '555-0100', countryCode: 'IN',
      currency: 'INR', currencyMinorUnits: 2, locale: 'en-IN', tenantAdminLastName: null,
      planId: 'plan-starter', billingInterval: 'YEARLY',
    });
    expect(payload.enabledModules).toEqual(['WORKSPACE', 'ORGANIZATION', 'USERS', 'ACCESS', 'AUDIT', 'PAYMENTS', 'MEMBERSHIPS']);
  });

  it('renders the guided accessible stages and keeps the current provisioning contract fields', () => {
    const markup = renderToStaticMarkup(createElement(ProvisionTenantWizard, {
      plans,
      busy: false,
      onProvision: vi.fn(async () => true),
    }));

    expect(markup).toContain('aria-label="Tenant provisioning progress"');
    expect(markup).toContain('aria-current="step"');
    expect(markup).toContain('Step 1 of 5: Organization');
    expect(markup).toContain('name="organizationType"');
    expect(markup).toContain('Organisation category');
    expect(markup).toContain('School');
    expect(markup).toContain('name="slug"');
    expect(markup).toContain('name="enabledModules"');
    expect(markup).toContain('name="currencyMinorUnits"');
    expect(markup).toContain('name="tenantAdminEmail"');
    expect(markup).toContain('Review before provisioning');
    expect(markup).toContain('single-use email invitation');
    expect(markup).toContain('type="button" class="button button-primary">Continue</button>');
  });

  it('explains when no active subscription plan exists', () => {
    const markup = renderToStaticMarkup(createElement(ProvisionTenantWizard, {
      plans: [],
      busy: false,
      onProvision: vi.fn(async () => true),
    }));

    expect(markup).toContain('No active plans are available');
    expect(markup).toContain('Create or activate a plan before provisioning a tenant');
  });

  it('generates a normalized slug from an organisation name and shares stable category identifiers', () => {
    expect(slugFromOrganizationName('  Élan Coaching Centre  ')).toBe('elan-coaching-centre');
    expect(ORGANIZATION_CATEGORIES.map(({ key }) => key)).toContain('club_association');
    expect(ORGANIZATION_CATEGORIES.find(({ key }) => key === 'tuition_centre')?.groupLabel).toBe('Batches');
  });

  it('keeps custom category names on the generic workspace path', () => {
    const values = new FormData();
    values.set('organizationType', 'custom');
    values.set('customOrganizationType', 'Community Support Group');
    expect(buildTenantProvisionPayload(values).organizationType).toBe('Community Support Group');
  });
});
