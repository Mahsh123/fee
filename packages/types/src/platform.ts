import type { RoleKey } from './enums';

/** Three-level SaaS authorization vocabulary mapped onto the existing detailed RBAC roles. */
export const SAAS_ACCESS_TIERS = ['SUPER_ADMIN', 'TENANT_ADMIN', 'TENANT_USER'] as const;
export type SaasAccessTier = (typeof SAAS_ACCESS_TIERS)[number];

/** Platform-managed module keys. Tenant/plan records may add custom modules without imposing an industry taxonomy. */
export const PLATFORM_MODULES = [
  'USERS', 'BRANCHES', 'ORGANIZATION', 'ASSIGNMENTS', 'REPORTS', 'NOTIFICATIONS',
  'FEES', 'PAYMENTS', 'ADMISSIONS', 'PORTAL', 'ANALYTICS',
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
  PORTAL: 'User portal',
  ANALYTICS: 'Analytics',
};

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
};
