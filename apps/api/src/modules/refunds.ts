import { Body, Controller, Get, Injectable, Module, Param, Post, Query, UsePipes } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { Money } from '@fee/money';
import { Prisma, type DemandItemStatus, type DemandStatus, type InstallmentStatus, type RefundStatus, type TransactionClient } from '@fee/database';
import { ERROR_CODES, PERMISSIONS, type SystemLedgerAccountKey } from '@fee/types';
import { createRefundSchema, refundDecisionSchema, refundReconciliationSchema, type CreateRefundInput, type RefundReconciliationInput } from '@fee/validation';
import { createAdapter, GatewayError, type GatewayCredentials, type RefundResult } from '@fee/payment-contracts';
import { AppError } from '../common/errors';
import { AuditService, IdempotencyService, LedgerService, OutboxService, SequenceService, syncInvoiceSettlement } from '../common/financial';
import { paginate, parseListQuery, toPrismaOrderBy, ZodValidationPipe } from '../common/http';
import { PrismaModule, PrismaService } from '../common/prisma.service';
import { CurrentTenant, RequireModules, RequirePermissions, TenantContextModule, TenantContextService } from '../common/tenancy';
import { EncryptionService } from '../common/security';

type RefundSource =
  | { type: 'CREDIT'; credit: { id: string; originalAmount: Prisma.Decimal; availableAmount: Prisma.Decimal; allocatedAmount: Prisma.Decimal; refundedAmount: Prisma.Decimal; status: string }; amount: Money }
  | { type: 'CREDIT_ALLOCATION'; credit: { id: string; originalAmount: Prisma.Decimal; availableAmount: Prisma.Decimal; allocatedAmount: Prisma.Decimal; refundedAmount: Prisma.Decimal; status: string }; allocation: { id: string; amount: Prisma.Decimal; demandId: string | null; demandItemId: string | null; installmentId: string | null; reversedAt: Date | null }; installmentItem: RefundInstallmentItem | null; item: RefundItem | null; demand: RefundDemand | null; amount: Money }
  | { type: 'PAYMENT_ALLOCATION'; allocation: { id: string; amount: Prisma.Decimal; demandId: string | null; demandItemId: string | null; installmentId: string | null; reversedAt: Date | null }; installmentItem: RefundInstallmentItem | null; item: RefundItem | null; demand: RefundDemand | null; amount: Money };
type RefundItem = { id: string; status: DemandItemStatus; netAmount: Prisma.Decimal; adjustmentAmount: Prisma.Decimal; paidAmount: Prisma.Decimal; waivedAmount: Prisma.Decimal; updatedAt: Date };
type RefundDemand = { id: string; status: DemandStatus; netAmount: Prisma.Decimal; adjustmentAmount: Prisma.Decimal; paidAmount: Prisma.Decimal; waivedAmount: Prisma.Decimal; creditedAmount: Prisma.Decimal; dueDate: Date; updatedAt: Date };
type RefundInstallmentItem = { id: string; installmentId: string; amount: Prisma.Decimal; adjustmentAmount: Prisma.Decimal; paidAmount: Prisma.Decimal; updatedAt: Date; installment: { id: string; amount: Prisma.Decimal; adjustmentAmount: Prisma.Decimal; paidAmount: Prisma.Decimal; waivedAmount: Prisma.Decimal; dueDate: Date; status: InstallmentStatus; updatedAt: Date } };

@Injectable()
export class RefundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly sequences: SequenceService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly tenantContext: TenantContextService,
    private readonly encryption: EncryptionService,
  ) {}

  async create(tenantId: string, input: CreateRefundInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId ?? null;
    const requestHash = IdempotencyService.fingerprint(input);
    return this.prisma.transactionWithRetry(async (tx) => {
      const reservation = await this.idempotency.reserve(tx, { tenantId, scope: 'refund.create', key: input.idempotencyKey, requestHash });
      if (!reservation.isNew) return reservation.cachedResponse?.body;
      const payment = await tx.payment.findFirst({ where: { tenantId, id: input.paymentId } });
      if (!payment) throw AppError.notFound('Payment');
      if (!['SUCCESS', 'PARTIALLY_REFUNDED'].includes(payment.status)) throw AppError.conflict('PAYMENT_NOT_REFUNDABLE', 'Only successful payments can be refunded.');
      if (input.toCreditBalance && !payment.studentId && !payment.personId) throw AppError.validation('A refund can become credit only when the payment belongs to an organisation person or student.');
      const currency = payment.currency;
      const amount = Money.fromString(input.amount, currency);
      const refundable = Money.fromString(payment.amount.toString(), currency).subtract(Money.fromString(payment.refundedAmount.toString(), currency));
      if (!amount.isPositive || amount.greaterThan(refundable)) throw AppError.validation(`Refund amount cannot exceed the remaining ${refundable.toString()} ${currency}.`);
      let method: { id: string; kind: typeof payment.methodKind; requiresReference: boolean; requiresInstrument: boolean } | null = null;
      let gatewayTransactionId: string | null = null;
      if (input.kind === 'MANUAL') {
        method = await tx.paymentMethod.findFirst({ where: { tenantId, id: input.methodId, active: true, enabledForManual: true }, select: { id: true, kind: true, requiresReference: true, requiresInstrument: true } });
        if (!method) throw AppError.validation('Choose an active tenant payment method for the refund.');
        if (method.requiresReference && !input.referenceNumber?.trim()) throw AppError.validation('This refund method requires a reference number.');
        if (method.requiresInstrument && !input.instrumentNumber?.trim()) throw AppError.validation('This refund method requires an instrument number.');
      } else {
        if (payment.channel !== 'ONLINE' || !payment.provider || !payment.gatewayConfigId) throw AppError.validation('Only captured online payments with a configured provider can use a gateway refund.');
        if (payment.provider === 'PAYU') throw AppError.validation('PayU refunds must be initiated in the PayU merchant dashboard and recorded as manual refunds.');
        const transaction = await tx.gatewayTransaction.findFirst({ where: { tenantId, paymentId: payment.id, gatewayConfigId: payment.gatewayConfigId, provider: payment.provider, status: 'CAPTURED' } });
        if (!transaction || (!transaction.providerPaymentId && !payment.providerTxnId)) throw AppError.conflict('GATEWAY_PAYMENT_REFERENCE_MISSING', 'The captured provider payment reference is unavailable, so a gateway refund cannot be safely matched.');
        gatewayTransactionId = transaction.id;
      }

      const settings = await tx.tenantSettings.findUnique({ where: { tenantId } });
      const threshold = settings?.refundApprovalThreshold ? Money.fromString(settings.refundApprovalThreshold.toString(), currency) : null;
      const requiresApproval = Boolean(threshold && amount.greaterThanOrEqual(threshold));
      const refundNumber = await this.sequences.allocate(tx, { tenantId, kind: 'REFUND', asOfDate: new Date().toISOString().slice(0, 10) });
      const refundId = randomUUID();
      let approvalRequestId: string | null = null;
      if (requiresApproval) {
        const approval = await tx.approvalRequest.create({
          data: { tenantId, actionType: 'REFUND', status: 'PENDING', entityType: 'Refund', entityId: refundId, payload: { refundId }, summary: `Approve refund ${currency} ${amount.format()} · ${payment.paymentNumber}`, amount: amount.toString(), currency, requestedBy: actorId ?? null, thresholdAmount: threshold?.toString() },
        });
        approvalRequestId = approval.id;
      }
      const refund = await tx.refund.create({
        data: { id: refundId, tenantId, branchId: payment.branchId, refundNumber, paymentId: payment.id, kind: input.kind, status: requiresApproval ? 'PENDING_APPROVAL' : 'APPROVED', amount: amount.toString(), currency, reason: input.reason, methodKind: method?.kind ?? payment.methodKind, methodId: method?.id ?? payment.methodId, gatewayTransactionId, referenceNumber: input.referenceNumber ?? null, instrumentNumber: input.instrumentNumber ?? null, bankName: input.bankName ?? null, toCreditBalance: input.toCreditBalance, requestedBy: actorId ?? null, approvedBy: requiresApproval ? null : actorId ?? null, approvedAt: requiresApproval ? null : new Date(), approvalRequestId },
      });
      const response = { refund, approvalRequestId, requiresApproval };
      await this.idempotency.complete(tx, { id: reservation.id, responseCode: requiresApproval ? 202 : 201, responseBody: response, resourceId: refund.id, resourceType: 'Refund' });
      await this.audit.record(tx, { tenantId, actorId, action: 'REFUND_REQUESTED', entityType: 'Refund', entityId: refund.id, after: { refundNumber, paymentId: payment.id, amount: amount.toString(), currency, kind: refund.kind, status: refund.status, toCreditBalance: input.toCreditBalance } });
      await this.outbox.publish(tx, { tenantId, eventType: 'REFUND_REQUESTED', aggregateType: 'Refund', aggregateId: refund.id, payload: { refundId: refund.id, refundNumber, paymentId: payment.id, amount: amount.toString(), currency, status: refund.status }, actorId, requestId: this.tenantContext.requestId });
      return response;
    });
  }

  async list(tenantId: string, raw: Record<string, unknown>) {
    this.assertTenant(tenantId);
    const query = parseListQuery(raw, { allowedSortFields: ['refundNumber', 'status', 'amount', 'createdAt'] });
    const where: Prisma.RefundWhereInput = { tenantId, ...(query.status?.length ? { status: { in: query.status as RefundStatus[] } } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.db.refund.findMany({ where, orderBy: toPrismaOrderBy(query.sort) as Prisma.RefundOrderByWithRelationInput[], skip: query.skip, take: query.take }),
      this.prisma.db.refund.count({ where }),
    ]);
    return paginate(items, total, query);
  }

  async get(tenantId: string, id: string) {
    this.assertTenant(tenantId);
    const refund = await this.prisma.db.refund.findFirst({ where: { tenantId, id } });
    if (!refund) throw AppError.notFound('Refund');
    const reversals = await this.prisma.db.refundAllocation.findMany({ where: { tenantId, refundId: id }, orderBy: { createdAt: 'asc' } });
    return { ...refund, allocationReversals: reversals };
  }

  async decide(tenantId: string, id: string, input: { approved: boolean; note?: string | null }) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const refund = await tx.refund.findFirst({ where: { tenantId, id } });
      if (!refund) throw AppError.notFound('Refund');
      if (refund.status !== 'PENDING_APPROVAL' || !refund.approvalRequestId) throw AppError.conflict('REFUND_NOT_PENDING_APPROVAL', 'This refund is not awaiting approval.');
      const approval = await tx.approvalRequest.findFirst({ where: { tenantId, id: refund.approvalRequestId, actionType: 'REFUND', status: 'PENDING' } });
      if (!approval) throw AppError.conflict('APPROVAL_NOT_PENDING', 'The refund approval request is no longer pending.');
      const changedApproval = await tx.approvalRequest.updateMany({ where: { tenantId, id: approval.id, status: 'PENDING' }, data: { status: input.approved ? 'APPROVED' : 'REJECTED', decidedBy: actorId ?? null, decidedAt: new Date(), decisionNote: input.note ?? null } });
      if (changedApproval.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'This approval changed while being decided.');
      const changedRefund = await tx.refund.updateMany({ where: { tenantId, id, status: 'PENDING_APPROVAL', updatedAt: refund.updatedAt }, data: { status: input.approved ? 'APPROVED' : 'REJECTED', approvedBy: input.approved ? actorId ?? null : null, approvedAt: input.approved ? new Date() : null } });
      if (changedRefund.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'This refund changed while being decided.');
      const updated = await tx.refund.findFirst({ where: { tenantId, id } });
      await this.audit.record(tx, { tenantId, actorId, action: input.approved ? 'REFUND_APPROVED' : 'REFUND_REJECTED', entityType: 'Refund', entityId: id, before: { status: refund.status }, after: { status: updated?.status }, reason: input.note });
      await this.outbox.publish(tx, { tenantId, eventType: input.approved ? 'REFUND_APPROVED' : 'REFUND_REJECTED', aggregateType: 'Refund', aggregateId: id, payload: { refundId: id, status: updated?.status }, actorId, requestId: this.tenantContext.requestId });
      return updated;
    });
  }

  async reconcileGatewayRefund(tenantId: string, id: string, input: RefundReconciliationInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId ?? null;
    const refund = await this.prisma.db.refund.findFirst({ where: { tenantId, id, kind: 'GATEWAY' } });
    if (!refund) throw AppError.notFound('Gateway refund');
    if (refund.status !== 'PROCESSING') throw AppError.conflict('REFUND_NOT_PROCESSING', 'Only a gateway refund awaiting provider confirmation can be reconciled.');
    if (refund.failureReason === 'PROVIDER_REFUND_SUCCEEDED_ACCOUNTING_PENDING' && input.outcome !== 'REFUNDED') {
      throw AppError.conflict('REFUND_PROVIDER_SUCCESS_ALREADY_CONFIRMED', 'Provider success is already recorded. Finalize the local ledger posting instead of changing the provider result.');
    }
    if (input.outcome === 'REFUNDED') {
      const actualAmount = Money.fromString(input.amount, input.currency);
      const expectedAmount = Money.fromString(refund.amount.toString(), refund.currency);
      if (!actualAmount.equals(expectedAmount) || input.currency !== refund.currency.toUpperCase()) {
        throw AppError.conflict('GATEWAY_REFUND_RESULT_MISMATCH', 'The provider refund amount and currency must exactly match the requested refund before it can be posted.');
      }
      if (refund.providerRefundId && refund.providerRefundId !== input.providerRefundId) {
        throw AppError.conflict('GATEWAY_REFUND_ID_MISMATCH', 'The provider refund ID differs from the ID already recorded for this request.');
      }
    }

    const nextFailureReason = input.outcome === 'REFUNDED' ? 'PROVIDER_REFUND_SUCCEEDED_ACCOUNTING_PENDING' : 'PROVIDER_REFUND_FAILED';
    const updated = await this.prisma.transactionWithRetry(async (tx) => {
      const changed = await tx.refund.updateMany({
        where: { tenantId, id, kind: 'GATEWAY', status: 'PROCESSING', updatedAt: refund.updatedAt },
        data: {
          status: input.outcome === 'REFUNDED' ? 'PROCESSING' : 'FAILED',
          providerRefundId: input.providerRefundId ?? refund.providerRefundId,
          failureReason: nextFailureReason,
        },
      });
      if (changed.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'The refund changed while the provider reconciliation was being saved.');
      await tx.reconciliationRecord.updateMany({
        where: { tenantId, refundId: id, status: { in: ['OPEN', 'MISMATCHED'] } },
        data: { status: 'RESOLVED', resolution: input.resolution, resolvedBy: actorId, resolvedAt: new Date() },
      });
      await this.audit.record(tx, { tenantId, actorId, action: input.outcome === 'REFUNDED' ? 'REFUND_GATEWAY_RECONCILED_SUCCESS' : 'REFUND_GATEWAY_RECONCILED_FAILED', entityType: 'Refund', entityId: id, before: { status: refund.status, failureReason: refund.failureReason }, after: { status: input.outcome === 'REFUNDED' ? 'PROCESSING' : 'FAILED', providerRefundId: input.providerRefundId ?? refund.providerRefundId, providerAmount: input.amount, providerCurrency: input.currency }, reason: input.resolution });
      await this.outbox.publish(tx, { tenantId, eventType: input.outcome === 'REFUNDED' ? 'REFUND_GATEWAY_RECONCILED_SUCCESS' : 'REFUND_GATEWAY_RECONCILED_FAILED', aggregateType: 'Refund', aggregateId: id, payload: { refundId: id, refundNumber: refund.refundNumber, paymentId: refund.paymentId, status: input.outcome === 'REFUNDED' ? 'PROCESSING' : 'FAILED', providerRefundId: input.providerRefundId ?? refund.providerRefundId }, actorId, requestId: this.tenantContext.requestId });
      return tx.refund.findFirst({ where: { tenantId, id } });
    });
    if (input.outcome === 'REFUNDED') return this.postCompletedRefund(tenantId, id, actorId, 'PROCESSING');
    return updated;
  }

  async complete(tenantId: string, id: string) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId ?? null;
    const refund = await this.prisma.db.refund.findFirst({ where: { tenantId, id } });
    if (!refund) throw AppError.notFound('Refund');
    if (refund.status === 'COMPLETED') return refund;
    if (refund.kind === 'GATEWAY') return this.processGatewayRefund(tenantId, refund.id, actorId);
    return this.postCompletedRefund(tenantId, id, actorId, 'APPROVED');
  }

  private async processGatewayRefund(tenantId: string, id: string, actorId: string | null) {
    const refund = await this.prisma.db.refund.findFirst({ where: { tenantId, id, kind: 'GATEWAY' } });
    if (!refund) throw AppError.notFound('Refund');
    if (refund.status !== 'APPROVED') {
      if (refund.status === 'PROCESSING' && refund.failureReason === 'PROVIDER_REFUND_SUCCEEDED_ACCOUNTING_PENDING' && refund.providerRefundId) {
        return this.postCompletedRefund(tenantId, id, actorId, 'PROCESSING');
      }
      if (refund.status === 'PROCESSING') throw AppError.conflict('REFUND_PROVIDER_CONFIRMATION_PENDING', 'The provider has not confirmed this refund yet. Do not submit it again; check the provider dashboard and reconcile the recorded refund result.');
      throw AppError.conflict('REFUND_NOT_APPROVED', 'Only an approved refund can be sent to the payment provider.');
    }
    const [payment, gatewayTransaction] = await Promise.all([
      this.prisma.db.payment.findFirst({ where: { tenantId, id: refund.paymentId } }),
      refund.gatewayTransactionId ? this.prisma.db.gatewayTransaction.findFirst({ where: { tenantId, id: refund.gatewayTransactionId } }) : null,
    ]);
    if (!payment || payment.channel !== 'ONLINE' || !payment.provider || !payment.gatewayConfigId || !gatewayTransaction
      || gatewayTransaction.paymentId !== payment.id || gatewayTransaction.gatewayConfigId !== payment.gatewayConfigId
      || gatewayTransaction.provider !== payment.provider || gatewayTransaction.status !== 'CAPTURED') {
      throw AppError.conflict('GATEWAY_PAYMENT_REFERENCE_MISSING', 'The captured provider payment reference is unavailable or inconsistent.');
    }
    if (payment.provider === 'PAYU') throw AppError.validation('PayU refunds must be initiated in the PayU merchant dashboard and recorded as manual refunds.');
    const config = await this.prisma.db.tenantPaymentGateway.findFirst({ where: { tenantId, id: payment.gatewayConfigId } });
    if (!config || config.provider !== payment.provider || config.environment !== gatewayTransaction.environment) {
      throw AppError.conflict('GATEWAY_CONFIG_NOT_FOUND', 'The tenant gateway configuration for this payment is unavailable or inconsistent.');
    }
    const providerPaymentId = gatewayTransaction.providerPaymentId ?? payment.providerTxnId;
    if (!providerPaymentId) throw AppError.conflict('GATEWAY_PAYMENT_REFERENCE_MISSING', 'The provider payment identifier is missing.');
    const amount = Money.fromString(refund.amount.toString(), refund.currency);
    const refundable = Money.fromString(payment.amount.toString(), payment.currency).subtract(Money.fromString(payment.refundedAmount.toString(), payment.currency));
    if (amount.greaterThan(refundable)) throw AppError.conflict('REFUND_AMOUNT_CHANGED', 'The source payment no longer has enough refundable balance.');
    const credentials: GatewayCredentials = {
      provider: config.provider,
      environment: config.environment,
      keyId: config.keyId,
      secret: this.encryption.decrypt(config.secretCiphertext),
      extra: config.extraConfig && typeof config.extraConfig === 'object' && !Array.isArray(config.extraConfig) ? config.extraConfig as Record<string, unknown> : {},
    };

    const claimed = await this.prisma.transactionWithRetry(async (tx) => {
      const result = await tx.refund.updateMany({
        where: { tenantId, id, kind: 'GATEWAY', status: 'APPROVED', updatedAt: refund.updatedAt },
        data: { status: 'PROCESSING', gatewayTransactionId: gatewayTransaction.id, failureReason: null },
      });
      if (result.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'The refund changed before the provider request could be started.');
      await this.audit.record(tx, { tenantId, actorId, action: 'REFUND_GATEWAY_SUBMITTED', entityType: 'Refund', entityId: id, before: { status: 'APPROVED' }, after: { status: 'PROCESSING', provider: config.provider, gatewayTransactionId: gatewayTransaction.id } });
      await this.outbox.publish(tx, { tenantId, eventType: 'REFUND_GATEWAY_SUBMITTED', aggregateType: 'Refund', aggregateId: id, payload: { refundId: id, paymentId: payment.id, provider: config.provider }, actorId, requestId: this.tenantContext.requestId });
      return tx.refund.findFirst({ where: { tenantId, id } });
    });
    if (!claimed) throw AppError.notFound('Refund');

    let providerResult: RefundResult;
    try {
      providerResult = await createAdapter(config.provider).refundPayment({
        credentials,
        refundNumber: refund.refundNumber,
        providerPaymentId,
        providerOrderId: gatewayTransaction.providerOrderId ?? undefined,
        amount,
        currency: refund.currency,
        reason: refund.reason,
        notes: { refund_number: refund.refundNumber, tenant_id: tenantId },
      });
    } catch (error) {
      const errorCode = error instanceof GatewayError ? error.code : 'PROVIDER_RESPONSE_UNKNOWN';
      return this.saveGatewayRefundOutcome(tenantId, refund, actorId, {
        status: 'PROCESSING',
        providerRefundId: null,
        failureReason: errorCode,
        action: 'REFUND_GATEWAY_RECONCILIATION_REQUIRED',
        eventType: 'REFUND_GATEWAY_RECONCILIATION_REQUIRED',
        reconciliation: { mismatchType: 'GATEWAY_REFUND_RESULT_UNKNOWN', expectedAmount: amount.toString(), actualAmount: null, actualCurrency: null },
      });
    }

    const amountMatches = providerResult.amount.equals(amount);
    const currencyMatches = providerResult.currency.toUpperCase() === refund.currency.toUpperCase();
    if (!amountMatches || !currencyMatches) {
      return this.saveGatewayRefundOutcome(tenantId, refund, actorId, {
        status: 'PROCESSING',
        providerRefundId: providerResult.providerRefundId,
        failureReason: 'GATEWAY_REFUND_RESULT_MISMATCH',
        action: 'REFUND_GATEWAY_RECONCILIATION_REQUIRED',
        eventType: 'REFUND_GATEWAY_RECONCILIATION_REQUIRED',
        reconciliation: { mismatchType: 'GATEWAY_REFUND_RESULT_MISMATCH', expectedAmount: amount.toString(), actualAmount: providerResult.amount.toString(), actualCurrency: providerResult.currency },
      });
    }
    if (providerResult.status === 'FAILED') {
      return this.saveGatewayRefundOutcome(tenantId, refund, actorId, {
        status: 'FAILED',
        providerRefundId: providerResult.providerRefundId,
        failureReason: 'PROVIDER_REFUND_FAILED',
        action: 'REFUND_GATEWAY_FAILED',
        eventType: 'REFUND_GATEWAY_FAILED',
      });
    }
    if (providerResult.status !== 'REFUNDED') {
      return this.saveGatewayRefundOutcome(tenantId, refund, actorId, {
        status: 'PROCESSING',
        providerRefundId: providerResult.providerRefundId,
        failureReason: null,
        action: 'REFUND_GATEWAY_PROCESSING',
        eventType: 'REFUND_GATEWAY_PROCESSING',
      });
    }

    await this.prisma.transactionWithRetry(async (tx) => {
      const changed = await tx.refund.updateMany({ where: { tenantId, id, status: 'PROCESSING' }, data: { providerRefundId: providerResult.providerRefundId, failureReason: 'PROVIDER_REFUND_SUCCEEDED_ACCOUNTING_PENDING' } });
      if (changed.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'The refund changed while provider confirmation was being recorded.');
      await this.audit.record(tx, { tenantId, actorId, action: 'REFUND_GATEWAY_CONFIRMED', entityType: 'Refund', entityId: id, before: { status: 'PROCESSING' }, after: { status: 'PROCESSING', providerRefundId: providerResult.providerRefundId, providerStatus: providerResult.rawStatus ?? providerResult.status, localPosting: 'PENDING' } });
    });
    return this.postCompletedRefund(tenantId, id, actorId, 'PROCESSING');
  }

  private async saveGatewayRefundOutcome(tenantId: string, refund: { id: string; refundNumber: string; paymentId: string; currency: string }, actorId: string | null, outcome: {
    status: 'PROCESSING' | 'FAILED'; providerRefundId: string | null; failureReason: string | null;
    action: string; eventType: string;
    reconciliation?: { mismatchType: string; expectedAmount: string; actualAmount: string | null; actualCurrency: string | null };
  }) {
    return this.prisma.transactionWithRetry(async (tx) => {
      const changed = await tx.refund.updateMany({ where: { tenantId, id: refund.id, status: 'PROCESSING' }, data: { status: outcome.status, providerRefundId: outcome.providerRefundId, failureReason: outcome.failureReason } });
      if (changed.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'The refund changed while provider state was being recorded.');
      if (outcome.reconciliation) {
        const existing = await tx.reconciliationRecord.findFirst({ where: { tenantId, refundId: refund.id, status: 'OPEN', mismatchType: outcome.reconciliation.mismatchType }, select: { id: true } });
        if (!existing) await tx.reconciliationRecord.create({ data: {
          tenantId, gatewayTransactionId: (await tx.refund.findFirst({ where: { tenantId, id: refund.id }, select: { gatewayTransactionId: true } }))?.gatewayTransactionId ?? null,
          paymentId: refund.paymentId, refundId: refund.id, status: 'OPEN', mismatchType: outcome.reconciliation.mismatchType,
          expectedAmount: outcome.reconciliation.expectedAmount, actualAmount: outcome.reconciliation.actualAmount,
          difference: outcome.reconciliation.actualAmount && (outcome.reconciliation.actualCurrency ?? refund.currency).toUpperCase() === refund.currency.toUpperCase()
            ? Money.fromString(outcome.reconciliation.actualAmount, refund.currency).subtract(Money.fromString(outcome.reconciliation.expectedAmount, refund.currency)).toString()
            : null,
          currency: refund.currency, actualCurrency: outcome.reconciliation.actualCurrency,
          notes: 'The provider refund response requires an operator to verify the provider dashboard and reconcile the financial result before local accounting is completed.',
        } });
      }
      await this.audit.record(tx, { tenantId, actorId, action: outcome.action, entityType: 'Refund', entityId: refund.id, before: { status: 'PROCESSING' }, after: { status: outcome.status, providerRefundId: outcome.providerRefundId, failureReason: outcome.failureReason } });
      await this.outbox.publish(tx, { tenantId, eventType: outcome.eventType, aggregateType: 'Refund', aggregateId: refund.id, payload: { refundId: refund.id, refundNumber: refund.refundNumber, paymentId: refund.paymentId, status: outcome.status, providerRefundId: outcome.providerRefundId }, actorId, requestId: this.tenantContext.requestId });
      return tx.refund.findFirst({ where: { tenantId, id: refund.id } });
    });
  }

  private async postCompletedRefund(tenantId: string, id: string, actorId: string | null, expectedStatus: 'APPROVED' | 'PROCESSING') {
    return this.prisma.transactionWithRetry(async (tx) => {
      const refund = await tx.refund.findFirst({ where: { tenantId, id } });
      if (!refund) throw AppError.notFound('Refund');
      if (refund.status !== expectedStatus) throw AppError.conflict('REFUND_NOT_APPROVED', 'The refund is not in the state required for financial posting.');
      if (refund.kind === 'GATEWAY' && expectedStatus !== 'PROCESSING') throw AppError.conflict('REFUND_PROVIDER_CONFIRMATION_REQUIRED', 'A gateway refund can only be posted after confirmed provider success.');
      if (refund.kind === 'MANUAL' && expectedStatus !== 'APPROVED') throw AppError.conflict('REFUND_NOT_APPROVED', 'Only an approved manual refund can be processed.');
      const payment = await tx.payment.findFirst({ where: { tenantId, id: refund.paymentId } });
      if (!payment || (!payment.studentId && !payment.personId)) throw AppError.conflict('REFUND_PAYMENT_UNAVAILABLE', 'The source payment is unavailable for refund processing.');
      const isGenericPerson = !payment.studentId && Boolean(payment.personId);
      const receivableAccount: SystemLedgerAccountKey = isGenericPerson ? 'TENANT_PERSON_RECEIVABLE' : 'STUDENT_RECEIVABLE';
      const creditAccount: SystemLedgerAccountKey = isGenericPerson ? 'TENANT_PERSON_CREDIT' : 'STUDENT_CREDIT';
      const amount = Money.fromString(refund.amount.toString(), refund.currency);
      const refundable = Money.fromString(payment.amount.toString(), payment.currency).subtract(Money.fromString(payment.refundedAmount.toString(), payment.currency));
      if (amount.greaterThan(refundable)) throw AppError.conflict('REFUND_AMOUNT_CHANGED', 'The source payment no longer has enough refundable balance.');
      const sources = await this.planSources(tx, tenantId, payment.id, refund.currency, amount);
      let resultingCreditId: string | null = null;
      const demandChanges = new Map<string, { item: RefundItem; demand: RefundDemand; amount: Money }>();
      const installmentChanges = new Map<string, { item: RefundInstallmentItem; amount: Money }>();
      const ledgerLines: Array<{ accountKey: SystemLedgerAccountKey; side: 'DEBIT' | 'CREDIT'; amount: string; narration: string }> = [];
      let createdCreditAmount = Money.zero(refund.currency);
      for (const source of sources) {
        const entry: Prisma.RefundAllocationCreateManyInput = { tenantId, refundId: refund.id, paymentId: payment.id, amount: source.amount.toString(), createdBy: actorId ?? null };
        if (source.type === 'CREDIT') {
          entry.creditId = source.credit.id;
          const newAvailable = Money.fromString(source.credit.availableAmount.toString(), refund.currency).subtract(source.amount);
          const newRefunded = Money.fromString(source.credit.refundedAmount.toString(), refund.currency).add(source.amount);
          await this.updateCredit(tx, tenantId, source.credit, newAvailable, Money.fromString(source.credit.allocatedAmount.toString(), refund.currency), newRefunded);
          if (refund.toCreditBalance) createdCreditAmount = createdCreditAmount.add(source.amount);
          else ledgerLines.push({ accountKey: creditAccount, side: 'DEBIT', amount: source.amount.toString(), narration: `Refund from person credit · ${refund.refundNumber}` });
        } else {
          entry.demandId = source.demand?.id ?? null;
          entry.demandItemId = source.item?.id ?? null;
          if (source.type === 'CREDIT_ALLOCATION') {
            entry.creditAllocationId = source.allocation.id;
            const newAvailable = Money.fromString(source.credit.availableAmount.toString(), refund.currency);
            const oldAllocated = Money.fromString(source.credit.allocatedAmount.toString(), refund.currency);
            const newAllocated = oldAllocated.subtract(source.amount);
            const newRefunded = Money.fromString(source.credit.refundedAmount.toString(), refund.currency).add(refund.toCreditBalance ? Money.zero(refund.currency) : source.amount);
            const restoredAvailable = refund.toCreditBalance ? newAvailable.add(source.amount) : newAvailable;
            if (refund.toCreditBalance) createdCreditAmount = createdCreditAmount.add(Money.zero(refund.currency));
            await this.updateCredit(tx, tenantId, source.credit, restoredAvailable, newAllocated, newRefunded);
            await this.markCreditAllocationReversed(tx, tenantId, source.allocation, source.amount);
          } else {
            entry.paymentAllocationId = source.allocation.id;
            await this.markPaymentAllocationReversed(tx, tenantId, source.allocation, source.amount);
            if (refund.toCreditBalance) createdCreditAmount = createdCreditAmount.add(source.amount);
          }
          if (!source.item || !source.demand) throw AppError.conflict('REFUND_ALLOCATION_MISSING_DEMAND', 'An allocated payment cannot be refunded because its demand item is missing.');
          const prior = demandChanges.get(source.item.id) ?? { item: source.item, demand: source.demand, amount: Money.zero(refund.currency) };
          prior.amount = prior.amount.add(source.amount);
          demandChanges.set(source.item.id, prior);
          if (source.installmentItem) {
            const installmentChange = installmentChanges.get(source.installmentItem.id) ?? { item: source.installmentItem, amount: Money.zero(refund.currency) };
            installmentChange.amount = installmentChange.amount.add(source.amount);
            installmentChanges.set(source.installmentItem.id, installmentChange);
          }
          if (!refund.toCreditBalance) ledgerLines.push({ accountKey: receivableAccount, side: 'DEBIT', amount: source.amount.toString(), narration: `Reopen fee demand · ${refund.refundNumber}` });
          else if (source.type === 'CREDIT_ALLOCATION' || source.type === 'PAYMENT_ALLOCATION') ledgerLines.push({ accountKey: receivableAccount, side: 'DEBIT', amount: source.amount.toString(), narration: `Move refunded amount to credit · ${refund.refundNumber}` });
        }
        await tx.refundAllocation.create({ data: { id: randomUUID(), ...entry } });
      }
      if (refund.toCreditBalance) {
        if (createdCreditAmount.isPositive) {
          resultingCreditId = randomUUID();
          await tx.credit.create({ data: { id: resultingCreditId!, tenantId, branchId: payment.branchId, studentId: payment.studentId, personId: isGenericPerson ? payment.personId : null, source: 'REFUND_TO_CREDIT', status: 'AVAILABLE', currency: refund.currency, originalAmount: createdCreditAmount.toString(), allocatedAmount: '0.0000', availableAmount: createdCreditAmount.toString(), refundedAmount: '0.0000', paymentId: payment.id, refundId: refund.id, reason: `Refund ${refund.refundNumber} returned to person credit`, createdBy: actorId ?? null } });
        }
        const liabilityCredit = sources.filter((source) => source.type !== 'CREDIT').reduce((sum, source) => sum.add(source.amount), Money.zero(refund.currency));
        if (liabilityCredit.isPositive) ledgerLines.push({ accountKey: creditAccount, side: 'CREDIT', amount: liabilityCredit.toString(), narration: `Refund credited to person · ${refund.refundNumber}` });
        const availableCreditTransfer = sources.filter((source) => source.type === 'CREDIT').reduce((sum, source) => sum.add(source.amount), Money.zero(refund.currency));
        if (availableCreditTransfer.isPositive) {
          ledgerLines.push({ accountKey: creditAccount, side: 'DEBIT', amount: availableCreditTransfer.toString(), narration: `Transfer payment credit · ${refund.refundNumber}` });
          ledgerLines.push({ accountKey: creditAccount, side: 'CREDIT', amount: availableCreditTransfer.toString(), narration: `Transfer to refund credit · ${refund.refundNumber}` });
        }
      } else {
        const cashAccount: SystemLedgerAccountKey = refund.kind === 'GATEWAY' ? 'GATEWAY_CLEARING' : refund.methodKind === 'CASH' ? 'CASH_IN_HAND' : 'BANK_ACCOUNT';
        ledgerLines.push({ accountKey: cashAccount, side: 'CREDIT', amount: amount.toString(), narration: `${refund.kind === 'GATEWAY' ? 'Gateway' : 'Manual'} refund ${refund.refundNumber}` });
      }
      await this.persistDemandChanges(tx, tenantId, demandChanges);
      await this.persistInstallmentChanges(tx, tenantId, refund.currency, installmentChanges);
      const posted = await this.ledger.post(tx, { tenantId, currency: refund.currency, eventType: 'REFUND_COMPLETED', entryDate: new Date().toISOString().slice(0, 10), lines: ledgerLines, studentId: payment.studentId, personId: isGenericPerson ? payment.personId : null, paymentId: payment.id, refundId: refund.id, creditId: resultingCreditId, narration: `Refund ${refund.refundNumber}`, createdBy: actorId ?? null });
      const nextRefunded = Money.fromString(payment.refundedAmount.toString(), payment.currency).add(amount);
      const allocationReduction = sources.filter((source) => source.type !== 'CREDIT').reduce((sum, source) => sum.add(source.amount), Money.zero(payment.currency));
      const unallocatedReduction = sources.filter((source) => source.type === 'CREDIT').reduce((sum, source) => sum.add(source.amount), Money.zero(payment.currency));
      const nextAllocated = Money.fromString(payment.allocatedAmount.toString(), payment.currency).subtract(allocationReduction);
      const nextUnallocated = Money.fromString(payment.unallocatedAmount.toString(), payment.currency).subtract(unallocatedReduction);
      if (nextAllocated.isNegative || nextUnallocated.isNegative) throw AppError.conflict('PAYMENT_ALLOCATION_BALANCE_MISMATCH', 'Refund sources exceed the payment’s recorded allocation totals.');
      const nextStatus = nextRefunded.greaterThanOrEqual(Money.fromString(payment.amount.toString(), payment.currency)) ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
      const updatedPayment = await tx.payment.updateMany({ where: { tenantId, id: payment.id, status: payment.status, refundedAmount: payment.refundedAmount }, data: { allocatedAmount: nextAllocated.toString(), unallocatedAmount: nextUnallocated.toString(), refundedAmount: nextRefunded.toString(), netAmount: Money.fromString(payment.amount.toString(), payment.currency).subtract(nextRefunded).toString(), status: nextStatus, updatedBy: actorId ?? null } });
      if (updatedPayment.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'The source payment changed while the refund was being posted.');
      const updatedRefund = await tx.refund.updateMany({ where: { tenantId, id, status: expectedStatus, updatedAt: refund.updatedAt }, data: { status: 'COMPLETED', processedBy: actorId ?? null, processedAt: new Date(), reversalApplied: true, resultingCreditId, failureReason: null } });
      if (updatedRefund.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'The refund changed while it was being posted.');
      const result = await tx.refund.findFirst({ where: { tenantId, id } });
      await this.audit.record(tx, { tenantId, actorId, action: 'REFUND_COMPLETED', entityType: 'Refund', entityId: id, before: { status: refund.status }, after: { status: 'COMPLETED', paymentStatus: nextStatus, amount: amount.toString(), ledgerGroupId: posted.transactionGroupId, resultingCreditId } });
      await this.outbox.publish(tx, { tenantId, eventType: 'REFUND_COMPLETED', aggregateType: 'Refund', aggregateId: id, payload: { refundId: id, paymentId: payment.id, amount: amount.toString(), currency: refund.currency, toCreditBalance: refund.toCreditBalance, resultingCreditId }, actorId, requestId: this.tenantContext.requestId });
      return result;
    });
  }

  private async planSources(tx: TransactionClient, tenantId: string, paymentId: string, currency: string, amount: Money): Promise<RefundSource[]> {
    const credits = await tx.credit.findMany({ where: { tenantId, paymentId, status: { in: ['AVAILABLE', 'PARTIALLY_ALLOCATED', 'ALLOCATED'] } }, orderBy: { createdAt: 'asc' } });
    const sources: RefundSource[] = [];
    let remaining = amount;
    for (const credit of credits) {
      const available = Money.fromString(credit.availableAmount.toString(), currency);
      const use = available.min(remaining);
      if (use.isPositive) { sources.push({ type: 'CREDIT', credit, amount: use }); remaining = remaining.subtract(use); }
      if (!remaining.isPositive) return sources;
    }
    const creditAllocations = credits.length ? await tx.creditAllocation.findMany({ where: { tenantId, creditId: { in: credits.map((credit) => credit.id) } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }) : [];
    const creditAllocationIds = creditAllocations.map((row) => row.id);
    const reversedCredit = creditAllocationIds.length ? await tx.refundAllocation.groupBy({ by: ['creditAllocationId'], where: { tenantId, creditAllocationId: { in: creditAllocationIds } }, _sum: { amount: true } }) : [];
    const creditReversedById = new Map(reversedCredit.map((row) => [row.creditAllocationId, row._sum.amount?.toString() ?? '0']));
    const creditById = new Map(credits.map((credit) => [credit.id, credit]));
    for (const allocation of creditAllocations) {
      const credit = creditById.get(allocation.creditId)!;
      const outstanding = allocation.reversedAt ? Money.zero(currency) : Money.fromString(allocation.amount.toString(), currency).subtract(Money.fromString(creditReversedById.get(allocation.id) ?? '0', currency));
      const use = outstanding.min(remaining);
      if (use.isPositive) {
        const item = allocation.demandItemId ? await tx.feeDemandItem.findFirst({ where: { tenantId, id: allocation.demandItemId } }) : null;
        const demand = item ? await tx.feeDemand.findFirst({ where: { tenantId, id: item.demandId } }) : null;
        const installmentItem = await this.loadInstallmentItem(tx, tenantId, allocation.installmentId, allocation.demandItemId, allocation.demandId);
        sources.push({ type: 'CREDIT_ALLOCATION', credit, allocation, installmentItem, item, demand, amount: use }); remaining = remaining.subtract(use);
      }
      if (!remaining.isPositive) return sources;
    }
    const paymentAllocations = await tx.paymentAllocation.findMany({ where: { tenantId, paymentId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    const paymentAllocationIds = paymentAllocations.map((row) => row.id);
    const reversedPayment = paymentAllocationIds.length ? await tx.refundAllocation.groupBy({ by: ['paymentAllocationId'], where: { tenantId, paymentAllocationId: { in: paymentAllocationIds } }, _sum: { amount: true } }) : [];
    const paymentReversedById = new Map(reversedPayment.map((row) => [row.paymentAllocationId, row._sum.amount?.toString() ?? '0']));
    for (const allocation of paymentAllocations) {
      const outstanding = allocation.reversedAt ? Money.zero(currency) : Money.fromString(allocation.amount.toString(), currency).subtract(Money.fromString(paymentReversedById.get(allocation.id) ?? '0', currency));
      const use = outstanding.min(remaining);
      if (use.isPositive) {
        const item = allocation.demandItemId ? await tx.feeDemandItem.findFirst({ where: { tenantId, id: allocation.demandItemId } }) : null;
        const demand = item ? await tx.feeDemand.findFirst({ where: { tenantId, id: item.demandId } }) : null;
        const installmentItem = await this.loadInstallmentItem(tx, tenantId, allocation.installmentId, allocation.demandItemId, allocation.demandId);
        sources.push({ type: 'PAYMENT_ALLOCATION', allocation, installmentItem, item, demand, amount: use }); remaining = remaining.subtract(use);
      }
      if (!remaining.isPositive) return sources;
    }
    if (remaining.isPositive) throw AppError.conflict('REFUND_SOURCE_BALANCE_MISMATCH', 'The payment’s remaining funds are not fully represented by its allocations or available credit.');
    return sources;
  }

  private async loadInstallmentItem(tx: TransactionClient, tenantId: string, installmentId: string | null, demandItemId: string | null, demandId: string | null): Promise<RefundInstallmentItem | null> {
    if (!installmentId) return null;
    if (!demandItemId || !demandId) throw AppError.conflict('REFUND_INSTALLMENT_LINK_INVALID', 'An installment allocation is missing its demand item reference.');
    const row = await tx.installmentItem.findFirst({ where: { tenantId, installmentId, demandItemId } });
    const installment = await tx.installment.findFirst({ where: { tenantId, id: installmentId } });
    if (!row || !installment || installment.demandId !== demandId) throw AppError.conflict('REFUND_INSTALLMENT_LINK_INVALID', 'The installment allocation no longer matches its saved demand item.');
    return { ...row, installment } as RefundInstallmentItem;
  }

  private async updateCredit(tx: TransactionClient, tenantId: string, credit: { id: string; originalAmount: Prisma.Decimal; availableAmount: Prisma.Decimal; allocatedAmount: Prisma.Decimal; refundedAmount: Prisma.Decimal }, available: Money, allocated: Money, refunded: Money) {
    const original = Money.fromString(credit.originalAmount.toString(), available.currency.code);
    if (available.isNegative || allocated.isNegative || refunded.isNegative || !available.add(allocated).add(refunded).equals(original)) throw AppError.conflict('CREDIT_BALANCE_INVARIANT', 'Refund would make the student credit balance inconsistent.');
    const status = refunded.equals(original) ? 'VOID' : allocated.isPositive && available.isPositive ? 'PARTIALLY_ALLOCATED' : allocated.isPositive ? 'ALLOCATED' : 'AVAILABLE';
    const result = await tx.credit.updateMany({ where: { tenantId, id: credit.id, availableAmount: credit.availableAmount, allocatedAmount: credit.allocatedAmount, refundedAmount: credit.refundedAmount }, data: { availableAmount: available.toString(), allocatedAmount: allocated.toString(), refundedAmount: refunded.toString(), status } });
    if (result.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'A student credit changed while the refund was being posted.');
  }

  private async markCreditAllocationReversed(tx: TransactionClient, tenantId: string, allocation: { id: string; amount: Prisma.Decimal }, amount: Money) {
    const prior = await tx.refundAllocation.aggregate({ where: { tenantId, creditAllocationId: allocation.id }, _sum: { amount: true } });
    const reversed = Money.fromString(prior._sum.amount?.toString() ?? '0', amount.currency.code).add(amount);
    if (reversed.equals(Money.fromString(allocation.amount.toString(), amount.currency.code))) await tx.creditAllocation.updateMany({ where: { tenantId, id: allocation.id, reversedAt: null }, data: { reversedAt: new Date(), reason: 'Fully reversed by refund' } });
  }

  private async markPaymentAllocationReversed(tx: TransactionClient, tenantId: string, allocation: { id: string; amount: Prisma.Decimal }, amount: Money) {
    const prior = await tx.refundAllocation.aggregate({ where: { tenantId, paymentAllocationId: allocation.id }, _sum: { amount: true } });
    const reversed = Money.fromString(prior._sum.amount?.toString() ?? '0', amount.currency.code).add(amount);
    if (reversed.equals(Money.fromString(allocation.amount.toString(), amount.currency.code))) await tx.paymentAllocation.updateMany({ where: { tenantId, id: allocation.id, reversedAt: null }, data: { reversedAt: new Date(), reversedBy: this.tenantContext.peek()?.userId ?? null, reversalReason: 'Fully reversed by refund' } });
  }

  private async persistDemandChanges(tx: TransactionClient, tenantId: string, changes: Map<string, { item: RefundItem; demand: RefundDemand; amount: Money }>) {
    const demandTotals = new Map<string, { demand: RefundDemand; amount: Money }>();
    for (const { item, demand, amount } of changes.values()) {
      const itemPaid = Money.fromString(item.paidAmount.toString(), amount.currency).subtract(amount);
      if (itemPaid.isNegative) throw AppError.conflict('REFUND_EXCEEDS_ALLOCATION', 'Refund would reverse more than this demand item has received.');
      const itemNet = Money.fromString(item.netAmount.toString(), amount.currency).add(Money.fromString(item.adjustmentAmount.toString(), amount.currency));
      const itemWaived = Money.fromString(item.waivedAmount.toString(), amount.currency);
      const itemStatus = itemPaid.add(itemWaived).greaterThanOrEqual(itemNet) ? 'PAID' : itemPaid.isZero ? 'UNPAID' : 'PARTIALLY_PAID';
      const itemResult = await tx.feeDemandItem.updateMany({ where: { tenantId, id: item.id, paidAmount: item.paidAmount, updatedAt: item.updatedAt }, data: { paidAmount: itemPaid.toString(), status: itemStatus } });
      if (itemResult.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'A demand item changed while the refund was being posted.');
      const existing = demandTotals.get(demand.id) ?? { demand, amount: Money.zero(amount.currency) };
      existing.amount = existing.amount.add(amount);
      demandTotals.set(demand.id, existing);
    }
    for (const { demand, amount } of demandTotals.values()) {
      const paid = Money.fromString(demand.paidAmount.toString(), amount.currency).subtract(amount);
      if (paid.isNegative) throw AppError.conflict('REFUND_EXCEEDS_DEMAND_PAYMENT', 'Refund would reverse more than the demand has received.');
      const net = Money.fromString(demand.netAmount.toString(), amount.currency).add(Money.fromString(demand.adjustmentAmount.toString(), amount.currency));
      const waived = Money.fromString(demand.waivedAmount.toString(), amount.currency);
      const nextStatus = paid.add(waived).greaterThanOrEqual(net) ? 'PAID' : demand.dueDate < new Date() ? 'OVERDUE' : paid.isZero ? 'ISSUED' : 'PARTIALLY_PAID';
      const result = await tx.feeDemand.updateMany({ where: { tenantId, id: demand.id, paidAmount: demand.paidAmount, updatedAt: demand.updatedAt }, data: { paidAmount: paid.toString(), status: nextStatus } });
      if (result.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'A fee demand changed while the refund was being posted.');
      await syncInvoiceSettlement(tx, { tenantId, demandId: demand.id, paidAmount: paid.toString(), dueDate: demand.dueDate });
    }
  }

  private async persistInstallmentChanges(tx: TransactionClient, tenantId: string, currency: string, changes: Map<string, { item: RefundInstallmentItem; amount: Money }>) {
    const installmentTotals = new Map<string, { installment: RefundInstallmentItem['installment']; amount: Money }>();
    for (const { item, amount } of changes.values()) {
      const paid = Money.fromString(item.paidAmount.toString(), currency).subtract(amount);
      if (paid.isNegative) throw AppError.conflict('REFUND_EXCEEDS_INSTALLMENT_SETTLEMENT', 'Refund would reverse more than the installment item has received.');
      const itemResult = await tx.installmentItem.updateMany({ where: { tenantId, id: item.id, paidAmount: item.paidAmount, updatedAt: item.updatedAt }, data: { paidAmount: paid.toString() } });
      if (itemResult.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'An installment item changed while the refund was being posted.');
      const total = installmentTotals.get(item.installmentId) ?? { installment: item.installment, amount: Money.zero(currency) };
      total.amount = total.amount.add(amount);
      installmentTotals.set(item.installmentId, total);
    }
    for (const { installment, amount } of installmentTotals.values()) {
      const paid = Money.fromString(installment.paidAmount.toString(), currency).subtract(amount);
      if (paid.isNegative) throw AppError.conflict('REFUND_EXCEEDS_INSTALLMENT_SETTLEMENT', 'Refund would reverse more than the installment has received.');
      const net = Money.fromString(installment.amount.toString(), currency).add(Money.fromString(installment.adjustmentAmount.toString(), currency)).subtract(Money.fromString(installment.waivedAmount.toString(), currency));
      const status = paid.greaterThanOrEqual(net) ? 'PAID' : paid.isPositive ? 'PARTIALLY_PAID' : installment.dueDate < new Date() ? 'OVERDUE' : 'PENDING';
      const result = await tx.installment.updateMany({ where: { tenantId, id: installment.id, paidAmount: installment.paidAmount, updatedAt: installment.updatedAt }, data: { paidAmount: paid.toString(), status } });
      if (result.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'An installment changed while the refund was being posted.');
    }
  }

  private assertTenant(tenantId: string): void { if (this.tenantContext.requireTenantId() !== tenantId) throw AppError.forbidden('The requested tenant does not match the authenticated session.'); }
}

@ApiTags('refunds')
@RequireModules('PAYMENTS')
@Controller('refunds')
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}
  @Get() @RequirePermissions(PERMISSIONS.PAYMENT_READ) list(@CurrentTenant() tenant: string, @Query() query: Record<string, unknown>) { return this.refunds.list(tenant, query); }
  @Get(':id') @RequirePermissions(PERMISSIONS.PAYMENT_READ) get(@CurrentTenant() tenant: string, @Param('id') id: string) { return this.refunds.get(tenant, id); }
  @Post() @RequirePermissions(PERMISSIONS.PAYMENT_REFUND) @UsePipes(new ZodValidationPipe(createRefundSchema)) request(@CurrentTenant() tenant: string, @Body() body: CreateRefundInput) { return this.refunds.create(tenant, body); }
  @Post(':id/decision') @RequirePermissions(PERMISSIONS.PAYMENT_REFUND_APPROVE) @UsePipes(new ZodValidationPipe(refundDecisionSchema)) decide(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: { approved: boolean; note?: string | null }) { return this.refunds.decide(tenant, id, body); }
  @Post(':id/reconcile') @RequirePermissions(PERMISSIONS.PAYMENT_REFUND_APPROVE) @UsePipes(new ZodValidationPipe(refundReconciliationSchema)) reconcile(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: RefundReconciliationInput) { return this.refunds.reconcileGatewayRefund(tenant, id, body); }
  @Post(':id/complete') @RequirePermissions(PERMISSIONS.PAYMENT_REFUND) @ApiOperation({ summary: 'Process an approved refund; gateway refunds post only after a matching provider success response' }) complete(@CurrentTenant() tenant: string, @Param('id') id: string) { return this.refunds.complete(tenant, id); }
}

@Module({ imports: [PrismaModule, TenantContextModule], controllers: [RefundsController], providers: [RefundsService, EncryptionService], exports: [RefundsService] })
export class RefundsModule {}
