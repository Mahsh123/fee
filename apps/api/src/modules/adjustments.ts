import { Body, Controller, Get, Injectable, Module, Param, Post, Query, UsePipes } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { Money } from '@fee/money';
import { Prisma, type AdjustmentDirection, type AdjustmentKind, type AdjustmentStatus, type DemandItemStatus, type DemandStatus, type InstallmentStatus, type TransactionClient } from '@fee/database';
import { ERROR_CODES, PERMISSIONS, type SystemLedgerAccountKey } from '@fee/types';
import { createAdjustmentSchema, approvalDecisionSchema, reverseAdjustmentSchema, type CreateAdjustmentInput, type ReverseAdjustmentInput } from '@fee/validation';
import { AppError } from '../common/errors';
import { AuditService, IdempotencyService, LedgerService, OutboxService, SequenceService } from '../common/financial';
import { paginate, parseListQuery, ZodValidationPipe } from '../common/http';
import { PrismaModule, PrismaService } from '../common/prisma.service';
import { CurrentTenant, RequireModules, RequirePermissions, TenantContextModule, TenantContextService } from '../common/tenancy';

type AdjustmentTarget = {
  item: {
    id: string; tenantId: string; demandId: string; status: DemandItemStatus;
    netAmount: Prisma.Decimal; adjustmentAmount: Prisma.Decimal; paidAmount: Prisma.Decimal; waivedAmount: Prisma.Decimal; updatedAt: Date;
  };
  demand: {
    id: string; branchId: string | null; studentId: string | null; personId: string | null; demandNumber: string; status: DemandStatus; currency: string;
    netAmount: Prisma.Decimal; adjustmentAmount: Prisma.Decimal; paidAmount: Prisma.Decimal; waivedAmount: Prisma.Decimal; creditedAmount: Prisma.Decimal;
    dueDate: Date; updatedAt: Date;
  };
  installmentItem: null | {
    id: string; amount: Prisma.Decimal; adjustmentAmount: Prisma.Decimal; paidAmount: Prisma.Decimal; updatedAt: Date;
    installment: { id: string; demandId: string; amount: Prisma.Decimal; adjustmentAmount: Prisma.Decimal; paidAmount: Prisma.Decimal; waivedAmount: Prisma.Decimal; status: InstallmentStatus; dueDate: Date; updatedAt: Date };
  };
};

@Injectable()
export class AdjustmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly sequences: SequenceService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async list(tenantId: string, raw: Record<string, unknown>) {
    this.assertTenant(tenantId);
    const query = parseListQuery(raw, { allowedSortFields: ['adjustmentNumber', 'kind', 'status', 'amount', 'createdAt'] });
    const where: Prisma.AdjustmentWhereInput = {
      tenantId,
      ...(query.status?.length ? { status: { in: query.status as AdjustmentStatus[] } } : {}),
      ...((query.search) ? { OR: [{ adjustmentNumber: { contains: query.search, mode: 'insensitive' } }, { reason: { contains: query.search, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.adjustment.findMany({ where, orderBy: { createdAt: 'desc' }, skip: query.skip, take: query.take }),
      this.prisma.db.adjustment.count({ where }),
    ]);
    const demandIds = [...new Set(rows.map((row) => row.demandId).filter((id): id is string => Boolean(id)))];
    const studentIds = [...new Set(rows.map((row) => row.studentId).filter((id): id is string => Boolean(id)))];
    const [demands, students, reversals] = await Promise.all([
      demandIds.length ? this.prisma.db.feeDemand.findMany({ where: { tenantId, id: { in: demandIds } }, select: { id: true, demandNumber: true, currency: true, status: true } }) : Promise.resolve([]),
      studentIds.length ? this.prisma.db.student.findMany({ where: { tenantId, id: { in: studentIds } }, select: { id: true, admissionNumber: true, firstName: true, middleName: true, lastName: true } }) : Promise.resolve([]),
      rows.length ? this.prisma.db.adjustment.findMany({ where: { tenantId, reversalOfAdjustmentId: { in: rows.map((row) => row.id) } }, select: { id: true, reversalOfAdjustmentId: true } }) : Promise.resolve([]),
    ]);
    const demandById = new Map(demands.map((row) => [row.id, row]));
    const studentById = new Map(students.map((row) => [row.id, row]));
    const reversedIds = new Set(reversals.map((row) => row.reversalOfAdjustmentId).filter((value): value is string => Boolean(value)));
    return paginate(rows.map((row) => ({ ...row, demand: row.demandId ? demandById.get(row.demandId) ?? null : null, student: row.studentId ? studentById.get(row.studentId) ?? null : null, hasReversal: reversedIds.has(row.id) })), total, query);
  }

  async targets(tenantId: string, studentId: string) {
    this.assertTenant(tenantId);
    if (!isUuid(studentId)) throw AppError.validation('The student ID must be a valid identifier.');
    const student = await this.prisma.db.student.findFirst({ where: { tenantId, id: studentId, deletedAt: null }, select: { id: true, admissionNumber: true, firstName: true, middleName: true, lastName: true } });
    if (!student) throw AppError.notFound('Student');
    const demands = await this.prisma.db.feeDemand.findMany({ where: { tenantId, studentId, status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE', 'PAID'] } }, select: { id: true, demandNumber: true, currency: true, status: true, dueDate: true }, orderBy: [{ dueDate: 'asc' }, { issueDate: 'asc' }] });
    if (!demands.length) return { student, items: [] };
    const demandIds = demands.map((row) => row.id);
    const demandById = new Map(demands.map((row) => [row.id, row]));
    const items = await this.prisma.db.feeDemandItem.findMany({ where: { tenantId, demandId: { in: demandIds }, status: { not: 'CANCELLED' } }, orderBy: [{ dueDate: 'asc' }, { sequence: 'asc' }] });
    const itemIds = items.map((row) => row.id);
    const rawShares = itemIds.length ? await this.prisma.db.installmentItem.findMany({ where: { tenantId, demandItemId: { in: itemIds } } }) : [];
    const installmentIds = [...new Set(rawShares.map(({ installmentId }) => installmentId))];
    const installments = installmentIds.length ? await this.prisma.db.installment.findMany({ where: { tenantId, id: { in: installmentIds }, status: { not: 'CANCELLED' } }, select: { id: true, demandId: true, label: true, sequence: true, dueDate: true, status: true } }) : [];
    const installmentById = new Map(installments.map((row) => [row.id, row]));
    const shares = rawShares.flatMap((share) => {
      const installment = installmentById.get(share.installmentId);
      return installment ? [{ ...share, installment }] : [];
    }).sort((a, b) => a.installment.dueDate.getTime() - b.installment.dueDate.getTime() || a.installment.sequence - b.installment.sequence);
    const sharesByItem = new Map<string, typeof shares>();
    for (const share of shares) {
      if (!share.demandItemId) continue;
      sharesByItem.set(share.demandItemId, [...(sharesByItem.get(share.demandItemId) ?? []), share]);
    }
    return {
      student,
      items: items.map((item) => {
        const demand = demandById.get(item.demandId)!;
        const balance = Money.fromString(item.netAmount.toString(), demand.currency)
          .add(Money.fromString(item.adjustmentAmount.toString(), demand.currency))
          .subtract(Money.fromString(item.paidAmount.toString(), demand.currency))
          .subtract(Money.fromString(item.waivedAmount.toString(), demand.currency));
        return {
          id: item.id, demandId: demand.id, demandNumber: demand.demandNumber, demandStatus: demand.status,
          feeTypeCode: item.feeTypeCode, feeTypeName: item.feeTypeName, currency: demand.currency, dueDate: item.dueDate ?? demand.dueDate,
          balance: balance.toString(),
          installmentItems: (sharesByItem.get(item.id) ?? []).map((share) => ({
            id: share.id, amount: share.amount.toString(), adjustmentAmount: share.adjustmentAmount.toString(), paidAmount: share.paidAmount.toString(),
            balance: Money.fromString(share.amount.toString(), demand.currency).add(Money.fromString(share.adjustmentAmount.toString(), demand.currency)).subtract(Money.fromString(share.paidAmount.toString(), demand.currency)).toString(),
            installment: share.installment,
          })),
        };
      }),
    };
  }

  async create(tenantId: string, input: CreateAdjustmentInput) {
    this.assertTenant(tenantId);
    const context = this.tenantContext.require();
    const actorId = context.userId;
    const direction = input.direction ?? directionFor(input.kind);
    const fingerprint = IdempotencyService.fingerprint({ ...input, direction });
    return this.prisma.transactionWithRetry(async (tx) => {
      const reservation = await this.idempotency.reserve(tx, { tenantId, scope: 'adjustment.create', key: input.idempotencyKey, requestHash: fingerprint });
      if (!reservation.isNew) return reservation.cachedResponse?.body;

      const target = await this.loadTarget(tx, tenantId, input.demandItemId, input.installmentItemId ?? null);
      this.validateTarget(target, direction, Money.fromString(input.amount, target.demand.currency));
      await this.validateProvenance(tx, tenantId, input);

      const amount = Money.fromString(input.amount, target.demand.currency);
      const settings = await tx.tenantSettings.findUnique({ where: { tenantId }, select: { adjustmentApprovalThreshold: true, waiverApprovalThreshold: true } });
      const thresholdValue = input.kind === 'WAIVER' ? settings?.waiverApprovalThreshold : settings?.adjustmentApprovalThreshold;
      const threshold = thresholdValue ? Money.fromString(thresholdValue.toString(), target.demand.currency) : null;
      const requiresApproval = Boolean(threshold && amount.greaterThanOrEqual(threshold));
      const adjustmentNumber = await this.sequences.allocate(tx, { tenantId, kind: 'ADJUSTMENT', asOfDate: new Date().toISOString().slice(0, 10) });
      const adjustmentId = randomUUID();
      const adjustment = await tx.adjustment.create({
        data: {
          id: adjustmentId, tenantId, branchId: target.demand.branchId, adjustmentNumber, demandId: target.demand.id, demandItemId: target.item.id,
          installmentItemId: target.installmentItem?.id ?? null, studentId: target.demand.studentId, personId: target.demand.personId,
          kind: input.kind as AdjustmentKind, status: requiresApproval ? 'PENDING_APPROVAL' : 'APPROVED', direction,
          amount: amount.toString(), currency: target.demand.currency, reason: input.reason,
          policyId: input.policyId ?? null, instrumentType: input.instrumentType ?? null, instrumentId: input.instrumentId ?? null,
          requestedBy: actorId, approvedBy: requiresApproval ? null : actorId, approvedAt: requiresApproval ? null : new Date(), createdBy: actorId,
        },
      });
      let approvalRequestId: string | null = null;
      if (requiresApproval) {
        const actionType = approvalActionType(input.kind);
        const approval = await tx.approvalRequest.create({
          data: {
            tenantId, actionType, status: 'PENDING', entityType: 'Adjustment', entityId: adjustment.id,
            payload: { adjustmentId: adjustment.id },
            summary: `Approve ${input.kind.toLowerCase().replaceAll('_', ' ')} ${target.demand.currency} ${amount.format()} · ${target.demand.demandNumber}`,
            amount: amount.toString(), currency: target.demand.currency, requestedBy: actorId,
            thresholdAmount: threshold?.toString() ?? null,
          },
        });
        approvalRequestId = approval.id;
        await tx.adjustment.update({ where: { id: adjustment.id }, data: { approvalRequestId: approval.id } });
      }

      let ledgerGroupId: string | null = null;
      if (!requiresApproval) ledgerGroupId = (await this.apply(tx, adjustment, actorId ?? null)).transactionGroupId;
      const current = await tx.adjustment.findFirst({ where: { tenantId, id: adjustment.id } });
      const response = { adjustment: current, approvalRequestId, requiresApproval, ledgerGroupId };
      await this.idempotency.complete(tx, { id: reservation.id, responseCode: requiresApproval ? 202 : 201, responseBody: response, resourceId: adjustment.id, resourceType: 'Adjustment' });
      await this.audit.record(tx, { tenantId, actorId, action: requiresApproval ? 'ADJUSTMENT_REQUESTED' : 'ADJUSTMENT_APPLIED', entityType: 'Adjustment', entityId: adjustment.id, after: { adjustmentNumber, kind: input.kind, direction, amount: amount.toString(), currency: target.demand.currency, status: current?.status, demandId: target.demand.id, demandItemId: target.item.id, installmentItemId: target.installmentItem?.id ?? null, ledgerGroupId }, reason: input.reason });
      if (requiresApproval && approvalRequestId) {
        await this.outbox.publish(tx, { tenantId, eventType: 'approval.requested', aggregateType: 'ApprovalRequest', aggregateId: approvalRequestId, payload: { approvalRequestId, actionType: approvalActionType(input.kind), entityType: 'Adjustment', entityId: adjustment.id, amount: amount.toString(), requestedBy: actorId, summary: `Adjustment ${adjustmentNumber}` }, actorId, requestId: context.requestId });
      } else {
        await this.outbox.publish(tx, { tenantId, eventType: 'adjustment.applied', aggregateType: 'Adjustment', aggregateId: adjustment.id, payload: { adjustmentId: adjustment.id, adjustmentNumber, demandId: target.demand.id, studentId: target.demand.studentId, personId: target.demand.personId, amount: amount.toString(), direction, currency: target.demand.currency, ledgerGroupId }, actorId, requestId: context.requestId });
      }
      return response;
    });
  }

  async decide(tenantId: string, id: string, input: { approved: boolean; note?: string | null }) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const adjustment = await tx.adjustment.findFirst({ where: { tenantId, id } });
      if (!adjustment) throw AppError.notFound('Adjustment');
      if (adjustment.status !== 'PENDING_APPROVAL' || !adjustment.approvalRequestId) throw AppError.conflict('ADJUSTMENT_NOT_PENDING_APPROVAL', 'This adjustment is not awaiting approval.');
      if (input.approved && adjustment.requestedBy && adjustment.requestedBy === actorId && !this.tenantContext.require().isPlatformAdmin) {
        throw AppError.conflict('SELF_APPROVAL_FORBIDDEN', 'An adjustment must be approved by someone other than the person who requested it.');
      }
      const approval = await tx.approvalRequest.findFirst({ where: { tenantId, id: adjustment.approvalRequestId, actionType: approvalActionType(adjustment.kind), status: 'PENDING' } });
      if (!approval) throw AppError.conflict('APPROVAL_NOT_PENDING', 'The adjustment approval request is no longer pending.');
      const changedApproval = await tx.approvalRequest.updateMany({ where: { tenantId, id: approval.id, status: 'PENDING' }, data: { status: input.approved ? 'APPROVED' : 'REJECTED', decidedBy: actorId, decidedAt: new Date(), decisionNote: input.note ?? null } });
      if (changedApproval.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'This approval changed while being decided.');
      const changed = await tx.adjustment.updateMany({ where: { tenantId, id, status: 'PENDING_APPROVAL', updatedAt: adjustment.updatedAt }, data: input.approved ? { status: 'APPROVED', approvedBy: actorId, approvedAt: new Date() } : { status: 'REJECTED' } });
      if (changed.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'This adjustment changed while being decided.');
      const approvedAdjustment = input.approved ? await tx.adjustment.findFirst({ where: { tenantId, id } }) : null;
      if (input.approved && !approvedAdjustment) throw AppError.notFound('Adjustment');
      const ledgerGroupId = input.approved ? (await this.apply(tx, approvedAdjustment!, actorId ?? null)).transactionGroupId : null;
      const updated = await tx.adjustment.findFirst({ where: { tenantId, id } });
      await this.audit.record(tx, { tenantId, actorId, action: input.approved ? 'ADJUSTMENT_APPROVED_AND_APPLIED' : 'ADJUSTMENT_REJECTED', entityType: 'Adjustment', entityId: id, before: { status: adjustment.status }, after: { status: updated?.status, ledgerGroupId }, reason: input.note });
      await this.outbox.publish(tx, { tenantId, eventType: input.approved ? 'adjustment.applied' : 'approval.rejected', aggregateType: input.approved ? 'Adjustment' : 'ApprovalRequest', aggregateId: input.approved ? id : approval.id, payload: { adjustmentId: id, adjustmentNumber: adjustment.adjustmentNumber, approved: input.approved, ledgerGroupId, reason: input.note ?? null }, actorId, requestId: this.tenantContext.requestId });
      return { adjustment: updated, ledgerGroupId };
    });
  }

  async reverse(tenantId: string, id: string, input: ReverseAdjustmentInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    const fingerprint = IdempotencyService.fingerprint({ adjustmentId: id, reason: input.reason });
    return this.prisma.transactionWithRetry(async (tx) => {
      const reservation = await this.idempotency.reserve(tx, { tenantId, scope: 'adjustment.reverse', key: input.idempotencyKey, requestHash: fingerprint });
      if (!reservation.isNew) return reservation.cachedResponse?.body;
      const original = await tx.adjustment.findFirst({ where: { tenantId, id } });
      if (!original) throw AppError.notFound('Adjustment');
      if (original.status !== 'APPLIED' || original.reversalOfAdjustmentId) throw AppError.conflict('ADJUSTMENT_NOT_REVERSIBLE', 'Only an applied original adjustment can be reversed.');
      const existing = await tx.adjustment.findFirst({ where: { tenantId, reversalOfAdjustmentId: original.id }, select: { id: true } });
      if (existing) throw AppError.conflict('ADJUSTMENT_ALREADY_REVERSED', 'This adjustment already has a reversal.');
      if (!original.demandItemId || !original.demandId) throw AppError.conflict('ADJUSTMENT_TARGET_MISSING', 'The original adjustment has no demand item to reverse.');
      const reverseDirection: AdjustmentDirection = original.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT';
      const target = await this.loadTarget(tx, tenantId, original.demandItemId, original.installmentItemId);
      const amount = Money.fromString(original.amount.toString(), original.currency);
      this.validateTarget(target, reverseDirection, amount);
      const adjustmentNumber = await this.sequences.allocate(tx, { tenantId, kind: 'ADJUSTMENT', asOfDate: new Date().toISOString().slice(0, 10) });
      const reversal = await tx.adjustment.create({
        data: {
          tenantId, branchId: original.branchId, adjustmentNumber, demandId: original.demandId, demandItemId: original.demandItemId,
          installmentItemId: original.installmentItemId, studentId: original.studentId,
          kind: 'CORRECTION', status: 'APPROVED', direction: reverseDirection, amount: original.amount,
          currency: original.currency, reason: input.reason, reversalOfAdjustmentId: original.id,
          reversalReason: input.reason, requestedBy: actorId, approvedBy: actorId, approvedAt: new Date(), createdBy: actorId,
        },
      });
      const posted = await this.apply(tx, reversal, actorId ?? null);
      const changedOriginal = await tx.adjustment.updateMany({ where: { tenantId, id: original.id, status: 'APPLIED', updatedAt: original.updatedAt }, data: { status: 'REVERSED', reversedAt: new Date(), reversalReason: input.reason } });
      if (changedOriginal.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'This adjustment changed while its reversal was being recorded.');
      const response = { adjustment: reversal, reversedAdjustmentId: original.id, ledgerGroupId: posted.transactionGroupId };
      await this.idempotency.complete(tx, { id: reservation.id, responseCode: 201, responseBody: response, resourceId: reversal.id, resourceType: 'Adjustment' });
      await this.audit.record(tx, { tenantId, actorId, action: 'ADJUSTMENT_REVERSED', entityType: 'Adjustment', entityId: reversal.id, before: { originalStatus: original.status, originalDirection: original.direction }, after: { status: 'APPLIED', direction: reverseDirection, amount: original.amount.toString(), ledgerGroupId: posted.transactionGroupId, reversedAdjustmentId: original.id }, reason: input.reason });
      await this.outbox.publish(tx, { tenantId, eventType: 'adjustment.applied', aggregateType: 'Adjustment', aggregateId: reversal.id, payload: { adjustmentId: reversal.id, adjustmentNumber, reversalOfAdjustmentId: original.id, amount: original.amount.toString(), direction: reverseDirection, currency: original.currency, ledgerGroupId: posted.transactionGroupId }, actorId, requestId: this.tenantContext.requestId });
      return response;
    });
  }

  private async apply(tx: TransactionClient, adjustment: { id: string; tenantId: string; adjustmentNumber: string; demandId: string | null; demandItemId: string | null; installmentItemId: string | null; studentId: string | null; kind: AdjustmentKind; status: AdjustmentStatus; direction: AdjustmentDirection; amount: Prisma.Decimal; currency: string; reason: string; updatedAt: Date; reversalOfAdjustmentId?: string | null }, actorId: string | null) {
    if (adjustment.status !== 'APPROVED' || !adjustment.demandId || !adjustment.demandItemId || !adjustment.studentId) throw AppError.conflict('ADJUSTMENT_NOT_APPROVED', 'Only an approved adjustment with a valid demand target can be applied.');
    const target = await this.loadTarget(tx, adjustment.tenantId, adjustment.demandItemId, adjustment.installmentItemId);
    const amount = Money.fromString(adjustment.amount.toString(), adjustment.currency);
    this.validateTarget(target, adjustment.direction, amount);
    if (adjustment.direction === 'CREDIT') {
      const activeOrders = await tx.paymentOrder.findMany({
        where: { tenantId: adjustment.tenantId, ...(target.demand.personId ? { personId: target.demand.personId } : { studentId: target.demand.studentId }), status: { in: ['CREATED', 'INITIATED', 'PENDING'] }, expiresAt: { gt: new Date() } },
        select: { responsibilityShares: true },
      });
      const reserved = activeOrders.flatMap((order) => parseResponsibilityReservations(order.responsibilityShares))
        .filter((reservation) => reservation.demandItemId === target.item.id)
        .reduce((sum, reservation) => sum.add(Money.fromString(reservation.amount, adjustment.currency)), Money.zero(adjustment.currency));
      const currentBalance = Money.fromString(target.item.netAmount.toString(), adjustment.currency)
        .add(Money.fromString(target.item.adjustmentAmount.toString(), adjustment.currency))
        .subtract(Money.fromString(target.item.paidAmount.toString(), adjustment.currency))
        .subtract(Money.fromString(target.item.waivedAmount.toString(), adjustment.currency));
      if (amount.greaterThan(currentBalance.subtract(reserved))) {
        throw AppError.conflict('ADJUSTMENT_CHECKOUT_RESERVED', 'This reduction would consume an amount reserved by an active online checkout. Let the checkout expire or finish, then retry.');
      }
    }
    const signedDelta = this.signedDelta(adjustment.direction, amount);

    const itemAdjustment = Money.fromString(target.item.adjustmentAmount.toString(), adjustment.currency).add(signedDelta);
    const itemEffective = Money.fromString(target.item.netAmount.toString(), adjustment.currency).add(itemAdjustment);
    const itemSettled = Money.fromString(target.item.paidAmount.toString(), adjustment.currency).add(Money.fromString(target.item.waivedAmount.toString(), adjustment.currency));
    const itemStatus: DemandItemStatus = itemSettled.greaterThanOrEqual(itemEffective) ? 'PAID' : itemSettled.isPositive ? 'PARTIALLY_PAID' : 'UNPAID';
    const itemChanged = await tx.feeDemandItem.updateMany({ where: { tenantId: adjustment.tenantId, id: target.item.id, status: target.item.status, adjustmentAmount: target.item.adjustmentAmount, updatedAt: target.item.updatedAt }, data: { adjustmentAmount: itemAdjustment.toString(), status: itemStatus } });
    if (itemChanged.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'The fee item changed while the adjustment was being posted. Retry the request.');

    const demandAdjustment = Money.fromString(target.demand.adjustmentAmount.toString(), adjustment.currency).add(signedDelta);
    const demandEffective = Money.fromString(target.demand.netAmount.toString(), adjustment.currency).add(demandAdjustment);
    const demandSettled = Money.fromString(target.demand.paidAmount.toString(), adjustment.currency).add(Money.fromString(target.demand.waivedAmount.toString(), adjustment.currency)).add(Money.fromString(target.demand.creditedAmount.toString(), adjustment.currency));
    const demandStatus = this.deriveDemandStatus(target.demand, demandEffective, demandSettled);
    const demandChanged = await tx.feeDemand.updateMany({ where: { tenantId: adjustment.tenantId, id: target.demand.id, status: target.demand.status, adjustmentAmount: target.demand.adjustmentAmount, updatedAt: target.demand.updatedAt }, data: { adjustmentAmount: demandAdjustment.toString(), status: demandStatus, updatedBy: actorId } });
    if (demandChanged.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'The demand changed while the adjustment was being posted. Retry the request.');

    if (target.installmentItem) {
      const shareAdjustment = Money.fromString(target.installmentItem.adjustmentAmount.toString(), adjustment.currency).add(signedDelta);
      const shareTotal = Money.fromString(target.installmentItem.amount.toString(), adjustment.currency).add(shareAdjustment);
      const sharePaid = Money.fromString(target.installmentItem.paidAmount.toString(), adjustment.currency);
      const shareChanged = await tx.installmentItem.updateMany({ where: { tenantId: adjustment.tenantId, id: target.installmentItem.id, adjustmentAmount: target.installmentItem.adjustmentAmount, updatedAt: target.installmentItem.updatedAt }, data: { adjustmentAmount: shareAdjustment.toString() } });
      if (shareChanged.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'The installment fee item changed while the adjustment was being posted. Retry the request.');

      const installment = target.installmentItem.installment;
      const installmentAdjustment = Money.fromString(installment.adjustmentAmount.toString(), adjustment.currency).add(signedDelta);
      const installmentEffective = Money.fromString(installment.amount.toString(), adjustment.currency).add(installmentAdjustment).subtract(Money.fromString(installment.waivedAmount.toString(), adjustment.currency));
      const installmentPaid = Money.fromString(installment.paidAmount.toString(), adjustment.currency);
      const installmentStatus: InstallmentStatus = installmentPaid.greaterThanOrEqual(installmentEffective) ? 'PAID' : installmentPaid.isPositive ? 'PARTIALLY_PAID' : installment.dueDate < startOfUtcDay() ? 'OVERDUE' : 'PENDING';
      const installmentChanged = await tx.installment.updateMany({ where: { tenantId: adjustment.tenantId, id: installment.id, adjustmentAmount: installment.adjustmentAmount, updatedAt: installment.updatedAt }, data: { adjustmentAmount: installmentAdjustment.toString(), status: installmentStatus } });
      if (installmentChanged.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'The installment changed while the adjustment was being posted. Retry the request.');
      if (shareTotal.isNegative || shareTotal.lessThan(sharePaid)) throw AppError.conflict('ADJUSTMENT_BELOW_INSTALLMENT_PAID', 'The adjustment would reduce the installment below amounts already settled.');
    }

    const invoices = await tx.invoice.findMany({ where: { tenantId: adjustment.tenantId, demandId: target.demand.id, status: { not: 'VOID' } } });
    for (const invoice of invoices) {
      const nextAdjustment = Money.fromString(invoice.adjustmentAmount.toString(), adjustment.currency).add(signedDelta);
      const invoiceEffective = Money.fromString(invoice.totalAmount.toString(), adjustment.currency).add(nextAdjustment);
      const invoicePaid = Money.fromString(invoice.paidAmount.toString(), adjustment.currency);
      if (invoiceEffective.isNegative || invoiceEffective.lessThan(invoicePaid)) throw AppError.conflict('ADJUSTMENT_BELOW_INVOICE_PAID', 'The adjustment would reduce the issued invoice below amounts already settled.');
      const invoiceStatus = invoicePaid.equals(invoiceEffective) ? 'PAID' : invoicePaid.isPositive ? 'PARTIALLY_PAID' : invoice.dueDate < startOfUtcDay() ? 'OVERDUE' : 'ISSUED';
      const invoiceChanged = await tx.invoice.updateMany({ where: { tenantId: adjustment.tenantId, id: invoice.id, adjustmentAmount: invoice.adjustmentAmount, paidAmount: invoice.paidAmount, status: invoice.status }, data: { adjustmentAmount: nextAdjustment.toString(), status: invoiceStatus } });
      if (invoiceChanged.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'The invoice changed while the adjustment was being posted. Retry the request.');
    }

    const updatedAdjustment = await tx.adjustment.updateMany({ where: { tenantId: adjustment.tenantId, id: adjustment.id, status: 'APPROVED', updatedAt: adjustment.updatedAt }, data: { status: 'APPLIED', appliedAt: new Date() } });
    if (updatedAdjustment.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'The adjustment changed while being applied. Retry the request.');

    const account: SystemLedgerAccountKey = adjustment.direction === 'DEBIT'
      ? 'FEE_INCOME'
      : adjustment.kind === 'WRITE_OFF'
        ? 'WRITE_OFF_EXPENSE'
        : adjustment.kind === 'WAIVER'
          ? 'WAIVER_CONTRA'
          : 'DISCOUNT_CONTRA';
    const receivableSide = adjustment.direction === 'DEBIT' ? 'DEBIT' : 'CREDIT';
    const contraSide = receivableSide === 'DEBIT' ? 'CREDIT' : 'DEBIT';
    const receivableAccount: SystemLedgerAccountKey = target.demand.personId && !target.demand.studentId ? 'TENANT_PERSON_RECEIVABLE' : 'STUDENT_RECEIVABLE';
    return this.ledger.post(tx, {
      tenantId: adjustment.tenantId,
      currency: amount.currency.code,
      eventType: adjustment.reversalOfAdjustmentId ? 'ADJUSTMENT_REVERSED' : 'ADJUSTMENT_APPLIED',
      entryDate: new Date().toISOString().slice(0, 10),
      lines: [
        { accountKey: receivableAccount, side: receivableSide, amount: amount.toString(), narration: `${adjustment.direction === 'DEBIT' ? 'Increase' : 'Reduce'} receivable · ${adjustment.adjustmentNumber}` },
        { accountKey: account, side: contraSide, amount: amount.toString(), narration: `${adjustment.kind.replaceAll('_', ' ')} · ${adjustment.reason}` },
      ],
      studentId: target.demand.studentId, personId: target.demand.personId, demandId: target.demand.id, demandItemId: target.item.id, adjustmentId: adjustment.id,
      narration: `${adjustment.kind.replaceAll('_', ' ')} ${adjustment.adjustmentNumber}`, createdBy: actorId,
    });
  }

  private async loadTarget(tx: TransactionClient, tenantId: string, demandItemId: string, installmentItemId: string | null): Promise<AdjustmentTarget> {
    const item = await tx.feeDemandItem.findFirst({ where: { tenantId, id: demandItemId } });
    if (!item || item.status === 'CANCELLED') throw AppError.notFound('Open fee-demand item');
    const demand = await tx.feeDemand.findFirst({ where: { tenantId, id: item.demandId } });
    if (!demand) throw AppError.conflict('ADJUSTMENT_DEMAND_MISSING', 'The fee-demand item is missing its tenant demand.');
    if (!['ISSUED', 'PARTIALLY_PAID', 'OVERDUE', 'PAID'].includes(demand.status)) throw AppError.conflict('ADJUSTMENT_DEMAND_NOT_ISSUED', 'Only an issued demand can be adjusted.');
    const rawScheduleRows = await tx.installmentItem.findMany({ where: { tenantId, demandItemId: item.id } });
    const scheduleInstallmentIds = [...new Set(rawScheduleRows.map(({ installmentId }) => installmentId))];
    const scheduleInstallments = scheduleInstallmentIds.length ? await tx.installment.findMany({ where: { tenantId, id: { in: scheduleInstallmentIds }, status: { not: 'CANCELLED' } } }) : [];
    const scheduleById = new Map(scheduleInstallments.map((row) => [row.id, row]));
    const scheduleRows = rawScheduleRows.flatMap((row) => {
      const installment = scheduleById.get(row.installmentId);
      return installment ? [{ ...row, installment }] : [];
    });
    if (scheduleRows.length && !installmentItemId) throw AppError.validation('Choose the installment fee item this adjustment applies to.');
    if (!scheduleRows.length && installmentItemId) throw AppError.validation('This demand item has no active installment schedule.');
    let installmentItem: AdjustmentTarget['installmentItem'] = null;
    if (installmentItemId) {
      const selected = scheduleRows.find((row) => row.id === installmentItemId);
      if (!selected || !selected.installment || selected.installment.demandId !== item.demandId) throw AppError.notFound('Installment fee item');
      installmentItem = selected;
    }
    return { item, demand, installmentItem };
  }

  private validateTarget(target: AdjustmentTarget, direction: AdjustmentDirection, amount: Money): void {
    const currency = target.demand.currency;
    if (amount.currency.code !== currency) throw AppError.validation('Adjustment currency must match the fee demand currency.');
    const itemCurrent = Money.fromString(target.item.netAmount.toString(), currency)
      .add(Money.fromString(target.item.adjustmentAmount.toString(), currency))
      .subtract(Money.fromString(target.item.paidAmount.toString(), currency))
      .subtract(Money.fromString(target.item.waivedAmount.toString(), currency));
    if (direction === 'CREDIT' && amount.greaterThan(itemCurrent)) throw AppError.validation(`A reduction cannot exceed the current fee-item balance of ${itemCurrent.max(Money.zero(currency)).toString()} ${currency}.`);
    if (target.installmentItem) {
      const share = target.installmentItem;
      const shareCurrent = Money.fromString(share.amount.toString(), currency).add(Money.fromString(share.adjustmentAmount.toString(), currency)).subtract(Money.fromString(share.paidAmount.toString(), currency));
      if (direction === 'CREDIT' && amount.greaterThan(shareCurrent)) throw AppError.validation(`A reduction cannot exceed the installment balance of ${shareCurrent.max(Money.zero(currency)).toString()} ${currency}.`);
    }
  }

  private async validateProvenance(tx: TransactionClient, tenantId: string, input: CreateAdjustmentInput): Promise<void> {
    if (input.policyId && !(await tx.feePolicy.findFirst({ where: { tenantId, id: input.policyId }, select: { id: true } }))) throw AppError.notFound('Fee policy');
    if (!input.instrumentId || !input.instrumentType) return;
    const found = input.instrumentType === 'SCHOLARSHIP'
      ? await tx.scholarship.findFirst({ where: { tenantId, id: input.instrumentId }, select: { id: true } })
      : input.instrumentType === 'DISCOUNT'
        ? await tx.discount.findFirst({ where: { tenantId, id: input.instrumentId }, select: { id: true } })
        : input.instrumentType === 'CONCESSION'
          ? await tx.concession.findFirst({ where: { tenantId, id: input.instrumentId }, select: { id: true } })
          : input.instrumentType === 'OVERRIDE'
            ? await tx.feeOverride.findFirst({ where: { tenantId, id: input.instrumentId }, select: { id: true } })
            : await tx.waiver.findFirst({ where: { tenantId, id: input.instrumentId }, select: { id: true } });
    if (!found) throw AppError.notFound('Adjustment instrument');
  }

  private signedDelta(direction: AdjustmentDirection, amount: Money): Money {
    return direction === 'DEBIT' ? amount : Money.zero(amount.currency).subtract(amount);
  }

  private deriveDemandStatus(demand: AdjustmentTarget['demand'], effective: Money, settled: Money): DemandStatus {
    if (effective.isNegative) throw AppError.conflict('DEMAND_ADJUSTMENT_INVARIANT', 'A correction cannot make the fee demand total negative.');
    if (settled.greaterThanOrEqual(effective)) return 'PAID';
    if (demand.dueDate < startOfUtcDay()) return 'OVERDUE';
    return settled.isPositive ? 'PARTIALLY_PAID' : 'ISSUED';
  }

  private assertTenant(tenantId: string): void {
    if (this.tenantContext.requireTenantId() !== tenantId) throw AppError.forbidden('The requested tenant does not match the authenticated session.');
  }
}

@ApiTags('adjustments')
@RequireModules('FEES')
@Controller('adjustments')
export class AdjustmentsController {
  constructor(private readonly adjustments: AdjustmentsService) {}
  @Get() @RequirePermissions(PERMISSIONS.ADJUSTMENT_READ) list(@CurrentTenant() tenant: string, @Query() query: Record<string, unknown>) { return this.adjustments.list(tenant, query); }
  @Get('targets') @RequirePermissions(PERMISSIONS.ADJUSTMENT_CREATE) @ApiOperation({ summary: 'Read issued fee-item and installment targets for an operational adjustment' }) targets(@CurrentTenant() tenant: string, @Query('studentId') studentId: string) { return this.adjustments.targets(tenant, studentId); }
  @Post() @RequirePermissions(PERMISSIONS.ADJUSTMENT_CREATE) @UsePipes(new ZodValidationPipe(createAdjustmentSchema)) @ApiOperation({ summary: 'Create an idempotent adjustment; apply immediately or wait for tenant threshold approval' }) create(@CurrentTenant() tenant: string, @Body() body: CreateAdjustmentInput) { return this.adjustments.create(tenant, body); }
  @Post(':id/decision') @RequirePermissions(PERMISSIONS.ADJUSTMENT_APPROVE) @UsePipes(new ZodValidationPipe(approvalDecisionSchema)) decide(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: { approved: boolean; note?: string | null }) { return this.adjustments.decide(tenant, id, body); }
  @Post(':id/reverse') @RequirePermissions(PERMISSIONS.ADJUSTMENT_APPROVE) @UsePipes(new ZodValidationPipe(reverseAdjustmentSchema)) @ApiOperation({ summary: 'Create a compensating adjustment and balanced ledger posting' }) reverse(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: ReverseAdjustmentInput) { return this.adjustments.reverse(tenant, id, body); }
}

@Module({ imports: [PrismaModule, TenantContextModule], controllers: [AdjustmentsController], providers: [AdjustmentsService], exports: [AdjustmentsService] })
export class AdjustmentsModule {}

function directionFor(kind: CreateAdjustmentInput['kind']): AdjustmentDirection {
  return kind === 'DEBIT_ADJUSTMENT' ? 'DEBIT' : 'CREDIT';
}

function approvalActionType(kind: AdjustmentKind): 'FEE_WAIVER' | 'WRITE_OFF' | 'MANUAL_ADJUSTMENT' {
  return kind === 'WAIVER' ? 'FEE_WAIVER' : kind === 'WRITE_OFF' ? 'WRITE_OFF' : 'MANUAL_ADJUSTMENT';
}

function startOfUtcDay(): Date {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return today;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseResponsibilityReservations(value: Prisma.JsonValue | null): Array<{ demandItemId: string; amount: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const row = entry as { demandItemId?: unknown; amount?: unknown };
    if (typeof row.demandItemId !== 'string' || typeof row.amount !== 'string' || !/^\d{1,14}(?:\.\d{1,4})?$/.test(row.amount)) return [];
    return [{ demandItemId: row.demandItemId, amount: row.amount }];
  });
}
