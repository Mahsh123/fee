import { CORE_TENANT_MODULES, missingTenantModuleDependencies, SUBSCRIPTION_STATUSES, TENANT_STATUSES } from '@fee/types';
import { z } from 'zod';

export const provisionTenantSchema = z.object({
  name: z.string().trim().min(2).max(160),
  planId: z.string().uuid().optional(),
  billingInterval: z.enum(['MONTHLY', 'YEARLY', 'MANUAL']).optional(),
  organizationType: z.string().trim().min(2).max(80).default('ORGANIZATION'),
  enabledModules: z.array(z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_.-]{0,79}$/)).max(100)
    .refine((keys) => new Set(keys).size === keys.length, 'Each enabled module can only be selected once.')
    .refine((keys) => CORE_TENANT_MODULES.every((key) => keys.includes(key)), 'Every workspace must include the core tenant modules.')
    .refine((keys) => missingTenantModuleDependencies(keys).length === 0, 'Fees and the user portal require the payments module.').optional(),
  contactEmail: z.string().trim().email().max(254).transform((value) => value.toLowerCase()).nullable().optional(),
  contactPhone: z.string().trim().max(32).nullable().optional(),
  countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).nullable().optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  currencySymbol: z.string().trim().min(1).max(8),
  currencyMinorUnits: z.number().int().min(0).max(4),
  timezone: z.string().trim().min(3).max(100),
  locale: z.string().trim().min(2).max(32),
  tenantAdminEmail: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  tenantAdminFirstName: z.string().trim().min(1).max(120),
  tenantAdminLastName: z.string().trim().max(120).nullable().optional(),
});

/**
 * The caller must reuse this opaque key when retrying the same provisioning
 * request after a timeout. Use a high-entropy value such as crypto.randomUUID().
 */
export const provisionTenantIdempotencyKeySchema = z.string().trim().min(16).max(200)
  .regex(/^[A-Za-z0-9._~-]+$/, 'Use an opaque Idempotency-Key without whitespace.');

export const updateTenantStatusSchema = z.object({ status: z.enum(TENANT_STATUSES) });
export const updateTenantEntitlementSchema = z.object({
  limitValue: z.number().int().min(0).max(2_147_483_647).nullable(),
  reason: z.string().trim().min(5).max(500),
  inherit: z.boolean().default(false),
});
export const updateTenantModuleOverrideSchema = z.object({
  enabled: z.boolean().nullable(),
  reason: z.string().trim().min(5).max(500),
});
export const createTenantDomainSchema = z.object({
  domain: z.string().trim().min(4).max(253),
});

const planModuleSchema = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_.-]{0,79}$/);
const planEntitlementSchema = z.object({
  entitlementKey: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,99}$/),
  limitValue: z.number().int().min(0).max(2_147_483_647).nullable(),
});
const planFields = {
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).nullable().optional(),
  monthlyPrice: z.number().min(0).max(1_000_000_000_000),
  yearlyPrice: z.number().min(0).max(1_000_000_000_000),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  trialDays: z.number().int().min(0).max(365),
  active: z.boolean(),
  modules: z.array(planModuleSchema).max(100)
    .refine((keys) => new Set(keys).size === keys.length, 'Each plan module can only be added once.')
    .refine((keys) => CORE_TENANT_MODULES.every((key) => keys.includes(key)), 'Every plan must include the core tenant modules.')
    .refine((keys) => missingTenantModuleDependencies(keys).length === 0, 'Fees and the user portal require the payments module.'),
  entitlements: z.array(planEntitlementSchema).max(100).refine((items) => new Set(items.map(({ entitlementKey }) => entitlementKey)).size === items.length, 'Each plan entitlement can only be added once.'),
};

export const createPlanSchema = z.object({
  key: z.string().trim().toLowerCase().min(2).max(80).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
  ...planFields,
});
export const updatePlanSchema = z.object({ ...planFields, description: planFields.description }).partial()
  .refine((value) => Object.keys(value).length > 0, 'Change at least one plan field.')
  .refine((value) => value.modules === undefined || missingTenantModuleDependencies(value.modules).length === 0, 'Fees and the user portal require the payments module.');
export const createTenantSubscriptionSchema = z.object({
  planId: z.string().uuid(),
  billingInterval: z.enum(['MONTHLY', 'YEARLY', 'MANUAL']),
  startTrial: z.boolean().default(false),
});
export const updateTenantSubscriptionStatusSchema = z.object({
  status: z.enum(SUBSCRIPTION_STATUSES),
  reason: z.string().trim().min(5).max(500),
});
export const updateTenantSubscriptionCancellationSchema = z.object({
  cancelAtPeriodEnd: z.boolean(),
  reason: z.string().trim().min(5).max(500),
});
export const issuePlatformInvoiceSchema = z.object({ dueAt: z.string().datetime().optional() });
export const recordPlatformPaymentSchema = z.object({
  amount: z.number().positive().max(1_000_000_000_000),
  idempotencyKey: z.string().trim().min(12).max(200),
  providerPaymentId: z.string().trim().max(200).nullable().optional(),
}).refine(({ amount }) => Number.isInteger(amount * 10_000), 'Payment amounts can have at most four decimal places.');
export const requestPlatformRefundSchema = z.object({
  amount: z.number().positive().max(1_000_000_000_000),
  reason: z.string().trim().min(5).max(1000),
}).refine(({ amount }) => Number.isInteger(amount * 10_000), 'Refund amounts can have at most four decimal places.');
export const updatePlatformRefundStatusSchema = z.object({
  status: z.enum(['PROCESSED', 'REJECTED']),
  externalRefundId: z.string().trim().min(1).max(200).nullable().optional(),
}).refine((value) => value.status !== 'PROCESSED' || Boolean(value.externalRefundId), 'Enter the external refund reference after processing it with the payment provider.');

const slugSchema = z.string().trim().toLowerCase().min(2).max(63).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Use lowercase letters, numbers, and hyphens.');
export const updateTenantProfileSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  organizationType: z.string().trim().min(2).max(80).optional(),
  slug: slugSchema.optional(),
  contactEmail: z.string().trim().email().max(254).transform((value) => value.toLowerCase()).nullable().optional(),
  contactPhone: z.string().trim().max(32).nullable().optional(),
  countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, 'Change at least one institution field.');

export const createPlatformAdminSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().max(120).nullable().optional(),
});

export const createTenantAdminSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  phone: z.string().trim().max(32).nullable().optional(),
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().max(120).nullable().optional(),
  temporaryPassword: z.string().min(12, 'Use a temporary password with at least 12 characters.').max(200),
});

export const updatePlatformAdminProfileSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()).optional(),
  firstName: z.string().trim().min(1).max(120).optional(),
  lastName: z.string().trim().max(120).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, 'Change at least one administrator field.');

export type ProvisionTenantInput = z.infer<typeof provisionTenantSchema>;
export type ProvisionTenantIdempotencyKey = z.infer<typeof provisionTenantIdempotencyKeySchema>;
export type UpdateTenantStatusInput = z.infer<typeof updateTenantStatusSchema>;
export type UpdateTenantEntitlementInput = z.infer<typeof updateTenantEntitlementSchema>;
export type UpdateTenantModuleOverrideInput = z.infer<typeof updateTenantModuleOverrideSchema>;
export type CreateTenantDomainInput = z.infer<typeof createTenantDomainSchema>;
export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;
export type CreateTenantSubscriptionInput = z.infer<typeof createTenantSubscriptionSchema>;
export type UpdateTenantSubscriptionStatusInput = z.infer<typeof updateTenantSubscriptionStatusSchema>;
export type UpdateTenantSubscriptionCancellationInput = z.infer<typeof updateTenantSubscriptionCancellationSchema>;
export type IssuePlatformInvoiceInput = z.infer<typeof issuePlatformInvoiceSchema>;
export type RecordPlatformPaymentInput = z.infer<typeof recordPlatformPaymentSchema>;
export type RequestPlatformRefundInput = z.infer<typeof requestPlatformRefundSchema>;
export type UpdatePlatformRefundStatusInput = z.infer<typeof updatePlatformRefundStatusSchema>;
export type UpdateTenantProfileInput = z.infer<typeof updateTenantProfileSchema>;
export type CreatePlatformAdminInput = z.infer<typeof createPlatformAdminSchema>;
export type CreateTenantAdminInput = z.infer<typeof createTenantAdminSchema>;
export type UpdatePlatformAdminProfileInput = z.infer<typeof updatePlatformAdminProfileSchema>;
