import type { TenantScopedDatabaseClient } from '@fee/database';
import { CORE_TENANT_MODULES, missingTenantModuleDependencies } from '@fee/types';

type ModuleAccessDatabase = Pick<TenantScopedDatabaseClient, 'tenant' | 'tenantSubscription' | 'tenantModuleOverride'>;

/** Resolves module access from the current plan and platform overrides.
 * Tenant.enabledModules is only a legacy fallback/projection. */
export async function resolveTenantModuleAccess(db: ModuleAccessDatabase, tenantId: string) {
  const tenant = await db.tenant.findFirst({ where: { id: tenantId }, select: { enabledModules: true } });
  if (!tenant) return null;

  const subscription = await db.tenantSubscription.findFirst({
    where: { tenantId, isCurrent: true },
    select: { status: true, plan: { select: { modules: { select: { moduleKey: true, enabled: true } } } } },
  });
  const overrides = await db.tenantModuleOverride.findMany({ where: { tenantId }, select: { moduleKey: true, enabled: true } });

  // A tenant with no subscription history is a legacy workspace and may still
  // use the old module projection. Once it has had a subscription, losing the
  // current row must not resurrect paid access from stale tenant metadata.
  const subscriptionHistory = subscription ? null : await db.tenantSubscription.findFirst({
    where: { tenantId },
    select: { id: true },
  });
  const subscriptionAllowsOptionalModules = subscription
    ? ['TRIAL', 'ACTIVE', 'PAST_DUE'].includes(subscription.status)
    : !subscriptionHistory;
  const baseModules = subscription && subscriptionAllowsOptionalModules
    ? subscription.plan.modules.filter(({ enabled }) => enabled).map(({ moduleKey }) => moduleKey)
    : subscriptionAllowsOptionalModules
      ? tenant.enabledModules
      : [];
  const enabled = new Set<string>([...baseModules, ...CORE_TENANT_MODULES]);
  for (const override of overrides) {
    if ((CORE_TENANT_MODULES as readonly string[]).includes(override.moduleKey)) {
      enabled.add(override.moduleKey);
    } else if (override.enabled && subscriptionAllowsOptionalModules) {
      enabled.add(override.moduleKey);
    } else if (!override.enabled) {
      enabled.delete(override.moduleKey);
    }
  }
  for (const unavailableModule of missingTenantModuleDependencies([...enabled])) enabled.delete(unavailableModule);

  const enabledModules = [...enabled].sort();
  return { enabledModules, has: (moduleKey: string) => enabled.has(moduleKey) };
}
