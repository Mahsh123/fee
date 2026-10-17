import { Body, Controller, Delete, Get, Headers, Injectable, Module, Param, Patch, Post, Put, Query, UseGuards, UsePipes } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import { accessTierForRoles, CORE_TENANT_MODULES, DEFAULT_ROLE_PERMISSIONS, MANUAL_PAYMENT_METHODS, missingTenantModuleDependencies, PERMISSIONS, PLATFORM_MODULES, PLATFORM_SYSTEM_TENANT_SLUG, platformOperatorHasPermission, ROLE_KEYS, SYSTEM_LEDGER_ACCOUNTS, SYSTEM_ROLE_NAMES, enumLabel, type RoleKey } from '@fee/types';
import { isUniqueViolation, Prisma, type SubscriptionStatus, type TenantStatus, type TransactionClient } from '@fee/database';
import {
  assignUserRolesSchema,
  createPlatformAdminSchema,
  createTenantAdminSchema,
  createTenantUserSchema,
  provisionTenantSchema,
  provisionTenantIdempotencyKeySchema,
  tenantSlugAvailabilitySchema,
  resetTenantUserPasswordSchema,
  updatePlatformAdminProfileSchema,
  updatePlatformAdminRoleSchema,
  updateTenantProfileSchema,
  updateTenantStatusSchema,
  updateTenantEntitlementSchema,
  updateTenantModuleOverrideSchema,
  createTenantDomainSchema,
  createPlanSchema,
  updatePlanSchema,
  createTenantSubscriptionSchema,
  updateTenantSubscriptionStatusSchema,
  updateTenantSubscriptionCancellationSchema,
  issuePlatformInvoiceSchema,
  recordPlatformPaymentSchema,
  requestPlatformRefundSchema,
  updatePlatformRefundStatusSchema,
  updateTenantUserProfileSchema,
  updateTenantUserStatusSchema,
  createBranchSchema,
  updateBranchSchema,
  replaceBranchMembersSchema,
  type AssignUserRolesInput,
  type CreatePlatformAdminInput,
  type CreateTenantAdminInput,
  type CreateTenantUserInput,
  type ProvisionTenantInput,
  type UpdatePlatformAdminProfileInput,
  type UpdatePlatformAdminRoleInput,
  type UpdateTenantProfileInput,
  type UpdateTenantUserProfileInput,
  type UpdateTenantUserStatusInput,
  type CreateBranchInput,
  type UpdateBranchInput,
  type ReplaceBranchMembersInput,
  type UpdateTenantStatusInput,
  type UpdateTenantEntitlementInput,
  type UpdateTenantModuleOverrideInput,
  type CreateTenantDomainInput,
  type CreatePlanInput,
  type UpdatePlanInput,
  type CreateTenantSubscriptionInput,
  type UpdateTenantSubscriptionStatusInput,
  type UpdateTenantSubscriptionCancellationInput,
  type IssuePlatformInvoiceInput,
  type RecordPlatformPaymentInput,
  type RequestPlatformRefundInput,
  type UpdatePlatformRefundStatusInput,
} from '@fee/validation';
import { AppError } from '../common/errors';
import { AuditService } from '../common/financial';
import { buildSearchFilter, paginate, parseListQuery, toPrismaOrderBy, ZodValidationPipe } from '../common/http';
import { PrismaModule, PrismaService } from '../common/prisma.service';
import { PlatformAdminGuard, PasswordService } from '../common/security';
import { TenantContextModule, TenantContextService } from '../common/tenancy';
import { AuthModule } from './auth';
import { AccessModule, AccessService, type AccessMutationAudit } from './access';
import { AppConfigModule, AppConfigService } from '../config/env';
import { OrganizationModule, OrganizationService } from './organization';
import { buildUserInvitationUrl, enqueueUserInvitation } from '../common/invitations';
import { PlatformSubscriptionLifecycleScheduler } from './platform-subscription-lifecycle';

@Injectable()
export class TenantDomainDnsVerifier {
  async verify(domain: string, token: string): Promise<boolean> {
    try {
      const records = await resolveTxt(`_fee-verification.${domain}`);
      const expected = `fee-platform-verification=${token}`;
      return records.some((record) => record.join('') === expected);
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (code === 'ENODATA' || code === 'ENOTFOUND') return false;
      throw new AppError({ code: 'DNS_LOOKUP_UNAVAILABLE', message: 'DNS verification is temporarily unavailable. Retry in a moment.', status: 503 });
    }
  }
}

type ProvisionTenantResult = {
  id: string;
  slug: string;
  name: string;
  organizationType: string;
  enabledModules: string[];
  status: TenantStatus;
  contactEmail: string | null;
  contactPhone: string | null;
  countryCode: string | null;
  trialEndsAt: Date | string | null;
  subscriptionPlan: string | null;
  subscriptionStatus: SubscriptionStatus;
  subscriptionRenewalAt: Date | string | null;
  createdAt: Date | string;
  tenantHost: string;
  tenantAdminEmail: string;
  tenantAdminStatus: 'INVITED';
  tenantAdminInvitationExpiresAt: Date | string;
};

@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly tenantContext: TenantContextService,
    private readonly access: AccessService,
    private readonly organization: OrganizationService,
    private readonly config: AppConfigService,
    private readonly domainVerifier: TenantDomainDnsVerifier,
  ) {}

  async listTenantDomains(tenantId: string) {
    const actor = this.requirePlatformAdmin();
    await this.assertManagedTenant(tenantId);
    return this.withTenantScope(actor, tenantId, async () => {
      const domains = await this.prisma.db.tenantDomain.findMany({ where: { tenantId }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] });
      return domains.map(presentTenantDomain);
    });
  }

  async createTenantDomain(tenantId: string, input: CreateTenantDomainInput) {
    const actor = this.requirePlatformAdmin();
    await this.assertManagedTenant(tenantId);
    const domain = normalizeCustomDomain(input.domain, this.config.tenantBaseDomain);
    const verificationToken = randomBytes(32).toString('hex');
    try {
      return await this.withTenantScope(actor, tenantId, () => this.prisma.transactionWithRetry(async (tx) => {
        const created = await tx.tenantDomain.create({ data: { tenantId, domain, verificationToken } });
        await this.auditPlatformMutation(tx, actor, 'platform.tenant.domain.created', 'TenantDomain', created.id, undefined, { tenantId, domain, verified: false });
        return presentTenantDomain(created);
      }));
    } catch (error) {
      if (isUniqueViolation(error) && uniqueViolationTargets(error, 'domain')) throw AppError.conflict('TENANT_DOMAIN_EXISTS', 'This domain is already registered to a workspace.');
      throw error;
    }
  }

  async rotateTenantDomainChallenge(tenantId: string, domainId: string) {
    const actor = this.requirePlatformAdmin();
    await this.assertManagedTenant(tenantId);
    return this.withTenantScope(actor, tenantId, () => this.prisma.transactionWithRetry(async (tx) => {
      const current = await tx.tenantDomain.findFirst({ where: { id: domainId, tenantId } });
      if (!current) throw AppError.notFound('Tenant domain');
      if (current.verifiedAt) throw AppError.conflict('TENANT_DOMAIN_ALREADY_VERIFIED', 'Remove the verified domain and add it again before changing its ownership challenge.');
      const updated = await tx.tenantDomain.update({ where: { id: domainId }, data: { verificationToken: randomBytes(32).toString('hex') } });
      await this.auditPlatformMutation(tx, actor, 'platform.tenant.domain.challenge_rotated', 'TenantDomain', domainId, { domain: current.domain }, { tenantId, domain: current.domain });
      return presentTenantDomain(updated);
    }));
  }

  async verifyTenantDomain(tenantId: string, domainId: string) {
    const actor = this.requirePlatformAdmin();
    await this.assertManagedTenant(tenantId);
    const current = await this.withTenantScope(actor, tenantId, () => this.prisma.db.tenantDomain.findFirst({ where: { id: domainId, tenantId } }));
    if (!current) throw AppError.notFound('Tenant domain');
    if (current.verifiedAt) return { ...presentTenantDomain(current), verified: true };
    if (!current.verificationToken) throw AppError.conflict('TENANT_DOMAIN_CHALLENGE_REQUIRED', 'Generate a DNS ownership challenge before verification.');
    const verified = await this.domainVerifier.verify(current.domain, current.verificationToken);
    if (!verified) return { ...presentTenantDomain(current), verified: false };
    return this.withTenantScope(actor, tenantId, () => this.prisma.transactionWithRetry(async (tx) => {
      const latest = await tx.tenantDomain.findFirst({ where: { id: domainId, tenantId } });
      if (!latest) throw AppError.notFound('Tenant domain');
      if (latest.verificationToken !== current.verificationToken) throw AppError.conflict('TENANT_DOMAIN_CHALLENGE_CHANGED', 'The DNS challenge changed during verification. Load the latest challenge and retry.');
      if (latest.verifiedAt) return { ...presentTenantDomain(latest), verified: true };
      const updated = await tx.tenantDomain.update({ where: { id: domainId }, data: { verifiedAt: new Date(), verificationToken: null } });
      await this.auditPlatformMutation(tx, actor, 'platform.tenant.domain.verified', 'TenantDomain', domainId, { domain: current.domain, verified: false }, { tenantId, domain: current.domain, verified: true });
      return { ...presentTenantDomain(updated), verified: true };
    }));
  }

  async setPrimaryTenantDomain(tenantId: string, domainId: string) {
    const actor = this.requirePlatformAdmin();
    await this.assertManagedTenant(tenantId);
    return this.withTenantScope(actor, tenantId, () => this.prisma.transactionWithRetry(async (tx) => {
      const current = await tx.tenantDomain.findFirst({ where: { id: domainId, tenantId } });
      if (!current) throw AppError.notFound('Tenant domain');
      if (!current.verifiedAt) throw AppError.conflict('TENANT_DOMAIN_UNVERIFIED', 'Only an ownership-verified domain can become primary.');
      await tx.tenantDomain.updateMany({ where: { tenantId, isPrimary: true }, data: { isPrimary: false } });
      const updated = await tx.tenantDomain.update({ where: { id: domainId }, data: { isPrimary: true } });
      await this.auditPlatformMutation(tx, actor, 'platform.tenant.domain.primary_changed', 'TenantDomain', domainId, { domain: current.domain, isPrimary: current.isPrimary }, { tenantId, domain: current.domain, isPrimary: true });
      return presentTenantDomain(updated);
    }));
  }

  async removeTenantDomain(tenantId: string, domainId: string) {
    const actor = this.requirePlatformAdmin();
    await this.assertManagedTenant(tenantId);
    return this.withTenantScope(actor, tenantId, () => this.prisma.transactionWithRetry(async (tx) => {
      const current = await tx.tenantDomain.findFirst({ where: { id: domainId, tenantId } });
      if (!current) throw AppError.notFound('Tenant domain');
      await tx.tenantDomain.delete({ where: { id: domainId } });
      await this.auditPlatformMutation(tx, actor, 'platform.tenant.domain.removed', 'TenantDomain', domainId, { tenantId, domain: current.domain, verified: Boolean(current.verifiedAt), isPrimary: current.isPrimary }, undefined);
      return { id: domainId, removed: true };
    }));
  }

  private auditPlatformMutation(tx: TransactionClient, actor: { tenantId: string; userId: string }, action: string, entityType: string, entityId: string, before?: Record<string, unknown>, after?: Record<string, unknown>) {
    return this.tenantContext.run({
      tenantId: actor.tenantId, userId: actor.userId, roles: ['PLATFORM_ADMIN'],
      requestId: this.tenantContext.requestId ?? 'platform-domain-change', isPlatformAdmin: true,
    }, () => this.audit.record(tx, { tenantId: actor.tenantId, actorId: actor.userId, action, entityType, entityId, before, after }));
  }

  async listPlans() {
    this.requirePlatformAdmin();
    return this.prisma.db.plan.findMany({
      include: { modules: { orderBy: { moduleKey: 'asc' } }, entitlements: { orderBy: { entitlementKey: 'asc' } }, _count: { select: { subscriptions: true } } },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
  }

  async createPlan(input: CreatePlanInput) {
    const actor = await this.requirePlatformPermission('platform.plan.write');
    try {
      return await this.prisma.transactionWithRetry(async (tx) => {
        const created = await tx.plan.create({
          data: {
            key: input.key,
            name: input.name,
            description: input.description ?? null,
            monthlyPrice: input.monthlyPrice.toFixed(4),
            yearlyPrice: input.yearlyPrice.toFixed(4),
            currency: input.currency,
            trialDays: input.trialDays,
            active: input.active,
            modules: { create: input.modules.map((moduleKey) => ({ moduleKey, enabled: true })) },
            entitlements: { create: input.entitlements.map(({ entitlementKey, limitValue }) => ({ entitlementKey, limitValue })) },
          },
          include: { modules: true, entitlements: true, _count: { select: { subscriptions: true } } },
        });
        await this.audit.record(tx, { tenantId: actor.tenantId, actorId: actor.userId, action: 'platform.plan.created', entityType: 'Plan', entityId: created.id, after: { key: created.key, name: created.name, active: created.active } });
        return created;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict('PLAN_KEY_EXISTS', 'A plan already uses that key. Choose another key.');
      throw error;
    }
  }

  async updatePlan(id: string, input: UpdatePlanInput) {
    const actor = await this.requirePlatformPermission('platform.plan.write');
    return this.prisma.transactionWithRetry(async (tx) => {
      const current = await tx.plan.findUnique({ where: { id }, include: { modules: true, entitlements: true } });
      if (!current) throw AppError.notFound('Plan');
      const isChangingTerms = input.monthlyPrice !== undefined || input.yearlyPrice !== undefined || input.currency !== undefined || input.trialDays !== undefined || input.modules !== undefined || input.entitlements !== undefined;
      const subscriptionCount = isChangingTerms ? await tx.tenantSubscription.count({ where: { planId: id } }) : 0;
      if (subscriptionCount > 0) throw AppError.conflict('PLAN_TERMS_LOCKED', 'This plan has subscription history. Its billing terms and entitlements are immutable; create a new plan key for changed terms.');
      const updated = await tx.plan.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.monthlyPrice !== undefined ? { monthlyPrice: input.monthlyPrice.toFixed(4) } : {}),
          ...(input.yearlyPrice !== undefined ? { yearlyPrice: input.yearlyPrice.toFixed(4) } : {}),
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          ...(input.trialDays !== undefined ? { trialDays: input.trialDays } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          ...(input.modules !== undefined ? { modules: { deleteMany: {}, create: input.modules.map((moduleKey) => ({ moduleKey, enabled: true })) } } : {}),
          ...(input.entitlements !== undefined ? { entitlements: { deleteMany: {}, create: input.entitlements.map(({ entitlementKey, limitValue }) => ({ entitlementKey, limitValue })) } } : {}),
        },
        include: { modules: true, entitlements: true, _count: { select: { subscriptions: true } } },
      });
      await this.audit.record(tx, { tenantId: actor.tenantId, actorId: actor.userId, action: 'platform.plan.updated', entityType: 'Plan', entityId: id, before: { name: current.name, active: current.active }, after: { name: updated.name, active: updated.active } });
      return updated;
    });
  }

  async listTenantSubscriptions(tenantId: string) {
    const actor = this.requirePlatformAdmin();
    await this.assertManagedTenant(tenantId);
    return this.withTenantScope(actor, tenantId, async () => {
      const subscriptions = await this.prisma.db.tenantSubscription.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
      if (subscriptions.length === 0) return [];

      const subscriptionIds = subscriptions.map(({ id }) => id);
      const planIds = [...new Set(subscriptions.map(({ planId }) => planId))];
      const plans = await this.prisma.db.plan.findMany({ where: { id: { in: planIds } }, select: { id: true, key: true, name: true, monthlyPrice: true, yearlyPrice: true, currency: true } });
      const invoices = await this.prisma.db.platformInvoice.findMany({ where: { tenantId, subscriptionId: { in: subscriptionIds } }, orderBy: { issuedAt: 'desc' } });
      const invoiceIds = invoices.map(({ id }) => id);
      const payments = invoiceIds.length
        ? await this.prisma.db.platformPayment.findMany({ where: { tenantId, invoiceId: { in: invoiceIds } }, orderBy: { createdAt: 'desc' } })
        : [];
      const paymentIds = payments.map(({ id }) => id);
      const refunds = paymentIds.length
        ? await this.prisma.db.platformRefund.findMany({ where: { tenantId, paymentId: { in: paymentIds } }, orderBy: { createdAt: 'desc' } })
        : [];

      const plansById = new Map(plans.map((plan) => [plan.id, plan]));
      const invoicesBySubscription = new Map<string, typeof invoices>();
      for (const invoice of invoices) invoicesBySubscription.set(invoice.subscriptionId, [...(invoicesBySubscription.get(invoice.subscriptionId) ?? []), invoice]);
      const paymentsByInvoice = new Map<string, typeof payments>();
      for (const payment of payments) paymentsByInvoice.set(payment.invoiceId, [...(paymentsByInvoice.get(payment.invoiceId) ?? []), payment]);
      const refundsByPayment = new Map<string, typeof refunds>();
      for (const refund of refunds) refundsByPayment.set(refund.paymentId, [...(refundsByPayment.get(refund.paymentId) ?? []), refund]);

      return subscriptions.map((subscription) => ({
        ...subscription,
        plan: plansById.get(subscription.planId) ?? null,
        invoices: (invoicesBySubscription.get(subscription.id) ?? []).map((invoice) => ({
          ...invoice,
          payments: (paymentsByInvoice.get(invoice.id) ?? []).map((payment) => ({
            ...payment,
            refunds: refundsByPayment.get(payment.id) ?? [],
          })),
        })),
      }));
    });
  }

  async createTenantSubscription(tenantId: string, input: CreateTenantSubscriptionInput) {
    const actor = this.requirePlatformAdmin();
    await this.assertManagedTenant(tenantId);
    return this.withTenantScope(actor, tenantId, () => this.prisma.transactionWithRetry(async (tx) => {
      const plan = await tx.plan.findFirst({ where: { id: input.planId, active: true }, include: { modules: { where: { enabled: true } } } });
      if (!plan) throw AppError.validation('Choose an active subscription plan.');
      if (input.startTrial && plan.trialDays <= 0) throw AppError.validation('This plan does not include a trial period.');
      const now = new Date();
      const trialEndsAt = input.startTrial ? new Date(now.getTime() + plan.trialDays * 86_400_000) : null;
      const amount = input.billingInterval === 'YEARLY' ? plan.yearlyPrice : plan.monthlyPrice;
      const current = await tx.tenantSubscription.findFirst({ where: { tenantId, isCurrent: true } });
      if (current) await tx.tenantSubscription.update({ where: { id: current.id }, data: { isCurrent: false, status: 'CANCELLED', cancelledAt: now } });
      const subscription = await tx.tenantSubscription.create({
        data: {
          tenantId,
          planId: plan.id,
          status: trialEndsAt ? 'TRIAL' : 'ACTIVE',
          billingInterval: input.billingInterval,
          amount,
          currency: plan.currency,
          startedAt: now,
          trialEndsAt,
          currentPeriodStart: now,
          currentPeriodEnd: trialEndsAt ?? (input.billingInterval === 'MANUAL' ? null : periodEnd(now, input.billingInterval)),
          createdBy: actor.userId,
        },
        include: { plan: { select: { id: true, key: true, name: true } } },
      });
      const planModules = plan.modules.map(({ moduleKey }) => moduleKey);
      const overrides = await tx.tenantModuleOverride.findMany({ where: { tenantId }, select: { moduleKey: true, enabled: true } });
      const enabledModules = applyModuleOverrides(planModules, overrides);
      const tenantStatus = trialEndsAt ? 'TRIAL' : 'ACTIVE';
      const renewalAt = subscription.currentPeriodEnd;
      await tx.tenant.update({ where: { id: tenantId }, data: { enabledModules, subscriptionPlan: plan.key, subscriptionStatus: subscription.status, trialEndsAt, subscriptionRenewalAt: renewalAt, status: tenantStatus } });
      await this.tenantContext.run({ tenantId: actor.tenantId, userId: actor.userId, roles: ['PLATFORM_ADMIN'], requestId: this.tenantContext.requestId ?? 'platform-subscription-change', isPlatformAdmin: true }, () => this.audit.record(tx, {
        tenantId: actor.tenantId, actorId: actor.userId,
        action: current ? 'platform.subscription.plan_changed' : 'platform.subscription.created',
        entityType: 'TenantSubscription', entityId: subscription.id,
        after: { tenantId, planId: plan.id, planKey: plan.key, billingInterval: input.billingInterval, status: subscription.status, startedAt: now.toISOString() },
      }));
      return subscription;
    }));
  }

  async updateTenantSubscriptionStatus(id: string, input: UpdateTenantSubscriptionStatusInput) {
    const actor = this.requirePlatformAdmin();
    return this.prisma.transactionWithRetry(async (tx) => {
      const current = await tx.tenantSubscription.findFirst({ where: { id, tenant: { slug: { not: PLATFORM_SYSTEM_TENANT_SLUG } } }, include: { tenant: { select: { slug: true } } } });
      if (!current) throw AppError.notFound('Subscription');
      if (!current.isCurrent) throw AppError.conflict('SUBSCRIPTION_NOT_CURRENT', 'Only the current subscription can change lifecycle state.');
      if (!subscriptionTransitionAllowed(current.status, input.status)) throw AppError.conflict('INVALID_SUBSCRIPTION_TRANSITION', `A subscription cannot move from ${current.status} to ${input.status}.`);
      const now = new Date();
      const activatingTrial = input.status === 'ACTIVE' && current.status === 'TRIAL';
      const updated = await tx.tenantSubscription.update({
        where: { id },
        data: {
          status: input.status,
          ...(input.status === 'CANCELLED' ? { isCurrent: false, cancelledAt: now, cancelAtPeriodEnd: false } : {}),
          ...(input.status === 'EXPIRED' ? { isCurrent: false } : {}),
          ...(activatingTrial ? {
            trialEndsAt: null,
            currentPeriodStart: now,
            currentPeriodEnd: current.billingInterval === 'MANUAL' ? null : periodEnd(now, current.billingInterval),
          } : {}),
        },
      });
      const tenantStatus = input.status === 'ACTIVE' || input.status === 'PAST_DUE' ? 'ACTIVE' : input.status === 'TRIAL' ? 'TRIAL' : 'SUSPENDED';
      await tx.tenant.update({ where: { id: current.tenantId }, data: { subscriptionStatus: input.status, status: tenantStatus, ...(activatingTrial ? { trialEndsAt: null } : {}) } });
      await this.audit.record(tx, { tenantId: actor.tenantId, actorId: actor.userId, action: 'platform.subscription.status_changed', entityType: 'TenantSubscription', entityId: id, before: { tenantId: current.tenantId, status: current.status }, after: { tenantId: current.tenantId, status: input.status, reason: input.reason } });
      return updated;
    });
  }

  async updateTenantSubscriptionCancellation(id: string, input: UpdateTenantSubscriptionCancellationInput) {
    const actor = this.requirePlatformAdmin();
    return this.prisma.transactionWithRetry(async (tx) => {
      const current = await tx.tenantSubscription.findFirst({ where: { id, tenant: { slug: { not: PLATFORM_SYSTEM_TENANT_SLUG } } } });
      if (!current) throw AppError.notFound('Subscription');
      if (!current.isCurrent) throw AppError.conflict('SUBSCRIPTION_NOT_CURRENT', 'Only the current subscription can change its cancellation schedule.');
      if (!['TRIAL', 'ACTIVE', 'PAST_DUE'].includes(current.status)) throw AppError.conflict('SUBSCRIPTION_CANNOT_SCHEDULE_CANCELLATION', 'This subscription cannot change its cancellation schedule.');
      if (input.cancelAtPeriodEnd && (!current.currentPeriodEnd || current.currentPeriodEnd <= new Date())) {
        throw AppError.conflict('SUBSCRIPTION_PERIOD_ENDED', 'A cancellation can be scheduled only before the current billing period ends.');
      }
      if (current.cancelAtPeriodEnd === input.cancelAtPeriodEnd) throw AppError.conflict('CANCELLATION_SCHEDULE_UNCHANGED', 'The subscription already has this cancellation schedule.');
      const updated = await tx.tenantSubscription.update({ where: { id }, data: { cancelAtPeriodEnd: input.cancelAtPeriodEnd } });
      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorId: actor.userId,
        action: input.cancelAtPeriodEnd ? 'platform.subscription.cancellation_scheduled' : 'platform.subscription.cancellation_rescinded',
        entityType: 'TenantSubscription',
        entityId: id,
        before: { tenantId: current.tenantId, cancelAtPeriodEnd: current.cancelAtPeriodEnd, currentPeriodEnd: current.currentPeriodEnd?.toISOString() ?? null },
        after: { tenantId: current.tenantId, cancelAtPeriodEnd: input.cancelAtPeriodEnd, reason: input.reason },
      });
      return updated;
    });
  }

  async issuePlatformInvoice(tenantId: string, subscriptionId: string, input: IssuePlatformInvoiceInput) {
    const actor = this.requirePlatformAdmin();
    await this.assertManagedTenant(tenantId);
    return this.withTenantScope(actor, tenantId, () => this.prisma.transactionWithRetry(async (tx) => {
      const subscription = await tx.tenantSubscription.findFirst({
        where: { id: subscriptionId, tenantId, isCurrent: true },
        include: { plan: { select: { id: true, key: true, name: true } } },
      });
      if (!subscription) throw AppError.notFound('Current tenant subscription');
      const outstanding = await tx.platformInvoice.findFirst({ where: { tenantId, subscriptionId, status: { in: ['OPEN', 'PARTIALLY_PAID', 'PAST_DUE'] } }, orderBy: { issuedAt: 'desc' } });
      if (outstanding) return outstanding;
      const now = new Date();
      const periodStart = subscription.currentPeriodEnd && subscription.currentPeriodEnd > now ? subscription.currentPeriodEnd : now;
      const periodFinish = periodEnd(periodStart, subscription.billingInterval);
      const dueAt = input.dueAt ? new Date(input.dueAt) : new Date(now.getTime() + this.config.platformSubscriptionLifecycle.invoiceDueDays * 86_400_000);
      const invoiceNumber = `SAAS-${subscription.id.slice(0, 8).toUpperCase()}-${periodStart.toISOString().slice(0, 10).replaceAll('-', '')}-${randomUUID().slice(0, 6).toUpperCase()}`;
      const invoice = await tx.platformInvoice.create({
        data: {
          tenantId, subscriptionId, invoiceNumber, status: 'OPEN', currency: subscription.currency,
          subtotal: subscription.amount, tax: 0, total: subscription.amount, dueAt,
          lineSnapshot: {
            description: `${subscription.plan.name} subscription`, planId: subscription.plan.id, planKey: subscription.plan.key,
            planName: subscription.plan.name, billingInterval: subscription.billingInterval,
            periodStart: periodStart.toISOString(), periodEnd: periodFinish?.toISOString() ?? null,
            unitAmount: subscription.amount.toString(), tax: '0.0000', total: subscription.amount.toString(),
          },
        },
      });
      await this.tenantContext.run({ tenantId: actor.tenantId, userId: actor.userId, roles: ['PLATFORM_ADMIN'], requestId: this.tenantContext.requestId ?? 'platform-invoice-issued', isPlatformAdmin: true }, () => this.audit.record(tx, {
        tenantId: actor.tenantId, actorId: actor.userId, action: 'platform.invoice.issued', entityType: 'PlatformInvoice', entityId: invoice.id,
        after: { tenantId, subscriptionId, invoiceNumber, currency: invoice.currency, total: invoice.total.toString(), dueAt: invoice.dueAt.toISOString() },
      }));
      return invoice;
    }));
  }

  async recordPlatformPayment(invoiceId: string, input: RecordPlatformPaymentInput) {
    const actor = await this.requirePlatformPermission('platform.billing.write');
    return this.prisma.transactionWithRetry(async (tx) => {
      const invoice = await tx.platformInvoice.findFirst({
        where: { id: invoiceId, tenant: { slug: { not: PLATFORM_SYSTEM_TENANT_SLUG } } },
        include: { payments: { include: { refunds: true } }, subscription: true },
      });
      if (!invoice) throw AppError.notFound('Platform invoice');
      const prior = await tx.platformPayment.findUnique({ where: { tenantId_idempotencyKey: { tenantId: invoice.tenantId, idempotencyKey: input.idempotencyKey } } });
      const amount = new Prisma.Decimal(input.amount.toFixed(4));
      if (prior) {
        if (prior.invoiceId === invoiceId && prior.amount.equals(amount)) return prior;
        throw AppError.conflict('PAYMENT_IDEMPOTENCY_CONFLICT', 'That idempotency key was already used for a different payment.');
      }
      if (!['OPEN', 'PARTIALLY_PAID', 'PAST_DUE'].includes(invoice.status)) throw AppError.conflict('INVOICE_NOT_PAYABLE', 'This invoice is not open for payment.');
      const paid = invoice.payments.filter((payment) => payment.status === 'SUCCEEDED' || payment.status === 'PARTIALLY_REFUNDED' || payment.status === 'REFUNDED').reduce((total, payment) => total.plus(payment.amount), new Prisma.Decimal(0));
      const refunded = invoice.payments.flatMap((payment) => payment.refunds).filter((refund) => refund.status === 'PROCESSED').reduce((total, refund) => total.plus(refund.amount), new Prisma.Decimal(0));
      const remaining = invoice.total.minus(paid).plus(refunded);
      if (remaining.lessThanOrEqualTo(0) || amount.greaterThan(remaining)) throw AppError.validation('Payment exceeds the remaining invoice balance.');
      const payment = await tx.platformPayment.create({
        data: { tenantId: invoice.tenantId, invoiceId, provider: 'MANUAL', providerPaymentId: input.providerPaymentId ?? null, idempotencyKey: input.idempotencyKey, status: 'SUCCEEDED', amount, currency: invoice.currency, paidAt: new Date() },
      });
      const remainingAfter = remaining.minus(amount);
      await tx.platformInvoice.update({ where: { id: invoice.id }, data: { status: remainingAfter.isZero() ? 'PAID' : 'PARTIALLY_PAID', paidAt: remainingAfter.isZero() ? new Date() : null } });
      if (remainingAfter.isZero() && invoice.subscription.isCurrent) {
        const period = invoicePeriod(invoice.lineSnapshot);
        await tx.tenantSubscription.update({ where: { id: invoice.subscriptionId }, data: {
          status: 'ACTIVE', trialEndsAt: null,
          currentPeriodStart: period.start ?? new Date(),
          ...(period.end ? { currentPeriodEnd: period.end } : {}),
        } });
        await tx.tenant.update({ where: { id: invoice.tenantId }, data: {
          status: 'ACTIVE', subscriptionStatus: 'ACTIVE', trialEndsAt: null,
          subscriptionRenewalAt: period.end ?? null,
        } });
      }
      await this.audit.record(tx, { tenantId: actor.tenantId, actorId: actor.userId, action: 'platform.payment.recorded', entityType: 'PlatformPayment', entityId: payment.id, after: { tenantId: invoice.tenantId, invoiceId, provider: 'MANUAL', amount: payment.amount.toString(), currency: payment.currency, idempotencyKey: input.idempotencyKey } });
      return payment;
    });
  }

  async requestPlatformRefund(paymentId: string, input: RequestPlatformRefundInput) {
    const actor = this.requirePlatformAdmin();
    return this.prisma.transactionWithRetry(async (tx) => {
      const payment = await tx.platformPayment.findFirst({ where: { id: paymentId, status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED'] }, invoice: { tenant: { slug: { not: PLATFORM_SYSTEM_TENANT_SLUG } } } }, include: { refunds: true } });
      if (!payment) throw AppError.notFound('Paid platform payment');
      const reserved = payment.refunds.filter((refund) => refund.status === 'REQUESTED' || refund.status === 'PROCESSED').reduce((total, refund) => total.plus(refund.amount), new Prisma.Decimal(0));
      const amount = new Prisma.Decimal(input.amount.toFixed(4));
      if (amount.greaterThan(payment.amount.minus(reserved))) throw AppError.validation('Refund exceeds the unrefunded payment amount.');
      const refund = await tx.platformRefund.create({ data: { tenantId: payment.tenantId, paymentId, amount, currency: payment.currency, reason: input.reason, status: 'REQUESTED', createdBy: actor.userId } });
      await this.audit.record(tx, { tenantId: actor.tenantId, actorId: actor.userId, action: 'platform.refund.requested', entityType: 'PlatformRefund', entityId: refund.id, after: { tenantId: payment.tenantId, paymentId, amount: refund.amount.toString(), currency: refund.currency, reason: refund.reason } });
      return refund;
    });
  }

  async updatePlatformRefundStatus(refundId: string, input: UpdatePlatformRefundStatusInput) {
    const actor = await this.requirePlatformPermission('platform.refund.write');
    return this.prisma.transactionWithRetry(async (tx) => {
      const refund = await tx.platformRefund.findFirst({ where: { id: refundId, tenant: { slug: { not: PLATFORM_SYSTEM_TENANT_SLUG } } } });
      if (!refund) throw AppError.notFound('Platform refund');
      if (refund.status !== 'REQUESTED') throw AppError.conflict('REFUND_ALREADY_PROCESSED', 'Only requested refunds can be updated.');
      const updated = await tx.platformRefund.update({ where: { id: refundId }, data: { status: input.status, externalRefundId: input.status === 'PROCESSED' ? input.externalRefundId : null, processedAt: new Date() } });
      if (input.status === 'PROCESSED') {
        const payment = await tx.platformPayment.findFirst({ where: { id: refund.paymentId, tenantId: refund.tenantId }, include: { refunds: true } });
        if (payment) {
          const processed = payment.refunds.filter((row) => row.id === refundId || row.status === 'PROCESSED').reduce((total, row) => total.plus(row.amount), new Prisma.Decimal(0));
          await tx.platformPayment.update({ where: { id: payment.id }, data: { status: processed.greaterThanOrEqualTo(payment.amount) ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
        }
      }
      await this.audit.record(tx, { tenantId: actor.tenantId, actorId: actor.userId, action: `platform.refund.${input.status.toLowerCase()}`, entityType: 'PlatformRefund', entityId: refundId, before: { tenantId: refund.tenantId, status: refund.status }, after: { tenantId: refund.tenantId, status: input.status, externalRefundId: input.externalRefundId ?? null } });
      return updated;
    });
  }

  async listTenants(raw: Record<string, unknown>) {
    const actor = this.requirePlatformAdmin();
    const query = parseListQuery(raw, { allowedSortFields: ['name', 'slug', 'status', 'subscriptionStatus', 'createdAt'] });
    const validStatuses = new Set<string>(['TRIAL', 'ACTIVE', 'SUSPENDED', 'ARCHIVED']);
    const status = query.status?.filter((entry) => validStatuses.has(entry));
    if (query.status?.some((entry) => !validStatuses.has(entry))) throw AppError.validation('Choose a supported tenant status filter.');
    const validSubscriptionStatuses = new Set<string>(['TRIAL', 'ACTIVE', 'PAST_DUE', 'PAUSED', 'CANCELLED', 'EXPIRED']);
    const subscriptionStatus = typeof raw.subscriptionStatus === 'string' && raw.subscriptionStatus ? raw.subscriptionStatus : undefined;
    if (subscriptionStatus && !validSubscriptionStatuses.has(subscriptionStatus)) throw AppError.validation('Choose a supported subscription status filter.');
    const where = {
      slug: { not: PLATFORM_SYSTEM_TENANT_SLUG },
      ...(status?.length ? { status: { in: status as TenantStatus[] } } : {}),
      ...(subscriptionStatus ? { subscriptionStatus: subscriptionStatus as SubscriptionStatus } : {}),
      ...buildSearchFilter(query.search, ['name', 'slug', 'contactEmail', 'subscriptionPlan']),
    };
    const items = await this.prisma.db.tenant.findMany({
      where,
      select: {
        id: true, slug: true, name: true, organizationType: true, enabledModules: true, status: true, contactEmail: true, contactPhone: true, countryCode: true,
        trialEndsAt: true, subscriptionPlan: true, subscriptionStatus: true, subscriptionRenewalAt: true, createdAt: true, updatedAt: true,
      },
      orderBy: toPrismaOrderBy(query.sort) as never,
      skip: query.skip,
      take: query.take,
    });
    const total = await this.prisma.db.tenant.count({ where });
    const enriched = [];
    for (const tenant of items) {
      const usage = await this.withTenantScope(actor, tenant.id, () => this.tenantUsage(tenant.id, tenant.enabledModules as string[]));
      enriched.push({ ...tenant, tenantHost: tenant.slug + '.' + this.config.tenantBaseDomain, usage });
    }
    return paginate(enriched, total, query);
  }

  async checkTenantSlugAvailability(rawSlug: string) {
    this.requirePlatformAdmin();
    const { slug } = tenantSlugAvailabilitySchema.parse({ slug: rawSlug });
    if (slug === PLATFORM_SYSTEM_TENANT_SLUG || slug === this.config.platformSubdomain.toLowerCase()) {
      return { slug, available: false, reason: 'reserved' as const };
    }
    const tenant = await this.prisma.db.tenant.findUnique({ where: { slug }, select: { id: true } });
    return { slug, available: !tenant, reason: tenant ? 'in_use' as const : null };
  }

  async overview() {
    const actor = this.requirePlatformAdmin();
    return this.prisma.platformDashboardMetrics(actor.tenantId);
  }

  async getTenant(id: string) {
    const actor = this.requirePlatformAdmin();
    const tenant = await this.prisma.db.tenant.findFirst({
      where: { id, slug: { not: PLATFORM_SYSTEM_TENANT_SLUG } },
      select: {
        id: true, slug: true, name: true, organizationType: true, enabledModules: true, status: true, contactEmail: true, contactPhone: true, countryCode: true,
        trialEndsAt: true, subscriptionPlan: true, subscriptionStatus: true, subscriptionRenewalAt: true, createdAt: true, updatedAt: true,
      },
    });
    if (!tenant) throw AppError.notFound('Tenant');
    return {
      ...tenant,
      tenantHost: tenant.slug + '.' + this.config.tenantBaseDomain,
      usage: await this.withTenantScope(actor, tenant.id, () => this.tenantUsage(tenant.id, tenant.enabledModules as string[])),
    };
  }

  async getTenantFeatureAccess(tenantId: string) {
    const actor = this.requirePlatformAdmin();
    await this.assertManagedTenant(tenantId);
    return this.withTenantScope(actor, tenantId, async () => {
      const tenant = await this.prisma.db.tenant.findFirst({ where: { id: tenantId }, select: { enabledModules: true } });
      const subscription = await this.prisma.db.tenantSubscription.findFirst({
        where: { tenantId, isCurrent: true },
        include: { plan: { include: { modules: true, entitlements: true } } },
      });
      const moduleOverrides = await this.prisma.db.tenantModuleOverride.findMany({ where: { tenantId }, orderBy: { moduleKey: 'asc' } });
      const entitlementOverrides = await this.prisma.db.tenantEntitlementOverride.findMany({ where: { tenantId }, orderBy: { entitlementKey: 'asc' } });
      const activeUsers = await this.prisma.db.user.count({ where: { tenantId, deletedAt: null, status: 'ACTIVE', isPlatformAdmin: false } });
      const activeBranches = await this.prisma.db.branch.count({ where: { tenantId, status: { not: 'ARCHIVED' } } });
      if (!tenant) throw AppError.notFound('Tenant');
      const plannedModules = new Map((subscription?.plan.modules ?? []).map(({ moduleKey, enabled }) => [moduleKey, enabled]));
      const moduleOverrideMap = new Map(moduleOverrides.map(({ moduleKey, enabled, reason }) => [moduleKey, { enabled, reason }]));
      const moduleKeys = new Set([...PLATFORM_MODULES, ...plannedModules.keys(), ...moduleOverrideMap.keys(), ...(tenant.enabledModules as string[])]);
      const modules = [...moduleKeys].sort().map((moduleKey) => {
        const override = moduleOverrideMap.get(moduleKey);
        const isCore = (CORE_TENANT_MODULES as readonly string[]).includes(moduleKey);
        const planEnabled = isCore || (plannedModules.has(moduleKey) ? plannedModules.get(moduleKey)! : (tenant.enabledModules as string[]).includes(moduleKey));
        return { moduleKey, planEnabled, enabled: isCore || (override?.enabled ?? (tenant.enabledModules as string[]).includes(moduleKey)), override: override ?? null };
      });
      const planLimits = new Map((subscription?.plan.entitlements ?? []).map(({ entitlementKey, limitValue }) => [entitlementKey, limitValue]));
      const limitOverrides = new Map(entitlementOverrides.map(({ entitlementKey, limitValue, reason }) => [entitlementKey, { limitValue, reason }]));
      const keys = new Set([...planLimits.keys(), ...limitOverrides.keys()]);
      const entitlements = [...keys].sort().map((entitlementKey) => {
        const override = limitOverrides.get(entitlementKey);
        const limit = override ? override.limitValue : planLimits.get(entitlementKey) ?? null;
        const usage = entitlementKey === 'MAX_USERS' ? activeUsers : entitlementKey === 'MAX_BRANCHES' ? activeBranches : null;
        return { entitlementKey, planLimit: planLimits.get(entitlementKey) ?? null, limit, usage, override: override ?? null };
      });
      return { plan: subscription?.plan ?? null, modules, entitlements };
    });
  }

  async updateTenantModuleOverride(tenantId: string, moduleKey: string, input: UpdateTenantModuleOverrideInput) {
    const actor = this.requirePlatformAdmin();
    const normalizedKey = moduleKey.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_.-]{0,79}$/.test(normalizedKey)) throw AppError.validation('Enter a valid module key.');
    if (input.enabled === false && (CORE_TENANT_MODULES as readonly string[]).includes(normalizedKey)) {
      throw AppError.validation('Core workspace modules are always enabled and cannot be disabled.');
    }
    await this.assertManagedTenant(tenantId);
    return this.withPlatformTenantScope(actor, tenantId, () => this.prisma.transactionWithRetry(async (tx) => {
      const existing = await tx.tenantModuleOverride.findUnique({ where: { tenantId_moduleKey: { tenantId, moduleKey: normalizedKey } } });
      if (input.enabled === null) {
        await tx.tenantModuleOverride.deleteMany({ where: { tenantId, moduleKey: normalizedKey } });
      } else {
        await tx.tenantModuleOverride.upsert({
          where: { tenantId_moduleKey: { tenantId, moduleKey: normalizedKey } },
          create: { tenantId, moduleKey: normalizedKey, enabled: input.enabled, reason: input.reason, updatedBy: actor.userId },
          update: { enabled: input.enabled, reason: input.reason, updatedBy: actor.userId },
        });
      }
      const [tenant, subscription, overrides] = await Promise.all([
        tx.tenant.findFirst({ where: { id: tenantId }, select: { enabledModules: true } }),
        tx.tenantSubscription.findFirst({ where: { tenantId, isCurrent: true }, include: { plan: { include: { modules: { where: { enabled: true } } } } } }),
        tx.tenantModuleOverride.findMany({ where: { tenantId }, select: { moduleKey: true, enabled: true } }),
      ]);
      const planModules = subscription?.plan.modules.map(({ moduleKey }) => moduleKey) ?? (tenant?.enabledModules as string[] | undefined) ?? [];
      const enabledModules = applyModuleOverrides(planModules, overrides);
      const dependencyViolations = missingTenantModuleDependencies(enabledModules);
      if (dependencyViolations.length) {
        throw AppError.conflict('MODULE_DEPENDENCY_REQUIRED', `${dependencyViolations.join(', ')} require the Payments module.`);
      }
      await tx.tenant.update({ where: { id: tenantId }, data: { enabledModules } });
      await this.tenantContext.run({ tenantId: actor.tenantId, userId: actor.userId, roles: ['PLATFORM_ADMIN'], requestId: this.tenantContext.requestId ?? 'platform-module-override', isPlatformAdmin: true }, () => this.audit.record(tx, {
        tenantId: actor.tenantId, actorId: actor.userId, action: input.enabled === null ? 'platform.tenant.module_override.cleared' : 'platform.tenant.module_override.updated',
        entityType: 'TenantModuleOverride', entityId: existing?.id ?? `${tenantId}:${normalizedKey}`,
        before: existing ? { tenantId, moduleKey: normalizedKey, enabled: existing.enabled, reason: existing.reason } : undefined,
        after: { tenantId, moduleKey: normalizedKey, enabled: input.enabled, reason: input.reason },
      }));
      return { tenantId, moduleKey: normalizedKey, enabled: input.enabled, enabledModules };
    }));
  }

  async updateTenantEntitlement(tenantId: string, entitlementKey: string, input: UpdateTenantEntitlementInput) {
    const actor = this.requirePlatformAdmin();
    if (!/^[A-Z][A-Z0-9_]{1,99}$/.test(entitlementKey)) throw AppError.validation('Choose a valid uppercase entitlement key.');
    await this.assertManagedTenant(tenantId);
    return this.withTenantScope(actor, tenantId, () => this.prisma.transactionWithRetry(async (tx) => {
      const existing = await tx.tenantEntitlementOverride.findUnique({ where: { tenantId_entitlementKey: { tenantId, entitlementKey } } });
      const updated = input.inherit
        ? null
        : await tx.tenantEntitlementOverride.upsert({
            where: { tenantId_entitlementKey: { tenantId, entitlementKey } },
            create: { tenantId, entitlementKey, limitValue: input.limitValue, reason: input.reason, updatedBy: actor.userId },
            update: { limitValue: input.limitValue, reason: input.reason, updatedBy: actor.userId },
          });
      if (input.inherit) await tx.tenantEntitlementOverride.deleteMany({ where: { tenantId, entitlementKey } });
      await this.tenantContext.run({
        tenantId: actor.tenantId, userId: actor.userId, roles: ['PLATFORM_ADMIN'],
        requestId: this.tenantContext.requestId ?? 'platform-entitlement-override', isPlatformAdmin: true,
      }, () => this.audit.record(tx, {
        tenantId: actor.tenantId, actorId: actor.userId, action: input.inherit ? 'platform.tenant.entitlement.cleared' : 'platform.tenant.entitlement.updated',
        entityType: 'TenantEntitlementOverride', entityId: updated?.id ?? existing?.id ?? `${tenantId}:${entitlementKey}`,
        before: existing ? { tenantId, entitlementKey, limitValue: existing.limitValue, reason: existing.reason } : undefined,
        after: input.inherit ? { tenantId, entitlementKey, inherited: true, reason: input.reason } : { tenantId, entitlementKey, limitValue: updated?.limitValue, reason: updated?.reason },
      }));
      return updated ?? { tenantId, entitlementKey, inherited: true };
    }));
  }

  async provisionTenant(input: ProvisionTenantInput, idempotencyKey: string): Promise<ProvisionTenantResult> {
    const actor = this.requirePlatformAdmin();
    const requestFingerprint = tenantProvisioningFingerprint(input, this.config.jwtSecret);
    const operationWhere = { actorId_idempotencyKey: { actorId: actor.userId, idempotencyKey } };
    const priorOperation = await this.prisma.db.tenantProvisioningOperation.findUnique({ where: operationWhere });
    if (priorOperation) return replayProvisioningOperation(priorOperation, requestFingerprint);

    if (input.slug) {
      const availability = await this.checkTenantSlugAvailability(input.slug);
      if (!availability.available) throw AppError.conflict('TENANT_SLUG_UNAVAILABLE', 'That workspace address is already in use or reserved. Choose another address.');
    }
    const slugBase = input.slug ?? tenantSlugBase(input.name);
    const invitationToken = this.passwords.generateToken();
    const invitationTokenHash = this.passwords.hashToken(invitationToken);
    const invitationExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1_000);
    const passwordHash = await this.passwords.hash(this.passwords.generateToken());

    let suffix = 1;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const slug = input.slug ?? await this.availableSlug(slugBase, suffix);
      try {
        const created = await this.prisma.transactionWithRetry(async (tx) => {
        const availablePermissionKeys = new Set((await tx.permission.findMany({ select: { key: true } })).map((permission) => permission.key));
        if (Object.values(PERMISSIONS).some((key) => !availablePermissionKeys.has(key))) {
          throw AppError.conflict('PERMISSION_CATALOG_NOT_READY', 'The platform permission catalogue has not been seeded. Run the database seed before provisioning tenants.');
        }
        const tenantId = randomUUID();
        const createdTenant = await tx.tenant.create({
          data: {
            id: tenantId,
            slug,
            name: input.name,
            organizationType: input.organizationType,
            enabledModules: input.enabledModules ?? [],
            status: 'TRIAL',
            contactEmail: input.contactEmail ?? null,
            contactPhone: input.contactPhone ?? null,
            countryCode: input.countryCode ?? null,
            subscriptionStatus: 'TRIAL',
            createdBy: actor.userId,
          },
          select: {
            id: true, slug: true, name: true, organizationType: true, enabledModules: true, status: true, contactEmail: true, contactPhone: true, countryCode: true,
            trialEndsAt: true, subscriptionPlan: true, subscriptionStatus: true, subscriptionRenewalAt: true, createdAt: true,
          },
        });

        const created = await this.tenantContext.run(
          // Provisioning is an authenticated platform operation running against
          // a newly-created tenant inside the same transaction. Keep the
          // platform capability for this bounded bootstrap scope: the tenant
          // row itself is platform metadata, while all tenant-owned models are
          // still pinned to `tenantId` by the Prisma extension.
          { tenantId, userId: actor.userId, roles: ['PLATFORM_ADMIN'], requestId: this.tenantContext.requestId ?? 'platform-provision', isPlatformAdmin: true },
          async () => this.provisionTenantWorkspace(tx, {
            tenantId, actorId: actor.userId, passwordHash, invitationTokenHash, invitationExpiresAt,
            acceptUrl: buildUserInvitationUrl(this.config.webAppUrl, `${slug}.${this.config.tenantBaseDomain}`, invitationToken, this.config.isProduction), input,
          }),
        );

        await this.audit.record(tx, {
          tenantId: actor.tenantId,
          actorId: actor.userId,
          action: 'platform.tenant.provisioned',
          entityType: 'Tenant',
          entityId: createdTenant.id,
          after: { slug: createdTenant.slug, name: createdTenant.name, status: createdTenant.status, tenantAdminEmail: created.tenantAdminEmail },
        });
        const response = {
          ...createdTenant,
          tenantHost: createdTenant.slug + '.' + this.config.tenantBaseDomain,
          tenantAdminEmail: created.tenantAdminEmail,
          tenantAdminStatus: 'INVITED' as const,
          tenantAdminInvitationExpiresAt: invitationExpiresAt,
        };
        await tx.tenantProvisioningOperation.create({
          data: {
            id: randomUUID(),
            actorId: actor.userId,
            idempotencyKey,
            requestFingerprint,
            createdTenantId: createdTenant.id,
            result: JSON.parse(JSON.stringify(response)) as Prisma.InputJsonValue,
          },
        });
        return response;
        });
        return created;
      } catch (error) {
        if (isUniqueViolation(error) && uniqueViolationTargets(error, 'idempotencyKey')) {
          const concurrentOperation = await this.prisma.db.tenantProvisioningOperation.findUnique({ where: operationWhere });
          if (concurrentOperation) return replayProvisioningOperation(concurrentOperation, requestFingerprint);
        }
        if (isUniqueViolation(error) && uniqueViolationTargets(error, 'slug')) {
          if (input.slug) throw AppError.conflict('TENANT_SLUG_UNAVAILABLE', 'That workspace address was just claimed. Choose another address and retry.');
          suffix += 1;
          continue;
        }
        if (isUniqueViolation(error)) throw AppError.conflict('TENANT_PROVISION_CONFLICT', 'A tenant or administrator already uses one of these details. Review the workspace address and email, then retry.');
        throw error;
      }
    }
    throw AppError.conflict('TENANT_SLUG_GENERATION_FAILED', 'A unique workspace address could not be generated. Edit the organization name and try again.');
  }

  async updateTenantProfile(id: string, input: UpdateTenantProfileInput) {
    const actor = this.requirePlatformAdmin();
    if (input.slug?.toLowerCase() === this.config.platformSubdomain || input.slug === PLATFORM_SYSTEM_TENANT_SLUG) {
      throw AppError.conflict('RESERVED_TENANT_SLUG', 'That workspace address is reserved by the platform.');
    }
    try {
      return await this.prisma.transactionWithRetry(async (tx) => {
        const current = await tx.tenant.findUnique({ where: { id } });
        if (!current || current.slug === PLATFORM_SYSTEM_TENANT_SLUG) throw AppError.notFound('Tenant');
        const data = {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.organizationType !== undefined ? { organizationType: input.organizationType } : {}),
          ...(input.slug !== undefined ? { slug: input.slug } : {}),
          ...(input.contactEmail !== undefined ? { contactEmail: input.contactEmail } : {}),
          ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone } : {}),
          ...(input.countryCode !== undefined ? { countryCode: input.countryCode } : {}),
          updatedBy: actor.userId,
        };
        const changed = await tx.tenant.updateMany({ where: { id, updatedAt: current.updatedAt }, data });
      if (changed.count !== 1) throw AppError.conflict('TENANT_CHANGED', 'This organization changed while its details were being updated. Reload and retry.');
        const updated = await tx.tenant.findUnique({
          where: { id },
          select: {
            id: true, slug: true, name: true, organizationType: true, enabledModules: true, status: true, contactEmail: true, contactPhone: true, countryCode: true,
            trialEndsAt: true, subscriptionPlan: true, subscriptionStatus: true, subscriptionRenewalAt: true, createdAt: true, updatedAt: true,
          },
        });
        if (!updated) throw AppError.notFound('Tenant');
        await this.audit.record(tx, {
          tenantId: actor.tenantId, actorId: actor.userId, action: 'platform.tenant.updated', entityType: 'Tenant', entityId: id,
          before: { slug: current.slug, name: current.name, organizationType: current.organizationType, contactEmail: current.contactEmail, contactPhone: current.contactPhone, countryCode: current.countryCode, trialEndsAt: current.trialEndsAt, subscriptionPlan: current.subscriptionPlan, subscriptionStatus: current.subscriptionStatus, subscriptionRenewalAt: current.subscriptionRenewalAt },
          after: { slug: updated.slug, name: updated.name, organizationType: updated.organizationType, contactEmail: updated.contactEmail, contactPhone: updated.contactPhone, countryCode: updated.countryCode, trialEndsAt: updated.trialEndsAt, subscriptionPlan: updated.subscriptionPlan, subscriptionStatus: updated.subscriptionStatus, subscriptionRenewalAt: updated.subscriptionRenewalAt },
        });
        return { ...updated, tenantHost: updated.slug + '.' + this.config.tenantBaseDomain };
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict('TENANT_SLUG_EXISTS', 'That workspace address is already in use.');
      throw error;
    }
  }

  async updateTenantStatus(id: string, input: UpdateTenantStatusInput) {
    const actor = this.requirePlatformAdmin();
    return this.prisma.transactionWithRetry(async (tx) => {
      const current = await tx.tenant.findUnique({ where: { id } });
      if (!current || current.slug === PLATFORM_SYSTEM_TENANT_SLUG) throw AppError.notFound('Tenant');
      const changed = await tx.tenant.updateMany({ where: { id, updatedAt: current.updatedAt }, data: { status: input.status, updatedBy: actor.userId } });
      if (changed.count !== 1) throw AppError.conflict('TENANT_CHANGED', 'This tenant changed while the status was being updated. Reload and retry.');
      if (input.status === 'SUSPENDED' || input.status === 'ARCHIVED') {
        await this.tenantContext.run(
          { tenantId: id, userId: actor.userId, requestId: this.tenantContext.requestId ?? 'platform-status-update', isPlatformAdmin: false },
          () => tx.refreshToken.updateMany({ where: { revokedAt: null }, data: { revokedAt: new Date() } }),
        );
      }
      const updated = await tx.tenant.findUnique({ where: { id }, select: { id: true, slug: true, name: true, status: true, contactEmail: true, trialEndsAt: true, subscriptionPlan: true, subscriptionStatus: true, subscriptionRenewalAt: true, createdAt: true } });
      if (!updated) throw AppError.notFound('Tenant');
      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorId: actor.userId,
        action: 'platform.tenant.status_updated',
        entityType: 'Tenant',
        entityId: id,
        before: { status: current.status },
        after: { status: updated.status },
      });
      return { ...updated, tenantHost: updated.slug + '.' + this.config.tenantBaseDomain };
    });
  }

  async listTenantUsers(tenantId: string, raw: Record<string, unknown>) {
    const actor = this.requirePlatformAdmin();
    await this.assertManagedTenant(tenantId);
    return this.withTenantScope(actor, tenantId, () => this.access.listUsers(tenantId, raw));
  }

  async listTenantBranches(tenantId: string, raw: Record<string, unknown>) {
    const actor = this.requirePlatformAdmin();
    await this.assertManagedTenant(tenantId);
    return this.withPlatformTenantScope(actor, tenantId, () => this.organization.listBranches(tenantId, raw));
  }

  async createTenantBranch(tenantId: string, input: CreateBranchInput) {
    const actor = this.requirePlatformAdmin();
    await this.assertManagedTenant(tenantId);
    return this.withPlatformTenantScope(actor, tenantId, () => this.organization.createBranch(tenantId, input));
  }

  async updateTenantBranch(tenantId: string, branchId: string, input: UpdateBranchInput) {
    const actor = this.requirePlatformAdmin();
    await this.assertManagedTenant(tenantId);
    return this.withPlatformTenantScope(actor, tenantId, () => this.organization.updateBranch(tenantId, branchId, input));
  }

  async replaceTenantBranchMembers(tenantId: string, branchId: string, input: ReplaceBranchMembersInput) {
    const actor = this.requirePlatformAdmin();
    await this.assertManagedTenant(tenantId);
    return this.withPlatformTenantScope(actor, tenantId, () => this.organization.replaceBranchMembers(tenantId, branchId, input));
  }

  async listTenantAdmins(tenantId: string, raw: Record<string, unknown>) {
    const actor = this.requirePlatformAdmin();
    await this.assertManagedTenant(tenantId);
    return this.withTenantScope(actor, tenantId, async () => {
      const query = parseListQuery(raw, { allowedSortFields: ['email', 'firstName', 'status', 'createdAt'] });
      const roles = await this.prisma.db.role.findMany({ where: { tenantId, key: { in: ['TENANT_ADMIN', 'TENANT_OWNER'] } }, select: { id: true } });
      const links = roles.length ? await this.prisma.db.userRole.findMany({ where: { tenantId, roleId: { in: roles.map(({ id }) => id) } }, select: { userId: true }, distinct: ['userId'] }) : [];
      const adminIds = [...new Set(links.map(({ userId }) => userId))];
      const statusValues = new Set(['INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED']);
      if (query.status?.some((status) => !statusValues.has(status))) throw AppError.validation('Choose a supported user status filter.');
      if (adminIds.length === 0) return paginate([], 0, query);
      const where = {
        tenantId,
        id: { in: adminIds },
        deletedAt: null,
        ...(query.status?.length ? { status: { in: query.status as Array<'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED'> } } : {}),
        ...buildSearchFilter(query.search, ['email', 'firstName', 'lastName', 'phone']),
      };
      const [users, total] = await Promise.all([
        this.prisma.db.user.findMany({ where, select: { id: true, email: true, phone: true, firstName: true, lastName: true, status: true, mustChangePassword: true, lastLoginAt: true, createdAt: true }, orderBy: toPrismaOrderBy(query.sort) as never, skip: query.skip, take: query.take }),
        this.prisma.db.user.count({ where }),
      ]);
      const userIds = users.map(({ id }) => id);
      const userRoles = userIds.length ? await this.prisma.db.userRole.findMany({ where: { tenantId, userId: { in: userIds } }, select: { userId: true, roleId: true } }) : [];
      const roleIds = [...new Set(userRoles.map(({ roleId }) => roleId))];
      const roleRows = roleIds.length ? await this.prisma.db.role.findMany({ where: { tenantId, id: { in: roleIds } }, select: { id: true, key: true, name: true } }) : [];
      const roleById = new Map(roleRows.map((role) => [role.id, role]));
      const items = users.map((user) => {
        const links = userRoles.filter((link) => link.userId === user.id).flatMap((link) => { const role = roleById.get(link.roleId); return role ? [{ role }] : []; });
        return { ...user, userRoles: links, accessTier: accessTierForRoles(links.map(({ role }) => role.key)) };
      });
      return paginate(items, total, query);
    });
  }

  async listTenantRoles(tenantId: string) {
    const actor = this.requirePlatformAdmin();
    await this.assertManagedTenant(tenantId);
    return this.withTenantScope(actor, tenantId, () => this.access.listRoles(tenantId));
  }

  async createTenantAdmin(tenantId: string, input: CreateTenantAdminInput) {
    const actor = this.requirePlatformAdmin();
    await this.assertManagedTenant(tenantId);
    const roleKey = input.ownership === 'OWNER' ? 'TENANT_OWNER' : 'TENANT_ADMIN';
    if (roleKey === 'TENANT_OWNER') {
      const existingOwner = await this.prisma.db.userRole.findFirst({ where: { tenantId, role: { key: 'TENANT_OWNER' } }, select: { id: true } });
      if (existingOwner) throw AppError.conflict('TENANT_OWNER_EXISTS', 'This workspace already has an owner. Transfer ownership instead of creating a second one.');
    }
    const created = await this.withPlatformTenantScope(actor, tenantId, async () => {
      const role = await this.prisma.db.role.findFirst({ where: { tenantId, key: roleKey }, select: { id: true, name: true } });
      if (!role) throw AppError.conflict('TENANT_ADMIN_ROLE_NOT_READY', 'This workspace does not have its administrator role.');
      return this.access.createUser(tenantId, { ...input, roleIds: [role.id] }, this.platformMutationAudit(actor, tenantId,
        roleKey === 'TENANT_OWNER' ? 'platform.tenant_owner.created' : 'platform.tenant_admin.created', 'User', input.email, { email: input.email, role: roleKey }));
    });
    return { ...created, roles: [{ id: created.roles[0]?.id, key: roleKey, name: roleKey === 'TENANT_OWNER' ? 'Workspace owner' : 'Workspace administrator' }] };
  }

  async resendTenantUserInvitation(tenantId: string, userId: string) {
    const actor = this.requirePlatformAdmin();
    await this.assertManagedTenant(tenantId);
    const tenant = await this.prisma.db.tenant.findFirst({
      where: { id: tenantId },
      select: { id: true, slug: true, name: true, status: true },
    });
    if (!tenant) throw AppError.notFound('Tenant');
    return this.withPlatformTenantScope(actor, tenantId, () => {
      this.tenantContext.establishTenantHost({
        kind: 'tenant', hostname: `${tenant.slug}.${this.config.tenantBaseDomain}`,
        baseDomain: this.config.tenantBaseDomain, tenantId: tenant.id, slug: tenant.slug,
        name: tenant.name, status: tenant.status,
      });
      return this.access.resendInvitation(
        tenantId,
        userId,
        this.platformMutationAudit(actor, tenantId, 'platform.tenant_user.invitation_resent', 'User', userId, { invitationTokenRotated: true }),
      );
    });
  }

  async createTenantUser(tenantId: string, input: CreateTenantUserInput) {
    const actor = this.requirePlatformAdmin();
    await this.assertManagedTenant(tenantId);
    return this.withTenantScope(actor, tenantId, () => this.access.createUser(
      tenantId,
      input,
      this.platformMutationAudit(actor, tenantId, 'platform.tenant_user.created', 'User', input.email, { email: input.email, roleIds: input.roleIds }),
    ));
  }

  async updateTenantUserProfile(tenantId: string, userId: string, input: UpdateTenantUserProfileInput) {
    const actor = this.requirePlatformAdmin();
    await this.assertManagedTenant(tenantId);
    return this.withPlatformTenantScope(actor, tenantId, () => this.access.updateUserProfile(
      tenantId, userId, input,
      this.platformMutationAudit(actor, tenantId, 'platform.tenant_user.profile_updated', 'User', userId, { email: input.email }),
    ));
  }

  async updateTenantUserStatus(tenantId: string, userId: string, input: UpdateTenantUserStatusInput) {
    const actor = this.requirePlatformAdmin();
    await this.assertManagedTenant(tenantId);
    return this.withPlatformTenantScope(actor, tenantId, () => this.access.updateStatus(
      tenantId, userId, input,
      this.platformMutationAudit(actor, tenantId, 'platform.tenant_user.status_updated', 'User', userId, { status: input.status }),
    ));
  }

  async assignTenantUserRoles(tenantId: string, userId: string, input: AssignUserRolesInput) {
    const actor = this.requirePlatformAdmin();
    await this.assertManagedTenant(tenantId);
    return this.withPlatformTenantScope(actor, tenantId, () => this.access.assignRoles(
      tenantId, userId, input,
      this.platformMutationAudit(actor, tenantId, 'platform.tenant_user.roles_updated', 'User', userId, { roleIds: input.roleIds }),
    ));
  }

  async resetTenantUserPassword(tenantId: string, userId: string, input: { temporaryPassword: string }) {
    const actor = this.requirePlatformAdmin();
    await this.assertManagedTenant(tenantId);
    return this.withPlatformTenantScope(actor, tenantId, () => this.access.resetTemporaryPassword(
      tenantId, userId, input.temporaryPassword,
      this.platformMutationAudit(actor, tenantId, 'platform.tenant_user.password_reset', 'User', userId, { mustChangePassword: true }),
    ));
  }

  async listSuperAdmins(raw: Record<string, unknown>) {
    const actor = this.requirePlatformAdmin();
    const query = parseListQuery(raw, { allowedSortFields: ['email', 'firstName', 'status', 'createdAt', 'lastLoginAt'] });
    const validStatuses = new Set(['INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED']);
    if (query.status?.some((status) => !validStatuses.has(status))) throw AppError.validation('Choose a supported administrator status filter.');
    const where = {
      tenantId: actor.tenantId,
      isPlatformAdmin: true,
      deletedAt: null,
      ...(query.status?.length ? { status: { in: query.status as Array<'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED'> } } : {}),
      ...buildSearchFilter(query.search, ['email', 'firstName', 'lastName']),
    };
    const [items, total] = await Promise.all([
      this.prisma.db.user.findMany({
        where,
        select: { id: true, email: true, firstName: true, lastName: true, status: true, mustChangePassword: true, lastLoginAt: true, createdAt: true, invitationExpiresAt: true, emailVerifiedAt: true, platformRole: true },
        orderBy: toPrismaOrderBy(query.sort) as never,
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.db.user.count({ where }),
    ]);
    return paginate(items.map((item) => ({ ...item, accessTier: 'SUPER_ADMIN' as const })), total, query);
  }

  async createSuperAdmin(input: CreatePlatformAdminInput) {
    const actor = await this.requirePlatformPermission('platform.operator.write');
    const token = this.passwords.generateToken();
    const tokenHash = this.passwords.hashToken(token);
    const invitationExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1_000);
    const passwordHash = await this.passwords.hash(this.passwords.generateToken());
    const acceptUrl = buildUserInvitationUrl(this.config.webAppUrl, this.config.platformHostname, token, this.config.isProduction);
    try {
      return await this.prisma.transactionWithRetry(async (tx) => {
        const role = await tx.role.findFirst({ where: { tenantId: actor.tenantId, key: 'PLATFORM_ADMIN' }, select: { id: true } });
        if (!role) throw AppError.conflict('PLATFORM_ADMIN_ROLE_NOT_READY', 'The platform administrator role has not been seeded.');
        const user = await tx.user.create({
          data: {
            tenantId: actor.tenantId,
            email: input.email,
            firstName: input.firstName,
            lastName: input.lastName ?? null,
            passwordHash,
            status: 'INVITED',
            isPlatformAdmin: true,
            platformRole: input.operatorRole ?? 'SUPPORT',
            mustChangePassword: true,
            invitationTokenHash: tokenHash,
            invitationExpiresAt,
            createdBy: actor.userId,
          },
          select: { id: true, email: true, firstName: true, lastName: true, status: true, mustChangePassword: true, createdAt: true, invitationExpiresAt: true, platformRole: true },
        });
        await tx.userRole.create({ data: { tenantId: actor.tenantId, userId: user.id, roleId: role.id, grantedBy: actor.userId } });
        await enqueueUserInvitation(tx, { tenantId: actor.tenantId, userId: user.id, email: user.email, firstName: user.firstName, acceptUrl, tokenHash });
        await this.audit.record(tx, {
          tenantId: actor.tenantId, actorId: actor.userId, action: 'platform.super_admin.invitation_sent', entityType: 'User', entityId: user.id,
          after: { email: user.email, status: user.status, invitationExpiresAt: invitationExpiresAt.toISOString() },
        });
        return user;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict('SUPER_ADMIN_EMAIL_EXISTS', 'A super administrator with this email already exists.');
      throw error;
    }
  }

  async resendSuperAdminInvitation(userId: string) {
    const actor = this.requirePlatformAdmin();
    const token = this.passwords.generateToken();
    const tokenHash = this.passwords.hashToken(token);
    const invitationExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1_000);
    const acceptUrl = buildUserInvitationUrl(this.config.webAppUrl, this.config.platformHostname, token, this.config.isProduction);
    return this.prisma.transactionWithRetry(async (tx) => {
      const current = await tx.user.findFirst({ where: { tenantId: actor.tenantId, id: userId, isPlatformAdmin: true, deletedAt: null } });
      if (!current) throw AppError.notFound('Super administrator');
      if (current.emailVerifiedAt) throw AppError.conflict('PLATFORM_ADMIN_ALREADY_VERIFIED', 'This administrator has already accepted the invitation. Use the password reset action instead.');
      const changed = await tx.user.updateMany({
        where: { tenantId: actor.tenantId, id: userId, isPlatformAdmin: true, status: current.status, updatedAt: current.updatedAt },
        data: { status: 'INVITED', invitationTokenHash: tokenHash, invitationExpiresAt, updatedBy: actor.userId },
      });
      if (changed.count !== 1) throw AppError.conflict('SUPER_ADMIN_CHANGED', 'This administrator changed while the invitation was being sent. Reload and retry.');
      await enqueueUserInvitation(tx, { tenantId: actor.tenantId, userId, email: current.email, firstName: current.firstName, acceptUrl, tokenHash });
      await this.audit.record(tx, {
        tenantId: actor.tenantId, actorId: actor.userId, action: 'platform.super_admin.invitation_resent', entityType: 'User', entityId: userId,
        before: { status: current.status, invitationExpiresAt: current.invitationExpiresAt?.toISOString() ?? null },
        after: { status: 'INVITED', invitationExpiresAt: invitationExpiresAt.toISOString() },
      });
      return { id: current.id, email: current.email, status: 'INVITED' as const, invitationExpiresAt };
    });
  }

  async updateSuperAdminProfile(userId: string, input: UpdatePlatformAdminProfileInput) {
    const actor = this.requirePlatformAdmin();
    try {
      return await this.prisma.transactionWithRetry(async (tx) => {
        const current = await tx.user.findFirst({ where: { tenantId: actor.tenantId, id: userId, isPlatformAdmin: true, deletedAt: null } });
        if (!current) throw AppError.notFound('Super administrator');
        if (input.email && input.email !== current.email) {
          throw AppError.conflict('EMAIL_CHANGE_VERIFICATION_REQUIRED', 'A Super Admin email change must be verified before it can be saved.');
        }
        const changed = await tx.user.updateMany({
          where: { tenantId: actor.tenantId, id: userId, isPlatformAdmin: true, updatedAt: current.updatedAt },
          data: { ...input, ...(input.email && input.email !== current.email ? { sessionVersion: current.sessionVersion + 1 } : {}), updatedBy: actor.userId },
        });
        if (changed.count !== 1) throw AppError.conflict('SUPER_ADMIN_CHANGED', 'This administrator changed while the profile was being updated. Reload and retry.');
        if (input.email && input.email !== current.email) await tx.refreshToken.updateMany({ where: { tenantId: actor.tenantId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
        const updated = await tx.user.findFirst({
          where: { tenantId: actor.tenantId, id: userId, isPlatformAdmin: true },
          select: { id: true, email: true, firstName: true, lastName: true, status: true, mustChangePassword: true, createdAt: true },
        });
        if (!updated) throw AppError.notFound('Super administrator');
        await this.audit.record(tx, { tenantId: actor.tenantId, actorId: actor.userId, action: 'platform.super_admin.profile_updated', entityType: 'User', entityId: userId, before: { email: current.email, firstName: current.firstName, lastName: current.lastName }, after: { email: updated.email, firstName: updated.firstName, lastName: updated.lastName } });
        return updated;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict('SUPER_ADMIN_EMAIL_EXISTS', 'A super administrator with this email already exists.');
      throw error;
    }
  }

  async updateSuperAdminStatus(userId: string, input: UpdateTenantUserStatusInput) {
    const actor = await this.requirePlatformPermission('platform.operator.write');
    return this.prisma.transactionWithRetry(async (tx) => {
      const current = await tx.user.findFirst({ where: { tenantId: actor.tenantId, id: userId, isPlatformAdmin: true, deletedAt: null } });
      if (!current) throw AppError.notFound('Super administrator');
      if (input.status === 'ACTIVE' && !current.emailVerifiedAt) {
        throw AppError.conflict('PLATFORM_ADMIN_INVITATION_REQUIRED', 'An administrator must accept a verified invitation before activation.');
      }
      if (input.status !== 'ACTIVE' && current.status === 'ACTIVE') {
        const activeAdmins = await tx.user.count({ where: { tenantId: actor.tenantId, isPlatformAdmin: true, status: 'ACTIVE', deletedAt: null } });
        if (activeAdmins <= 1) throw AppError.conflict('LAST_SUPER_ADMIN', 'At least one active super administrator must remain.');
      }
      const changed = await tx.user.updateMany({ where: { tenantId: actor.tenantId, id: userId, isPlatformAdmin: true, updatedAt: current.updatedAt }, data: {
        status: input.status, sessionVersion: current.sessionVersion + 1,
        ...(input.status === 'ACTIVE' ? {} : { invitationTokenHash: null, invitationExpiresAt: null, pendingEmail: null, emailChangeTokenHash: null, emailChangeExpiresAt: null }),
        updatedBy: actor.userId,
      } });
      if (changed.count !== 1) throw AppError.conflict('SUPER_ADMIN_CHANGED', 'This administrator changed while the status was being updated. Reload and retry.');
      if (input.status !== 'ACTIVE') await tx.refreshToken.updateMany({ where: { tenantId: actor.tenantId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record(tx, { tenantId: actor.tenantId, actorId: actor.userId, action: 'platform.super_admin.status_updated', entityType: 'User', entityId: userId, before: { status: current.status }, after: { status: input.status } });
      return { id: userId, status: input.status };
    });
  }

  /** Support-tier operators can end platform sessions without touching money or plans. */
  async revokeSuperAdminSessions(userId: string) {
    const actor = await this.requirePlatformPermission('platform.session.revoke');
    const result = await this.prisma.db.refreshToken.updateMany({
      where: { tenantId: actor.tenantId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.prisma.transaction(async (tx) => {
      await this.audit.record(tx, {
        tenantId: actor.tenantId, actorId: actor.userId, action: 'platform.super_admin.sessions_revoked', entityType: 'User', entityId: userId,
        after: { revokedSessions: result.count },
      });
    });
    return { revokedSessions: result.count };
  }

  async updateSuperAdminRole(userId: string, input: UpdatePlatformAdminRoleInput) {
    const actor = await this.requirePlatformPermission('platform.operator.write');
    return this.prisma.transactionWithRetry(async (tx) => {
      const current = await tx.user.findFirst({ where: { tenantId: actor.tenantId, id: userId, isPlatformAdmin: true, deletedAt: null }, select: { id: true, platformRole: true } });
      if (!current) throw AppError.notFound('Super administrator');
      if (current.id === actor.userId && input.operatorRole !== 'OWNER') {
        const owners = await tx.user.count({ where: { tenantId: actor.tenantId, isPlatformAdmin: true, status: 'ACTIVE', platformRole: 'OWNER', deletedAt: null } });
        if (owners <= 1) throw AppError.conflict('LAST_PLATFORM_OWNER', 'Keep at least one platform owner before changing your own operator tier.');
      }
      await tx.user.update({ where: { id: userId }, data: { platformRole: input.operatorRole, sessionVersion: { increment: 1 }, updatedBy: actor.userId } });
      await tx.refreshToken.updateMany({ where: { tenantId: actor.tenantId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record(tx, {
        tenantId: actor.tenantId, actorId: actor.userId, action: 'platform.super_admin.role_updated', entityType: 'User', entityId: userId,
        before: { platformRole: current.platformRole }, after: { platformRole: input.operatorRole },
      });
      return { id: userId, platformRole: input.operatorRole };
    });
  }

  async resetSuperAdminPassword(userId: string, input: { temporaryPassword: string }) {
    const actor = await this.requirePlatformPermission('platform.operator.write');
    const passwordHash = await this.passwords.hash(input.temporaryPassword);
    return this.prisma.transactionWithRetry(async (tx) => {
      const current = await tx.user.findFirst({ where: { tenantId: actor.tenantId, id: userId, isPlatformAdmin: true, deletedAt: null } });
      if (!current) throw AppError.notFound('Super administrator');
      const changed = await tx.user.updateMany({ where: { tenantId: actor.tenantId, id: userId, isPlatformAdmin: true, updatedAt: current.updatedAt }, data: { passwordHash, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null, pendingEmail: null, emailChangeTokenHash: null, emailChangeExpiresAt: null, sessionVersion: current.sessionVersion + 1, updatedBy: actor.userId } });
      if (changed.count !== 1) throw AppError.conflict('SUPER_ADMIN_CHANGED', 'This administrator changed while the password was being reset. Reload and retry.');
      await tx.refreshToken.updateMany({ where: { tenantId: actor.tenantId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record(tx, { tenantId: actor.tenantId, actorId: actor.userId, action: 'platform.super_admin.password_reset', entityType: 'User', entityId: userId, after: { mustChangePassword: true } });
      return { id: userId, mustChangePassword: true };
    });
  }

  private async tenantUsage(tenantId: string, enabledModules: readonly string[]) {
    const roles = await this.prisma.db.role.findMany({
      where: { tenantId, key: { in: ['TENANT_ADMIN', 'TENANT_OWNER'] } },
      select: { id: true },
    });
    const adminLinks = roles.length
      ? await this.prisma.db.userRole.findMany({ where: { tenantId, roleId: { in: roles.map(({ id }) => id) } }, select: { userId: true }, distinct: ['userId'] })
      : [];
    const adminIds = [...new Set(adminLinks.map(({ userId }) => userId))];
    // These aggregates run once for each tenant in the platform directory. Keep
    // them sequential so a full page does not open dozens of simultaneous Neon
    // connections and starve authentication and host-resolution reads.
    const totalUsers = await this.prisma.db.user.count({ where: { tenantId, deletedAt: null } });
    const activeUsers = await this.prisma.db.user.count({ where: { tenantId, deletedAt: null, status: 'ACTIVE' } });
    const activeTenantAdmins = adminIds.length
      ? await this.prisma.db.user.count({ where: { tenantId, id: { in: adminIds }, deletedAt: null, status: 'ACTIVE' } })
      : 0;
    const branches = await this.prisma.db.branch.count({ where: { tenantId, status: { not: 'ARCHIVED' } } });
    const organizationUnits = await this.prisma.db.organizationUnit.count({ where: { tenantId, active: true } });
    const payments = enabledModules.includes('PAYMENTS')
      ? await this.prisma.db.payment.count({ where: { tenantId } })
      : null;
    const recentSignIn = await this.prisma.db.user.findFirst({ where: { tenantId, deletedAt: null, lastLoginAt: { not: null } }, orderBy: { lastLoginAt: 'desc' }, select: { lastLoginAt: true } });
    return {
      totalUsers,
      activeUsers,
      activeTenantAdmins,
      branches,
      organizationUnits,
      recordedPayments: payments,
      latestSignInAt: recentSignIn?.lastLoginAt ?? null,
    };
  }

  private async availableSlug(base: string, firstSuffix: number): Promise<string> {
    for (let index = firstSuffix; index < firstSuffix + 10_000; index += 1) {
      const suffix = index === 1 ? '' : '-' + index;
      const candidate = base.slice(0, Math.max(2, 63 - suffix.length)).replace(/-+$/g, '') + suffix;
      if (candidate === PLATFORM_SYSTEM_TENANT_SLUG || candidate === this.config.platformSubdomain) continue;
      const existing = await this.prisma.db.tenant.findUnique({ where: { slug: candidate }, select: { id: true } });
      if (!existing) return candidate;
    }
    throw AppError.conflict('TENANT_SLUG_GENERATION_FAILED', 'A unique workspace address could not be generated. Edit the organization name and try again.');
  }

  private async assertManagedTenant(tenantId: string) {
    const tenant = await this.prisma.db.tenant.findFirst({
      where: { id: tenantId, slug: { not: PLATFORM_SYSTEM_TENANT_SLUG } },
      select: { id: true },
    });
    if (!tenant) throw AppError.notFound('Tenant');
  }

  private withTenantScope<T>(actor: { tenantId: string; userId: string }, tenantId: string, work: () => T): T {
    return this.tenantContext.run({
      tenantId,
      userId: actor.userId,
      roles: [],
      requestId: this.tenantContext.requestId ?? 'platform-tenant-operation',
      isPlatformAdmin: false,
    }, work);
  }

  private withPlatformTenantScope<T>(actor: { tenantId: string; userId: string }, tenantId: string, work: () => T): T {
    return this.tenantContext.run({
      tenantId,
      userId: actor.userId,
      roles: ['PLATFORM_ADMIN'],
      requestId: this.tenantContext.requestId ?? 'platform-tenant-branch-operation',
      isPlatformAdmin: true,
      actingAsTenantId: tenantId,
    }, work);
  }

  private platformMutationAudit(
    actor: { tenantId: string; userId: string },
    targetTenantId: string,
    action: string,
    entityType: string,
    entityId: string,
    after: Record<string, unknown>,
  ): AccessMutationAudit {
    return (tx) => this.tenantContext.run({
      tenantId: actor.tenantId,
      userId: actor.userId,
      roles: ['PLATFORM_ADMIN'],
      requestId: this.tenantContext.requestId ?? 'platform-tenant-user-mutation',
      isPlatformAdmin: true,
    }, () => this.audit.record(tx, {
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action,
      entityType,
      entityId,
      after: { tenantId: targetTenantId, ...after },
    }));
  }

  private async provisionTenantWorkspace(
    tx: TransactionClient,
    context: { tenantId: string; actorId: string; passwordHash: string; invitationTokenHash: string; invitationExpiresAt: Date; acceptUrl: string; input: ProvisionTenantInput },
  ): Promise<{ tenantAdminEmail: string }> {
    const { tenantId, actorId, passwordHash, invitationTokenHash, invitationExpiresAt, acceptUrl, input } = context;
    const plan = input.planId
      ? await tx.plan.findFirst({ where: { id: input.planId, active: true }, include: { modules: { where: { enabled: true } } } })
      : await tx.plan.findFirst({ where: { key: 'starter', active: true }, include: { modules: { where: { enabled: true } } } });
    if (!plan) throw AppError.validation(input.planId ? 'Choose an active subscription plan.' : 'The default starter plan is unavailable. Create or activate a plan before provisioning tenants.');
    const interval = input.billingInterval ?? 'MONTHLY';
    const amount = interval === 'YEARLY' ? plan.yearlyPrice : plan.monthlyPrice;
    const now = new Date();
    const trialEndsAt = plan.trialDays > 0 ? new Date(now.getTime() + plan.trialDays * 86_400_000) : null;
    const status = trialEndsAt ? 'TRIAL' : 'ACTIVE';
    const renewalAt = trialEndsAt ?? (interval === 'MANUAL' ? null : periodEnd(now, interval));
    const enabledModules = plan.modules.map(({ moduleKey }) => moduleKey);
    const selectedModules = input.enabledModules ?? [...CORE_TENANT_MODULES];
    if (CORE_TENANT_MODULES.some((moduleKey) => !enabledModules.includes(moduleKey))) {
      throw AppError.validation('The selected plan is missing a required core workspace module. Update the plan before provisioning a tenant.');
    }
    if (CORE_TENANT_MODULES.some((moduleKey) => !selectedModules.includes(moduleKey))) {
      throw AppError.validation('Core workspace modules cannot be disabled.');
    }
    if (selectedModules.some((moduleKey) => !enabledModules.includes(moduleKey))) {
      throw AppError.validation('Choose only modules included in the selected subscription plan.');
    }
    if ((selectedModules.includes('FEES') || selectedModules.includes('PORTAL')) && !selectedModules.includes('PAYMENTS')) {
      throw AppError.validation('The selected fee and payer-portal modules require the payments module.');
    }
    await tx.tenant.update({ where: { id: tenantId }, data: { enabledModules: selectedModules, subscriptionPlan: plan.key, subscriptionStatus: status, trialEndsAt, subscriptionRenewalAt: renewalAt, status: trialEndsAt ? 'TRIAL' : 'ACTIVE' } });
    const disabledPlanModules = enabledModules.filter((moduleKey) => !selectedModules.includes(moduleKey));
    if (disabledPlanModules.length) await tx.tenantModuleOverride.createMany({ data: disabledPlanModules.map((moduleKey) => ({ tenantId, moduleKey, enabled: false, reason: 'Not selected during workspace provisioning.', updatedBy: actorId })) });
    await tx.tenantSubscription.create({
      data: {
        tenantId,
        planId: plan.id,
        status,
        billingInterval: interval,
        amount,
        currency: plan.currency,
        startedAt: now,
        trialEndsAt,
        currentPeriodStart: now,
        currentPeriodEnd: renewalAt,
        createdBy: actorId,
      },
    });
    await tx.tenantSettings.create({
      data: {
        tenantId,
        currency: input.currency,
        currencySymbol: input.currencySymbol,
        currencyMinorUnits: input.currencyMinorUnits,
        timezone: input.timezone,
        locale: input.locale,
      },
    });
    await tx.tenantBranding.create({ data: { tenantId, organizationName: input.name } });
    await tx.tenantNumberingSettings.create({ data: { tenantId } });

    const roleKeys = tenantRoleKeys(selectedModules);
    await tx.role.createMany({
      data: roleKeys.map((key) => ({ tenantId, key, name: SYSTEM_ROLE_NAMES[key], isSystem: true, permissionsConfigured: true })),
    });
    const roles = await tx.role.findMany({ where: { tenantId }, select: { id: true, key: true } });
    const permissions = await tx.permission.findMany({ select: { id: true, key: true } });
    const permissionIdByKey = new Map(permissions.map((permission) => [permission.key, permission.id]));
    if (Object.values(PERMISSIONS).some((key) => !permissionIdByKey.has(key))) {
      throw AppError.conflict('PERMISSION_CATALOG_NOT_READY', 'The platform permission catalogue is incomplete. Run the database seed before provisioning tenants.');
    }
    const roleLinks = roles.flatMap((role) =>
      (DEFAULT_ROLE_PERMISSIONS[role.key as RoleKey] ?? []).flatMap((key) => {
        const permissionId = permissionIdByKey.get(key);
        return permissionId ? [{ tenantId, roleId: role.id, permissionId }] : [];
      }),
    );
    if (roleLinks.length) await tx.rolePermission.createMany({ data: roleLinks, skipDuplicates: true });

    // The first account is the accountable workspace owner, not a peer
    // administrator: ownership is what makes transfer and owner-only controls
    // reachable at all.
    const adminRole = roles.find((role) => role.key === 'TENANT_OWNER') ?? roles.find((role) => role.key === 'TENANT_ADMIN');
    if (!adminRole) throw new Error('The workspace owner role could not be initialized.');
    const owner = await tx.user.create({
      data: {
        tenantId,
        email: input.tenantAdminEmail,
        firstName: input.tenantAdminFirstName,
        lastName: input.tenantAdminLastName ?? null,
        passwordHash,
        status: 'INVITED',
        mustChangePassword: true,
        invitationTokenHash,
        invitationExpiresAt,
        createdBy: actorId,
      },
      select: { id: true, email: true },
    });
    await tx.userRole.create({ data: { tenantId, userId: owner.id, roleId: adminRole.id } });
    const branch = await tx.branch.create({ data: { tenantId, code: 'MAIN', name: 'Main branch', managerId: owner.id, enabledModules } });
    await tx.userBranchMembership.create({ data: { tenantId, userId: owner.id, branchId: branch.id, isPrimary: true } });
    await enqueueUserInvitation(tx, { tenantId, userId: owner.id, email: owner.email, firstName: input.tenantAdminFirstName, acceptUrl, tokenHash: invitationTokenHash });

    if (selectedModules.includes('PAYMENTS')) {
      await tx.ledgerAccount.createMany({
        data: Object.entries(SYSTEM_LEDGER_ACCOUNTS).map(([systemKey, account]) => ({
          tenantId,
          systemKey,
          code: account.code,
          name: account.name,
          type: account.type,
          isSystem: true,
        })),
      });
      await tx.paymentMethod.createMany({
        data: MANUAL_PAYMENT_METHODS.map((kind, index) => ({ tenantId, kind, code: kind, name: enumLabel(kind), enabledForManual: true, sortOrder: index })),
      });
    }

    await this.audit.record(tx, {
      tenantId,
      actorId,
      action: 'tenant.workspace.initialized',
      entityType: 'Tenant',
      entityId: tenantId,
      after: { ownerEmail: owner.email, systemRoleCount: roles.length, paymentMethodCount: selectedModules.includes('PAYMENTS') ? MANUAL_PAYMENT_METHODS.length : 0, enabledModules: selectedModules },
    });
    return { tenantAdminEmail: owner.email };
  }

  private requirePlatformAdmin() {
    const context = this.tenantContext.require();
    if (!context.isPlatformAdmin || !context.userId || !context.roles?.includes('PLATFORM_ADMIN')) throw AppError.forbidden('Super administrator access is required.');
    return { tenantId: context.tenantId, userId: context.userId };
  }

  /**
   * Platform operators are tiered. Reads stay open to any operator; money,
   * plan, and operator-account changes are checked against the stored tier so a
   * read-only support account cannot issue invoices or mint another owner.
   */
  private async requirePlatformPermission(permission: string) {
    const actor = this.requirePlatformAdmin();
    const user = await this.prisma.db.user.findUnique({ where: { id: actor.userId }, select: { platformRole: true } });
    if (!platformOperatorHasPermission(user?.platformRole, permission)) {
      throw AppError.forbidden('Your platform operator tier does not allow this action.');
    }
    return actor;
  }

  /**
   * The platform audit trail is the reserved workspace's own hash-chained log.
   * Platform mutations are written there with an actor, so an operator can
   * review control-plane activity without opening every tenant.
   */
  async listPlatformAudit(raw: Record<string, unknown>) {
    const actor = this.requirePlatformAdmin();
    const page = Math.max(1, Number.parseInt(String(raw.page ?? '1'), 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(raw.pageSize ?? '25'), 10) || 25));
    const action = typeof raw.action === 'string' && raw.action.trim() ? raw.action.trim().slice(0, 120) : null;
    const search = typeof raw.search === 'string' && raw.search.trim() ? raw.search.trim().slice(0, 200) : null;
    const where: Prisma.AuditLogWhereInput = {
      tenantId: actor.tenantId,
      ...(action ? { action } : {}),
      ...(search ? { OR: [{ action: { contains: search, mode: 'insensitive' } }, { entityRef: { contains: search, mode: 'insensitive' } }, { actorEmail: { contains: search, mode: 'insensitive' } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.db.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { id: true, actorId: true, actorType: true, actorEmail: true, action: true, entityType: true, entityId: true, entityRef: true, severity: true, reason: true, createdAt: true },
      }),
      this.prisma.db.auditLog.count({ where }),
    ]);
    return { items, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }
}

@ApiTags('platform administration')
@Controller('platform/tenants')
@UseGuards(PlatformAdminGuard)
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get()
  @ApiOperation({ summary: 'List tenant workspaces on the platform' })
  list(@Query() query: Record<string, unknown>) { return this.platform.listTenants(query); }

  @Get('slug-availability')
  @UsePipes(new ZodValidationPipe(tenantSlugAvailabilitySchema, 'query'))
  @ApiOperation({ summary: 'Check whether a workspace slug is valid and available' })
  checkSlug(@Query() query: { slug: string }) { return this.platform.checkTenantSlugAvailability(query.slug); }

  @Get(':id')
  @ApiOperation({ summary: 'Read an organization profile, subscription and usage summary' })
  get(@Param('id') id: string) { return this.platform.getTenant(id); }

  @Get(':id/features')
  @ApiOperation({ summary: 'Read plan features and tenant overrides' })
  features(@Param('id') id: string) { return this.platform.getTenantFeatureAccess(id); }

  @Get(':id/branches')
  @ApiOperation({ summary: 'List branches in a selected tenant workspace' })
  branches(@Param('id') id: string, @Query() query: Record<string, unknown>) { return this.platform.listTenantBranches(id, query); }

  @Post(':id/branches')
  @UsePipes(new ZodValidationPipe(createBranchSchema))
  @ApiOperation({ summary: 'Create a branch in a selected tenant workspace' })
  createBranch(@Param('id') id: string, @Body() body: CreateBranchInput) { return this.platform.createTenantBranch(id, body); }

  @Patch(':id/branches/:branchId')
  @UsePipes(new ZodValidationPipe(updateBranchSchema))
  @ApiOperation({ summary: 'Update a branch in a selected tenant workspace' })
  updateBranch(@Param('id') id: string, @Param('branchId') branchId: string, @Body() body: UpdateBranchInput) { return this.platform.updateTenantBranch(id, branchId, body); }

  @Put(':id/branches/:branchId/users')
  @UsePipes(new ZodValidationPipe(replaceBranchMembersSchema))
  @ApiOperation({ summary: 'Replace branch membership within a selected tenant workspace' })
  replaceBranchMembers(@Param('id') id: string, @Param('branchId') branchId: string, @Body() body: ReplaceBranchMembersInput) { return this.platform.replaceTenantBranchMembers(id, branchId, body); }

  @Get(':id/domains')
  @ApiOperation({ summary: 'List tenant custom domains and DNS verification instructions' })
  domains(@Param('id') id: string) { return this.platform.listTenantDomains(id); }

  @Post(':id/domains')
  @UsePipes(new ZodValidationPipe(createTenantDomainSchema))
  @ApiOperation({ summary: 'Register an unverified tenant custom domain and issue a DNS ownership challenge' })
  addDomain(@Param('id') id: string, @Body() body: CreateTenantDomainInput) { return this.platform.createTenantDomain(id, body); }

  @Post(':id/domains/:domainId/challenge')
  @ApiOperation({ summary: 'Rotate an unverified custom domain DNS challenge' })
  rotateDomainChallenge(@Param('id') id: string, @Param('domainId') domainId: string) { return this.platform.rotateTenantDomainChallenge(id, domainId); }

  @Post(':id/domains/:domainId/verify')
  @ApiOperation({ summary: 'Verify the custom domain TXT ownership challenge' })
  verifyDomain(@Param('id') id: string, @Param('domainId') domainId: string) { return this.platform.verifyTenantDomain(id, domainId); }

  @Put(':id/domains/:domainId/primary')
  @ApiOperation({ summary: 'Set a verified custom domain as the primary hostname' })
  setPrimaryDomain(@Param('id') id: string, @Param('domainId') domainId: string) { return this.platform.setPrimaryTenantDomain(id, domainId); }

  @Delete(':id/domains/:domainId')
  @ApiOperation({ summary: 'Remove a custom domain from the tenant' })
  removeDomain(@Param('id') id: string, @Param('domainId') domainId: string) { return this.platform.removeTenantDomain(id, domainId); }

  @Post()
  @UsePipes(new ZodValidationPipe(provisionTenantSchema))
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Opaque key reused for retries of the same tenant provisioning request.' })
  @ApiOperation({ summary: 'Generate a tenant subdomain and atomically provision its administrator, roles, settings, and selected modules' })
  create(@Body() body: ProvisionTenantInput, @Headers('idempotency-key') idempotencyKey?: string) {
    const key = provisionTenantIdempotencyKeySchema.safeParse(idempotencyKey);
    if (!key.success) {
      throw AppError.validation('Provide a valid Idempotency-Key header (16–200 letters, numbers, dots, underscores, tildes, or hyphens).', [
        { path: 'Idempotency-Key', message: key.error.issues[0]?.message ?? 'A valid idempotency key is required.', code: 'invalid_string' },
      ]);
    }
    return this.platform.provisionTenant(body, key.data);
  }

  @Patch(':id')
  @UsePipes(new ZodValidationPipe(updateTenantProfileSchema))
  @ApiOperation({ summary: 'Update an organization profile and administrative subscription metadata' })
  update(@Param('id') id: string, @Body() body: UpdateTenantProfileInput) { return this.platform.updateTenantProfile(id, body); }

  @Patch(':id/status')
  @UsePipes(new ZodValidationPipe(updateTenantStatusSchema))
  @ApiOperation({ summary: 'Update a tenant workspace lifecycle status' })
  setStatus(@Param('id') id: string, @Body() body: UpdateTenantStatusInput) { return this.platform.updateTenantStatus(id, body); }

  @Put(':id/entitlements/:key')
  @UsePipes(new ZodValidationPipe(updateTenantEntitlementSchema))
  @ApiOperation({ summary: 'Set or clear a tenant-specific entitlement limit override; null means unlimited' })
  setEntitlement(@Param('id') id: string, @Param('key') key: string, @Body() body: UpdateTenantEntitlementInput) { return this.platform.updateTenantEntitlement(id, key, body); }

  @Put(':id/modules/:key')
  @UsePipes(new ZodValidationPipe(updateTenantModuleOverrideSchema))
  @ApiOperation({ summary: 'Set or clear an audited tenant module override and synchronize enabled module projection' })
  setModuleOverride(@Param('id') id: string, @Param('key') key: string, @Body() body: UpdateTenantModuleOverrideInput) { return this.platform.updateTenantModuleOverride(id, key, body); }

}

@ApiTags('platform administration')
@Controller('platform')
@UseGuards(PlatformAdminGuard)
export class PlatformDirectoryController {
  constructor(private readonly platform: PlatformService) {}

  @Get('overview') overview() { return this.platform.overview(); }
  @Get('plans') listPlans() { return this.platform.listPlans(); }
  @Post('plans') @UsePipes(new ZodValidationPipe(createPlanSchema)) createPlan(@Body() body: CreatePlanInput) { return this.platform.createPlan(body); }
  @Patch('plans/:id') @UsePipes(new ZodValidationPipe(updatePlanSchema)) updatePlan(@Param('id') id: string, @Body() body: UpdatePlanInput) { return this.platform.updatePlan(id, body); }
  @Get('tenants/:tenantId/subscriptions') listTenantSubscriptions(@Param('tenantId') id: string) { return this.platform.listTenantSubscriptions(id); }
  @Post('tenants/:tenantId/subscriptions') @UsePipes(new ZodValidationPipe(createTenantSubscriptionSchema)) createTenantSubscription(@Param('tenantId') id: string, @Body() body: CreateTenantSubscriptionInput) { return this.platform.createTenantSubscription(id, body); }
  @Post('tenants/:tenantId/subscriptions/:subscriptionId/invoices') @UsePipes(new ZodValidationPipe(issuePlatformInvoiceSchema)) issueInvoice(@Param('tenantId') tenantId: string, @Param('subscriptionId') subscriptionId: string, @Body() body: IssuePlatformInvoiceInput) { return this.platform.issuePlatformInvoice(tenantId, subscriptionId, body); }
  @Patch('subscriptions/:id/status') @UsePipes(new ZodValidationPipe(updateTenantSubscriptionStatusSchema)) updateSubscriptionStatus(@Param('id') id: string, @Body() body: UpdateTenantSubscriptionStatusInput) { return this.platform.updateTenantSubscriptionStatus(id, body); }
  @Patch('subscriptions/:id/cancellation') @UsePipes(new ZodValidationPipe(updateTenantSubscriptionCancellationSchema)) updateSubscriptionCancellation(@Param('id') id: string, @Body() body: UpdateTenantSubscriptionCancellationInput) { return this.platform.updateTenantSubscriptionCancellation(id, body); }
  @Post('invoices/:invoiceId/payments') @UsePipes(new ZodValidationPipe(recordPlatformPaymentSchema)) recordPayment(@Param('invoiceId') id: string, @Body() body: RecordPlatformPaymentInput) { return this.platform.recordPlatformPayment(id, body); }
  @Post('payments/:paymentId/refunds') @UsePipes(new ZodValidationPipe(requestPlatformRefundSchema)) requestRefund(@Param('paymentId') id: string, @Body() body: RequestPlatformRefundInput) { return this.platform.requestPlatformRefund(id, body); }
  @Patch('refunds/:refundId/status') @UsePipes(new ZodValidationPipe(updatePlatformRefundStatusSchema)) updateRefundStatus(@Param('refundId') id: string, @Body() body: UpdatePlatformRefundStatusInput) { return this.platform.updatePlatformRefundStatus(id, body); }
  @Get('tenants/:tenantId/users') listTenantUsers(@Param('tenantId') id: string, @Query() query: Record<string, unknown>) { return this.platform.listTenantUsers(id, query); }
  @Get('tenants/:tenantId/admins') listTenantAdmins(@Param('tenantId') id: string, @Query() query: Record<string, unknown>) { return this.platform.listTenantAdmins(id, query); }
  @Get('tenants/:tenantId/roles') listTenantRoles(@Param('tenantId') id: string) { return this.platform.listTenantRoles(id); }
  @Post('tenants/:tenantId/admins') @UsePipes(new ZodValidationPipe(createTenantAdminSchema)) createTenantAdmin(@Param('tenantId') id: string, @Body() body: CreateTenantAdminInput) { return this.platform.createTenantAdmin(id, body); }
  @Post('tenants/:tenantId/users/:userId/invitation') resendTenantUserInvitation(@Param('tenantId') tenantId: string, @Param('userId') userId: string) { return this.platform.resendTenantUserInvitation(tenantId, userId); }
  @Patch('tenants/:tenantId/users/:userId') @UsePipes(new ZodValidationPipe(updateTenantUserProfileSchema)) updateTenantUser(@Param('tenantId') tenantId: string, @Param('userId') userId: string, @Body() body: UpdateTenantUserProfileInput) { return this.platform.updateTenantUserProfile(tenantId, userId, body); }
  @Patch('tenants/:tenantId/users/:userId/roles') @UsePipes(new ZodValidationPipe(assignUserRolesSchema)) assignTenantUserRoles(@Param('tenantId') tenantId: string, @Param('userId') userId: string, @Body() body: AssignUserRolesInput) { return this.platform.assignTenantUserRoles(tenantId, userId, body); }
  @Patch('tenants/:tenantId/users/:userId/status') @UsePipes(new ZodValidationPipe(updateTenantUserStatusSchema)) updateTenantUserStatus(@Param('tenantId') tenantId: string, @Param('userId') userId: string, @Body() body: UpdateTenantUserStatusInput) { return this.platform.updateTenantUserStatus(tenantId, userId, body); }
  @Post('tenants/:tenantId/users/:userId/password-reset') @UsePipes(new ZodValidationPipe(resetTenantUserPasswordSchema)) resetTenantUserPassword(@Param('tenantId') tenantId: string, @Param('userId') userId: string, @Body() body: { temporaryPassword: string }) { return this.platform.resetTenantUserPassword(tenantId, userId, body); }

  @Get('super-admins') listSuperAdmins(@Query() query: Record<string, unknown>) { return this.platform.listSuperAdmins(query); }
  @Post('super-admins') @UsePipes(new ZodValidationPipe(createPlatformAdminSchema)) createSuperAdmin(@Body() body: CreatePlatformAdminInput) { return this.platform.createSuperAdmin(body); }
  @Post('super-admins/:userId/invitation') resendSuperAdminInvitation(@Param('userId') userId: string) { return this.platform.resendSuperAdminInvitation(userId); }
  @Patch('super-admins/:userId') @UsePipes(new ZodValidationPipe(updatePlatformAdminProfileSchema)) updateSuperAdmin(@Param('userId') userId: string, @Body() body: UpdatePlatformAdminProfileInput) { return this.platform.updateSuperAdminProfile(userId, body); }
  @Patch('super-admins/:userId/status') @UsePipes(new ZodValidationPipe(updateTenantUserStatusSchema)) updateSuperAdminStatus(@Param('userId') userId: string, @Body() body: UpdateTenantUserStatusInput) { return this.platform.updateSuperAdminStatus(userId, body); }
  @Post('super-admins/:userId/password-reset') @UsePipes(new ZodValidationPipe(resetTenantUserPasswordSchema)) resetSuperAdminPassword(@Param('userId') userId: string, @Body() body: { temporaryPassword: string }) { return this.platform.resetSuperAdminPassword(userId, body); }
  @Patch('super-admins/:userId/operator-role') @UsePipes(new ZodValidationPipe(updatePlatformAdminRoleSchema)) updateSuperAdminRole(@Param('userId') userId: string, @Body() body: UpdatePlatformAdminRoleInput) { return this.platform.updateSuperAdminRole(userId, body); }
  @Delete('super-admins/:userId/sessions') revokeSuperAdminSessions(@Param('userId') userId: string) { return this.platform.revokeSuperAdminSessions(userId); }
  @Get('audit-logs') listPlatformAudit(@Query() query: Record<string, unknown>) { return this.platform.listPlatformAudit(query); }
}

@Module({ imports: [PrismaModule, TenantContextModule, AuthModule, AccessModule, OrganizationModule, AppConfigModule], controllers: [PlatformController, PlatformDirectoryController], providers: [PlatformService, TenantDomainDnsVerifier, PlatformSubscriptionLifecycleScheduler, PlatformAdminGuard] })
export class PlatformModule {}

function normalizeCustomDomain(input: string, tenantBaseDomain: string): string {
  const raw = input.trim().replace(/\.$/, '').toLowerCase();
  if (!raw || /[\s/:?#@\\*]/.test(raw)) throw AppError.validation('Enter a hostname only, without a URL, path, port, or wildcard.');
  const domain = domainToASCII(raw).toLowerCase();
  const labels = domain.split('.');
  if (!domain || domain.length > 253 || labels.length < 2 || isIP(domain) !== 0 || labels.some((label) =>
    label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
    throw AppError.validation('Enter a valid fully qualified DNS hostname.');
  }
  if (domain === tenantBaseDomain || domain.endsWith(`.${tenantBaseDomain}`)) {
    throw AppError.conflict('TENANT_DOMAIN_USES_PLATFORM_BASE', 'Use the generated workspace subdomain for hosts under the platform base domain.');
  }
  return domain;
}

function presentTenantDomain<T extends { id: string; tenantId: string; domain: string; isPrimary: boolean; verifiedAt: Date | null; verificationToken: string | null; createdAt: Date }>(domain: T) {
  return {
    id: domain.id,
    tenantId: domain.tenantId,
    domain: domain.domain,
    isPrimary: domain.isPrimary,
    verifiedAt: domain.verifiedAt,
    createdAt: domain.createdAt,
    verificationRecordName: `_fee-verification.${domain.domain}`,
    verificationRecordValue: domain.verificationToken ? `fee-platform-verification=${domain.verificationToken}` : null,
  };
}

function tenantSlugBase(name: string): string {
  const base = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63).replace(/-+$/g, '');
  if (base.length < 2) throw AppError.validation('Use an organization name with at least two letters or numbers so a workspace address can be generated.');
  return base;
}

function periodEnd(start: Date, interval: 'MONTHLY' | 'YEARLY' | 'MANUAL'): Date | null {
  if (interval === 'MANUAL') return null;
  const targetMonth = start.getUTCMonth() + (interval === 'YEARLY' ? 12 : 1);
  const year = start.getUTCFullYear() + Math.floor(targetMonth / 12);
  const month = targetMonth % 12;
  const day = Math.min(start.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return new Date(Date.UTC(year, month, day, start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds(), start.getUTCMilliseconds()));
}

function applyModuleOverrides(planModules: string[], overrides: Array<{ moduleKey: string; enabled: boolean }>): string[] {
  const enabled = new Set(planModules);
  for (const override of overrides) {
    if (override.enabled) enabled.add(override.moduleKey);
    else enabled.delete(override.moduleKey);
  }
  return [...enabled].sort();
}

function tenantRoleKeys(enabledModules: readonly string[]): RoleKey[] {
  const enabled = new Set(enabledModules);
  const moduleForRole: Partial<Record<RoleKey, string>> = {
    FINANCE_ADMIN: 'PAYMENTS',
    FINANCE_STAFF: 'PAYMENTS',
    COLLECTION_STAFF: 'PAYMENTS',
    ACCOUNTANT: 'PAYMENTS',
    ADMISSION_STAFF: 'ADMISSIONS',
    REPORT_VIEWER: 'REPORTS',
    STUDENT: 'PORTAL',
    PARENT: 'PORTAL',
  };
  return ROLE_KEYS.filter((key) => key !== 'PLATFORM_ADMIN' && (!moduleForRole[key] || enabled.has(moduleForRole[key]!)));
}

function invoicePeriod(snapshot: Prisma.JsonValue): { start: Date | null; end: Date | null } {
  const value = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot as Record<string, unknown> : {};
  const parse = (key: 'periodStart' | 'periodEnd') => {
    const raw = value[key];
    if (typeof raw !== 'string') return null;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  return { start: parse('periodStart'), end: parse('periodEnd') };
}

function subscriptionTransitionAllowed(current: SubscriptionStatus, next: SubscriptionStatus): boolean {
  if (current === next) return false;
  const transitions: Record<SubscriptionStatus, readonly SubscriptionStatus[]> = {
    TRIAL: ['ACTIVE', 'PAST_DUE', 'PAUSED', 'CANCELLED', 'EXPIRED'],
    ACTIVE: ['PAST_DUE', 'PAUSED', 'CANCELLED', 'EXPIRED'],
    PAST_DUE: ['ACTIVE', 'PAUSED', 'CANCELLED', 'EXPIRED'],
    PAUSED: ['ACTIVE', 'CANCELLED', 'EXPIRED'],
    CANCELLED: [],
    EXPIRED: [],
  };
  return transitions[current].includes(next);
}

function uniqueViolationTargets(error: unknown, field: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const meta = 'meta' in error && error.meta && typeof error.meta === 'object' ? error.meta as Record<string, unknown> : {};
  const target = meta.target;
  const constraint = meta.constraint;
  const targetText = Array.isArray(target) ? target.join(' ') : String(target ?? '');
  return (targetText + ' ' + String(constraint ?? '')).toLowerCase().includes(field.toLowerCase());
}

function tenantProvisioningFingerprint(input: ProvisionTenantInput, secret: string): string {
  const canonical = canonicalJson(input);
  return createHmac('sha256', secret).update(canonical).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function replayProvisioningOperation(
  operation: { requestFingerprint: string; result: Prisma.JsonValue },
  requestFingerprint: string,
): ProvisionTenantResult {
  if (operation.requestFingerprint !== requestFingerprint) {
    throw AppError.conflict('TENANT_PROVISION_IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different tenant provisioning request.');
  }
  return operation.result as unknown as ProvisionTenantResult;
}
