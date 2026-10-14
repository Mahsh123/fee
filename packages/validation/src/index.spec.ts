import { describe, expect, it } from 'vitest';
import { changePasswordSchema, createPaymentOrderSchema, loginSchema, manualPaymentSchema, refreshSchema, updateOwnProfileSchema } from './index';
import { tenantBrandingUpdateSchema } from './tenant-operations';
import { createPlanSchema, provisionTenantSchema, tenantSlugAvailabilitySchema, updatePlanSchema, updateTenantProfileSchema } from './platform';
import { createFeeAssignmentSchema } from './fees';

describe('shared validation contracts', () => {
  it('requires selected people for direct fee assignment and accepts bounded explicit targets', () => {
    const assignment = {
      branchId: '11111111-1111-4111-8111-111111111111',
      feeStructureId: '22222222-2222-4222-8222-222222222222',
      feeStructureVersionId: '33333333-3333-4333-8333-333333333333',
      targetType: 'STUDENT',
      dueDateOverride: '2026-11-01',
    };
    expect(createFeeAssignmentSchema.safeParse(assignment).success).toBe(false);
    expect(createFeeAssignmentSchema.safeParse({ ...assignment, targetStudentIds: ['44444444-4444-4444-8444-444444444444'] }).success).toBe(true);
    expect(createFeeAssignmentSchema.safeParse({ ...assignment, targetStudentIds: Array.from({ length: 5001 }, () => '44444444-4444-4444-8444-444444444444') }).success).toBe(false);
  });

  it('resolves login scope from the hostname and strips client tenant identity', () => {
    expect(loginSchema.safeParse({ email: 'payer@example.test', password: 'secret' }).success).toBe(true);
    const withSpoofedSlug = loginSchema.safeParse({ tenantSlug: 'other-school', email: 'payer@example.test', password: 'secret' });
    expect(withSpoofedSlug.success).toBe(true);
    if (withSpoofedSlug.success) expect(withSpoofedSlug.data).toEqual({ email: 'payer@example.test', password: 'secret' });
  });

  it('requires an opaque refresh token of usable length', () => {
    expect(refreshSchema.safeParse({ refreshToken: 'a'.repeat(10) }).success).toBe(true);
    expect(refreshSchema.safeParse({ refreshToken: 'short' }).success).toBe(false);
  });

  it('accepts safe tenant landing branding and rejects unsafe logo URLs/colors', () => {
    expect(tenantBrandingUpdateSchema.safeParse({
      logoUrl: '/tenant-brands/demo.svg',
      landingTitle: 'Welcome',
      landingDescription: 'Public information',
      landingActionLabel: 'Sign in',
      accentColor: '#123456',
    }).success).toBe(true);
    expect(tenantBrandingUpdateSchema.safeParse({ logoUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(tenantBrandingUpdateSchema.safeParse({ logoUrl: '//other.example/logo.svg' }).success).toBe(false);
    expect(tenantBrandingUpdateSchema.safeParse({ logoUrl: 'https://cdn.example/logo.svg' }).success).toBe(true);
    expect(tenantBrandingUpdateSchema.safeParse({ accentColor: 'blue' }).success).toBe(false);
  });

  it('requires a strong new password without imposing policy on the old password', () => {
    expect(changePasswordSchema.safeParse({ currentPassword: 'old', newPassword: 'long-enough-password' }).success).toBe(true);
    expect(changePasswordSchema.safeParse({ currentPassword: '', newPassword: 'short' }).success).toBe(false);
  });

  it('allows users to update profile details but not change email without verification', () => {
    expect(updateOwnProfileSchema.safeParse({ firstName: 'Sam', phone: '+1 555 0100' }).success).toBe(true);
    expect(updateOwnProfileSchema.safeParse({ email: 'unverified@example.test' }).success).toBe(false);
  });

  it('requires tenant-resolvable guardian identity on parent and guardian collections', () => {
    const guardianId = '3d1ef071-e838-46bd-9991-35c024e7e77c';
    const base = { idempotencyKey: guardianId, studentId: guardianId, methodId: guardianId, amount: '10.00', payerType: 'PARENT' };
    expect(manualPaymentSchema.safeParse({ ...base, payerGuardianId: guardianId }).success).toBe(true);
    expect(manualPaymentSchema.safeParse(base).success).toBe(false);
    expect(manualPaymentSchema.safeParse({ ...base, payerType: 'GOVERNMENT', payerGuardianId: guardianId, payerName: 'Grant' }).success).toBe(false);

    const onlineBase = { ...base, environment: 'TEST' };
    expect(createPaymentOrderSchema.safeParse({ ...onlineBase, payerGuardianId: guardianId }).success).toBe(true);
    expect(createPaymentOrderSchema.safeParse(onlineBase).success).toBe(false);
  });

  it('requires payment support whenever the fee or user portal module is configured', () => {
    const core = ['USERS', 'BRANCHES', 'ORGANIZATION', 'ASSIGNMENTS', 'REPORTS', 'NOTIFICATIONS'];
    const plan = {
      key: 'team', name: 'Team', monthlyPrice: 0, yearlyPrice: 0, currency: 'INR', trialDays: 0,
      active: true, entitlements: [], modules: [...core, 'FEES'],
    };
    expect(createPlanSchema.safeParse(plan).success).toBe(false);
    expect(updatePlanSchema.safeParse({ modules: [...core, 'PORTAL'] }).success).toBe(false);
    expect(createPlanSchema.safeParse({ ...plan, modules: [...core, 'FEES', 'PAYMENTS'] }).success).toBe(true);
    expect(provisionTenantSchema.safeParse({
      name: 'Example Org', enabledModules: [...core, 'PORTAL'], currency: 'INR', currencySymbol: '₹', currencyMinorUnits: 2,
      timezone: 'Asia/Kolkata', locale: 'en-IN', tenantAdminEmail: 'owner@example.test', tenantAdminFirstName: 'Owner',
    }).success).toBe(false);
  });

  it('accepts stable organisation category IDs and validates workspace slugs', () => {
    const core = ['USERS', 'BRANCHES', 'ORGANIZATION', 'ASSIGNMENTS', 'REPORTS', 'NOTIFICATIONS'];
    const common = { name: 'Example Organisation', currency: 'INR', currencySymbol: '₹', currencyMinorUnits: 2, timezone: 'Asia/Kolkata', locale: 'en-IN', tenantAdminEmail: 'admin@example.test', tenantAdminFirstName: 'Asha', enabledModules: core };
    expect(provisionTenantSchema.safeParse({ ...common, organizationType: 'school', slug: 'example-school' }).success).toBe(true);
    expect(provisionTenantSchema.safeParse({ ...common, organizationType: 'Community Centre' }).success).toBe(true);
    expect(provisionTenantSchema.safeParse({ ...common, organizationType: 'S' }).success).toBe(false);
    expect(tenantSlugAvailabilitySchema.safeParse({ slug: 'tenant-1' }).success).toBe(true);
    expect(tenantSlugAvailabilitySchema.safeParse({ slug: 'platform' }).success).toBe(true);
    expect(updateTenantProfileSchema.safeParse({ organizationType: 'club_association' }).success).toBe(true);
    expect(updateTenantProfileSchema.safeParse({ organizationType: 'Community Centre' }).success).toBe(true);
  });

  it('allows a gym workspace to enable generic attendance without Education admissions', () => {
    const core = ['USERS', 'BRANCHES', 'ORGANIZATION', 'ASSIGNMENTS', 'REPORTS', 'NOTIFICATIONS'];
    const result = provisionTenantSchema.safeParse({
      name: 'Northstar Fitness', organizationType: 'gym_fitness', enabledModules: [...core, 'ATTENDANCE'],
      currency: 'INR', currencySymbol: '₹', currencyMinorUnits: 2, timezone: 'Asia/Kolkata', locale: 'en-IN',
      tenantAdminEmail: 'owner@example.test', tenantAdminFirstName: 'Asha',
    });
    expect(result.success).toBe(true);
  });
});
