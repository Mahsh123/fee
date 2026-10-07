import { Body, Controller, Get, HttpCode, Injectable, Logger, Module, Param, Patch, Post, Req, UsePipes, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Money } from '@fee/money';
import { isUniqueViolation, Prisma, type GatewayEnvironment, type GatewayProvider, type PaymentMethodKind, type TransactionClient } from '@fee/database';
import { ERROR_CODES, PERMISSIONS, type PayerType } from '@fee/types';
import { createGatewaySchema, createPaymentOrderSchema, updateGatewaySchema, type CreateGatewayInput, type CreatePaymentOrderInput, type UpdateGatewayInput } from '@fee/validation';
import { createAdapter, GatewayError, type GatewayCredentials, type VerifyOrderClosureResult } from '@fee/payment-contracts';
import { AppError } from '../common/errors';
import { safeOperationalErrorCode } from '../common/diagnostics';
import { EncryptionService } from '../common/security';
import { AuditService, IdempotencyService, OutboxService, requireTenantCurrency } from '../common/financial';
import { PrismaModule, PrismaService } from '../common/prisma.service';
import { CurrentTenant, PortalRoute, Public, RequireModules, RequirePermissions, TenantContextModule, TenantContextService } from '../common/tenancy';
import { AppConfigService } from '../config/env';
import { ZodValidationPipe } from '../common/http';
import { PaymentsModule, PaymentsService } from './payments';
import { resolveOrderPayerType } from './gateway-payer';
import type { RequestWithContext } from '../common/errors';

type SafeGateway = {
  id: string; provider: GatewayProvider; environment: GatewayEnvironment; displayName: string;
  keyIdMasked: string | null; hasWebhookSecret: boolean; enabled: boolean; active: boolean;
  isDefault: boolean; isBackup: boolean; priority: number; supportedMethods: PaymentMethodKind[];
  routingRules: Prisma.JsonValue | null; minAmount: string | null; maxAmount: string | null; updatedAt: Date;
};
type NormalizedGatewayEvent = {
  eventId: string; eventType: string; providerOrderId: string | null; providerPaymentId: string | null;
  status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'UNKNOWN'; amount: string | null; currency: string | null; rawStatus: string;
};
type GatewayCreateOrderResult = { providerOrderId: string; checkout: Record<string, unknown> };

@Injectable()
export class GatewaysService {
  private readonly logger = new Logger(GatewaysService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly payments: PaymentsService,
    private readonly tenantContext: TenantContextService,
    private readonly config: AppConfigService,
  ) {}

  async list(tenantId: string) {
    this.assertTenant(tenantId);
    const rows = await this.prisma.db.tenantPaymentGateway.findMany({ where: { tenantId }, orderBy: [{ environment: 'asc' }, { isDefault: 'desc' }, { priority: 'asc' }] });
    return rows.map((row) => this.safeGateway(row));
  }

  async create(tenantId: string, input: CreateGatewayInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      if (input.isDefault) await tx.tenantPaymentGateway.updateMany({ where: { tenantId, environment: input.environment }, data: { isDefault: false } });
      const row = await tx.tenantPaymentGateway.create({ data: {
        tenantId, provider: input.provider, environment: input.environment, displayName: input.displayName,
        keyId: input.keyId, secretCiphertext: this.encryption.encrypt(input.secret),
        webhookSecretCiphertext: input.webhookSecret ? this.encryption.encrypt(input.webhookSecret) : null,
        enabled: input.enabled ?? false, isDefault: input.isDefault ?? false, isBackup: input.isBackup ?? false,
        priority: input.priority ?? 100, supportedMethods: input.supportedMethods,
        routingRules: input.routingRules ? input.routingRules as unknown as Prisma.InputJsonValue : Prisma.JsonNull,
        minAmount: input.minAmount ?? null, maxAmount: input.maxAmount ?? null,
        extraConfig: input.extraConfig ? input.extraConfig as Prisma.InputJsonValue : Prisma.JsonNull,
        updatedBy: actorId ?? null,
      } });
      const safe = this.safeGateway(row);
      await this.audit.record(tx, { tenantId, actorId, action: 'PAYMENT_GATEWAY_CREATED', entityType: 'TenantPaymentGateway', entityId: row.id, after: safe });
      await this.outbox.publish(tx, { tenantId, eventType: 'PAYMENT_GATEWAY_CREATED', aggregateType: 'TenantPaymentGateway', aggregateId: row.id, payload: { gatewayId: row.id, provider: row.provider, environment: row.environment }, actorId, requestId: this.tenantContext.requestId });
      return safe;
    });
  }

  async update(tenantId: string, id: string, input: UpdateGatewayInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const before = await tx.tenantPaymentGateway.findFirst({ where: { tenantId, id } });
      if (!before) throw AppError.notFound('Payment gateway');
      const nextMin = input.minAmount !== undefined ? input.minAmount : before.minAmount?.toString();
      const nextMax = input.maxAmount !== undefined ? input.maxAmount : before.maxAmount?.toString();
      if (nextMin && nextMax && decimalGreaterThan(nextMin, nextMax)) throw AppError.validation('Gateway maximum must be at least its minimum.');
      if (input.isDefault) await tx.tenantPaymentGateway.updateMany({ where: { tenantId, environment: before.environment, id: { not: id } }, data: { isDefault: false } });
      const data: Prisma.TenantPaymentGatewayUpdateManyMutationInput = {
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.keyId !== undefined ? { keyId: input.keyId } : {}),
        ...(input.secret !== undefined ? { secretCiphertext: this.encryption.encrypt(input.secret) } : {}),
        ...(input.webhookSecret !== undefined ? { webhookSecretCiphertext: input.webhookSecret ? this.encryption.encrypt(input.webhookSecret) : null } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
        ...(input.isBackup !== undefined ? { isBackup: input.isBackup } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.supportedMethods !== undefined ? { supportedMethods: input.supportedMethods } : {}),
        ...(input.routingRules !== undefined ? { routingRules: input.routingRules as unknown as Prisma.InputJsonValue } : {}),
        ...(input.minAmount !== undefined ? { minAmount: input.minAmount } : {}),
        ...(input.maxAmount !== undefined ? { maxAmount: input.maxAmount } : {}),
        ...(input.extraConfig !== undefined ? { extraConfig: input.extraConfig as Prisma.InputJsonValue } : {}),
        updatedBy: actorId ?? null,
      };
      const changed = await tx.tenantPaymentGateway.updateMany({ where: { tenantId, id, updatedAt: before.updatedAt }, data });
      if (changed.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'The gateway configuration changed. Reload and try again.');
      const after = await tx.tenantPaymentGateway.findFirst({ where: { tenantId, id } });
      if (!after) throw AppError.notFound('Payment gateway');
      const safe = this.safeGateway(after);
      await this.audit.record(tx, { tenantId, actorId, action: 'PAYMENT_GATEWAY_UPDATED', entityType: 'TenantPaymentGateway', entityId: id, before: this.safeGateway(before), after: safe });
      await this.outbox.publish(tx, { tenantId, eventType: 'PAYMENT_GATEWAY_UPDATED', aggregateType: 'TenantPaymentGateway', aggregateId: id, payload: { gatewayId: id, provider: after.provider, environment: after.environment, enabled: after.enabled, active: after.active }, actorId, requestId: this.tenantContext.requestId });
      return safe;
    });
  }

  async createOrder(tenantId: string, input: CreatePaymentOrderInput) {
    this.assertTenant(tenantId);
    const requestContext = this.tenantContext.require();
    const actorId = requestContext.userId;
    const portalOnly = Boolean(requestContext.roles?.length && requestContext.roles.every((role) => role === 'STUDENT' || role === 'PARENT'));
    const isParentPortal = portalOnly && requestContext.roles?.includes('PARENT') === true;
    const payerType = resolveOrderPayerType(input.payerType, { portalOnly, isParentPortal });
    const idempotencyScope = portalOnly ? `payment.gateway.order.portal:${actorId}` : 'payment.gateway.order';
    const requestHash = IdempotencyService.fingerprint(input);
    const prepared = await this.prisma.transactionWithRetry(async (tx) => {
      await this.assertPortalStudentAccess(tx, tenantId, input.studentId);
      const reservation = await this.idempotency.reserve(tx, { tenantId, scope: idempotencyScope, key: input.idempotencyKey, requestHash });
      if (!reservation.isNew) return { kind: 'cached' as const, cachedResponse: reservation.cachedResponse?.body };
      const settings = await tx.tenantSettings.findUnique({ where: { tenantId } });
      const currency = requireTenantCurrency(settings);
      const amount = Money.fromString(input.amount, currency);
      const minorUnits = settings?.currencyMinorUnits ?? 2;
      toMinorUnits(amount, minorUnits);
      const payerGuardianId = input.payerGuardianId ?? (isParentPortal ? requestContext.guardianId ?? null : null);
      if (isParentPortal && input.payerGuardianId && input.payerGuardianId !== requestContext.guardianId) throw AppError.forbidden('Portal users may only pay as their linked guardian identity.');
      const [student, method, sponsor, guardian] = await Promise.all([
        tx.student.findFirst({ where: { tenantId, id: input.studentId, deletedAt: null }, select: { id: true, admissionNumber: true, firstName: true, lastName: true, email: true, phone: true } }),
        tx.paymentMethod.findFirst({ where: { tenantId, id: input.methodId, active: true, enabledForOnline: true } }),
        input.payerSponsorId ? tx.sponsor.findFirst({ where: { tenantId, id: input.payerSponsorId, active: true, deletedAt: null }, select: { id: true, name: true } }) : Promise.resolve(null),
        payerGuardianId ? tx.guardian.findFirst({ where: { tenantId, id: payerGuardianId, deletedAt: null }, select: { id: true, firstName: true, lastName: true, phone: true, email: true } }) : Promise.resolve(null),
      ]);
      if (!student) throw AppError.notFound('Student');
      if (!method) throw AppError.validation('Choose an active tenant payment method enabled for online checkout.');
      if (payerType === 'SPONSOR' && !sponsor) throw AppError.validation('Choose an active sponsor from this institution.');
      if (['PARENT', 'GUARDIAN'].includes(payerType) && !guardian) throw AppError.validation('Choose a linked guardian who will pay.');
      if (guardian && !['PARENT', 'GUARDIAN'].includes(payerType)) throw AppError.validation('A guardian reference is only valid for a parent or guardian payment.');
      if (guardian) {
        const link = await tx.studentGuardian.findFirst({ where: { tenantId, guardianId: guardian.id, studentId: student.id }, select: { id: true } });
        if (!link) throw AppError.validation('The selected guardian is not linked to this student.');
      }
      const payerPlan = await this.payments.planPayerPayment(tx, tenantId, student.id, { type: payerType, sponsorId: sponsor?.id ?? null, payerGuardianId: guardian?.id ?? null, payerName: input.payerName ?? null }, amount, input.demandItemIds);
      const balance = payerPlan.balance;
      if (!amount.isPositive || amount.greaterThan(balance)) throw AppError.validation(`Online order amount cannot exceed the selected open balance (${balance.format()}).`);
      if (amount.lessThan(balance) && settings?.partialPaymentPolicy === 'DISALLOW') throw AppError.validation('Tenant settings do not allow partial online payment.');
      if (amount.lessThan(balance) && settings?.partialPaymentPolicy === 'ALLOW_WITH_APPROVAL') throw AppError.unprocessable('PAYMENT_APPROVAL_REQUIRED', 'This tenant requires collection approval before partial payments can be started.');
      const gateway = await this.selectGateway(tx, tenantId, method, input.environment, amount);
      const orderId = randomUUID();
      const orderNumber = `PO-${orderId.slice(0, 12).toUpperCase()}`;
      const order = await tx.paymentOrder.create({ data: {
        id: orderId, tenantId, branchId: payerPlan.branchId, orderNumber, studentId: student.id, methodId: method.id,
        amount: amount.toString(), currency, purpose: 'FEE_PAYMENT', channel: 'ONLINE', status: 'CREATED',
        payerType, payerName: guardian ? `${guardian.firstName} ${guardian.lastName ?? ''}`.trim() : input.payerName ?? null, payerPhone: input.payerPhone ?? guardian?.phone ?? null,
        payerEmail: input.payerEmail ?? guardian?.email ?? null, payerSponsorId: sponsor?.id ?? null, payerGuardianId: guardian?.id ?? null,
        responsibilityShares: payerPlan.responsibilityShares as Prisma.InputJsonValue,
        gatewayConfigId: gateway.id, provider: gateway.provider, environment: gateway.environment, methodKind: method.kind,
        intendedDemandItemIds: input.demandItemIds ?? [], expiresAt: new Date(Date.now() + 30 * 60 * 1000), idempotencyKey: input.idempotencyKey, createdBy: actorId ?? null,
      } });
      const transaction = await tx.gatewayTransaction.create({ data: {
        tenantId, paymentOrderId: order.id, gatewayConfigId: gateway.id, provider: gateway.provider, environment: gateway.environment,
        status: 'CREATED', amount: amount.toString(), currency, methodKind: method.kind,
        providerOrderId: createAdapter(gateway.provider).orderReferenceForStatusLookup(orderNumber),
        requestPayload: { orderNumber, studentId: student.id, amount: amount.toString(), currency, methodKind: method.kind } as Prisma.InputJsonValue,
      } });
      const response = { orderId: order.id, orderNumber, status: 'CREATED', provider: gateway.provider, environment: gateway.environment };
      return { kind: 'new' as const, reservationId: reservation.id, order, transaction, gateway, student, method, amount, currency, minorUnits, response };
    });
    if (prepared.kind === 'cached') return prepared.cachedResponse;
    const { order, transaction, gateway, student, method, amount, currency, minorUnits, reservationId } = prepared;
    let external: GatewayCreateOrderResult;
    try {
      external = await this.createProviderOrder({ gateway, student, method, orderNumber: order.orderNumber, orderId: order.id, amount, currency, minorUnits });
    } catch (error) {
      const safeError = error instanceof ProviderRequestError ? error.code : 'GATEWAY_ORDER_FAILED';
      const providerStateUnknown = error instanceof ProviderRequestError && error.mayHaveCreatedOrder;
      const message = providerStateUnknown
        ? 'The provider response was inconclusive. Do not start another payment; this amount remains reserved while the provider result is reconciled.'
        : 'The payment provider could not start checkout. Try again or choose another configured method.';
      const response = { ...prepared.response, status: providerStateUnknown ? 'PENDING' : 'FAILED', errorCode: safeError, message };
      await this.prisma.transactionWithRetry(async (tx) => {
        await tx.gatewayTransaction.updateMany({ where: { tenantId, id: transaction.id, status: 'CREATED' }, data: providerStateUnknown
          ? { providerStatusRaw: 'CREATE_RESULT_UNKNOWN', errorCode: safeError, errorMessage: message }
          : { status: 'FAILED', failedAt: new Date(), errorCode: safeError, errorMessage: message } });
        await tx.paymentOrder.updateMany({ where: { tenantId, id: order.id, status: 'CREATED' }, data: { status: providerStateUnknown ? 'PENDING' : 'FAILED' } });
        await this.idempotency.complete(tx, { id: reservationId, responseCode: providerStateUnknown ? 202 : 502, responseBody: response, resourceId: order.id, resourceType: 'PaymentOrder' });
        await this.audit.record(tx, { tenantId, actorId, action: providerStateUnknown ? 'PAYMENT_ORDER_PROVIDER_RESPONSE_UNKNOWN' : 'PAYMENT_ORDER_FAILED', entityType: 'PaymentOrder', entityId: order.id, after: { orderNumber: order.orderNumber, provider: gateway.provider, errorCode: safeError, reservationHeld: providerStateUnknown } });
        if (providerStateUnknown) await this.outbox.publish(tx, { tenantId, eventType: 'PAYMENT_ORDER_PROVIDER_STATUS_REQUIRED', aggregateType: 'PaymentOrder', aggregateId: order.id, payload: { orderId: order.id, orderNumber: order.orderNumber, gatewayConfigId: gateway.id }, actorId, requestId: this.tenantContext.requestId });
      });
      return response;
    }
    const response = { ...prepared.response, status: 'INITIATED', providerOrderId: external.providerOrderId, checkout: external.checkout };
    await this.prisma.transactionWithRetry(async (tx) => {
      const transactionChanged = await tx.gatewayTransaction.updateMany({ where: { tenantId, id: transaction.id, status: 'CREATED' }, data: { providerOrderId: external.providerOrderId, responsePayload: external.checkout as Prisma.InputJsonValue } });
      const orderChanged = await tx.paymentOrder.updateMany({ where: { tenantId, id: order.id, status: 'CREATED' }, data: { status: 'INITIATED' } });
      if (transactionChanged.count !== 1 || orderChanged.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'The payment order changed while the provider checkout was being created.');
      await this.idempotency.complete(tx, { id: reservationId, responseCode: 201, responseBody: response, resourceId: order.id, resourceType: 'PaymentOrder' });
      await this.audit.record(tx, { tenantId, actorId, action: 'PAYMENT_ORDER_INITIATED', entityType: 'PaymentOrder', entityId: order.id, after: { orderNumber: order.orderNumber, provider: gateway.provider, amount: amount.toString(), currency } });
      await this.outbox.publish(tx, { tenantId, eventType: 'PAYMENT_ORDER_INITIATED', aggregateType: 'PaymentOrder', aggregateId: order.id, payload: { orderId: order.id, orderNumber: order.orderNumber, provider: gateway.provider }, actorId, requestId: this.tenantContext.requestId });
    });
    return response;
  }

  async listOrders(tenantId: string) {
    this.assertTenant(tenantId);
    const orders = await this.prisma.db.paymentOrder.findMany({ where: { tenantId, channel: 'ONLINE' }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, orderNumber: true, studentId: true, payerType: true, payerName: true, payerSponsorId: true, payerGuardianId: true, amount: true, currency: true, status: true, provider: true, providerStatusAutoCheckAttempts: true, providerStatusCheckedAt: true, providerStatusNextCheckAt: true, createdAt: true, completedAt: true, expiresAt: true } });
    const payments = orders.length ? await this.prisma.db.payment.findMany({ where: { tenantId, paymentOrderId: { in: orders.map((order) => order.id) } }, orderBy: { paidAt: 'desc' }, select: { paymentOrderId: true, paymentNumber: true, status: true, receiptNumber: true } }) : [];
    const byOrder = new Map<string, typeof payments>();
    for (const payment of payments) if (payment.paymentOrderId) byOrder.set(payment.paymentOrderId, [...(byOrder.get(payment.paymentOrderId) ?? []), payment]);
    const retry = this.config.gatewayStatusReconciliation;
    return orders.map((order) => ({
      ...order,
      payments: byOrder.get(order.id) ?? [],
      providerStatusRetriesExhausted: Boolean(order.provider && createAdapter(order.provider).supportsOrderStatusVerification && order.providerStatusAutoCheckAttempts >= retry.maxAutomaticAttempts),
      providerStatusAutoCheckSupported: Boolean(order.provider && createAdapter(order.provider).supportsOrderStatusVerification),
    }));
  }

  async getOrder(tenantId: string, orderId: string) {
    this.assertTenant(tenantId);
    const studentIds = await this.portalStudentScope(tenantId);
    const query = {
      where: { tenantId, id: orderId, channel: 'ONLINE' as const, ...(studentIds ? { studentId: { in: studentIds } } : {}) },
      select: { id: true, orderNumber: true, amount: true, currency: true, status: true, payerType: true, createdAt: true, expiresAt: true, completedAt: true, studentId: true },
    };
    const order = await this.prisma.db.paymentOrder.findFirst(query);
    if (!order) throw AppError.notFound('Payment order');
    const payments = await this.prisma.db.payment.findMany({ where: { tenantId, paymentOrderId: order.id }, orderBy: { paidAt: 'desc' }, select: { id: true, paymentNumber: true, receiptNumber: true, status: true, paidAt: true } });
    return { ...order, payments };
  }

  async verifyProviderStatus(tenantId: string, orderId: string, options: { scheduled?: boolean } = {}) {
    this.assertTenant(tenantId);
    const now = new Date();
    const order = await this.prisma.db.paymentOrder.findFirst({ where: { tenantId, id: orderId, channel: 'ONLINE' } });
    if (!order) throw AppError.notFound('Payment order');
    if (order.status === 'SUCCESS') return { accepted: true, state: 'CAPTURED' as const, status: 'SUCCESS', reservationHeld: false, alreadyProcessed: true };
    if (!['CREATED', 'INITIATED', 'PENDING'].includes(order.status) || !order.expiresAt || order.expiresAt > now) {
      throw AppError.conflict('PAYMENT_ORDER_NOT_ELIGIBLE', 'Only an overdue, still-open online order can be checked with its provider.');
    }

    const retry = this.config.gatewayStatusReconciliation;
    if (options.scheduled && (!order.provider || !createAdapter(order.provider).supportsOrderStatusVerification || order.providerStatusAutoCheckAttempts >= retry.maxAutomaticAttempts
      || (order.providerStatusNextCheckAt && order.providerStatusNextCheckAt > now))) {
      return { accepted: true, state: 'UNKNOWN' as const, status: order.status, reservationHeld: true, skipped: true };
    }
    const delayMs = Math.min(retry.initialRetryMs * 2 ** Math.min(order.providerStatusAutoCheckAttempts, 16), retry.maxRetryMs);
    const leaseUntil = new Date(now.getTime() + retry.leaseMs);
    const leaseId = randomUUID();
    const nextCheckAt = new Date(now.getTime() + delayMs);
    const claimed = await this.prisma.db.paymentOrder.updateMany({
      where: {
        tenantId, id: order.id, status: { in: ['CREATED', 'INITIATED', 'PENDING'] }, expiresAt: { lte: now },
        providerStatusAutoCheckAttempts: order.providerStatusAutoCheckAttempts,
        AND: [
          { OR: [{ providerStatusCheckLeaseUntil: null }, { providerStatusCheckLeaseUntil: { lte: now } }] },
          ...(options.scheduled ? [{ OR: [{ providerStatusNextCheckAt: null }, { providerStatusNextCheckAt: { lte: now } }] }] : []),
        ],
      },
      data: {
        ...(options.scheduled ? { providerStatusAutoCheckAttempts: { increment: 1 } } : {}),
        providerStatusCheckLeaseUntil: leaseUntil,
        providerStatusCheckLeaseId: leaseId,
        providerStatusNextCheckAt: nextCheckAt,
      },
    });
    if (claimed.count !== 1) {
      const latest = await this.prisma.db.paymentOrder.findFirst({ where: { tenantId, id: order.id }, select: { status: true } });
      if (latest?.status === 'SUCCESS') return { accepted: true, state: 'CAPTURED' as const, status: 'SUCCESS', reservationHeld: false, alreadyProcessed: true };
      if (options.scheduled) return { accepted: true, state: 'UNKNOWN' as const, status: order.status, reservationHeld: true, skipped: true };
      throw AppError.conflict('PROVIDER_STATUS_CHECK_IN_PROGRESS', 'A provider status check is already running for this order. Retry shortly.');
    }

    try {
      return await this.performProviderStatusCheck(tenantId, order.id, options.scheduled ? 'SCHEDULED' : 'MANUAL');
    } finally {
      await this.prisma.db.paymentOrder.updateMany({
        where: { tenantId, id: order.id, providerStatusCheckLeaseId: leaseId },
        data: { providerStatusCheckLeaseUntil: null, providerStatusCheckLeaseId: null, providerStatusCheckedAt: new Date() },
      });
    }
  }

  private async performProviderStatusCheck(tenantId: string, orderId: string, source: 'MANUAL' | 'SCHEDULED') {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    const now = new Date();
    const order = await this.prisma.db.paymentOrder.findFirst({ where: { tenantId, id: orderId, channel: 'ONLINE' } });
    if (!order) throw AppError.notFound('Payment order');
    if (order.status === 'SUCCESS') return { accepted: true, state: 'CAPTURED' as const, status: 'SUCCESS', reservationHeld: false, alreadyProcessed: true };
    if (!['CREATED', 'INITIATED', 'PENDING'].includes(order.status) || !order.expiresAt || order.expiresAt > now) {
      throw AppError.conflict('PAYMENT_ORDER_NOT_ELIGIBLE', 'Only an overdue, still-open online order can be checked with its provider.');
    }
    const gatewayTxn = await this.prisma.db.gatewayTransaction.findFirst({
      where: { tenantId, paymentOrderId: order.id, paymentId: null, status: { in: ['CREATED', 'AUTHORIZED', 'FAILED', 'EXPIRED'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (!gatewayTxn?.providerOrderId || !gatewayTxn.gatewayConfigId) throw AppError.conflict('GATEWAY_ORDER_NOT_FOUND', 'No provider order is available for this payment order.');
    const config = await this.prisma.db.tenantPaymentGateway.findFirst({ where: { tenantId, id: gatewayTxn.gatewayConfigId } });
    if (!config || config.provider !== gatewayTxn.provider || config.environment !== gatewayTxn.environment
      || order.gatewayConfigId !== gatewayTxn.gatewayConfigId || order.provider !== gatewayTxn.provider || order.environment !== gatewayTxn.environment) {
      throw AppError.conflict('GATEWAY_CONFIG_NOT_FOUND', 'The tenant gateway configuration for this order is unavailable or inconsistent.');
    }

    const credentials: GatewayCredentials = {
      provider: config.provider,
      environment: config.environment,
      keyId: config.keyId,
      secret: this.encryption.decrypt(config.secretCiphertext),
      extra: recordValue(config.extraConfig),
    };
    let providerResult: VerifyOrderClosureResult;
    try {
      providerResult = await createAdapter(config.provider).verifyOrderClosure({ credentials, providerOrderId: gatewayTxn.providerOrderId, currency: gatewayTxn.currency });
    } catch (error) {
      const errorCode = error instanceof GatewayError ? error.code : 'PROVIDER_STATUS_CHECK_FAILED';
      await this.prisma.transactionWithRetry(async (tx) => {
        await this.audit.record(tx, { tenantId, actorId, action: 'PAYMENT_ORDER_PROVIDER_STATUS_CHECKED', entityType: 'PaymentOrder', entityId: order.id, before: { status: order.status }, after: { source, provider: config.provider, environment: config.environment, providerOrderId: gatewayTxn.providerOrderId, gatewayTransactionId: gatewayTxn.id, state: 'UNKNOWN', errorCode, checkedAt: new Date().toISOString(), reservationHeld: true } });
      });
      return { accepted: true, state: 'UNKNOWN' as const, status: 'PENDING', reservationHeld: true, message: 'The provider could not confirm closure. The existing payment responsibility remains reserved.' };
    }

    return this.prisma.transactionWithRetry(async (tx) => {
      const currentOrder = await tx.paymentOrder.findFirst({ where: { tenantId, id: order.id } });
      const currentTxn = await tx.gatewayTransaction.findFirst({ where: { tenantId, id: gatewayTxn.id } });
      if (!currentOrder || !currentTxn) throw AppError.notFound('Payment order');
      if (currentTxn.status === 'EXPIRED' && currentOrder.status === 'EXPIRED') {
        await this.audit.record(tx, { tenantId, actorId, action: 'PAYMENT_ORDER_PROVIDER_STATUS_CHECKED', entityType: 'PaymentOrder', entityId: order.id, before: { status: currentOrder.status }, after: { source, provider: config.provider, providerOrderId: gatewayTxn.providerOrderId, gatewayTransactionId: gatewayTxn.id, state: providerResult.state, result: 'ALREADY_CLOSED', checkedAt: new Date().toISOString(), reservationHeld: false } });
        return { accepted: true, state: providerResult.state, status: 'EXPIRED', reservationHeld: false, alreadyProcessed: true };
      }
      if (currentTxn.status === 'CAPTURED' || currentTxn.paymentId || currentOrder.status === 'SUCCESS') {
        await this.audit.record(tx, { tenantId, actorId, action: 'PAYMENT_ORDER_PROVIDER_STATUS_CHECKED', entityType: 'PaymentOrder', entityId: order.id, before: { status: currentOrder.status }, after: { source, provider: config.provider, providerOrderId: gatewayTxn.providerOrderId, gatewayTransactionId: gatewayTxn.id, state: providerResult.state, result: 'ALREADY_CAPTURED', checkedAt: new Date().toISOString(), reservationHeld: false } });
        return { accepted: true, state: providerResult.state, status: 'SUCCESS', reservationHeld: false, alreadyProcessed: true };
      }

      let outcome: { status: string; reservationHeld: boolean; paymentId?: string; receiptId?: string; mismatch?: string };
      if (providerResult.state === 'CAPTURED') {
        const event: NormalizedGatewayEvent = {
          eventId: `provider-check-${randomUUID()}`,
          eventType: 'PROVIDER_STATUS_CHECK',
          providerOrderId: gatewayTxn.providerOrderId,
          providerPaymentId: providerResult.providerPaymentId ?? null,
          status: 'SUCCESS',
          amount: providerResult.amount?.toString() ?? null,
          currency: providerResult.currency?.toUpperCase() ?? null,
          rawStatus: providerResult.rawStatus ?? 'CAPTURED',
        };
        const sameAttemptPreviouslyFailed = currentTxn.status === 'FAILED'
          && (!currentTxn.providerPaymentId || !event.providerPaymentId || currentTxn.providerPaymentId === event.providerPaymentId);
        outcome = await this.recordVerifiedCapture(tx, tenantId, config, currentTxn, currentOrder, event, sameAttemptPreviouslyFailed || currentOrder.status === 'FAILED');
      } else if (providerResult.state === 'TERMINAL') {
        const txnChanged = await tx.gatewayTransaction.updateMany({ where: { tenantId, id: currentTxn.id, status: { in: ['CREATED', 'AUTHORIZED', 'FAILED'] }, paymentId: null }, data: { status: 'EXPIRED', providerStatusRaw: providerResult.rawStatus ?? 'PROVIDER_TERMINAL' } });
        if (txnChanged.count === 1) {
          await tx.paymentOrder.updateMany({ where: { tenantId, id: currentOrder.id, status: { in: ['CREATED', 'INITIATED', 'PENDING'] } }, data: { status: 'EXPIRED', completedAt: new Date() } });
          await this.outbox.publish(tx, { tenantId, eventType: 'PAYMENT_ORDER_PROVIDER_CLOSED', aggregateType: 'PaymentOrder', aggregateId: currentOrder.id, payload: { orderId: currentOrder.id, gatewayTransactionId: currentTxn.id, provider: config.provider, providerOrderId: gatewayTxn.providerOrderId, providerStatus: providerResult.rawStatus ?? null }, dedupeKey: `gateway-order-closed:${currentOrder.id}`, actorId, requestId: this.tenantContext.requestId });
          outcome = { status: 'EXPIRED', reservationHeld: false };
        } else {
          outcome = { status: 'PENDING', reservationHeld: true };
        }
      } else {
        outcome = { status: 'PENDING', reservationHeld: true };
      }

      await this.audit.record(tx, { tenantId, actorId, action: 'PAYMENT_ORDER_PROVIDER_STATUS_CHECKED', entityType: 'PaymentOrder', entityId: currentOrder.id, before: { status: currentOrder.status }, after: {
        source, provider: config.provider, environment: config.environment, providerOrderId: gatewayTxn.providerOrderId,
        providerPaymentId: providerResult.providerPaymentId ?? null, providerTxnId: providerResult.providerTxnId ?? null,
        gatewayTransactionId: currentTxn.id, providerState: providerResult.state, providerStatus: providerResult.rawStatus ?? null,
        providerAmount: providerResult.amount?.toString() ?? null, providerCurrency: providerResult.currency?.toUpperCase() ?? null,
        result: outcome.status, paymentId: outcome.paymentId ?? null, receiptId: outcome.receiptId ?? null,
        checkedAt: new Date().toISOString(), reservationHeld: outcome.reservationHeld,
      } });
      return { accepted: true, state: providerResult.state, ...outcome };
    });
  }

  private async assertPortalStudentAccess(tx: TransactionClient, tenantId: string, studentId: string): Promise<void> {
    const context = this.tenantContext.require();
    const roles = context.roles ?? [];
    const portalOnly = roles.length > 0 && roles.every((role) => role === 'STUDENT' || role === 'PARENT');
    if (!portalOnly) return;
    if (roles.includes('STUDENT') && context.studentId === studentId) return;
    if (roles.includes('PARENT') && context.guardianId) {
      const link = await tx.studentGuardian.findFirst({ where: { tenantId, guardianId: context.guardianId, studentId }, select: { id: true } });
      if (link) return;
    }
    throw AppError.notFound('Student');
  }

  private async portalStudentScope(tenantId: string): Promise<string[] | null> {
    const context = this.tenantContext.require();
    const roles = context.roles ?? [];
    const portalOnly = roles.length > 0 && roles.every((role) => role === 'STUDENT' || role === 'PARENT');
    if (!portalOnly) return null;
    if (roles.includes('STUDENT') && context.studentId) return [context.studentId];
    if (roles.includes('PARENT') && context.guardianId) {
      const links = await this.prisma.db.studentGuardian.findMany({ where: { tenantId, guardianId: context.guardianId }, select: { studentId: true } });
      return [...new Set(links.map((link) => link.studentId))];
    }
    return [];
  }

  async receiveWebhook(tenantId: string, configId: string, request: RequestWithContext) {
    this.assertTenant(tenantId);
    const config = await this.prisma.db.tenantPaymentGateway.findFirst({ where: { tenantId, id: configId, enabled: true, active: true } });
    if (!config) throw AppError.notFound('Payment gateway');
    const raw = request.rawBody;
    if (!raw) throw AppError.unprocessable('WEBHOOK_RAW_BODY_REQUIRED', 'The raw provider request body is unavailable for signature verification.');
    const headers = safeHeaders(request.headers);
    const signature = firstHeader(request.headers, signatureHeader(config.provider)) ?? (config.provider === 'PAYU' ? stringValue(recordValue(request.body).hash) ?? undefined : undefined);
    const secretCiphertext = config.webhookSecretCiphertext;
    const signatureValid = Boolean(secretCiphertext && signature && verifySignature(config.provider, this.encryption.decrypt(secretCiphertext), raw, signature, request.headers, request.body));
    if (!signatureValid) {
      this.logger.warn({
        message: 'Rejected payment provider webhook with an invalid signature.',
        tenantId,
        gatewayConfigId: config.id,
        provider: config.provider,
        environment: config.environment,
      });
      throw AppError.forbidden('The payment provider webhook signature is invalid.');
    }
    const settings = await this.prisma.db.tenantSettings.findUnique({ where: { tenantId } });
    const event = normalizeEvent(config.provider, request.body, request.headers, settings?.currencyMinorUnits ?? 2);
    // A provider signature may omit some callback fields and headers. Use only
    // an ID inside signed data; PayU's signature itself is the fingerprint
    // because its `mihpayid` field is not part of the signed string.
    const externalEventId = event.eventId
      || (config.provider === 'PAYU' && signature
        ? `signature-${createHash('sha256').update(signature).digest('hex')}`
        : `payload-${createHash('sha256').update(raw).digest('hex')}`);
    const payload = jsonValue(request.body);
    const canonicalPayload = canonicalJson(payload);
    let webhook: { id: string; processingStatus: string };
    try {
      webhook = await this.prisma.transactionWithRetry(async (tx) => tx.gatewayWebhook.create({ data: {
        tenantId, provider: config.provider, environment: config.environment, externalEventId, eventType: event.eventType,
        signature, signatureValid: true, payload, headers: headers as Prisma.InputJsonValue,
        processingStatus: 'RECEIVED', lastError: null,
      } }));
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.prisma.db.gatewayWebhook.findFirst({ where: { tenantId, provider: config.provider, environment: config.environment, externalEventId, signatureValid: true } });
      if (!existing) throw error;
      if (canonicalJson(existing.payload) !== canonicalPayload) {
        throw AppError.conflict('WEBHOOK_EVENT_PAYLOAD_MISMATCH', 'A verified provider event ID was received with a different payload. The callback was rejected for reconciliation.');
      }
      if (existing.processingStatus === 'PROCESSED' || existing.processingStatus === 'IGNORED') return { accepted: true, duplicate: true, status: existing.processingStatus };
      webhook = existing;
    }
    try {
      return await this.processWebhook(tenantId, config, webhook.id, event);
    } catch (error) {
      await this.prisma.transactionWithRetry(async (tx) => {
        await tx.gatewayWebhook.updateMany({ where: { tenantId, id: webhook.id, processingStatus: { in: ['RECEIVED', 'PROCESSING'] } }, data: { processingStatus: 'FAILED', lastError: error instanceof AppError ? error.code : 'WEBHOOK_PROCESSING_FAILED' } });
      });
      throw error;
    }
  }

  private async processWebhook(tenantId: string, config: { id: string; provider: GatewayProvider; environment: GatewayEnvironment }, webhookId: string, event: NormalizedGatewayEvent) {
    return this.prisma.transactionWithRetry(async (tx) => {
      const webhook = await tx.gatewayWebhook.findFirst({ where: { tenantId, id: webhookId } });
      if (!webhook || !webhook.signatureValid) throw AppError.notFound('Verified webhook');
      if (webhook.processingStatus === 'PROCESSED') return { accepted: true, duplicate: true, status: 'PROCESSED' };
      const processing = await tx.gatewayWebhook.updateMany({ where: { tenantId, id: webhookId, processingStatus: { in: ['RECEIVED', 'FAILED'] } }, data: { processingStatus: 'PROCESSING', attemptCount: { increment: 1 }, lastError: null } });
      if (processing.count !== 1) return { accepted: true, duplicate: true, status: webhook.processingStatus };
      const gatewayTxn = event.providerOrderId ? await tx.gatewayTransaction.findFirst({ where: { tenantId, gatewayConfigId: config.id, provider: config.provider, environment: config.environment, providerOrderId: event.providerOrderId } }) : null;
      if (!gatewayTxn) {
        await tx.gatewayWebhook.updateMany({ where: { tenantId, id: webhookId, processingStatus: 'PROCESSING' }, data: { processingStatus: 'IGNORED', processedAt: new Date(), lastError: 'PAYMENT_ORDER_NOT_FOUND' } });
        return { accepted: true, processed: false, status: 'IGNORED' };
      }
      const order = gatewayTxn.paymentOrderId ? await tx.paymentOrder.findFirst({ where: { tenantId, id: gatewayTxn.paymentOrderId } }) : null;
      if (!order) throw AppError.conflict('PAYMENT_ORDER_NOT_FOUND', 'The gateway event has no matching payment order.');
      if (gatewayTxn.status === 'CAPTURED' || gatewayTxn.paymentId) {
        await tx.gatewayWebhook.updateMany({ where: { tenantId, id: webhookId, processingStatus: 'PROCESSING' }, data: { processingStatus: 'PROCESSED', processedAt: new Date(), resultingPaymentId: gatewayTxn.paymentId, resultingTransactionId: gatewayTxn.id } });
        return { accepted: true, duplicate: true, status: 'PROCESSED' };
      }
      const sameAttemptPreviouslyFailed = gatewayTxn.status === 'FAILED'
        && (!gatewayTxn.providerPaymentId || !event.providerPaymentId || gatewayTxn.providerPaymentId === event.providerPaymentId);
      const priorFailure = sameAttemptPreviouslyFailed || order.status === 'FAILED';
      if (event.status === 'FAILED') {
        await tx.gatewayTransaction.updateMany({ where: { tenantId, id: gatewayTxn.id, status: { in: ['CREATED', 'AUTHORIZED'] } }, data: { status: 'FAILED', providerPaymentId: event.providerPaymentId, providerStatusRaw: event.rawStatus, failedAt: new Date() } });
        // A failed payment attempt does not prove the provider order is closed;
        // another attempt may still capture against the same order.
        await this.audit.record(tx, { tenantId, actorId: null, action: 'PAYMENT_ORDER_PAYMENT_ATTEMPT_FAILED', entityType: 'PaymentOrder', entityId: order.id, after: { orderNumber: order.orderNumber, gatewayTransactionId: gatewayTxn.id, providerPaymentId: event.providerPaymentId, rawStatus: event.rawStatus, orderStatusRetained: order.status, reservationHeld: true } });
        await tx.gatewayWebhook.updateMany({ where: { tenantId, id: webhookId, processingStatus: 'PROCESSING' }, data: { processingStatus: 'PROCESSED', processedAt: new Date(), resultingTransactionId: gatewayTxn.id } });
        return { accepted: true, processed: true, status: 'PENDING', attemptStatus: 'FAILED', reservationHeld: true };
      }
      if (event.status !== 'SUCCESS') {
        await tx.gatewayWebhook.updateMany({ where: { tenantId, id: webhookId, processingStatus: 'PROCESSING' }, data: { processingStatus: 'IGNORED', processedAt: new Date(), resultingTransactionId: gatewayTxn.id, lastError: 'UNSUPPORTED_EVENT_STATE' } });
        return { accepted: true, processed: false, status: 'IGNORED' };
      }
      return this.recordVerifiedCapture(tx, tenantId, config, gatewayTxn, order, event, priorFailure, webhookId);
    });
  }

  private async recordVerifiedCapture(
    tx: TransactionClient,
    tenantId: string,
    config: { id: string; provider: GatewayProvider; environment: GatewayEnvironment },
    gatewayTxn: { id: string; status: string; paymentId: string | null; providerPaymentId: string | null; amount: Prisma.Decimal; currency: string },
    order: { id: string; orderNumber: string; branchId: string | null; studentId: string | null; methodId: string | null; amount: Prisma.Decimal; currency: string; intendedDemandItemIds: string[]; payerType: PayerType; payerName: string | null; payerPhone: string | null; payerEmail: string | null; payerSponsorId: string | null; payerGuardianId: string | null; status: string; expiresAt: Date | null },
    event: NormalizedGatewayEvent,
    priorFailure: boolean,
    webhookId?: string,
  ) {
    const mismatch = this.validateCapturedEvent(event, gatewayTxn.amount.toString(), gatewayTxn.currency);
    const orderExpired = order.status === 'CANCELLED' || order.status === 'EXPIRED' || Boolean(order.expiresAt && order.expiresAt <= new Date());
    const captureMismatch = mismatch ?? (priorFailure ? 'SUCCESS_AFTER_FAILURE' : orderExpired ? 'PAYMENT_AFTER_ORDER_EXPIRY' : null);
    if (mismatch === 'GATEWAY_CURRENCY_MISMATCH' || mismatch === 'GATEWAY_AMOUNT_MISSING' || mismatch === 'GATEWAY_AMOUNT_INVALID') {
      const expected = Money.fromString(gatewayTxn.amount.toString(), gatewayTxn.currency);
      const actualCurrency = event.currency && /^[A-Za-z]{3}$/.test(event.currency) ? event.currency.toUpperCase() : null;
      let actualAmount: string | null = null;
      if (mismatch === 'GATEWAY_CURRENCY_MISMATCH' && event.amount && actualCurrency) {
        try { actualAmount = Money.fromString(event.amount, actualCurrency).toString(); } catch { actualAmount = null; }
      }
      const existingIssue = await tx.reconciliationRecord.findFirst({ where: { tenantId, gatewayTransactionId: gatewayTxn.id, status: 'OPEN', mismatchType: mismatch }, select: { id: true } });
      if (!existingIssue) await tx.reconciliationRecord.create({ data: { tenantId, settlementId: null, gatewayTransactionId: gatewayTxn.id, status: 'OPEN', mismatchType: mismatch, expectedAmount: expected.toString(), actualAmount, difference: null, currency: gatewayTxn.currency, actualCurrency, notes: `Provider reported success, but the capture cannot yet be posted: ${mismatch}${priorFailure ? '; the transaction was previously marked failed' : ''}${orderExpired ? '; the local order was expired or cancelled' : ''}. Provider evidence is retained for reconciliation.` } });
      await tx.gatewayTransaction.updateMany({ where: { tenantId, id: gatewayTxn.id, status: { in: ['CREATED', 'AUTHORIZED', 'FAILED', 'EXPIRED'] }, paymentId: null }, data: { providerPaymentId: event.providerPaymentId, providerTxnId: event.providerPaymentId ?? event.providerOrderId, providerStatusRaw: event.rawStatus } });
      if (webhookId) await tx.gatewayWebhook.updateMany({ where: { tenantId, id: webhookId, processingStatus: 'PROCESSING' }, data: { processingStatus: 'PROCESSED', processedAt: new Date(), resultingTransactionId: gatewayTxn.id, lastError: mismatch } });
      return { accepted: true, processed: true, status: 'RECONCILIATION_REQUIRED', mismatch, reservationHeld: true };
    }

    // Claim the gateway transaction before writing the payment. This row update
    // serializes simultaneous webhook and provider-check captures; both the
    // claim and financial posting commit or roll back together.
    const claimed = await tx.gatewayTransaction.updateMany({
      where: { tenantId, id: gatewayTxn.id, status: { in: ['CREATED', 'AUTHORIZED', 'FAILED', 'EXPIRED'] }, paymentId: null },
      data: { status: 'CAPTURED', providerPaymentId: event.providerPaymentId, providerTxnId: event.providerPaymentId ?? event.providerOrderId, providerStatusRaw: event.rawStatus, capturedAt: new Date() },
    });
    if (claimed.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'The gateway capture was processed concurrently. Retry the provider event safely.');
    const capturedAmount = event.amount!;
    const payment = await this.payments.recordGatewayPayment(tx, {
      tenantId, order, provider: config.provider, gatewayConfigId: config.id,
      providerTxnId: event.providerPaymentId ?? event.providerOrderId ?? gatewayTxn.id,
      capturedAmount,
      holdUnapplied: captureMismatch !== null,
    });
    const finalMismatch = captureMismatch ?? (payment.heldForReconciliation ? 'PAYMENT_ALLOCATION_REQUIRES_REVIEW' : null);
    const transactionChanged = await tx.gatewayTransaction.updateMany({ where: { tenantId, id: gatewayTxn.id, status: 'CAPTURED', paymentId: null }, data: { paymentId: payment.payment.id } });
    if (transactionChanged.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'The gateway capture was processed concurrently. Retry the provider event safely.');
    if (finalMismatch) {
      const expected = Money.fromString(gatewayTxn.amount.toString(), gatewayTxn.currency);
      const actual = Money.fromString(capturedAmount, gatewayTxn.currency);
      await tx.reconciliationRecord.create({ data: { tenantId, settlementId: null, gatewayTransactionId: gatewayTxn.id, paymentId: payment.payment.id, status: 'OPEN', mismatchType: finalMismatch, expectedAmount: expected.toString(), actualAmount: actual.toString(), difference: actual.subtract(expected).toString(), currency: gatewayTxn.currency, actualCurrency: gatewayTxn.currency, notes: `Verified provider capture is recorded as payment ${payment.payment.paymentNumber} and balanced ledger evidence; its amount, order lifecycle, or allocation context requires operator reconciliation.` } });
    }
    await tx.paymentOrder.updateMany({ where: { tenantId, id: order.id, status: { in: ['CREATED', 'INITIATED', 'PENDING'] } }, data: { status: 'SUCCESS', completedAt: new Date() } });
    if (webhookId) await tx.gatewayWebhook.updateMany({ where: { tenantId, id: webhookId, processingStatus: 'PROCESSING' }, data: { processingStatus: 'PROCESSED', processedAt: new Date(), resultingPaymentId: payment.payment.id, resultingTransactionId: gatewayTxn.id } });
    await this.outbox.publish(tx, { tenantId, eventType: 'GATEWAY_PAYMENT_CAPTURED', aggregateType: 'Payment', aggregateId: payment.payment.id, payload: { paymentId: payment.payment.id, orderId: order.id, gatewayTransactionId: gatewayTxn.id }, actorId: null, requestId: this.tenantContext.requestId });
    return { accepted: true, processed: true, status: finalMismatch ? 'RECONCILIATION_REQUIRED' : 'SUCCESS', ...(finalMismatch ? { mismatch: finalMismatch } : {}), paymentId: payment.payment.id, receiptId: payment.receipt.id, reservationHeld: false };
  }

  private async selectGateway(tx: TransactionClient, tenantId: string, method: { id: string; kind: PaymentMethodKind; preferredGatewayConfigId: string | null }, environment: GatewayEnvironment | undefined, amount: Money) {
    const configs = await tx.tenantPaymentGateway.findMany({ where: { tenantId, enabled: true, active: true, ...(environment ? { environment } : {}), ...(method.preferredGatewayConfigId ? { id: method.preferredGatewayConfigId } : {}) }, orderBy: [{ isDefault: 'desc' }, { isBackup: 'asc' }, { priority: 'asc' }] });
    const selected = configs.find((config) => {
      if (!config.supportedMethods.includes(method.kind)) return false;
      if (config.minAmount && amount.lessThan(Money.fromString(config.minAmount.toString(), amount.currency.code))) return false;
      if (config.maxAmount && amount.greaterThan(Money.fromString(config.maxAmount.toString(), amount.currency.code))) return false;
      const rules = Array.isArray(config.routingRules) ? config.routingRules as Array<{ method?: string; minAmount?: string; maxAmount?: string }> : [];
      const methodRules = rules.filter((rule) => rule.method === method.kind);
      if (methodRules.length && !methodRules.some((rule) => (!rule.minAmount || !amount.lessThan(Money.fromString(rule.minAmount, amount.currency.code))) && (!rule.maxAmount || !amount.greaterThan(Money.fromString(rule.maxAmount, amount.currency.code))))) return false;
      return true;
    });
    if (!selected) throw AppError.unprocessable('GATEWAY_UNAVAILABLE', 'No enabled gateway configuration supports this payment method, environment, and amount.');
    return selected;
  }

  private async createProviderOrder(input: { gateway: { id: string; provider: GatewayProvider; environment: GatewayEnvironment; keyId: string; secretCiphertext: string; extraConfig: Prisma.JsonValue | null }; student: { id: string; admissionNumber: string; firstName: string; lastName: string | null; email: string | null; phone: string | null }; method: { kind: PaymentMethodKind }; orderNumber: string; orderId: string; amount: Money; currency: string; minorUnits: number }): Promise<GatewayCreateOrderResult> {
    const { gateway, student, method, orderNumber, orderId, amount, currency } = input;
    const secret = this.encryption.decrypt(gateway.secretCiphertext);
    const minorAmount = toMinorUnits(amount, input.minorUnits);
    if (gateway.provider === 'MOCK') {
      if (gateway.environment !== 'TEST') throw AppError.validation('The mock adapter is allowed only in the test environment.');
      return { providerOrderId: orderNumber, checkout: { mode: 'MOCK', orderId, providerOrderId: orderNumber, amount: amount.toString(), currency } };
    }
    if (gateway.provider === 'PAYU') {
      if (!student.email || !student.phone) throw AppError.validation('PayU checkout requires the student’s email and phone number.');
      const config = recordValue(gateway.extraConfig);
      const returnUrl = safeHttpUrl(config.returnUrl);
      const successUrl = safeHttpUrl(config.successUrl ?? returnUrl);
      const failureUrl = safeHttpUrl(config.failureUrl ?? returnUrl);
      if (!successUrl || !failureUrl) throw AppError.validation('Configure HTTPS successUrl and failureUrl for this PayU gateway.');
      const productInfo = `Fee payment ${orderNumber}`;
      const firstName = student.firstName;
      const hashInput = `${gateway.keyId}|${orderNumber}|${amount.toString()}|${productInfo}|${firstName}|${student.email}|||||||||||${secret}`;
      const hash = createHash('sha512').update(hashInput).digest('hex');
      const baseUrl = gateway.environment === 'LIVE' ? 'https://secure.payu.in/_payment' : 'https://test.payu.in/_payment';
      return { providerOrderId: orderNumber, checkout: { mode: 'FORM_POST', url: baseUrl, fields: { key: gateway.keyId, txnid: orderNumber, amount: amount.toString(), productinfo: productInfo, firstname: firstName, email: student.email, phone: student.phone, surl: appendQuery(successUrl, 'payment_order', orderId), furl: appendQuery(failureUrl, 'payment_order', orderId), hash } } };
    }
    let url: string;
    let headers: Record<string, string>;
    let body: string;
    if (gateway.provider === 'RAZORPAY') {
      url = 'https://api.razorpay.com/v1/orders';
      headers = { authorization: `Basic ${Buffer.from(`${gateway.keyId}:${secret}`).toString('base64')}`, 'content-type': 'application/json' };
      body = JSON.stringify({ amount: minorAmount.toString(), currency, receipt: orderNumber, notes: { paymentOrderId: orderId } });
    } else if (gateway.provider === 'STRIPE') {
      const config = recordValue(gateway.extraConfig);
      const successUrl = safeHttpUrl(config.successUrl);
      const cancelUrl = safeHttpUrl(config.failureUrl ?? config.cancelUrl);
      if (!successUrl || !cancelUrl) throw AppError.validation('Configure HTTPS successUrl and failureUrl for this Stripe gateway.');
      url = 'https://api.stripe.com/v1/checkout/sessions';
      headers = { authorization: `Bearer ${secret}`, 'content-type': 'application/x-www-form-urlencoded' };
      const form = new URLSearchParams({
        mode: 'payment',
        success_url: appendQuery(successUrl, 'payment_order', orderId),
        cancel_url: appendQuery(cancelUrl, 'payment_order', orderId),
        client_reference_id: orderId,
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': currency.toLowerCase(),
        'line_items[0][price_data][unit_amount]': minorAmount.toString(),
        'line_items[0][price_data][product_data][name]': `Fee payment ${orderNumber}`,
        'metadata[payment_order_id]': orderId,
        'metadata[order_number]': orderNumber,
      });
      body = form.toString();
    } else if (gateway.provider === 'CASHFREE') {
      if (!student.email || !student.phone) throw AppError.validation('Cashfree checkout requires the student’s email and phone number.');
      url = `${gateway.environment === 'LIVE' ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com'}/pg/orders`;
      headers = { 'x-client-id': gateway.keyId, 'x-client-secret': secret, 'x-api-version': String(recordValue(gateway.extraConfig).apiVersion ?? '2023-08-01'), 'content-type': 'application/json', 'x-idempotency-key': orderId };
      const returnUrl = safeHttpUrl(recordValue(gateway.extraConfig).successUrl);
      body = JSON.stringify({ order_id: orderNumber, order_amount: amount.toString(), order_currency: currency, customer_details: { customer_id: student.id, customer_name: [student.firstName, student.lastName].filter(Boolean).join(' '), customer_email: student.email, customer_phone: student.phone }, order_meta: { payment_order_id: orderId, ...(returnUrl ? { return_url: appendQuery(returnUrl, 'payment_order', orderId) } : {}) } });
    } else {
      throw AppError.unprocessable('GATEWAY_ADAPTER_NOT_CONFIGURED', `No adapter is registered for gateway ${gateway.provider}.`);
    }
    let response: Response;
    try {
      response = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new ProviderRequestError('PROVIDER_RESPONSE_UNKNOWN', true);
    }
    const json = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new ProviderRequestError(`HTTP_${response.status}`, response.status === 408 || response.status === 409 || response.status === 425 || response.status === 429 || response.status >= 500);
    if (gateway.provider === 'RAZORPAY') {
      const providerOrderId = stringValue(json.id);
      if (!providerOrderId) throw new ProviderRequestError('INVALID_PROVIDER_RESPONSE', true);
      const callbackUrl = safeHttpUrl(recordValue(gateway.extraConfig).successUrl);
      return { providerOrderId, checkout: { mode: 'RAZORPAY', keyId: gateway.keyId, orderId: providerOrderId, amount: minorAmount.toString(), currency, ...(callbackUrl ? { callbackUrl: appendQuery(callbackUrl, 'payment_order', orderId) } : {}) } };
    }
    if (gateway.provider === 'STRIPE') {
      const providerOrderId = stringValue(json.id);
      const checkoutUrl = stringValue(json.url);
      if (!providerOrderId || !checkoutUrl || !safeHttpUrl(checkoutUrl)) throw new ProviderRequestError('INVALID_PROVIDER_RESPONSE', true);
      return { providerOrderId, checkout: { mode: 'REDIRECT', url: checkoutUrl } };
    }
    const providerOrderId = stringValue(json.order_id);
    const paymentSessionId = stringValue(json.payment_session_id);
    if (!providerOrderId || !paymentSessionId) throw new ProviderRequestError('INVALID_PROVIDER_RESPONSE', true);
    return { providerOrderId, checkout: { mode: 'CASHFREE', paymentSessionId, environment: gateway.environment } };
  }

  private validateCapturedEvent(event: NormalizedGatewayEvent, expectedAmount: string, expectedCurrency: string): string | null {
    if (!event.currency || event.currency.toUpperCase() !== expectedCurrency.toUpperCase()) return 'GATEWAY_CURRENCY_MISMATCH';
    if (!event.amount) return 'GATEWAY_AMOUNT_MISSING';
    const actual = Money.fromString(event.amount, expectedCurrency);
    if (!actual.isPositive) return 'GATEWAY_AMOUNT_INVALID';
    return actual.equals(Money.fromString(expectedAmount, expectedCurrency)) ? null : 'GATEWAY_AMOUNT_MISMATCH';
  }

  private safeGateway(row: { id: string; provider: GatewayProvider; environment: GatewayEnvironment; displayName: string; keyId: string; webhookSecretCiphertext: string | null; enabled: boolean; active: boolean; isDefault: boolean; isBackup: boolean; priority: number; supportedMethods: PaymentMethodKind[]; routingRules: Prisma.JsonValue | null; minAmount: Prisma.Decimal | null; maxAmount: Prisma.Decimal | null; extraConfig: Prisma.JsonValue | null; updatedAt: Date }): SafeGateway {
    return { id: row.id, provider: row.provider, environment: row.environment, displayName: row.displayName, keyIdMasked: EncryptionService.mask(row.keyId), hasWebhookSecret: Boolean(row.webhookSecretCiphertext), enabled: row.enabled, active: row.active, isDefault: row.isDefault, isBackup: row.isBackup, priority: row.priority, supportedMethods: row.supportedMethods, routingRules: row.routingRules, minAmount: row.minAmount?.toString() ?? null, maxAmount: row.maxAmount?.toString() ?? null, updatedAt: row.updatedAt };
  }

  private assertTenant(tenantId: string) { if (this.tenantContext.requireTenantId() !== tenantId) throw AppError.forbidden('The requested tenant does not match the authenticated session.'); }
}

/**
 * Periodically finds expired online orders and asks the configured provider
 * whether money was captured or the order is terminal. The durable per-order
 * lease keeps multiple API replicas from polling the same order concurrently;
 * all financial state changes still pass through GatewaysService's verified,
 * tenant-scoped transaction path.
 */
@Injectable()
class GatewayStatusScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GatewayStatusScheduler.name);
  private timer?: NodeJS.Timeout;
  private activeRun?: Promise<void>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateways: GatewaysService,
    private readonly tenantContext: TenantContextService,
    private readonly config: AppConfigService,
  ) {}

  onModuleInit() {
    if (this.config.isTest) return;
    const interval = this.config.gatewayStatusReconciliation.pollIntervalMs;
    this.timer = setInterval(() => { void this.run(); }, interval);
    this.timer.unref();
    void this.run();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.activeRun;
  }

  private run() {
    if (this.activeRun) return this.activeRun;
    this.activeRun = this.scan().catch((error: unknown) => {
      this.logger.error({ error: safeStatusCheckError(error) }, 'Gateway status reconciliation scan failed');
    }).finally(() => { this.activeRun = undefined; });
    return this.activeRun;
  }

  private async scan() {
    const tenants = await this.tenantContext.run(
      { requestId: `gateway-reconcile-directory:${randomUUID()}`, isPlatformAdmin: true },
      async () => await this.prisma.db.tenant.findMany({ where: { status: 'ACTIVE' }, select: { id: true } }),
    );
    for (const tenant of tenants) {
      try {
        await this.tenantContext.run({ tenantId: tenant.id, userId: undefined, roles: [], requestId: `gateway-reconcile:${randomUUID()}`, isPlatformAdmin: false }, async () => {
        const now = new Date();
        const retry = this.config.gatewayStatusReconciliation;
        const transactionCandidates = await this.prisma.db.gatewayTransaction.findMany({
          where: { tenantId: tenant.id, paymentOrderId: { not: null }, paymentId: null, providerOrderId: { not: null }, status: { in: ['CREATED', 'AUTHORIZED', 'FAILED', 'EXPIRED'] } },
          select: { paymentOrderId: true },
          distinct: ['paymentOrderId'],
        });
        const paymentOrderIds = transactionCandidates.flatMap((row) => row.paymentOrderId ? [row.paymentOrderId] : []);
        if (!paymentOrderIds.length) return;
        const due = await this.prisma.db.paymentOrder.findMany({
          where: {
            tenantId: tenant.id,
            id: { in: paymentOrderIds },
            channel: 'ONLINE',
            status: { in: ['CREATED', 'INITIATED', 'PENDING'] },
            provider: { not: null },
            expiresAt: { lte: now },
            providerStatusAutoCheckAttempts: { lt: retry.maxAutomaticAttempts },
            AND: [
              { OR: [{ providerStatusNextCheckAt: null }, { providerStatusNextCheckAt: { lte: now } }] },
              { OR: [{ providerStatusCheckLeaseUntil: null }, { providerStatusCheckLeaseUntil: { lte: now } }] },
            ],
          },
          orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
          take: 25,
          select: { id: true },
        });
        for (const order of due) {
          try {
            await this.gateways.verifyProviderStatus(tenant.id, order.id, { scheduled: true });
          } catch (error) {
            this.logger.warn({ tenantId: tenant.id, orderId: order.id, error: safeStatusCheckError(error) }, 'Scheduled provider check did not complete');
          }
        }
        });
      } catch (error) {
        this.logger.warn({ tenantId: tenant.id, error: safeStatusCheckError(error) }, 'Tenant provider status scan did not complete');
      }
    }
  }
}

function safeStatusCheckError(error: unknown): string {
  return safeOperationalErrorCode(error, 'PROVIDER_STATUS_CHECK_FAILED');
}

@ApiTags('payment gateways')
@RequireModules('PAYMENTS')
@Controller('gateways')
export class GatewaysController {
  constructor(private readonly gateways: GatewaysService) {}
  @Get() @RequirePermissions(PERMISSIONS.TENANT_SETTINGS_READ) list(@CurrentTenant() tenant: string) { return this.gateways.list(tenant); }
  @Post() @RequirePermissions(PERMISSIONS.TENANT_SETTINGS_UPDATE) @UsePipes(new ZodValidationPipe(createGatewaySchema)) create(@CurrentTenant() tenant: string, @Body() body: CreateGatewayInput) { return this.gateways.create(tenant, body); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.TENANT_SETTINGS_UPDATE) @UsePipes(new ZodValidationPipe(updateGatewaySchema)) update(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: UpdateGatewayInput) { return this.gateways.update(tenant, id, body); }
  @Get('orders') @RequirePermissions(PERMISSIONS.PAYMENT_READ) orders(@CurrentTenant() tenant: string) { return this.gateways.listOrders(tenant); }
  @Get('orders/:id') @PortalRoute() @RequirePermissions(PERMISSIONS.PAYMENT_READ) order(@CurrentTenant() tenant: string, @Param('id') id: string) { return this.gateways.getOrder(tenant, id); }
  @Post('orders/:id/verify-provider-status') @RequirePermissions(PERMISSIONS.PAYMENT_VERIFY) @ApiOperation({ summary: 'Verify an overdue order with its tenant-configured provider' }) verifyProviderStatus(@CurrentTenant() tenant: string, @Param('id') id: string) { return this.gateways.verifyProviderStatus(tenant, id); }
  @Post('orders') @PortalRoute() @RequirePermissions(PERMISSIONS.PAYMENT_COLLECT) @UsePipes(new ZodValidationPipe(createPaymentOrderSchema)) createOrder(@CurrentTenant() tenant: string, @Body() body: CreatePaymentOrderInput) { return this.gateways.createOrder(tenant, body); }
}

@ApiTags('payment webhooks')
@Controller('webhooks')
export class GatewayWebhooksController {
  constructor(private readonly gateways: GatewaysService, private readonly tenantContext: TenantContextService) {}
  @Post(':tenantSlug/:configId') @Public() @HttpCode(200) @ApiOperation({ summary: 'Receive, verify, persist, and idempotently process a gateway event' })
  async receive(@Param('tenantSlug') slug: string, @Param('configId') configId: string, @Req() request: RequestWithContext) {
    const host = request.tenantHost ?? this.tenantContext.peek()?.tenantHost;
    // The URL slug is retained for provider callback compatibility, but the
    // tenant identity always comes from hostname resolution. A platform-subdomain,
    // unknown, inactive, or sibling-host callback cannot select another tenant.
    if (!host || host.kind !== 'tenant' || host.slug !== slug || host.status !== 'ACTIVE') {
      throw AppError.notFound('Webhook endpoint');
    }
    this.tenantContext.establish({ tenantId: host.tenantId, userId: undefined, isPlatformAdmin: false });
    return this.gateways.receiveWebhook(host.tenantId, configId, request);
  }
}

@Module({ imports: [PrismaModule, TenantContextModule, PaymentsModule], controllers: [GatewaysController, GatewayWebhooksController], providers: [GatewaysService, GatewayStatusScheduler, EncryptionService], exports: [GatewaysService] })
export class GatewaysModule {}

class ProviderRequestError extends Error { constructor(readonly code: string, readonly mayHaveCreatedOrder = false) { super(code); this.name = 'ProviderRequestError'; } }

function toMinorUnits(amount: Money, minorUnits: number): bigint {
  const scale = 4 - minorUnits;
  if (scale < 0) throw AppError.validation('The configured currency precision is unsupported by this provider.');
  const divisor = 10n ** BigInt(scale);
  if (amount.units % divisor !== 0n) throw AppError.validation(`This gateway can accept ${amount.currency.code} values with at most ${minorUnits} decimal places.`);
  return amount.units / divisor;
}

function signatureHeader(provider: GatewayProvider): string {
  if (provider === 'RAZORPAY') return 'x-razorpay-signature';
  if (provider === 'STRIPE') return 'stripe-signature';
  if (provider === 'CASHFREE') return 'x-webhook-signature';
  if (provider === 'PAYU') return 'hash';
  return 'x-mock-signature';
}

function verifySignature(provider: GatewayProvider, secret: string, raw: Buffer, signature: string, headers: RequestWithContext['headers'], body: unknown): boolean {
  if (provider === 'RAZORPAY' || provider === 'MOCK') return safeEqual(createHmac('sha256', secret).update(raw).digest('hex'), signature);
  if (provider === 'CASHFREE') {
    const timestamp = firstHeader(headers, 'x-webhook-timestamp');
    if (!timestamp) return false;
    // Cashfree supports delayed retries and dashboard resends. The timestamp is
    // signed, while body-derived event identity, payload matching, and the
    // financial state transition make a replay idempotent; avoid a freshness
    // cutoff that would reject a legitimate delayed delivery.
    return safeEqual(createHmac('sha256', secret).update(timestamp).update(raw).digest('base64'), signature);
  }
  if (provider === 'STRIPE') {
    const parts = Object.fromEntries(signature.split(',').map((part) => part.trim().split('=', 2) as [string, string]));
    const timestamp = parts.t;
    if (!timestamp || !parts.v1 || !/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
    return parts.v1.split(',').some((candidate) => safeEqual(createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest('hex'), candidate));
  }
  const event = recordValue(body);
  const text = [secret, event.status, '', '', '', '', '', '', '', '', '', '', event.email, event.firstname, event.productinfo, event.amount, event.txnid, event.key].join('|');
  return safeEqual(createHash('sha512').update(text).digest('hex'), signature);
}

function normalizeEvent(provider: GatewayProvider, bodyValue: unknown, headers: RequestWithContext['headers'], minorUnits: number): NormalizedGatewayEvent {
  const body = recordValue(bodyValue);
  if (provider === 'RAZORPAY') {
    const payment = recordValue(recordValue(recordValue(body.payload).payment).entity);
    const orderId = stringValue(payment.order_id);
    const status = body.event === 'payment.captured' || body.event === 'order.paid' ? 'SUCCESS' : body.event === 'payment.failed' ? 'FAILED' : 'PENDING';
    const currency = stringValue(payment.currency);
    return { eventId: stringValue(body.id) ?? '', eventType: stringValue(body.event) ?? 'unknown', providerOrderId: orderId, providerPaymentId: stringValue(payment.id), status, amount: (typeof payment.amount === 'number' || typeof payment.amount === 'string') && currency ? fromMinorUnits(String(payment.amount), minorUnits, currency) : null, currency, rawStatus: stringValue(payment.status) ?? String(body.event ?? 'unknown') };
  }
  if (provider === 'STRIPE') {
    const data = recordValue(body.data); const object = recordValue(data.object); const eventType = stringValue(body.type) ?? 'unknown';
    const status = eventType === 'checkout.session.completed' && object.payment_status === 'paid' ? 'SUCCESS'
      : eventType === 'checkout.session.async_payment_succeeded' ? 'SUCCESS'
      : eventType === 'checkout.session.async_payment_failed' || eventType === 'payment_intent.payment_failed' ? 'FAILED' : 'PENDING';
    const currency = stringValue(object.currency)?.toUpperCase() ?? null;
    const amountMinor = typeof object.amount_total === 'number' ? object.amount_total : typeof object.amount_received === 'number' ? object.amount_received : typeof object.amount === 'number' ? object.amount : null;
    return { eventId: stringValue(body.id) ?? '', eventType, providerOrderId: stringValue(object.id), providerPaymentId: stringValue(object.payment_intent) ?? stringValue(object.id), status, amount: currency && amountMinor !== null ? fromMinorUnits(String(amountMinor), minorUnits, currency) : null, currency, rawStatus: stringValue(object.payment_status) ?? stringValue(object.status) ?? eventType };
  }
  if (provider === 'CASHFREE') {
    const data = recordValue(body.data); const payment = recordValue(data.payment); const order = recordValue(data.order); const statusValue = String(payment.payment_status ?? '');
    return { eventId: stringValue(body.id) ?? '', eventType: stringValue(body.type) ?? 'unknown', providerOrderId: stringValue(order.order_id), providerPaymentId: stringValue(payment.cf_payment_id), status: statusValue === 'SUCCESS' ? 'SUCCESS' : statusValue === 'FAILED' ? 'FAILED' : 'PENDING', amount: typeof payment.payment_amount === 'number' || typeof payment.payment_amount === 'string' ? String(payment.payment_amount) : null, currency: stringValue(order.order_currency), rawStatus: statusValue || 'unknown' };
  }
  if (provider === 'PAYU') {
    const status = String(body.status ?? '').toLowerCase();
    // PayU's documented response hash does not cover mihpayid or currency.
    // Use the signed merchant txnid for correlation and never promote an
    // unsigned provider ID into payment/reconciliation identity.
    return { eventId: '', eventType: 'payment', providerOrderId: stringValue(body.txnid), providerPaymentId: null, status: status === 'success' ? 'SUCCESS' : status === 'failure' ? 'FAILED' : 'PENDING', amount: stringValue(body.amount), currency: stringValue(body.currency) ?? null, rawStatus: status || 'unknown' };
  }
  const status = String(body.status ?? '').toUpperCase();
  return { eventId: stringValue(body.eventId) ?? '', eventType: stringValue(body.eventType) ?? 'test', providerOrderId: stringValue(body.orderId), providerPaymentId: stringValue(body.paymentId), status: status === 'SUCCESS' ? 'SUCCESS' : status === 'FAILED' ? 'FAILED' : 'PENDING', amount: stringValue(body.amount), currency: stringValue(body.currency), rawStatus: status || 'unknown' };
}

function fromMinorUnits(value: string, minorUnits: number, currency: string): string {
  if (!/^\d+$/.test(value) || minorUnits < 0 || minorUnits > 4) throw AppError.validation('The provider returned an invalid monetary amount.');
  const units = BigInt(value) * (10n ** BigInt(4 - minorUnits));
  return Money.fromUnits(units, currency).toString();
}

function safeEqual(expected: string, actual: string): boolean {
  const left = Buffer.from(expected); const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}
function firstHeader(headers: RequestWithContext['headers'], key: string): string | undefined { const value = headers[key]; return Array.isArray(value) ? value[0] : value; }
function safeHeaders(headers: RequestWithContext['headers']): Record<string, string> { const allowed = ['x-razorpay-signature', 'x-razorpay-event-id', 'stripe-signature', 'x-webhook-signature', 'x-webhook-timestamp', 'x-webhook-id', 'hash', 'user-agent']; return Object.fromEntries(allowed.flatMap((key) => { const value = firstHeader(headers, key); return value ? [[key, value.slice(0, 2048)]] : []; })); }
function stringValue(value: unknown): string | null { return typeof value === 'string' && value.length ? value : null; }
function recordValue(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function jsonValue(value: unknown): Prisma.InputJsonValue { return (value && typeof value === 'object' ? value : {}) as Prisma.InputJsonValue; }
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}
function safeHttpUrl(value: unknown): string | null { if (typeof value !== 'string') return null; try { const url = new URL(value); return url.protocol === 'https:' ? url.toString() : null; } catch { return null; } }
function appendQuery(value: string, key: string, item: string): string { const url = new URL(value); url.searchParams.set(key, item); return url.toString(); }
function decimalGreaterThan(left: string, right: string): boolean {
  const toParts = (value: string) => { const [whole = '0', fraction = ''] = value.split('.'); return BigInt(`${whole}${fraction.padEnd(4, '0')}`); };
  return toParts(left) > toParts(right);
}
