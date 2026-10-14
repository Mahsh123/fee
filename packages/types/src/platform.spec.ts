import { describe, expect, it } from 'vitest';
import { CORE_TENANT_MODULES, ORGANIZATION_CATEGORIES, missingTenantModuleDependencies, normalizeOrganizationCategory, organizationCategory, organizationCategoryDisplayName } from './platform';

describe('generic organisation categories', () => {
  it('uses stable category keys without baking custom categories into tenant records', () => {
    expect(ORGANIZATION_CATEGORIES.map(({ key }) => key)).toContain('gym_fitness');
    expect(ORGANIZATION_CATEGORIES.map(({ key }) => key)).toContain('other_organisation');
    expect(normalizeOrganizationCategory('Tuition Centre')).toBe('tuition_centre');
    expect(normalizeOrganizationCategory('custom coworking collective')).toBe('other_organisation');
    expect(organizationCategoryDisplayName('gym_fitness')).toBe('Gym or Fitness Centre');
    expect(organizationCategoryDisplayName('Community Support Group')).toBe('Community Support Group');
  });

  it('keeps setup guidance consistent for navigation and provisioning', () => {
    expect(organizationCategory('tuition_centre')).toMatchObject({ personLabel: 'Student', peopleLabel: 'Students', groupLabel: 'Batches' });
    expect(organizationCategory('company')).toMatchObject({ personLabel: 'Person', peopleLabel: 'People', groupLabel: 'Departments and groups' });
    expect(organizationCategory('gym_fitness').suggestedModules).toContain('ATTENDANCE');
    expect(missingTenantModuleDependencies([...CORE_TENANT_MODULES, 'ATTENDANCE'])).toEqual([]);
  });
});
