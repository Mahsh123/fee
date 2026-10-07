import { type TransactionClient } from '@fee/database';
import { AppError } from './errors';

/** Shared seat check for administrator invites and public tenant registration. */
export async function assertTenantUserSeatAvailable(tx: TransactionClient, tenantId: string): Promise<void> {
  const subscription = await tx.tenantSubscription.findFirst({ where: { tenantId, isCurrent: true }, select: { planId: true } });
  if (!subscription) return;
  const [current, planLimit, override] = await Promise.all([
    tx.user.count({ where: { tenantId, deletedAt: null, status: { in: ['ACTIVE', 'INVITED'] }, isPlatformAdmin: false } }),
    tx.planEntitlement.findFirst({ where: { planId: subscription.planId, entitlementKey: 'MAX_USERS' }, select: { limitValue: true } }),
    tx.tenantEntitlementOverride.findFirst({ where: { tenantId, entitlementKey: 'MAX_USERS' }, select: { limitValue: true } }),
  ]);
  const limit = override ? override.limitValue : planLimit?.limitValue;
  if (limit !== null && limit !== undefined && current >= limit) {
    throw AppError.conflict('TENANT_LIMIT_REACHED', 'The organization has reached its user seat limit. Increase its limit or change its subscription plan.');
  }
}
