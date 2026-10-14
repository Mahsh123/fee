import type { RoleKey } from './enums';

/** Three-level SaaS authorization vocabulary mapped onto the existing detailed RBAC roles. */
export const SAAS_ACCESS_TIERS = ['SUPER_ADMIN', 'TENANT_ADMIN', 'TENANT_USER'] as const;
export type SaasAccessTier = (typeof SAAS_ACCESS_TIERS)[number];

/** Platform-managed module keys. Tenant/plan records may add custom modules without imposing an industry taxonomy. */
export const PLATFORM_MODULES = [
  'USERS', 'BRANCHES', 'ORGANIZATION', 'ASSIGNMENTS', 'REPORTS', 'NOTIFICATIONS',
  'FEES', 'PAYMENTS', 'ADMISSIONS', 'ATTENDANCE', 'PORTAL', 'ANALYTICS',
] as const;
export type PlatformModule = (typeof PLATFORM_MODULES)[number];

/** Always-on building blocks for a tenant workspace; industry workflows are optional plan modules. */
export const CORE_TENANT_MODULES = ['USERS', 'BRANCHES', 'ORGANIZATION', 'ASSIGNMENTS', 'REPORTS', 'NOTIFICATIONS'] as const;
export type CoreTenantModule = (typeof CORE_TENANT_MODULES)[number];

/** Optional module prerequisites enforced by schema validation and at runtime. */
export const TENANT_MODULE_DEPENDENCIES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  FEES: ['PAYMENTS'],
  PORTAL: ['PAYMENTS'],
});

export function missingTenantModuleDependencies(moduleKeys: readonly string[]): string[] {
  const enabled = new Set(moduleKeys);
  return Object.entries(TENANT_MODULE_DEPENDENCIES)
    .filter(([moduleKey, dependencies]) => enabled.has(moduleKey) && dependencies.some((dependency) => !enabled.has(dependency)))
    .map(([moduleKey]) => moduleKey);
}

export const PLATFORM_MODULE_LABELS: Record<PlatformModule, string> = {
  USERS: 'Users',
  BRANCHES: 'Branches',
  ORGANIZATION: 'Organization',
  ASSIGNMENTS: 'Assignments',
  REPORTS: 'Reports',
  NOTIFICATIONS: 'Notifications',
  FEES: 'Fees',
  PAYMENTS: 'Payments',
  ADMISSIONS: 'Admissions',
  ATTENDANCE: 'Attendance',
  PORTAL: 'User portal',
  ANALYTICS: 'Analytics',
};

/**
 * Stable organisation categories used to configure the generic tenant
 * workspace. Labels and suggestions live in one shared catalog so the web
 * client and API never maintain competing category lists.
 */
export const ORGANIZATION_CATEGORY_KEYS = [
  'school', 'madrasa', 'tuition_centre', 'coaching_centre', 'academy', 'college',
  'training_institute', 'club_association', 'gym_fitness', 'company', 'ngo', 'other_organisation',
] as const;
export type OrganizationCategoryKey = (typeof ORGANIZATION_CATEGORY_KEYS)[number];

type OrganizationCategoryDefinition = {
  key: OrganizationCategoryKey;
  label: string;
  description: string;
  personLabel: string;
  peopleLabel: string;
  groupLabel: string;
  suggestedModules: readonly PlatformModule[];
};

export const ORGANIZATION_CATEGORIES = [
  { key: 'school', label: 'School', description: 'An education workspace for school operations.', personLabel: 'Student', peopleLabel: 'Students', groupLabel: 'Classes and sections', suggestedModules: ['ADMISSIONS', 'ATTENDANCE', 'FEES', 'PAYMENTS', 'PORTAL', 'ANALYTICS'] },
  { key: 'madrasa', label: 'Madrasa', description: 'An education workspace with configurable groups and fee collection.', personLabel: 'Student', peopleLabel: 'Students', groupLabel: 'Classes and groups', suggestedModules: ['ADMISSIONS', 'ATTENDANCE', 'FEES', 'PAYMENTS', 'PORTAL', 'ANALYTICS'] },
  { key: 'tuition_centre', label: 'Tuition Centre', description: 'An education workspace organised around batches.', personLabel: 'Student', peopleLabel: 'Students', groupLabel: 'Batches', suggestedModules: ['ADMISSIONS', 'ATTENDANCE', 'FEES', 'PAYMENTS', 'PORTAL', 'ANALYTICS'] },
  { key: 'coaching_centre', label: 'Coaching Centre', description: 'An education workspace organised around batches and admissions.', personLabel: 'Student', peopleLabel: 'Students', groupLabel: 'Batches', suggestedModules: ['ADMISSIONS', 'ATTENDANCE', 'FEES', 'PAYMENTS', 'PORTAL', 'ANALYTICS'] },
  { key: 'academy', label: 'Academy', description: 'A configurable training or education workspace.', personLabel: 'Student', peopleLabel: 'Students', groupLabel: 'Groups', suggestedModules: ['ADMISSIONS', 'ATTENDANCE', 'FEES', 'PAYMENTS', 'ANALYTICS'] },
  { key: 'college', label: 'College', description: 'An education workspace with configurable academic groups.', personLabel: 'Student', peopleLabel: 'Students', groupLabel: 'Classes and groups', suggestedModules: ['ADMISSIONS', 'ATTENDANCE', 'FEES', 'PAYMENTS', 'PORTAL', 'ANALYTICS'] },
  { key: 'training_institute', label: 'Training Institute', description: 'A training workspace organised around groups or batches.', personLabel: 'Learner', peopleLabel: 'Learners', groupLabel: 'Batches and groups', suggestedModules: ['ADMISSIONS', 'ATTENDANCE', 'FEES', 'PAYMENTS', 'ANALYTICS'] },
  { key: 'club_association', label: 'Club or Association', description: 'A member-oriented workspace using generic users and groups.', personLabel: 'Member', peopleLabel: 'Members', groupLabel: 'Groups', suggestedModules: ['ATTENDANCE', 'FEES', 'PAYMENTS', 'PORTAL', 'ANALYTICS'] },
  { key: 'gym_fitness', label: 'Gym or Fitness Centre', description: 'A member-oriented workspace using generic users and groups.', personLabel: 'Member', peopleLabel: 'Members', groupLabel: 'Groups', suggestedModules: ['ATTENDANCE', 'FEES', 'PAYMENTS', 'PORTAL', 'ANALYTICS'] },
  { key: 'company', label: 'Company', description: 'A general organisation workspace for people, branches, and groups.', personLabel: 'Person', peopleLabel: 'People', groupLabel: 'Departments and groups', suggestedModules: ['ATTENDANCE', 'ANALYTICS'] },
  { key: 'ngo', label: 'NGO', description: 'A general organisation workspace for people, branches, and groups.', personLabel: 'Member', peopleLabel: 'Members', groupLabel: 'Groups', suggestedModules: ['ATTENDANCE', 'FEES', 'PAYMENTS', 'ANALYTICS'] },
  { key: 'other_organisation', label: 'Other Organisation', description: 'A general-purpose workspace with configurable people and groups.', personLabel: 'Person', peopleLabel: 'People', groupLabel: 'Groups', suggestedModules: ['ANALYTICS'] },
] as const satisfies readonly OrganizationCategoryDefinition[];

const ORGANIZATION_CATEGORY_ALIASES: Readonly<Record<string, OrganizationCategoryKey>> = Object.freeze({
  organization: 'other_organisation', organisation: 'other_organisation',
  'tuition centre': 'tuition_centre', 'tuition center': 'tuition_centre',
  'coaching centre': 'coaching_centre', 'coaching center': 'coaching_centre',
  'club or association': 'club_association', 'club/association': 'club_association', club: 'club_association', association: 'club_association',
  gym: 'gym_fitness', fitness: 'gym_fitness', 'fitness centre': 'gym_fitness', 'fitness center': 'gym_fitness',
  company: 'company', ngo: 'ngo', school: 'school', madrasa: 'madrasa', academy: 'academy', college: 'college',
  'training institute': 'training_institute', 'other organisation': 'other_organisation', 'other organization': 'other_organisation',
});

export function normalizeOrganizationCategory(value: string | null | undefined): OrganizationCategoryKey {
  const normalized = (value ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ');
  const aliased = ORGANIZATION_CATEGORY_ALIASES[normalized];
  if (aliased) return aliased;
  const exact = ORGANIZATION_CATEGORY_KEYS.find((key) => key === (value ?? '').trim().toLowerCase());
  return exact ?? 'other_organisation';
}

export function organizationCategory(key: string | null | undefined): (typeof ORGANIZATION_CATEGORIES)[number] {
  const normalized = normalizeOrganizationCategory(key);
  return ORGANIZATION_CATEGORIES.find((category) => category.key === normalized) ?? ORGANIZATION_CATEGORIES[ORGANIZATION_CATEGORIES.length - 1]!;
}

/** Display known categories by their shared label and preserve custom labels. */
export function organizationCategoryDisplayName(value: string | null | undefined): string {
  const raw = value?.trim() ?? '';
  if (!raw) return organizationCategory('other_organisation').label;
  const lookupKey = raw.toLowerCase().replace(/[_-]+/g, ' ');
  const isKnown = ORGANIZATION_CATEGORY_KEYS.some((key) => key === raw.toLowerCase()) || ORGANIZATION_CATEGORY_ALIASES[lookupKey] !== undefined;
  return isKnown ? organizationCategory(raw).label : raw;
}

export function accessTierForRoles(roleKeys: readonly string[], isPlatformAdmin = false): SaasAccessTier {
  if (isPlatformAdmin && roleKeys.includes('PLATFORM_ADMIN')) return 'SUPER_ADMIN';
  return roleKeys.some((key) => key === 'TENANT_ADMIN' || key === 'TENANT_OWNER') ? 'TENANT_ADMIN' : 'TENANT_USER';
}

/** Reserved tenant used only to authenticate and audit platform operators. */
export const PLATFORM_SYSTEM_TENANT_SLUG = 'fee-platform';

/** Names for the built-in roles shown in tenant access screens. */
export const SYSTEM_ROLE_NAMES: Record<RoleKey, string> = {
  PLATFORM_ADMIN: 'Super administrator',
  TENANT_OWNER: 'Workspace owner',
  TENANT_ADMIN: 'Workspace administrator',
  TENANT_MEMBER: 'Workspace member',
  FINANCE_ADMIN: 'Finance administrator',
  FINANCE_STAFF: 'Finance staff',
  ADMISSION_STAFF: 'Admissions staff',
  COLLECTION_STAFF: 'Collection staff',
  ACCOUNTANT: 'Accountant',
  REPORT_VIEWER: 'Report viewer',
  STUDENT: 'Student portal',
  PARENT: 'Parent portal',
  WORKSPACE_PERSON: 'Workspace person portal',
};
