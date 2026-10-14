import { Body, Controller, Get, Injectable, Module, Param, Patch, Post, Query, UsePipes } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { Money } from '@fee/money';
import { Prisma, type GatewayProvider, type PaymentChannel, type PaymentMethodKind, type PaymentStatus, type TransactionClient } from '@fee/database';
import { ERROR_CODES, PAYER_TYPES, PERMISSIONS, type PayerType, type SystemLedgerAccountKey } from '@fee/types';
import { capPayerShareBalances } from './payer-balance';
import {
  createPaymentMethodSchema,
  manualPaymentSchema,
  approvalDecisionSchema,
  updatePaymentMethodSchema,
  type CreatePaymentMethodInput,
  type ManualPaymentInput,
  type UpdatePaymentMethodInput,
} from '@fee/validation';
import { AppError } from '../common/errors';
import { AuditService, IdempotencyService, LedgerService, OutboxService, SequenceService, requireTenantCurrency, syncInvoiceSettlement } from '../common/financial';
import { buildSearchFilter, paginate, parseListQuery, toPrismaOrderBy, ZodValidationPipe } from '../common/http';
import { PrismaModule, PrismaService } from '../common/prisma.service';
import { CurrentTenant, PortalRoute, RequireModules, RequirePermissions, TenantContextModule, TenantContextService } from '../common/tenancy';

type InstallmentShare = {
  id: string;
  installmentId: string;
  demandItemId: string | null;
  amount: Prisma.Decimal;
  adjustmentAmount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  updatedAt: Date;
  installment: {
    id: string;
    sequence: number;
    label: string;
    dueDate: Date;
    amount: Prisma.Decimal;
    adjustmentAmount: Prisma.Decimal;
    paidAmount: Prisma.Decimal;
    waivedAmount: Prisma.Decimal;
    status: string;
    updatedAt: Date;
  };
};
export type PayerSelection = { type: PayerType; sponsorId?: string | null; payerGuardianId?: string | null; payerName?: string | null };
type ResponsibilityShare = { id: string | null; payerType: PayerType; payerName: string; payerSponsorId: string | null; payerGuardianId: string | null; priority: number; amount: Money; actualOutstanding: Money; reserved: Money; outstanding: Money };
type AllocationDraft = { item: OpenDemandItem; amount: Money; responsibilityId: string | null; installmentShare?: InstallmentShare };
type PaymentSubject = { id: string; studentId: string | null; personId: string | null; branchId: string | null; firstName: string; middleName: string | null; lastName: string | null; admissionNumber: string | null; personNumber: string | null; typeLabel: string };
type OpenDemandItem = {
  id: string;
  tenantId: string;
  demandId: string;
  feeTypeCode: string;
  feeTypeName: string;
  netAmount: Prisma.Decimal;
  adjustmentAmount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  waivedAmount: Prisma.Decimal;
  status: 'UNPAID' | 'PARTIALLY_PAID';
  sequence: number;
  dueDate: Date | null;
  updatedAt: Date;
  installmentShares: InstallmentShare[];
  responsibilities: ResponsibilityShare[];
  demand: {
    id: string;
    branchId: string | null;
    studentId: string | null;
    personId: string | null;
    demandNumber: string;
    financialPeriod: string | null;
    dueDate: Date;
    issueDate: Date;
    currency: string;
    status: 'ISSUED' | 'PARTIALLY_PAID' | 'OVERDUE';
    paidAmount: Prisma.Decimal;
    netAmount: Prisma.Decimal;
    adjustmentAmount: Prisma.Decimal;
  };
};

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly sequences: SequenceService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async listMethods(tenantId: string) {
    this.assertTenant(tenantId);
    return this.prisma.db.paymentMethod.findMany({ where: { tenantId }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  }

  async createMethod(tenantId: string, input: CreatePaymentMethodInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const method = await tx.paymentMethod.create({ data: { tenantId, ...input } });
      await this.audit.record(tx, { tenantId, actorId, action: 'PAYMENT_METHOD_CREATED', entityType: 'PaymentMethod', entityId: method.id, after: method });
      await this.outbox.publish(tx, { tenantId, eventType: 'PAYMENT_METHOD_CREATED', aggregateType: 'PaymentMethod', aggregateId: method.id, payload: { methodId: method.id }, actorId, requestId: this.tenantContext.requestId });
      return method;
    });
  }

  async updateMethod(tenantId: string, id: string, input: UpdatePaymentMethodInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const before = await tx.paymentMethod.findFirst({ where: { tenantId, id } });
      if (!before) throw AppError.notFound('Payment method');
      const result = await tx.paymentMethod.updateMany({ where: { tenantId, id, updatedAt: before.updatedAt }, data: input });
      if (result.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'The payment method changed. Reload and try again.');
      const after = await tx.paymentMethod.findFirst({ where: { tenantId, id } });
      if (!after) throw AppError.notFound('Payment method');
      await this.audit.record(tx, { tenantId, actorId, action: 'PAYMENT_METHOD_UPDATED', entityType: 'PaymentMethod', entityId: id, before, after });
      await this.outbox.publish(tx, { tenantId, eventType: 'PAYMENT_METHOD_UPDATED', aggregateType: 'PaymentMethod', aggregateId: id, payload: { methodId: id }, actorId, requestId: this.tenantContext.requestId });
      return after;
    });
  }

  async collectManual(tenantId: string, input: ManualPaymentInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    const requestHash = IdempotencyService.fingerprint(input);
    return this.prisma.transactionWithRetry(async (tx) => {
      const reservation = await this.idempotency.reserve(tx, { tenantId, scope: 'payment.manual.collect', key: input.idempotencyKey, requestHash });
      if (!reservation.isNew) return reservation.cachedResponse?.body;

      const settings = await tx.tenantSettings.findUnique({ where: { tenantId } });
      const currency = requireTenantCurrency(settings);
      if (input.currency && input.currency !== currency) {
        throw AppError.validation(`Payments for this tenant must use ${currency}.`);
      }
      const amount = Money.fromString(input.amount, currency);
      const method = await tx.paymentMethod.findFirst({ where: { tenantId, id: input.methodId } });
      if (!method || !method.active || !method.enabledForManual) throw AppError.validation('Choose an active payment method enabled for manual collection.');
      if (method.requiresReference && !input.referenceNumber?.trim()) throw AppError.validation('This payment method requires a reference number.');
      if (method.requiresInstrument && !input.instrumentNumber?.trim()) throw AppError.validation('This payment method requires an instrument number.');

      const student = input.studentId ? await tx.student.findFirst({ where: { tenantId, id: input.studentId, deletedAt: null }, select: { id: true, branchId: true, firstName: true, middleName: true, lastName: true, admissionNumber: true } }) : null;
      const person = input.personId ? await tx.tenantPerson.findFirst({ where: { tenantId, id: input.personId, status: 'ACTIVE', deletedAt: null }, select: { id: true, branchId: true, firstName: true, middleName: true, lastName: true, personNumber: true, typeLabel: true } }) : null;
      if (!student && !person) throw AppError.notFound(input.personId ? 'Person' : 'Student');
      const subject: PaymentSubject = student
        ? { id: student.id, studentId: student.id, personId: null, branchId: student.branchId, firstName: student.firstName, middleName: student.middleName, lastName: student.lastName, admissionNumber: student.admissionNumber, personNumber: null, typeLabel: 'Student' }
        : { id: person!.id, studentId: null, personId: person!.id, branchId: person!.branchId, firstName: person!.firstName, middleName: person!.middleName, lastName: person!.lastName, admissionNumber: null, personNumber: person!.personNumber, typeLabel: person!.typeLabel };
      const payer = payerSelection({ ...input, payerType: input.payerType ?? (subject.personId ? 'MEMBER' : 'STUDENT') });
      if (subject.personId) {
        if (input.payerGuardianId) throw AppError.validation('A guardian cannot be attached to a generic person payment.');
        await this.assertPortalPersonAccess(tx, tenantId, subject.personId);
      } else {
        await this.assertPortalPayerAccess(tx, tenantId, subject.studentId!, payer);
      }
      const subjectField = subject.personId ? 'personId' : 'studentId';
      const openItems = await this.openItems(tx, tenantId, subject.id, payer, undefined, subjectField);
      const selectedItems = this.selectItems(openItems, input.demandItemIds);
      const balance = selectedItems.reduce((sum, entry) => sum.add(this.payerItemBalance(entry, payer)), Money.zero(currency));
      if (balance.isZero && input.demandItemIds?.length) throw AppError.conflict('NO_OPEN_BALANCE', 'The selected demand items have no amount left to pay.');

      const remainder = amount.subtract(balance);
      if (payer.type !== 'STUDENT' && remainder.isPositive) throw AppError.validation('A third-party collection cannot exceed that payer’s assigned responsibility.');
      const overpaymentPolicy = settings?.overpaymentPolicy ?? 'CREDIT_BALANCE';
      if (remainder.isPositive && overpaymentPolicy === 'REJECT') throw AppError.validation('The payment is larger than the selected outstanding balance.');
      if (remainder.isPositive && overpaymentPolicy === 'ADVANCE_PAYMENT' && !settings?.allowAdvancePayment) {
        throw AppError.validation('Advance payments are disabled in tenant payment settings.');
      }
      const partial = amount.lessThan(balance);
      const partialPolicy = settings?.partialPaymentPolicy ?? 'ALLOW';
      if (partial && partialPolicy === 'DISALLOW') throw AppError.validation('Tenant settings do not allow partial payment.');
      if (partial && partialPolicy === 'ALLOW_WITH_APPROVAL') {
        const requestedBy = actorId ?? null;
        const approval = await tx.approvalRequest.create({
          data: {
            tenantId,
            actionType: 'PAYMENT_COLLECTION',
            status: 'PENDING',
            entityType: 'PaymentCollection',
            payload: input as unknown as Prisma.InputJsonValue,
            summary: `Approve partial collection of ${currency} ${amount.format()} for ${subject.firstName} ${subject.lastName ?? ''}`,
            amount: amount.toString(),
            currency,
            requestedBy,
          },
        });
        const response = { requiresApproval: true, approvalRequestId: approval.id, status: approval.status, amount: approval.amount, currency };
        await this.idempotency.complete(tx, { id: reservation.id, responseCode: 202, responseBody: response, resourceId: approval.id, resourceType: 'ApprovalRequest' });
        await this.audit.record(tx, { tenantId, actorId, action: 'PAYMENT_COLLECTION_APPROVAL_REQUESTED', entityType: 'ApprovalRequest', entityId: approval.id, after: { amount: amount.toString(), currency, studentId: subject.studentId, personId: subject.personId } });
        await this.outbox.publish(tx, { tenantId, eventType: 'PAYMENT_COLLECTION_APPROVAL_REQUESTED', aggregateType: 'ApprovalRequest', aggregateId: approval.id, payload: { approvalRequestId: approval.id, studentId: subject.studentId, personId: subject.personId, amount: amount.toString(), currency }, actorId, requestId: this.tenantContext.requestId });
        return response;
      }
      const minimum = settings?.minimumPartialAmount ? Money.fromString(settings.minimumPartialAmount.toString(), currency) : null;
      if (partial && minimum && amount.lessThan(minimum)) throw AppError.validation(`A partial payment must be at least ${minimum.format()}.`);

      const response = await this.recordManualPayment(tx, tenantId, input, actorId ?? null, null, method, subject, selectedItems, amount, balance, overpaymentPolicy, settings?.allowAdvancePayment ?? false);
      await this.idempotency.complete(tx, { id: reservation.id, responseCode: 201, responseBody: response, resourceId: response.payment.id, resourceType: 'Payment' });
      return response;
    });
  }

  async list(tenantId: string, raw: Record<string, unknown>) {
    this.assertTenant(tenantId);
    const query = parseListQuery(raw, { allowedSortFields: ['paymentNumber', 'paidAt', 'amount', 'status', 'createdAt'] });
    const studentId = typeof raw.studentId === 'string' && raw.studentId.trim() ? raw.studentId.trim() : undefined;
    if (studentId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(studentId)) throw AppError.validation('The student ID must be a valid identifier.');
    const where: Prisma.PaymentWhereInput = {
      tenantId,
      ...(studentId ? { studentId } : {}),
      ...(query.status?.length ? { status: { in: query.status as PaymentStatus[] } } : {}),
      ...(query.from || query.to ? { paidAt: { ...(query.from ? { gte: dateValue(query.from) } : {}), ...(query.to ? { lte: dateValue(query.to) } : {}) } } : {}),
      ...buildSearchFilter(query.search, ['paymentNumber', 'receiptNumber', 'referenceNumber']),
    };
    const [items, total] = await Promise.all([
      this.prisma.db.payment.findMany({ where, orderBy: toPrismaOrderBy(query.sort) as Prisma.PaymentOrderByWithRelationInput[], skip: query.skip, take: query.take }),
      this.prisma.db.payment.count({ where }),
    ]);
    return paginate(items, total, query);
  }

  async get(tenantId: string, id: string) {
    this.assertTenant(tenantId);
    const payment = await this.prisma.db.payment.findFirst({ where: { tenantId, id } });
    if (!payment) throw AppError.notFound('Payment');
    const [allocations, receipt, student] = await Promise.all([
      this.prisma.db.paymentAllocation.findMany({ where: { tenantId, paymentId: id }, orderBy: { sequence: 'asc' } }),
      this.prisma.db.receipt.findFirst({ where: { tenantId, paymentId: id } }),
      payment.studentId ? this.prisma.db.student.findFirst({ where: { tenantId, id: payment.studentId }, select: { id: true, branchId: true, firstName: true, middleName: true, lastName: true, admissionNumber: true } }) : null,
    ]);
    const demandItemIds = [...new Set(allocations.flatMap((allocation) => allocation.demandItemId ? [allocation.demandItemId] : []))];
    const installmentIds = [...new Set(allocations.flatMap((allocation) => allocation.installmentId ? [allocation.installmentId] : []))];
    const [demandItems, installments, receiptLines] = await Promise.all([
      demandItemIds.length ? this.prisma.db.feeDemandItem.findMany({ where: { tenantId, id: { in: demandItemIds } } }) : [],
      installmentIds.length ? this.prisma.db.installment.findMany({ where: { tenantId, id: { in: installmentIds } } }) : [],
      receipt ? this.prisma.db.receiptLine.findMany({ where: { tenantId, receiptId: receipt.id }, orderBy: { sequence: 'asc' } }) : [],
    ]);
    const demandItemById = new Map(demandItems.map((item) => [item.id, item]));
    const installmentById = new Map(installments.map((installment) => [installment.id, installment]));
    const allocationDetails = allocations.map((allocation) => ({
      ...allocation,
      demandItem: allocation.demandItemId ? demandItemById.get(allocation.demandItemId) ?? null : null,
      installment: allocation.installmentId ? installmentById.get(allocation.installmentId) ?? null : null,
    }));
    const receiptDetails = receipt ? { ...receipt, lines: receiptLines } : null;
    return { ...payment, student, allocations: allocationDetails, receipt: receiptDetails };
  }

  async recordGatewayPayment(tx: TransactionClient, input: { tenantId: string; order: { id: string; branchId: string | null; studentId: string | null; personId?: string | null; methodId: string | null; amount: Prisma.Decimal; currency: string; intendedDemandItemIds: string[]; payerType: PayerType; payerName: string | null; payerPhone: string | null; payerEmail: string | null; payerSponsorId: string | null; payerGuardianId: string | null }; provider: GatewayProvider; gatewayConfigId: string; providerTxnId: string; capturedAmount?: string; holdUnapplied?: boolean; actorId?: string | null }) {
    if ((!input.order.studentId && !input.order.personId) || (input.order.studentId && input.order.personId) || !input.order.methodId) throw AppError.conflict('PAYMENT_ORDER_CONTEXT_MISSING', 'The payment order has no unique person or configured payment method.');
    let holdUnapplied = input.holdUnapplied === true;
    const [settings, method, student, person] = await Promise.all([
      tx.tenantSettings.findUnique({ where: { tenantId: input.tenantId } }),
      tx.paymentMethod.findFirst({ where: { tenantId: input.tenantId, id: input.order.methodId } }),
      input.order.studentId ? tx.student.findFirst({ where: { tenantId: input.tenantId, id: input.order.studentId }, select: { id: true, branchId: true, firstName: true, middleName: true, lastName: true, admissionNumber: true, deletedAt: true } }) : null,
      input.order.personId ? tx.tenantPerson.findFirst({ where: { tenantId: input.tenantId, id: input.order.personId }, select: { id: true, branchId: true, firstName: true, middleName: true, lastName: true, personNumber: true, typeLabel: true, deletedAt: true, status: true } }) : null,
    ]);
    if (!method) throw AppError.conflict('PAYMENT_METHOD_CONTEXT_MISSING', 'The configured payment method for this captured payment is unavailable.');
    if (!student && !person) throw AppError.conflict('PAYMENT_ORDER_PERSON_UNAVAILABLE', 'The person is no longer available for payment.');
    const subject: PaymentSubject = student
      ? { id: student.id, studentId: student.id, personId: null, branchId: student.branchId, firstName: student.firstName, middleName: student.middleName, lastName: student.lastName, admissionNumber: student.admissionNumber, personNumber: null, typeLabel: 'Student' }
      : { id: person!.id, studentId: null, personId: person!.id, branchId: person!.branchId, firstName: person!.firstName, middleName: person!.middleName, lastName: person!.lastName, admissionNumber: null, personNumber: person!.personNumber, typeLabel: person!.typeLabel };
    const currency = input.order.currency;
    if (!settings?.currency || currency !== settings.currency || (student?.deletedAt ?? person?.deletedAt) || (person && person.status !== 'ACTIVE')) holdUnapplied = true;
    const amount = Money.fromString(input.capturedAmount ?? input.order.amount.toString(), currency);
    const payer = payerSelection(input.order);
    if (!holdUnapplied && subject.studentId) await this.assertPortalPayerAccess(tx, input.tenantId, subject.studentId, payer);
    if (!holdUnapplied && subject.personId) await this.assertPortalPersonAccess(tx, input.tenantId, subject.personId);
    if (!holdUnapplied && payer.payerGuardianId && subject.studentId) {
      const [guardian, link] = await Promise.all([
        tx.guardian.findFirst({ where: { tenantId: input.tenantId, id: payer.payerGuardianId, deletedAt: null }, select: { id: true } }),
        tx.studentGuardian.findFirst({ where: { tenantId: input.tenantId, guardianId: payer.payerGuardianId, studentId: subject.studentId }, select: { id: true } }),
      ]);
      if (!guardian || !link) holdUnapplied = true;
    } else if (payer.payerGuardianId) holdUnapplied = true;
    if (!holdUnapplied && payer.type === 'SPONSOR' && payer.sponsorId) {
      const sponsor = await tx.sponsor.findFirst({ where: { tenantId: input.tenantId, id: payer.sponsorId }, select: { id: true } });
      if (!sponsor) holdUnapplied = true;
    }
    const subjectField = subject.personId ? 'personId' : 'studentId';
    const openItems = holdUnapplied ? [] : await this.openItems(tx, input.tenantId, subject.id, payer, input.order.id, subjectField);
    const selectedItems = holdUnapplied ? [] : this.selectItems(openItems, input.order.intendedDemandItemIds.length ? input.order.intendedDemandItemIds : undefined);
    const balance = holdUnapplied ? Money.zero(currency) : selectedItems.reduce((sum, item) => sum.add(this.payerItemBalance(item, payer)), Money.zero(currency));
    const overBalance = !holdUnapplied && amount.greaterThan(balance);
    const partial = !holdUnapplied && amount.lessThan(balance);
    const overpaymentPolicy = settings?.overpaymentPolicy ?? 'CREDIT_BALANCE';
    const partialPolicy = settings?.partialPaymentPolicy ?? 'ALLOW';
    const minimumPartial = settings?.minimumPartialAmount ? Money.fromString(settings.minimumPartialAmount.toString(), currency) : null;
    if (overBalance && (payer.type !== 'STUDENT' || overpaymentPolicy === 'REJECT' || (overpaymentPolicy === 'ADVANCE_PAYMENT' && !settings?.allowAdvancePayment))) holdUnapplied = true;
    if (partial && (partialPolicy === 'DISALLOW' || partialPolicy === 'ALLOW_WITH_APPROVAL' || (minimumPartial && amount.lessThan(minimumPartial)))) holdUnapplied = true;
    const result = await this.recordManualPayment(
      tx,
      input.tenantId,
      { idempotencyKey: randomUUID(), studentId: subject.studentId ?? undefined, personId: subject.personId ?? undefined, methodId: method.id, amount: amount.toString(), currency, demandItemIds: input.order.intendedDemandItemIds.length ? input.order.intendedDemandItemIds : undefined, referenceNumber: input.providerTxnId, payerType: input.order.payerType, payerName: input.order.payerName, payerPhone: input.order.payerPhone, payerEmail: input.order.payerEmail, payerSponsorId: input.order.payerSponsorId, payerGuardianId: input.order.payerGuardianId } as ManualPaymentInput,
      null,
      input.actorId ?? null,
      method,
      subject,
      selectedItems,
      amount,
      balance,
      overpaymentPolicy,
      settings?.allowAdvancePayment ?? false,
      { channel: 'ONLINE', paymentOrderId: input.order.id, branchId: input.order.branchId, provider: input.provider, providerTxnId: input.providerTxnId, gatewayConfigId: input.gatewayConfigId, tenderAccount: 'GATEWAY_CLEARING', ledgerEventType: holdUnapplied ? 'ONLINE_CAPTURE_HELD_FOR_RECONCILIATION' : 'ONLINE_PAYMENT_CAPTURED', skipInstrumentValidation: true, allowInactiveSponsor: true, allowHistoricalPayer: holdUnapplied, holdUnappliedGatewayCapture: holdUnapplied },
    );
    return { ...result, heldForReconciliation: holdUnapplied };
  }

  async openItemsForStudent(tenantId: string, studentId: string, payer: PayerSelection = { type: 'STUDENT' }) {
    this.assertTenant(tenantId);
    return this.prisma.transaction(async (tx) => {
      await this.assertPortalStudentAccess(tx, tenantId, studentId);
      await this.assertPortalPayerAccess(tx, tenantId, studentId, payer);
      const student = await tx.student.findFirst({ where: { tenantId, id: studentId }, select: { id: true } });
      if (!student) throw AppError.notFound('Student');
      const rows = await this.openItems(tx, tenantId, student.id, payer);
      return rows
        .filter((item) => this.payerItemBalance(item, payer).isPositive)
        .sort((left, right) => this.itemDueDate(left).getTime() - this.itemDueDate(right).getTime() || left.demand.issueDate.getTime() - right.demand.issueDate.getTime() || left.sequence - right.sequence)
        .map((item) => ({ ...item, outstandingAmount: this.payerItemBalance(item, payer).toString(), responsibilities: item.responsibilities.map((share) => ({ id: share.id, payerType: share.payerType, payerName: share.payerName, payerSponsorId: share.payerSponsorId, payerGuardianId: share.payerGuardianId, amount: share.amount.toString(), outstandingAmount: share.outstanding.toString() })) }));
    });
  }

  async openItemsForPerson(tenantId: string, personId: string, payer: PayerSelection = { type: 'MEMBER' }) {
    this.assertTenant(tenantId);
    return this.prisma.transaction(async (tx) => {
      await this.assertPortalPersonAccess(tx, tenantId, personId);
      const person = await tx.tenantPerson.findFirst({ where: { tenantId, id: personId, status: 'ACTIVE', deletedAt: null }, select: { id: true } });
      if (!person) throw AppError.notFound('Person');
      const rows = await this.openItems(tx, tenantId, person.id, payer, undefined, 'personId');
      return rows.filter((item) => this.payerItemBalance(item, payer).isPositive)
        .sort((left, right) => this.itemDueDate(left).getTime() - this.itemDueDate(right).getTime() || left.demand.issueDate.getTime() - right.demand.issueDate.getTime() || left.sequence - right.sequence)
        .map((item) => ({ ...item, outstandingAmount: this.payerItemBalance(item, payer).toString(), responsibilities: item.responsibilities.map((share) => ({ id: share.id, payerType: share.payerType, payerName: share.payerName, payerSponsorId: share.payerSponsorId, payerGuardianId: share.payerGuardianId, amount: share.amount.toString(), outstandingAmount: share.outstanding.toString() })) }));
    });
  }

  async pendingCollectionApprovals(tenantId: string) {
    this.assertTenant(tenantId);
    return this.prisma.db.approvalRequest.findMany({ where: { tenantId, actionType: 'PAYMENT_COLLECTION', status: 'PENDING' }, orderBy: { requestedAt: 'asc' } });
  }

  async decideCollectionApproval(tenantId: string, id: string, input: { approved: boolean; note?: string | null }) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const request = await tx.approvalRequest.findFirst({ where: { tenantId, id, actionType: 'PAYMENT_COLLECTION' } });
      if (!request) throw AppError.notFound('Payment collection approval');
      if (request.status !== 'PENDING') throw AppError.conflict('APPROVAL_ALREADY_DECIDED', 'This approval request has already been decided.');
      const changed = await tx.approvalRequest.updateMany({ where: { tenantId, id, status: 'PENDING', actionType: 'PAYMENT_COLLECTION' }, data: { status: input.approved ? 'APPROVED' : 'REJECTED', decidedBy: actorId ?? null, decidedAt: new Date(), decisionNote: input.note ?? null } });
      if (changed.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'This approval changed while being decided. Reload and try again.');

      let collection: unknown = null;
      if (input.approved) {
        const parsed = manualPaymentSchema.safeParse(request.payload);
        if (!parsed.success) throw AppError.unprocessable('INVALID_APPROVAL_PAYLOAD', 'The saved collection request is invalid and cannot be executed.');
        const settings = await tx.tenantSettings.findUnique({ where: { tenantId } });
        const currency = requireTenantCurrency(settings);
        const data = parsed.data;
        if (data.currency && data.currency !== currency) throw AppError.conflict('TENANT_CURRENCY_CHANGED', 'Tenant currency changed since approval was requested.');
        const method = await tx.paymentMethod.findFirst({ where: { tenantId, id: data.methodId, active: true, enabledForManual: true } });
        if (!method) throw AppError.conflict('PAYMENT_METHOD_DISABLED', 'The payment method is no longer enabled.');
        const student = await tx.student.findFirst({ where: { tenantId, id: data.studentId }, select: { id: true, branchId: true, firstName: true, middleName: true, lastName: true, admissionNumber: true } });
        if (!student) throw AppError.notFound('Student');
        const payer = payerSelection(data);
        await this.assertPortalPayerAccess(tx, tenantId, student.id, payer);
        const openItems = await this.openItems(tx, tenantId, student.id, payer);
        const selectedItems = this.selectItems(openItems, data.demandItemIds);
      const balance = selectedItems.reduce((sum, entry) => sum.add(this.payerItemBalance(entry, payer)), Money.zero(currency));
        const amount = Money.fromString(data.amount, currency);
        if (!amount.lessThan(balance)) throw AppError.conflict('APPROVAL_NO_LONGER_REQUIRED', 'The selected balance changed and this collection is no longer a partial payment.');
        const minimum = settings?.minimumPartialAmount ? Money.fromString(settings.minimumPartialAmount.toString(), currency) : null;
        if (minimum && amount.lessThan(minimum)) throw AppError.validation(`A partial payment must be at least ${minimum.format()}.`);
        const subject: PaymentSubject = { id: student.id, studentId: student.id, personId: null, branchId: student.branchId, firstName: student.firstName, middleName: student.middleName, lastName: student.lastName, admissionNumber: student.admissionNumber, personNumber: null, typeLabel: 'Student' };
        collection = await this.recordManualPayment(tx, tenantId, data, request.requestedBy ?? null, actorId ?? null, method, subject, selectedItems, amount, balance, settings?.overpaymentPolicy ?? 'CREDIT_BALANCE', settings?.allowAdvancePayment ?? false);
        await tx.approvalRequest.update({ where: { id }, data: { status: 'EXECUTED', executedAt: new Date() } });
      }
      await this.audit.record(tx, { tenantId, actorId, action: input.approved ? 'PAYMENT_COLLECTION_APPROVED' : 'PAYMENT_COLLECTION_REJECTED', entityType: 'ApprovalRequest', entityId: id, before: { status: request.status }, after: { status: input.approved ? 'EXECUTED' : 'REJECTED', collection }, reason: input.note });
      await this.outbox.publish(tx, { tenantId, eventType: input.approved ? 'PAYMENT_COLLECTION_APPROVED' : 'PAYMENT_COLLECTION_REJECTED', aggregateType: 'ApprovalRequest', aggregateId: id, payload: { approvalRequestId: id, approved: input.approved }, actorId, requestId: this.tenantContext.requestId });
      return { approvalRequestId: id, status: input.approved ? 'EXECUTED' : 'REJECTED', collection };
    });
  }

  async getReceipt(tenantId: string, id: string) {
    this.assertTenant(tenantId);
    const receipt = await this.prisma.db.receipt.findFirst({ where: { tenantId, id } });
    if (!receipt) throw AppError.notFound('Receipt');
    const lines = await this.prisma.db.receiptLine.findMany({ where: { tenantId, receiptId: receipt.id }, orderBy: { sequence: 'asc' } });
    return { ...receipt, lines };
  }

  async listReceipts(tenantId: string, raw: Record<string, unknown>) {
    this.assertTenant(tenantId);
    const query = parseListQuery(raw, { allowedSortFields: ['receiptNumber', 'issueDate', 'totalAmount', 'createdAt'] });
    const where: Prisma.ReceiptWhereInput = {
      tenantId,
      ...(query.from || query.to ? { issueDate: { ...(query.from ? { gte: dateValue(query.from) } : {}), ...(query.to ? { lte: dateValue(query.to) } : {}) } } : {}),
      ...buildSearchFilter(query.search, ['receiptNumber']),
    };
    const [items, total] = await Promise.all([
      this.prisma.db.receipt.findMany({ where, orderBy: toPrismaOrderBy(query.sort) as Prisma.ReceiptOrderByWithRelationInput[], skip: query.skip, take: query.take }),
      this.prisma.db.receipt.count({ where }),
    ]);
    return paginate(items, total, query);
  }

  private async recordManualPayment(
    tx: TransactionClient,
    tenantId: string,
    input: ManualPaymentInput,
    collectedBy: string | null,
    verifiedBy: string | null,
    method: { id: string; kind: PaymentMethodKind; name: string; requiresReference: boolean; requiresInstrument: boolean },
    subject: PaymentSubject,
    selectedItems: OpenDemandItem[],
    amount: Money,
    balance: Money,
    overpaymentPolicy: 'REJECT' | 'CREDIT_BALANCE' | 'ADVANCE_PAYMENT',
    allowAdvancePayment: boolean,
    options?: { channel?: PaymentChannel; paymentOrderId?: string; branchId?: string | null; provider?: GatewayProvider; providerTxnId?: string; gatewayConfigId?: string; tenderAccount?: SystemLedgerAccountKey; ledgerEventType?: string; skipInstrumentValidation?: boolean; allowInactiveSponsor?: boolean; allowHistoricalPayer?: boolean; holdUnappliedGatewayCapture?: boolean },
  ) {
    const currency = amount.currency.code;
    if (!options?.skipInstrumentValidation && method.requiresReference && !input.referenceNumber?.trim()) throw AppError.validation('This payment method requires a reference number.');
    if (!options?.skipInstrumentValidation && method.requiresInstrument && !input.instrumentNumber?.trim()) throw AppError.validation('This payment method requires an instrument number.');
    const sponsor = input.payerSponsorId
      ? await tx.sponsor.findFirst({ where: { tenantId, id: input.payerSponsorId, ...(options?.allowHistoricalPayer ? {} : options?.allowInactiveSponsor ? {} : { active: true, deletedAt: null }) }, select: { id: true, name: true, phone: true, email: true } })
      : null;
    const guardian = input.payerGuardianId
      ? await tx.guardian.findFirst({ where: { tenantId, id: input.payerGuardianId, ...(options?.allowHistoricalPayer ? {} : { deletedAt: null }) }, select: { id: true, firstName: true, lastName: true, phone: true, email: true } })
      : null;
    if (input.payerType === 'SPONSOR' && !sponsor && !options?.holdUnappliedGatewayCapture) throw AppError.validation('Choose an active sponsor from this institution.');
    if (['PARENT', 'GUARDIAN'].includes(input.payerType ?? '') && !guardian && !options?.holdUnappliedGatewayCapture) throw AppError.validation('Choose the linked guardian who made this payment.');
    if (guardian && !['PARENT', 'GUARDIAN'].includes(input.payerType ?? '')) throw AppError.validation('A guardian reference is only valid for a parent or guardian payment.');
    if (guardian && !options?.holdUnappliedGatewayCapture) {
      const link = subject.studentId ? await tx.studentGuardian.findFirst({ where: { tenantId, guardianId: guardian.id, studentId: subject.studentId }, select: { id: true } }) : null;
      if (!link) throw AppError.validation('The selected guardian is not linked to this student.');
    }
    const payer = payerSelection({ ...input, payerType: input.payerType ?? (subject.personId ? 'MEMBER' : 'STUDENT') });
    const selectedBranchIds = [...new Set(selectedItems.map((item) => item.demand.branchId))];
    if (selectedBranchIds.length > 1) throw AppError.validation('A single payment cannot combine fee demands from different branches.');
    if (selectedBranchIds[0] === null) throw AppError.conflict('FEE_BRANCH_UNASSIGNED', 'Assign this fee demand to a branch before collecting payment.');
    const branchId = selectedBranchIds[0] ?? options?.branchId ?? subject.branchId;
    if (options?.branchId && branchId !== options.branchId) throw AppError.conflict('PAYMENT_ORDER_BRANCH_MISMATCH', 'The fee demand branch does not match the branch recorded on the payment order.');
    const allocationDrafts = options?.holdUnappliedGatewayCapture ? [] : this.buildAllocationDrafts(selectedItems, amount.min(balance), payer);
    const allocatedAmount = allocationDrafts.reduce((sum, draft) => sum.add(draft.amount), Money.zero(currency));
    const remaining = amount.subtract(allocatedAmount);
    if (payer.type !== 'STUDENT' && remaining.isPositive && !options?.holdUnappliedGatewayCapture) throw AppError.validation('A third-party collection cannot exceed that payer’s assigned responsibility.');
    if (remaining.isPositive && overpaymentPolicy === 'REJECT' && !options?.holdUnappliedGatewayCapture) throw AppError.validation('The payment exceeds the outstanding balance.');
    if (remaining.isPositive && overpaymentPolicy === 'ADVANCE_PAYMENT' && !allowAdvancePayment && !options?.holdUnappliedGatewayCapture) throw AppError.validation('Advance payments are disabled in tenant payment settings.');
    const actorId = this.tenantContext.peek()?.userId ?? null;
    const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
    const paymentNumber = await this.sequences.allocate(tx, { tenantId, kind: 'PAYMENT', asOfDate: paidAt.toISOString().slice(0, 10) });
    const receiptNumber = await this.sequences.allocate(tx, { tenantId, kind: 'RECEIPT', asOfDate: paidAt.toISOString().slice(0, 10) });
    const paymentId = randomUUID();
    const receiptId = randomUUID();
    const creditId = remaining.isPositive && !options?.holdUnappliedGatewayCapture ? randomUUID() : null;
    const allocationMode = input.demandItemIds?.length ? 'TARGETED' : 'OLDEST_FIRST';
    const payment = await tx.payment.create({
      data: {
        id: paymentId,
        tenantId,
        branchId,
        paymentNumber,
        receiptNumber,
        studentId: subject.studentId,
        personId: subject.personId,
        paymentOrderId: options?.paymentOrderId ?? null,
        provider: options?.provider ?? null,
        providerTxnId: options?.providerTxnId ?? null,
        gatewayConfigId: options?.gatewayConfigId ?? null,
        channel: options?.channel ?? 'MANUAL',
        methodKind: method.kind,
        methodId: method.id,
        payerType: input.payerType ?? 'STUDENT',
        payerName: guardian ? `${guardian.firstName} ${guardian.lastName ?? ''}`.trim() : input.payerName?.trim() || sponsor?.name || null,
        payerPhone: input.payerPhone ?? guardian?.phone ?? sponsor?.phone ?? null,
        payerEmail: input.payerEmail ?? guardian?.email ?? sponsor?.email ?? null,
        payerStudentId: input.payerType === 'STUDENT' ? subject.studentId : null,
        payerGuardianId: guardian?.id ?? null,
        payerSponsorId: sponsor?.id ?? null,
        currency,
        amount: amount.toString(),
        allocatedAmount: allocatedAmount.toString(),
        unallocatedAmount: remaining.toString(),
        refundedAmount: '0',
        netAmount: amount.toString(),
        status: 'SUCCESS',
        paidAt,
        valueDate: input.valueDate ? dateValue(input.valueDate) : null,
        referenceNumber: input.referenceNumber ?? null,
        instrumentNumber: input.instrumentNumber ?? null,
        bankName: input.bankName ?? null,
        branchName: input.branchName ?? null,
        instrumentDate: input.instrumentDate ? dateValue(input.instrumentDate) : null,
        clearanceStatus: 'CLEARED',
        remarks: input.remarks ?? null,
        isAdvancePayment: remaining.isPositive && !options?.holdUnappliedGatewayCapture && overpaymentPolicy === 'ADVANCE_PAYMENT',
        isOverpayment: remaining.isPositive && !options?.holdUnappliedGatewayCapture,
        collectedBy,
        verifiedBy,
        verifiedAt: verifiedBy ? new Date() : null,
        createdBy: collectedBy ?? actorId,
        updatedBy: collectedBy ?? actorId,
      },
    });

    const perItem = new Map<string, { item: OpenDemandItem; amount: Money }>();
    const perDemand = new Map<string, { demand: OpenDemandItem['demand']; amount: Money }>();
    const perInstallment = new Map<string, { installment: InstallmentShare['installment']; amount: Money }>();
    const receiptLines: Array<{ feeTypeCode: string; feeTypeName: string; description: string; amount: string; allocatedAmount: string; sequence: number }> = [];
    for (let index = 0; index < allocationDrafts.length; index += 1) {
      const { item, amount: allocated, installmentShare, responsibilityId } = allocationDrafts[index]!;
      const itemTotal = perItem.get(item.id) ?? { item, amount: Money.zero(currency) };
      itemTotal.amount = itemTotal.amount.add(allocated);
      perItem.set(item.id, itemTotal);
      const current = perDemand.get(item.demandId) ?? { demand: item.demand, amount: Money.zero(currency) };
      current.amount = current.amount.add(allocated);
      perDemand.set(item.demandId, current);
      await tx.paymentAllocation.create({ data: { tenantId, paymentId, demandId: item.demandId, demandItemId: item.id, installmentId: installmentShare?.installmentId ?? null, responsibilityId, amount: allocated.toString(), currency, allocationMode, sequence: index, reason: allocationMode === 'TARGETED' ? 'Payer selected this fee item' : 'Oldest due date first', createdBy: collectedBy ?? actorId } });
      if (installmentShare) {
        const sharePaid = Money.fromString(installmentShare.paidAmount.toString(), currency).add(allocated);
        if (sharePaid.greaterThan(Money.fromString(installmentShare.amount.toString(), currency))) throw AppError.conflict('INSTALLMENT_OVERALLOCATED', 'Payment allocation exceeds the installment fee-item balance.');
        const shareChanged = await tx.installmentItem.updateMany({ where: { tenantId, id: installmentShare.id, paidAmount: installmentShare.paidAmount, updatedAt: installmentShare.updatedAt }, data: { paidAmount: { increment: allocated.toString() } } });
        if (shareChanged.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'An installment item changed while the payment was being applied. Retry the collection.');
        const installmentTotal = perInstallment.get(installmentShare.installmentId) ?? { installment: installmentShare.installment, amount: Money.zero(currency) };
        installmentTotal.amount = installmentTotal.amount.add(allocated);
        perInstallment.set(installmentShare.installmentId, installmentTotal);
      }
      const periodDescription = formatFinancialPeriod(item.demand.financialPeriod);
      const description = [item.demand.demandNumber, periodDescription, installmentShare?.installment.label].filter(Boolean).join(' · ');
      receiptLines.push({ feeTypeCode: item.feeTypeCode, feeTypeName: item.feeTypeName, description, amount: allocated.toString(), allocatedAmount: allocated.toString(), sequence: index });
    }
    for (const { item, amount: itemAllocation } of perItem.values()) {
      const nextPaid = Money.fromString(item.paidAmount.toString(), currency).add(itemAllocation);
      const itemNet = Money.fromString(item.netAmount.toString(), currency).add(Money.fromString(item.adjustmentAmount.toString(), currency));
      const itemWaived = Money.fromString(item.waivedAmount.toString(), currency);
      const itemPaidStatus = nextPaid.add(itemWaived).greaterThanOrEqual(itemNet) ? 'PAID' : 'PARTIALLY_PAID';
      const changed = await tx.feeDemandItem.updateMany({ where: { tenantId, id: item.id, status: item.status, paidAmount: item.paidAmount, updatedAt: item.updatedAt }, data: { paidAmount: nextPaid.toString(), status: itemPaidStatus } });
      if (changed.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'A selected demand item changed while the payment was being applied. Retry the collection.');
    }
    for (const { demand, amount: demandAllocation } of perDemand.values()) {
      const nextPaid = Money.fromString(demand.paidAmount.toString(), currency).add(demandAllocation);
      const demandNet = Money.fromString(demand.netAmount.toString(), currency).add(Money.fromString(demand.adjustmentAmount.toString(), currency));
      const nextStatus = nextPaid.greaterThanOrEqual(demandNet) ? 'PAID' : demand.status === 'OVERDUE' ? 'OVERDUE' : 'PARTIALLY_PAID';
      const changed = await tx.feeDemand.updateMany({ where: { tenantId, id: demand.id, status: demand.status, paidAmount: demand.paidAmount }, data: { paidAmount: { increment: demandAllocation.toString() }, status: nextStatus, updatedBy: collectedBy ?? actorId } });
      if (changed.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'A demand changed while the payment was being applied. Retry the collection.');
      await syncInvoiceSettlement(tx, { tenantId, demandId: demand.id, paidAmount: nextPaid.toString(), dueDate: demand.dueDate });
    }
    for (const { installment, amount: installmentAllocation } of perInstallment.values()) {
      const nextPaid = Money.fromString(installment.paidAmount.toString(), currency).add(installmentAllocation);
      const installmentNet = Money.fromString(installment.amount.toString(), currency).add(Money.fromString(installment.adjustmentAmount.toString(), currency)).subtract(Money.fromString(installment.waivedAmount.toString(), currency));
      const nextStatus = nextPaid.greaterThanOrEqual(installmentNet) ? 'PAID' : nextPaid.isPositive ? 'PARTIALLY_PAID' : installment.dueDate < new Date() ? 'OVERDUE' : 'PENDING';
      const changed = await tx.installment.updateMany({ where: { tenantId, id: installment.id, paidAmount: installment.paidAmount, updatedAt: installment.updatedAt }, data: { paidAmount: nextPaid.toString(), status: nextStatus } });
      if (changed.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'An installment changed while the payment was being applied. Retry the collection.');
    }

    if (options?.holdUnappliedGatewayCapture && remaining.isPositive) {
      receiptLines.push({ feeTypeCode: 'UNAPPLIED_GATEWAY_CAPTURE', feeTypeName: 'Payment held for review', description: 'Provider confirmed receipt; funds are held in reconciliation suspense pending allocation.', amount: remaining.toString(), allocatedAmount: '0.0000', sequence: receiptLines.length });
    } else if (creditId && remaining.isPositive) {
      await tx.credit.create({ data: { id: creditId, tenantId, branchId, studentId: subject.studentId, personId: subject.personId, source: overpaymentPolicy === 'ADVANCE_PAYMENT' ? 'ADVANCE_PAYMENT' : 'OVERPAYMENT', status: 'AVAILABLE', currency, originalAmount: remaining.toString(), allocatedAmount: '0', availableAmount: remaining.toString(), paymentId, reason: overpaymentPolicy === 'ADVANCE_PAYMENT' ? 'Advance payment balance' : 'Overpayment balance', createdBy: collectedBy ?? actorId } });
      receiptLines.push({ feeTypeCode: 'CREDIT_BALANCE', feeTypeName: 'Unallocated credit', description: 'Held for future fee demands', amount: remaining.toString(), allocatedAmount: '0.0000', sequence: receiptLines.length });
    }
    const configuredBranding = await tx.tenantBranding.findUnique({ where: { tenantId } });
    const tenantIdentity = configuredBranding ? null : await tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
    const receiptIdSnapshot = {
      organization: configuredBranding ?? (tenantIdentity ? { organizationName: tenantIdentity.name } : null),
      receiptNumber,
      issuedAt: paidAt.toISOString(),
      payment: { paymentNumber, channel: options?.channel ?? 'MANUAL', method: method.name, kind: method.kind, amount: amount.toString(), currency, referenceNumber: input.referenceNumber ?? null, instrumentNumber: input.instrumentNumber ?? null },
      student: subject.studentId ? { id: subject.studentId, admissionNumber: subject.admissionNumber, firstName: subject.firstName, middleName: subject.middleName, lastName: subject.lastName, fullName: [subject.firstName, subject.middleName, subject.lastName].filter(Boolean).join(' ') } : null,
      person: { id: subject.personId, personNumber: subject.personNumber, typeLabel: subject.typeLabel, firstName: subject.firstName, middleName: subject.middleName, lastName: subject.lastName, fullName: [subject.firstName, subject.middleName, subject.lastName].filter(Boolean).join(' ') },
      payer: { type: input.payerType ?? 'STUDENT', name: guardian ? `${guardian.firstName} ${guardian.lastName ?? ''}`.trim() : input.payerName?.trim() || sponsor?.name || null, phone: input.payerPhone ?? guardian?.phone ?? sponsor?.phone ?? null, email: input.payerEmail ?? guardian?.email ?? sponsor?.email ?? null, guardianId: guardian?.id ?? null, sponsorId: sponsor?.id ?? null },
      allocations: receiptLines,
      balanceAfter: options?.holdUnappliedGatewayCapture ? null : balance.subtract(allocatedAmount).toString(),
    };
    const receipt = await tx.receipt.create({
      data: {
        id: receiptId,
        tenantId,
        branchId,
        receiptNumber,
        paymentId,
        studentId: subject.studentId,
        personId: subject.personId,
        issueDate: dateValue(paidAt.toISOString().slice(0, 10)),
        snapshot: receiptIdSnapshot as unknown as Prisma.InputJsonValue,
        totalAmount: amount.toString(),
        currency,
        balanceAfter: options?.holdUnappliedGatewayCapture ? null : balance.subtract(allocatedAmount).toString(),
        createdBy: collectedBy ?? actorId,
      },
    });
    if (receiptLines.length) await tx.receiptLine.createMany({ data: receiptLines.map((line) => ({ tenantId, receiptId, ...line })) });

    const tenderAccount: SystemLedgerAccountKey = options?.tenderAccount ?? (method.kind === 'CASH' ? 'CASH_IN_HAND' : 'BANK_ACCOUNT');
    const receivableAccount: SystemLedgerAccountKey = subject.personId ? 'TENANT_PERSON_RECEIVABLE' : 'STUDENT_RECEIVABLE';
    const creditAccount: SystemLedgerAccountKey = subject.personId ? 'TENANT_PERSON_CREDIT' : 'STUDENT_CREDIT';
    const ledgerLines: Array<{ accountKey: SystemLedgerAccountKey; side: 'DEBIT' | 'CREDIT'; amount: string; narration: string }> = [
      { accountKey: tenderAccount, side: 'DEBIT', amount: amount.toString(), narration: `${method.name} · ${paymentNumber}` },
    ];
    if (allocatedAmount.isPositive) ledgerLines.push({ accountKey: receivableAccount, side: 'CREDIT', amount: allocatedAmount.toString(), narration: `Applied to fee demands · ${paymentNumber}` });
    if (remaining.isPositive) ledgerLines.push({ accountKey: options?.holdUnappliedGatewayCapture ? 'UNAPPLIED_GATEWAY_RECEIPTS' : creditAccount, side: 'CREDIT', amount: remaining.toString(), narration: `${options?.holdUnappliedGatewayCapture ? 'Unapplied gateway receipt held for reconciliation' : 'Unallocated person credit'} · ${paymentNumber}` });
    const eventType = options?.ledgerEventType ?? 'MANUAL_PAYMENT_RECEIVED';
    const posted = await this.ledger.post(tx, { tenantId, branchId, currency, eventType, entryDate: paidAt.toISOString().slice(0, 10), lines: ledgerLines, studentId: subject.studentId, personId: subject.personId, paymentId, creditId, narration: `${options?.channel === 'ONLINE' ? 'Online' : 'Manual'} payment ${paymentNumber}`, createdBy: collectedBy ?? actorId });

    await this.audit.record(tx, { tenantId, actorId: collectedBy ?? actorId, action: options?.channel === 'ONLINE' ? 'ONLINE_PAYMENT_CAPTURED' : 'MANUAL_PAYMENT_RECEIVED', entityType: 'Payment', entityId: paymentId, after: { paymentNumber, receiptNumber, studentId: subject.studentId, personId: subject.personId, amount: amount.toString(), allocatedAmount: allocatedAmount.toString(), unallocatedAmount: remaining.toString(), studentCreditAmount: creditId ? remaining.toString() : '0.0000', gatewaySuspenseAmount: options?.holdUnappliedGatewayCapture ? remaining.toString() : '0.0000', ledgerGroupId: posted.transactionGroupId } });
    await this.outbox.publish(tx, { tenantId, eventType: 'PAYMENT_SUCCESS', aggregateType: 'Payment', aggregateId: paymentId, payload: { paymentId, paymentNumber, receiptId, receiptNumber, studentId: subject.studentId, personId: subject.personId, amount: amount.toString(), currency }, actorId: collectedBy ?? actorId, requestId: this.tenantContext.requestId });
    await this.outbox.publish(tx, { tenantId, eventType: 'RECEIPT_GENERATED', aggregateType: 'Receipt', aggregateId: receiptId, payload: { receiptId, receiptNumber, paymentId, studentId: subject.studentId, personId: subject.personId }, actorId: collectedBy ?? actorId, requestId: this.tenantContext.requestId });
    return { payment, receipt, allocations: allocationDrafts.map(({ item, installmentShare, amount: value, responsibilityId }) => ({ demandItemId: item.id, demandId: item.demandId, installmentId: installmentShare?.installmentId ?? null, responsibilityId, amount: value.toString() })), creditId };
  }

  async openBalanceForPayer(tx: TransactionClient, tenantId: string, subjectId: string, payer: PayerSelection, itemIds?: string[], excludePaymentOrderId?: string, subjectField: 'studentId' | 'personId' = 'studentId') {
    if (subjectField === 'personId') await this.assertPortalPersonAccess(tx, tenantId, subjectId);
    else { await this.assertPortalStudentAccess(tx, tenantId, subjectId); await this.assertPortalPayerAccess(tx, tenantId, subjectId, payer); }
    const items = this.selectItems(await this.openItems(tx, tenantId, subjectId, payer, excludePaymentOrderId, subjectField), itemIds);
    return items.map((item) => ({ id: item.id, balance: this.payerItemBalance(item, payer) })).filter((item) => item.balance.isPositive);
  }

  async planPayerPayment(tx: TransactionClient, tenantId: string, subjectId: string, payer: PayerSelection, amount: Money, itemIds?: string[], subjectField: 'studentId' | 'personId' = 'studentId') {
    if (subjectField === 'personId') await this.assertPortalPersonAccess(tx, tenantId, subjectId);
    else { await this.assertPortalStudentAccess(tx, tenantId, subjectId); await this.assertPortalPayerAccess(tx, tenantId, subjectId, payer); }
    const items = this.selectItems(await this.openItems(tx, tenantId, subjectId, payer, undefined, subjectField), itemIds);
    const balance = items.reduce((sum, item) => sum.add(this.payerItemBalance(item, payer)), Money.zero(amount.currency.code));
    if (amount.greaterThan(balance)) throw AppError.validation(`The payment exceeds this payer’s assigned responsibility (${balance.format()}).`);
    const branchIds = [...new Set(items.map((item) => item.demand.branchId))];
    if (branchIds.length > 1) throw AppError.validation('A single payment order cannot combine fee demands from different branches.');
    if (branchIds[0] === null) throw AppError.conflict('FEE_BRANCH_UNASSIGNED', 'Assign this fee demand to a branch before collecting payment.');
    const responsibilityShares = this.buildAllocationDrafts(items, amount, payer).map((draft) => ({ demandItemId: draft.item.id, responsibilityId: draft.responsibilityId, amount: draft.amount.toString() }));
    return { balance, branchId: branchIds[0] ?? null, responsibilityShares };
  }

  private async openItems(tx: TransactionClient, tenantId: string, subjectId: string, payer?: PayerSelection, excludePaymentOrderId?: string, subjectField: 'studentId' | 'personId' = 'studentId'): Promise<OpenDemandItem[]> {
    const demands = await tx.feeDemand.findMany({ where: { tenantId, [subjectField]: subjectId, status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] } }, orderBy: [{ dueDate: 'asc' }, { issueDate: 'asc' }] });
    if (!demands.length) return [];
    const demandById = new Map(demands.map((demand) => [demand.id, demand]));
    const items = await tx.feeDemandItem.findMany({ where: { tenantId, demandId: { in: demands.map((demand) => demand.id) }, status: { in: ['UNPAID', 'PARTIALLY_PAID'] } }, orderBy: [{ sequence: 'asc' }] });
    if (!items.length) return [];
    const installments = await tx.installment.findMany({ where: { tenantId, demandId: { in: demands.map((demand) => demand.id) }, status: { not: 'CANCELLED' } }, orderBy: [{ dueDate: 'asc' }, { sequence: 'asc' }] });
    const installmentItems = installments.length ? await tx.installmentItem.findMany({
      where: { tenantId, demandItemId: { in: items.map((item) => item.id) }, installmentId: { in: installments.map((installment) => installment.id) } },
    }) : [];
    const responsibilityRows = await tx.feeDemandResponsibility.findMany({
      where: { tenantId, demandItemId: { in: items.map((item) => item.id) } },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
    const responsibilityIds = responsibilityRows.map((row) => row.id);
    const [paymentAllocations, creditAllocations] = responsibilityIds.length ? await Promise.all([
      tx.paymentAllocation.findMany({
        where: { tenantId, responsibilityId: { in: responsibilityIds }, reversedAt: null },
        select: { id: true, responsibilityId: true, amount: true },
      }),
      tx.creditAllocation.findMany({
        where: { tenantId, responsibilityId: { in: responsibilityIds }, reversedAt: null },
        select: { id: true, responsibilityId: true, amount: true },
      }),
    ]) : [[], []];
    const paymentAllocationIds = paymentAllocations.map((allocation) => allocation.id);
    const creditAllocationIds = creditAllocations.map((allocation) => allocation.id);
    const refundReversals = paymentAllocationIds.length || creditAllocationIds.length
      ? await tx.refundAllocation.findMany({
        where: {
          tenantId,
          OR: [
            ...(paymentAllocationIds.length ? [{ paymentAllocationId: { in: paymentAllocationIds } }] : []),
            ...(creditAllocationIds.length ? [{ creditAllocationId: { in: creditAllocationIds } }] : []),
          ],
        },
        select: { paymentAllocationId: true, creditAllocationId: true, amount: true },
      })
      : [];
    const paymentRefundsByAllocation = new Map<string, Array<{ amount: Prisma.Decimal }>>();
    const creditRefundsByAllocation = new Map<string, Array<{ amount: Prisma.Decimal }>>();
    for (const reversal of refundReversals) {
      if (reversal.paymentAllocationId) paymentRefundsByAllocation.set(reversal.paymentAllocationId, [...(paymentRefundsByAllocation.get(reversal.paymentAllocationId) ?? []), { amount: reversal.amount }]);
      if (reversal.creditAllocationId) creditRefundsByAllocation.set(reversal.creditAllocationId, [...(creditRefundsByAllocation.get(reversal.creditAllocationId) ?? []), { amount: reversal.amount }]);
    }
    const paymentAllocationsByResponsibility = new Map<string, Array<{ amount: Prisma.Decimal; refundReversals: Array<{ amount: Prisma.Decimal }> }>>();
    for (const allocation of paymentAllocations) {
      if (!allocation.responsibilityId) continue;
      paymentAllocationsByResponsibility.set(allocation.responsibilityId, [
        ...(paymentAllocationsByResponsibility.get(allocation.responsibilityId) ?? []),
        { amount: allocation.amount, refundReversals: paymentRefundsByAllocation.get(allocation.id) ?? [] },
      ]);
    }
    const creditAllocationsByResponsibility = new Map<string, Array<{ amount: Prisma.Decimal; refundReversals: Array<{ amount: Prisma.Decimal }> }>>();
    for (const allocation of creditAllocations) {
      if (!allocation.responsibilityId) continue;
      creditAllocationsByResponsibility.set(allocation.responsibilityId, [
        ...(creditAllocationsByResponsibility.get(allocation.responsibilityId) ?? []),
        { amount: allocation.amount, refundReversals: creditRefundsByAllocation.get(allocation.id) ?? [] },
      ]);
    }
    const activeOrders = await tx.paymentOrder.findMany({
      // A local deadline does not prove that the provider stopped accepting
      // money. Keep the responsibility reserved until a verified webhook or a
      // provider-side terminal-status check moves this intent out of an active
      // state; otherwise a late capture can race a second collection.
      where: { tenantId, [subjectField]: subjectId, ...(excludePaymentOrderId ? { id: { not: excludePaymentOrderId } } : {}), status: { in: ['CREATED', 'INITIATED', 'PENDING'] } },
      select: { responsibilityShares: true },
    });
    const reservedShares = activeOrders.flatMap((order) => parseResponsibilityReservations(order.responsibilityShares));
    const itemById = new Map(items.map((item) => [item.id, item]));
    const sharesByItem = new Map<string, InstallmentShare[]>();
    const rawResponsibilitiesByItem = new Map<string, ResponsibilityShare[]>();
    const currencyByItem = new Map(items.map((item) => [item.id, demandById.get(item.demandId)!.currency]));
    const responsibilityUsed = (allocations: Array<{ amount: Prisma.Decimal; refundReversals: Array<{ amount: Prisma.Decimal }> }>, currency: string) => allocations.reduce((sum, allocation) => {
      const net = Money.fromString(allocation.amount.toString(), currency).subtract(allocationsRefunded(allocation.refundReversals, currency));
      return sum.add(net.isPositive ? net : Money.zero(currency));
    }, Money.zero(currency));
    const reservationsByItem = new Map<string, Money>();
    const reservationsByResponsibility = new Map<string, Map<string | null, Money>>();
    for (const share of reservedShares) {
      const currency = currencyByItem.get(share.demandItemId);
      if (!currency) continue;
      const amount = Money.fromString(share.amount, currency);
      reservationsByItem.set(share.demandItemId, (reservationsByItem.get(share.demandItemId) ?? Money.zero(currency)).add(amount));
      const byResponsibility = reservationsByResponsibility.get(share.demandItemId) ?? new Map<string | null, Money>();
      byResponsibility.set(share.responsibilityId, (byResponsibility.get(share.responsibilityId) ?? Money.zero(currency)).add(amount));
      reservationsByResponsibility.set(share.demandItemId, byResponsibility);
    }
    for (const row of responsibilityRows) {
      const currency = currencyByItem.get(row.demandItemId)!;
      const used = responsibilityUsed(paymentAllocationsByResponsibility.get(row.id) ?? [], currency).add(responsibilityUsed(creditAllocationsByResponsibility.get(row.id) ?? [], currency));
      const reserved = reservationsByResponsibility.get(row.demandItemId)?.get(row.id) ?? Money.zero(currency);
      const actualOutstanding = Money.fromString(row.amount.toString(), currency).subtract(used);
      const responsibility: ResponsibilityShare = { id: row.id, payerType: row.payerType, payerName: row.payerName, payerSponsorId: row.payerSponsorId, payerGuardianId: row.payerGuardianId, priority: row.priority, amount: Money.fromString(row.amount.toString(), currency), actualOutstanding: actualOutstanding.isPositive ? actualOutstanding : Money.zero(currency), reserved, outstanding: Money.zero(currency) };
      rawResponsibilitiesByItem.set(row.demandItemId, [...(rawResponsibilitiesByItem.get(row.demandItemId) ?? []), responsibility]);
    }
    const installmentById = new Map(installments.map((installment) => [installment.id, installment]));
    for (const share of installmentItems) {
      const item = share.demandItemId ? itemById.get(share.demandItemId) : undefined;
      if (!item) continue;
      const installment = installmentById.get(share.installmentId);
      if (!installment) throw AppError.conflict('INSTALLMENT_UNAVAILABLE', 'A fee item is linked to an unavailable installment.');
      if (installment.demandId !== item.demandId) throw AppError.conflict('INSTALLMENT_DEMAND_MISMATCH', 'A fee item is linked to an installment from another demand.');
      const installmentShare: InstallmentShare = {
        id: share.id,
        installmentId: share.installmentId,
        demandItemId: share.demandItemId,
        amount: share.amount,
        adjustmentAmount: share.adjustmentAmount,
        paidAmount: share.paidAmount,
        updatedAt: share.updatedAt,
        installment: {
          id: installment.id,
          sequence: installment.sequence,
          label: installment.label,
          dueDate: installment.dueDate,
          amount: installment.amount,
          adjustmentAmount: installment.adjustmentAmount,
          paidAmount: installment.paidAmount,
          waivedAmount: installment.waivedAmount,
          status: installment.status,
          updatedAt: installment.updatedAt,
        },
      };
      const shares = sharesByItem.get(item.id) ?? [];
      shares.push(installmentShare);
      sharesByItem.set(item.id, shares);
    }
    for (const shares of sharesByItem.values()) shares.sort((left, right) => left.installment.dueDate.getTime() - right.installment.dueDate.getTime() || left.installment.sequence - right.installment.sequence);
    const openItems = items.map((item) => {
      const demand = demandById.get(item.demandId)!;
      const itemView = { ...item, demand, installmentShares: sharesByItem.get(item.id) ?? [], responsibilities: [] } as OpenDemandItem;
      const nullReservations = reservationsByResponsibility.get(item.id)?.get(null) ?? Money.zero(demand.currency);
      itemView.responsibilities = capPayerShareBalances({
        itemBalance: this.itemBalance(itemView),
        activeReservations: reservationsByItem.get(item.id) ?? Money.zero(demand.currency),
        shares: rawResponsibilitiesByItem.get(item.id) ?? [],
        studentResidual: (actualOutstanding) => ({
          id: null,
          payerType: itemView.demand.personId ? 'MEMBER' : 'STUDENT',
          payerName: itemView.demand.personId ? 'Member' : 'Student',
          payerSponsorId: null,
          payerGuardianId: null,
          priority: 2_147_483_647,
          amount: actualOutstanding,
          actualOutstanding,
          reserved: nullReservations,
          outstanding: Money.zero(demand.currency),
        }),
      });
      return itemView;
    });
    return openItems
      .filter((item) => (payer ? this.payerItemBalance(item, payer) : this.itemBalance(item)).isPositive)
      .sort((left, right) => {
        const dayDiff = this.itemDueDate(left).getTime() - this.itemDueDate(right).getTime();
        return dayDiff || left.demand.issueDate.getTime() - right.demand.issueDate.getTime() || left.sequence - right.sequence;
      });
  }

  private async assertPortalStudentAccess(tx: TransactionClient, tenantId: string, studentId: string): Promise<void> {
    const context = this.tenantContext.require();
    const roles = context.roles ?? [];
    const portalOnly = roles.length > 0 && roles.every((role) => role === 'STUDENT' || role === 'PARENT' || role === 'WORKSPACE_PERSON');
    if (!portalOnly) return;
    if (roles.includes('STUDENT') && context.studentId === studentId) return;
    if (roles.includes('PARENT') && context.guardianId) {
      const link = await tx.studentGuardian.findFirst({ where: { tenantId, guardianId: context.guardianId, studentId }, select: { id: true } });
      if (link) return;
    }
    throw AppError.notFound('Student');
  }

  private async assertPortalPayerAccess(tx: TransactionClient, tenantId: string, studentId: string, payer: PayerSelection): Promise<void> {
    const context = this.tenantContext.require();
    const roles = context.roles ?? [];
    const portalOnly = roles.length > 0 && roles.every((role) => role === 'STUDENT' || role === 'PARENT' || role === 'WORKSPACE_PERSON');
    if (!portalOnly || payer.type === 'STUDENT') return;
    if (!roles.includes('PARENT') || !context.guardianId || !['PARENT', 'GUARDIAN'].includes(payer.type) || payer.payerGuardianId !== context.guardianId) throw AppError.forbidden('Portal users may only view or pay their own responsibility share.');
    const link = await tx.studentGuardian.findFirst({ where: { tenantId, guardianId: context.guardianId, studentId }, select: { id: true } });
    if (!link) throw AppError.notFound('Student');
  }

  private async assertPortalPersonAccess(tx: TransactionClient, tenantId: string, personId: string): Promise<void> {
    const context = this.tenantContext.require();
    const roles = context.roles ?? [];
    const portalOnly = roles.length > 0 && roles.every((role) => role === 'WORKSPACE_PERSON');
    if (!portalOnly) return;
    if (!context.userId) throw AppError.notFound('Person');
    const user = await tx.user.findFirst({ where: { tenantId, id: context.userId, tenantPersonId: personId, status: 'ACTIVE', deletedAt: null }, select: { id: true } });
    if (!user) throw AppError.notFound('Person');
  }

  private buildAllocationDrafts(items: OpenDemandItem[], amount: Money, payer: PayerSelection): AllocationDraft[] {
    const drafts: AllocationDraft[] = [];
    let paymentRemaining = amount;
    for (const item of items) {
      if (!paymentRemaining.isPositive) break;
      let itemRemaining = this.payerItemBalance(item, payer).min(paymentRemaining);
      const itemTarget = itemRemaining;
      for (const responsibility of this.payerResponsibilities(item, payer)) {
        if (!itemRemaining.isPositive) break;
        const shareTarget = responsibility.outstanding.min(itemRemaining);
        let shareRemaining = shareTarget;
        for (const installmentShare of item.installmentShares) {
          if (!shareRemaining.isPositive) break;
          const installmentBalance = Money.fromString(installmentShare.amount.toString(), amount.currency.code).add(Money.fromString(installmentShare.adjustmentAmount.toString(), amount.currency.code)).subtract(Money.fromString(installmentShare.paidAmount.toString(), amount.currency.code));
          if (!installmentBalance.isPositive) continue;
          const allocated = installmentBalance.min(shareRemaining);
          if (allocated.isPositive) drafts.push({ item, responsibilityId: responsibility.id, amount: allocated, installmentShare });
          shareRemaining = shareRemaining.subtract(allocated);
        }
        if (shareRemaining.isPositive) drafts.push({ item, responsibilityId: responsibility.id, amount: shareRemaining });
        itemRemaining = itemRemaining.subtract(shareTarget);
      }
      paymentRemaining = paymentRemaining.subtract(itemTarget);
    }
    return drafts;
  }

  private itemDueDate(item: OpenDemandItem): Date {
    return item.installmentShares.find((share) => Money.fromString(share.amount.toString(), item.demand.currency).add(Money.fromString(share.adjustmentAmount.toString(), item.demand.currency)).greaterThan(Money.fromString(share.paidAmount.toString(), item.demand.currency)))?.installment.dueDate ?? item.demand.dueDate;
  }

  private selectItems(items: OpenDemandItem[], itemIds?: string[]): OpenDemandItem[] {
    if (!itemIds?.length) return items;
    const byId = new Map(items.map((item) => [item.id, item]));
    if (itemIds.some((id) => !byId.has(id))) throw AppError.validation('Every selected fee item must belong to this student and have an outstanding balance.');
    const selected = new Set(itemIds);
    return items.filter((item) => selected.has(item.id));
  }

  private itemBalance(item: { netAmount: Prisma.Decimal; adjustmentAmount: Prisma.Decimal; paidAmount: Prisma.Decimal; waivedAmount: Prisma.Decimal; demand: { currency: string } }): Money {
    const currency = item.demand.currency;
    return Money.fromString(item.netAmount.toString(), currency)
      .add(Money.fromString(item.adjustmentAmount.toString(), currency))
      .subtract(Money.fromString(item.paidAmount.toString(), currency))
      .subtract(Money.fromString(item.waivedAmount.toString(), currency));
  }

  private payerResponsibilities(item: OpenDemandItem, payer: PayerSelection): ResponsibilityShare[] {
    return item.responsibilities.filter((share) => matchesPayer(share, payer) && share.outstanding.isPositive);
  }

  private payerItemBalance(item: OpenDemandItem, payer: PayerSelection): Money {
    const configured = this.payerResponsibilities(item, payer).reduce((sum, share) => sum.add(share.outstanding), Money.zero(item.demand.currency));
    const overall = this.itemBalance(item);
    return configured.min(overall.isPositive ? overall : Money.zero(item.demand.currency));
  }

  private assertTenant(tenantId: string): void {
    if (this.tenantContext.requireTenantId() !== tenantId) throw AppError.forbidden('The requested tenant does not match the authenticated session.');
  }
}

@ApiTags('payment methods')
@RequireModules('PAYMENTS')
@Controller('payment-methods')
export class PaymentMethodsController {
  constructor(private readonly payments: PaymentsService) {}
  @Get() @RequirePermissions(PERMISSIONS.PAYMENT_READ) list(@CurrentTenant() tenant: string) { return this.payments.listMethods(tenant); }
  @Post() @RequirePermissions(PERMISSIONS.TENANT_SETTINGS_UPDATE) @UsePipes(new ZodValidationPipe(createPaymentMethodSchema)) create(@CurrentTenant() tenant: string, @Body() body: CreatePaymentMethodInput) { return this.payments.createMethod(tenant, body); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.TENANT_SETTINGS_UPDATE) @UsePipes(new ZodValidationPipe(updatePaymentMethodSchema)) update(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: UpdatePaymentMethodInput) { return this.payments.updateMethod(tenant, id, body); }
}

@ApiTags('payments')
@RequireModules('PAYMENTS')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService, private readonly tenantContext: TenantContextService) {}
  @Get() @RequirePermissions(PERMISSIONS.PAYMENT_READ) list(@CurrentTenant() tenant: string, @Query() query: Record<string, unknown>) { return this.payments.list(tenant, query); }
  @Get('collection-approvals') @RequirePermissions(PERMISSIONS.APPROVAL_READ) approvals(@CurrentTenant() tenant: string) { return this.payments.pendingCollectionApprovals(tenant); }
  @Post('collection-approvals/:id/decision') @RequirePermissions(PERMISSIONS.APPROVAL_DECIDE) @UsePipes(new ZodValidationPipe(approvalDecisionSchema)) decide(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: { approved: boolean; note?: string | null }) { return this.payments.decideCollectionApproval(tenant, id, body); }
  @Post('manual') @RequirePermissions(PERMISSIONS.PAYMENT_COLLECT) @ApiOperation({ summary: 'Collect a manual payment, allocate it to open demands and issue a receipt atomically' }) @UsePipes(new ZodValidationPipe(manualPaymentSchema)) collect(@CurrentTenant() tenant: string, @Body() body: ManualPaymentInput) { return this.payments.collectManual(tenant, body); }
  @Get('students/:studentId/open-items') @PortalRoute() @RequirePermissions(PERMISSIONS.PAYMENT_READ) openItems(@CurrentTenant() tenant: string, @Param('studentId') studentId: string, @Query() query: Record<string, unknown>) {
    if (query.payerType !== undefined && (typeof query.payerType !== 'string' || !PAYER_TYPES.includes(query.payerType as PayerType))) throw AppError.validation('Choose a supported payer type.');
    const requestContext = this.tenantContext.require();
    const parentPortal = Boolean(requestContext.guardianId && requestContext.roles?.includes('PARENT') && requestContext.roles.every((role) => role === 'PARENT' || role === 'STUDENT'));
    const payerType = typeof query.payerType === 'string' ? query.payerType as PayerType : parentPortal ? 'PARENT' : 'STUDENT';
    const payerSponsorId = typeof query.payerSponsorId === 'string' ? query.payerSponsorId : null;
    const payerName = typeof query.payerName === 'string' ? query.payerName : null;
    const isGuardianPayer = payerType === 'PARENT' || payerType === 'GUARDIAN';
    const payerGuardianId = parentPortal && isGuardianPayer ? requestContext.guardianId ?? null : typeof query.payerGuardianId === 'string' ? query.payerGuardianId : null;
    if (payerType === 'SPONSOR' && !payerSponsorId) throw AppError.validation('Choose a sponsor to view its assigned responsibility.');
    if (isGuardianPayer && !payerGuardianId) throw AppError.validation('Choose the linked guardian to view its assigned responsibility.');
    if (!['STUDENT', 'SPONSOR', 'PARENT', 'GUARDIAN'].includes(payerType) && !payerName?.trim()) throw AppError.validation('Enter the payer name to view its assigned responsibility.');
    return this.payments.openItemsForStudent(tenant, studentId, { type: payerType, sponsorId: payerSponsorId, payerGuardianId, payerName });
  }
  @Get('people/:personId/open-items') @PortalRoute() @RequirePermissions(PERMISSIONS.PAYMENT_READ) @ApiOperation({ summary: 'Read only the signed-in person’s assigned generic fee responsibility' })
  openPersonItems(@CurrentTenant() tenant: string, @Param('personId') personId: string) { return this.payments.openItemsForPerson(tenant, personId); }
  @Get(':id') @RequirePermissions(PERMISSIONS.PAYMENT_READ) get(@CurrentTenant() tenant: string, @Param('id') id: string) { return this.payments.get(tenant, id); }
}

@ApiTags('receipts')
@RequireModules('PAYMENTS')
@Controller('receipts')
export class ReceiptsController {
  constructor(private readonly payments: PaymentsService) {}
  @Get() @RequirePermissions(PERMISSIONS.RECEIPT_READ) list(@CurrentTenant() tenant: string, @Query() query: Record<string, unknown>) { return this.payments.listReceipts(tenant, query); }
  @Get(':id') @RequirePermissions(PERMISSIONS.RECEIPT_READ) get(@CurrentTenant() tenant: string, @Param('id') id: string) { return this.payments.getReceipt(tenant, id); }
}

@Module({
  imports: [PrismaModule, TenantContextModule],
  controllers: [PaymentMethodsController, PaymentsController, ReceiptsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}

function dateValue(value: string): Date { return new Date(`${value.slice(0, 10)}T00:00:00.000Z`); }
function formatFinancialPeriod(value: string | null): string {
  if (!value) return '';
  const [frequency, start, end] = value.split(':');
  if (!frequency || !start || !end || Number.isNaN(dateValue(start).valueOf()) || Number.isNaN(dateValue(end).valueOf())) return value;
  const format = (date: Date) => `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}`;
  return `${frequency.replaceAll('_', ' ')} · ${format(dateValue(start))}–${format(dateValue(end))}`;
}
function payerSelection(input: { payerType?: PayerType; payerSponsorId?: string | null; payerGuardianId?: string | null; payerName?: string | null }): PayerSelection {
  return { type: input.payerType ?? 'STUDENT', sponsorId: input.payerSponsorId ?? null, payerGuardianId: input.payerGuardianId ?? null, payerName: input.payerName ?? null };
}
function matchesPayer(share: ResponsibilityShare, payer: PayerSelection): boolean {
  if (share.payerType !== payer.type) return false;
  if (payer.type === 'SPONSOR') return Boolean(payer.sponsorId && share.payerSponsorId === payer.sponsorId);
  if (payer.type === 'PARENT' || payer.type === 'GUARDIAN') return Boolean(payer.payerGuardianId && share.payerGuardianId === payer.payerGuardianId);
  if (payer.type === 'STUDENT') return true;
  // Generic person responsibilities are linked to a tenant profile and the
  // portal endpoint has already verified the signed-in account owns it.
  if (payer.type === 'MEMBER') return true;
  return normalisePayerName(share.payerName) === normalisePayerName(payer.payerName);
}
function normalisePayerName(value?: string | null): string { return (value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase(); }
function allocationsRefunded(allocations: Array<{ amount: Prisma.Decimal }>, currency: string): Money {
  return allocations.reduce((sum, allocation) => sum.add(Money.fromString(allocation.amount.toString(), currency)), Money.zero(currency));
}
function parseResponsibilityReservations(value: Prisma.JsonValue | null): Array<{ demandItemId: string; responsibilityId: string | null; amount: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const row = entry as { demandItemId?: unknown; responsibilityId?: unknown; amount?: unknown };
    if (typeof row.demandItemId !== 'string' || (row.responsibilityId !== null && typeof row.responsibilityId !== 'string')) return [];
    const amount = typeof row.amount === 'string' ? row.amount : '';
    if (!/^\d{1,14}(?:\.\d{1,4})?$/.test(amount)) return [];
    return [{ demandItemId: row.demandItemId, responsibilityId: row.responsibilityId as string | null, amount }];
  });
}
