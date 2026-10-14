import { Body, Controller, Get, Injectable, Module, Param, Post, Query, UsePipes } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { Money } from '@fee/money';
import { Prisma, type CreditStatus, type DemandItemStatus, type DemandStatus, type InstallmentStatus, type TransactionClient } from '@fee/database';
import { ERROR_CODES, PERMISSIONS, type SystemLedgerAccountKey } from '@fee/types';
import { applyCreditSchema, type ApplyCreditInput } from '@fee/validation';
import { AppError } from '../common/errors';
import { AuditService, IdempotencyService, LedgerService, OutboxService, requireTenantCurrency, syncInvoiceSettlement } from '../common/financial';
import { parseListQuery, paginate, toPrismaOrderBy, ZodValidationPipe } from '../common/http';
import { PrismaModule, PrismaService } from '../common/prisma.service';
import { CurrentTenant, RequireModules, RequirePermissions, TenantContextModule, TenantContextService } from '../common/tenancy';

type CreditScheduleShare = {
  id: string;
  installmentId: string;
  amount: Prisma.Decimal;
  adjustmentAmount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  updatedAt: Date;
  installment: { id: string; sequence: number; label: string; dueDate: Date; amount: Prisma.Decimal; adjustmentAmount: Prisma.Decimal; paidAmount: Prisma.Decimal; waivedAmount: Prisma.Decimal; status: InstallmentStatus; updatedAt: Date };
};
type CreditDemandItem = {
  id: string;
  tenantId: string;
  demandId: string;
  feeTypeId: string;
  feeTypeCode: string;
  feeTypeName: string;
  netAmount: Prisma.Decimal;
  adjustmentAmount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  waivedAmount: Prisma.Decimal;
  status: DemandItemStatus;
  sequence: number;
  updatedAt: Date;
  demand: { id: string; demandNumber: string; studentId: string | null; personId: string | null; status: DemandStatus; dueDate: Date; issueDate: Date; currency: string; netAmount: Prisma.Decimal; adjustmentAmount: Prisma.Decimal; paidAmount: Prisma.Decimal; waivedAmount: Prisma.Decimal; creditedAmount: Prisma.Decimal; updatedAt: Date };
  installmentShares: CreditScheduleShare[];
  studentResponsibilityShares: Array<{ responsibilityId: string | null; balance: Money }>;
  responsibilityBalance: Money;
};
type ItemAllocation = { item: CreditDemandItem; amount: Money; responsibilityId: string | null; installmentShare?: CreditScheduleShare };
type FinalAllocation = ItemAllocation & { credit: { id: string; paymentId: string | null }; sequence: number };

@Injectable()
export class CreditsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async list(tenantId: string, raw: Record<string, unknown>) {
    this.assertTenant(tenantId);
    const query = parseListQuery(raw, { allowedSortFields: ['createdAt', 'originalAmount', 'availableAmount', 'status'] });
    const studentId = typeof raw.studentId === 'string' && raw.studentId.trim() ? raw.studentId.trim() : undefined;
    const personId = typeof raw.personId === 'string' && raw.personId.trim() ? raw.personId.trim() : undefined;
    if (studentId && personId) throw AppError.validation('Filter credits by one person identity at a time.');
    if ((studentId ?? personId) && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(studentId ?? personId!)) throw AppError.validation('The person ID must be a valid identifier.');
    const where: Prisma.CreditWhereInput = { tenantId, ...(studentId ? { studentId } : {}), ...(personId ? { personId } : {}), ...(query.status?.length ? { status: { in: query.status as CreditStatus[] } } : {}) };
    const [credits, total] = await Promise.all([
      this.prisma.db.credit.findMany({ where, orderBy: toPrismaOrderBy(query.sort) as Prisma.CreditOrderByWithRelationInput[], skip: query.skip, take: query.take }),
      this.prisma.db.credit.count({ where }),
    ]);
    const studentIds = [...new Set(credits.flatMap(({ studentId }) => studentId ? [studentId] : []))];
    const students = studentIds.length ? await this.prisma.db.student.findMany({ where: { tenantId, id: { in: studentIds } }, select: { id: true, admissionNumber: true, firstName: true, middleName: true, lastName: true } }) : [];
    const studentById = new Map(students.map((student) => [student.id, student]));
    const personIds = [...new Set(credits.flatMap(({ personId }) => personId ? [personId] : []))];
    const people = personIds.length ? await this.prisma.db.tenantPerson.findMany({ where: { tenantId, id: { in: personIds } }, select: { id: true, personNumber: true, typeLabel: true, firstName: true, middleName: true, lastName: true } }) : [];
    const personById = new Map(people.map((person) => [person.id, person]));
    const items = credits.map((credit) => ({ ...credit, student: credit.studentId ? studentById.get(credit.studentId) ?? null : null, person: credit.personId ? personById.get(credit.personId) ?? null : null }));
    return paginate(items, total, query);
  }

  async get(tenantId: string, id: string) {
    this.assertTenant(tenantId);
    const credit = await this.prisma.db.credit.findFirst({ where: { tenantId, id } });
    if (!credit) throw AppError.notFound('Credit');
    const allocations = await this.prisma.db.creditAllocation.findMany({ where: { tenantId, creditId: id }, orderBy: { createdAt: 'asc' } });
    const demandItemIds = [...new Set(allocations.flatMap((row) => row.demandItemId ? [row.demandItemId] : []))];
    const installmentIds = [...new Set(allocations.flatMap((row) => row.installmentId ? [row.installmentId] : []))];
    const [demandItems, installments] = await Promise.all([
      demandItemIds.length ? this.prisma.db.feeDemandItem.findMany({ where: { tenantId, id: { in: demandItemIds } } }) : Promise.resolve([]),
      installmentIds.length ? this.prisma.db.installment.findMany({ where: { tenantId, id: { in: installmentIds } } }) : Promise.resolve([]),
    ]);
    const itemById = new Map(demandItems.map((row) => [row.id, row]));
    const installmentById = new Map(installments.map((row) => [row.id, row]));
    return { ...credit, allocations: allocations.map((allocation) => ({
      ...allocation,
      demandItem: allocation.demandItemId ? itemById.get(allocation.demandItemId) ?? null : null,
      installment: allocation.installmentId ? installmentById.get(allocation.installmentId) ?? null : null,
    })) };
  }

  async apply(tenantId: string, input: ApplyCreditInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    const requestHash = IdempotencyService.fingerprint(input);
    return this.prisma.transactionWithRetry(async (tx) => {
      const reservation = await this.idempotency.reserve(tx, { tenantId, scope: 'credit.apply', key: input.idempotencyKey, requestHash });
      if (!reservation.isNew) return reservation.cachedResponse?.body;
      const settings = await tx.tenantSettings.findUnique({ where: { tenantId } });
      const currency = requireTenantCurrency(settings);
      const isPerson = Boolean(input.personId);
      const subjectId = input.personId ?? input.studentId!;
      const subject = isPerson
        ? await tx.tenantPerson.findFirst({ where: { tenantId, id: subjectId, deletedAt: null, status: 'ACTIVE' }, select: { id: true, personNumber: true, typeLabel: true } })
        : await tx.student.findFirst({ where: { tenantId, id: subjectId }, select: { id: true, admissionNumber: true } });
      if (!subject) throw AppError.notFound(isPerson ? 'Organisation person' : 'Student');
      const subjectFilter = isPerson ? { personId: subject.id } : { studentId: subject.id };
      const subjectNumber = isPerson ? (subject as { personNumber: string }).personNumber : (subject as { admissionNumber: string }).admissionNumber;
      const subjectLabel = isPerson ? (subject as { typeLabel: string }).typeLabel.toLowerCase() : 'student';

      let credits = await tx.credit.findMany({ where: { tenantId, ...subjectFilter, currency, status: { in: ['AVAILABLE', 'PARTIALLY_ALLOCATED'] }, availableAmount: { gt: 0 }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }], ...(input.creditIds ? { id: { in: input.creditIds } } : {}) }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      if (input.creditIds && credits.length !== input.creditIds.length) throw AppError.validation(`Every selected credit must belong to this ${subjectLabel}, use the tenant currency, and still have available balance.`);
      if (!credits.length) throw AppError.conflict('NO_AVAILABLE_CREDIT', `This ${subjectLabel} has no available credit in the tenant currency.`);

      let openItems = await this.openItems(tx, tenantId, subject.id, isPerson);
      if (input.demandItemIds) {
        const byId = new Map(openItems.map((item) => [item.id, item]));
        if (input.demandItemIds.some((id) => !byId.has(id))) throw AppError.validation(`Every selected demand item must belong to this ${subjectLabel} and have an outstanding balance.`);
        const selected = new Set(input.demandItemIds);
        openItems = openItems.filter((item) => selected.has(item.id));
      }
      const available = credits.reduce((sum, credit) => sum.add(Money.fromString(credit.availableAmount.toString(), currency)), Money.zero(currency));
      const due = openItems.reduce((sum, item) => sum.add(item.responsibilityBalance), Money.zero(currency));
      const maximum = available.min(due);
      const requested = input.amount ? Money.fromString(input.amount, currency) : maximum;
      if (!maximum.isPositive || !requested.isPositive || requested.greaterThan(maximum)) throw AppError.validation(`Credit application cannot exceed the lower of available credit (${available.format()}) and the ${subjectLabel}'s unreserved responsibility (${due.format()}).`);

      const itemPlan = this.planDemandItems(openItems, requested);
      const allocations = this.assignCredits(credits, itemPlan, requested, currency);
      if (!allocations.length) throw AppError.conflict('NO_CREDIT_ALLOCATION', 'No eligible fee balance could receive this credit.');

      const itemChanges = new Map<string, { item: CreditDemandItem; amount: Money }>();
      const demandChanges = new Map<string, { demand: CreditDemandItem['demand']; amount: Money }>();
      const installmentItemChanges = new Map<string, { item: CreditScheduleShare; amount: Money }>();
      const installmentChanges = new Map<string, { installment: CreditScheduleShare['installment']; amount: Money }>();
      const creditChanges = new Map<string, { credit: (typeof credits)[number]; amount: Money }>();
      const paymentChanges = new Map<string, Money>();
      const auditAllocations: Array<{ creditId: string; demandId: string; demandItemId: string; installmentId: string | null; amount: string }> = [];
      for (const allocation of allocations) {
        const itemChange = itemChanges.get(allocation.item.id) ?? { item: allocation.item, amount: Money.zero(currency) };
        itemChange.amount = itemChange.amount.add(allocation.amount);
        itemChanges.set(allocation.item.id, itemChange);
        const demandChange = demandChanges.get(allocation.item.demandId) ?? { demand: allocation.item.demand, amount: Money.zero(currency) };
        demandChange.amount = demandChange.amount.add(allocation.amount);
        demandChanges.set(allocation.item.demandId, demandChange);
        const creditChange = creditChanges.get(allocation.credit.id) ?? { credit: credits.find((credit) => credit.id === allocation.credit.id)!, amount: Money.zero(currency) };
        creditChange.amount = creditChange.amount.add(allocation.amount);
        creditChanges.set(allocation.credit.id, creditChange);
        if (allocation.credit.paymentId) paymentChanges.set(allocation.credit.paymentId, (paymentChanges.get(allocation.credit.paymentId) ?? Money.zero(currency)).add(allocation.amount));
        if (allocation.installmentShare) {
          const shareChange = installmentItemChanges.get(allocation.installmentShare.id) ?? { item: allocation.installmentShare, amount: Money.zero(currency) };
          shareChange.amount = shareChange.amount.add(allocation.amount);
          installmentItemChanges.set(allocation.installmentShare.id, shareChange);
          const installmentChange = installmentChanges.get(allocation.installmentShare.installmentId) ?? { installment: allocation.installmentShare.installment, amount: Money.zero(currency) };
          installmentChange.amount = installmentChange.amount.add(allocation.amount);
          installmentChanges.set(allocation.installmentShare.installmentId, installmentChange);
        }
        await tx.creditAllocation.create({ data: { id: randomUUID(), tenantId, creditId: allocation.credit.id, demandId: allocation.item.demandId, demandItemId: allocation.item.id, installmentId: allocation.installmentShare?.installmentId ?? null, responsibilityId: allocation.responsibilityId, amount: allocation.amount.toString(), currency, sequence: allocation.sequence, reason: allocation.installmentShare ? `Applied to ${allocation.installmentShare.installment.label}` : 'Applied to demand item', createdBy: actorId ?? null } });
        auditAllocations.push({ creditId: allocation.credit.id, demandId: allocation.item.demandId, demandItemId: allocation.item.id, installmentId: allocation.installmentShare?.installmentId ?? null, amount: allocation.amount.toString() });
      }

      for (const { item, amount } of itemChanges.values()) {
        const paid = Money.fromString(item.paidAmount.toString(), currency).add(amount);
        const net = Money.fromString(item.netAmount.toString(), currency).add(Money.fromString(item.adjustmentAmount.toString(), currency));
        const waived = Money.fromString(item.waivedAmount.toString(), currency);
        const status = paid.add(waived).greaterThanOrEqual(net) ? 'PAID' : 'PARTIALLY_PAID';
        const changed = await tx.feeDemandItem.updateMany({ where: { tenantId, id: item.id, status: item.status, paidAmount: item.paidAmount, updatedAt: item.updatedAt }, data: { paidAmount: paid.toString(), status } });
        if (changed.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'A demand item changed while the credit was being applied. Retry the application.');
      }
      for (const { demand, amount } of demandChanges.values()) {
        const paid = Money.fromString(demand.paidAmount.toString(), currency).add(amount);
        const net = Money.fromString(demand.netAmount.toString(), currency).add(Money.fromString(demand.adjustmentAmount.toString(), currency));
        const status = paid.add(Money.fromString(demand.waivedAmount.toString(), currency)).greaterThanOrEqual(net) ? 'PAID' : 'PARTIALLY_PAID';
        const changed = await tx.feeDemand.updateMany({ where: { tenantId, id: demand.id, status: demand.status, paidAmount: demand.paidAmount, updatedAt: demand.updatedAt }, data: { paidAmount: paid.toString(), status, updatedBy: actorId ?? null } });
        if (changed.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'A demand changed while the credit was being applied. Retry the application.');
        await syncInvoiceSettlement(tx, { tenantId, demandId: demand.id, paidAmount: paid.toString(), dueDate: demand.dueDate });
      }
      for (const { item, amount } of installmentItemChanges.values()) {
        const paid = Money.fromString(item.paidAmount.toString(), currency).add(amount);
        if (paid.greaterThan(Money.fromString(item.amount.toString(), currency).add(Money.fromString(item.adjustmentAmount.toString(), currency)))) throw AppError.conflict('INSTALLMENT_OVERALLOCATED', 'Credit allocation exceeds the installment fee-item balance.');
        const changed = await tx.installmentItem.updateMany({ where: { tenantId, id: item.id, paidAmount: item.paidAmount, updatedAt: item.updatedAt }, data: { paidAmount: paid.toString() } });
        if (changed.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'An installment item changed while credit was being applied.');
      }
      for (const { installment, amount } of installmentChanges.values()) {
        const paid = Money.fromString(installment.paidAmount.toString(), currency).add(amount);
        const net = Money.fromString(installment.amount.toString(), currency).add(Money.fromString(installment.adjustmentAmount.toString(), currency)).subtract(Money.fromString(installment.waivedAmount.toString(), currency));
        const status = paid.greaterThanOrEqual(net) ? 'PAID' : paid.isPositive ? 'PARTIALLY_PAID' : installment.dueDate < new Date() ? 'OVERDUE' : 'PENDING';
        const changed = await tx.installment.updateMany({ where: { tenantId, id: installment.id, paidAmount: installment.paidAmount, updatedAt: installment.updatedAt }, data: { paidAmount: paid.toString(), status } });
        if (changed.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'An installment changed while the credit was being applied.');
      }
      for (const { credit, amount } of creditChanges.values()) {
        const availableAmount = Money.fromString(credit.availableAmount.toString(), currency).subtract(amount);
        const allocatedAmount = Money.fromString(credit.allocatedAmount.toString(), currency).add(amount);
        const originalAmount = Money.fromString(credit.originalAmount.toString(), currency);
        const refundedAmount = Money.fromString(credit.refundedAmount.toString(), currency);
        if (availableAmount.isNegative || !availableAmount.add(allocatedAmount).add(refundedAmount).equals(originalAmount)) throw AppError.conflict('CREDIT_BALANCE_INVARIANT', 'Credit application would make the person credit balance inconsistent.');
        const status = availableAmount.isPositive ? 'PARTIALLY_ALLOCATED' : 'ALLOCATED';
        const changed = await tx.credit.updateMany({ where: { tenantId, id: credit.id, availableAmount: credit.availableAmount, allocatedAmount: credit.allocatedAmount, refundedAmount: credit.refundedAmount }, data: { availableAmount: availableAmount.toString(), allocatedAmount: allocatedAmount.toString(), status } });
        if (changed.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'A credit changed while the application was being posted.');
      }
      for (const [paymentId, amount] of paymentChanges) {
        const payment = await tx.payment.findFirst({ where: { tenantId, id: paymentId } });
        if (!payment) throw AppError.conflict('CREDIT_SOURCE_PAYMENT_MISSING', 'A credit source payment is unavailable.');
        const available = Money.fromString(payment.unallocatedAmount.toString(), currency);
        const allocated = Money.fromString(payment.allocatedAmount.toString(), currency).add(amount);
        if (amount.greaterThan(available)) throw AppError.conflict('CREDIT_SOURCE_PAYMENT_BALANCE_MISMATCH', 'Credit application exceeds the source payment’s unallocated balance.');
        const changed = await tx.payment.updateMany({ where: { tenantId, id: paymentId, unallocatedAmount: payment.unallocatedAmount, allocatedAmount: payment.allocatedAmount }, data: { unallocatedAmount: available.subtract(amount).toString(), allocatedAmount: allocated.toString(), updatedBy: actorId ?? null } });
        if (changed.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'A source payment changed while its credit was being applied.');
      }

      const appliedAmount = allocations.reduce((sum, allocation) => sum.add(allocation.amount), Money.zero(currency));
      const receivableAccount: SystemLedgerAccountKey = isPerson ? 'TENANT_PERSON_RECEIVABLE' : 'STUDENT_RECEIVABLE';
      const creditAccount: SystemLedgerAccountKey = isPerson ? 'TENANT_PERSON_CREDIT' : 'STUDENT_CREDIT';
      const ledgerLines: Array<{ accountKey: SystemLedgerAccountKey; side: 'DEBIT' | 'CREDIT'; amount: string; narration: string }> = [
        { accountKey: creditAccount, side: 'DEBIT', amount: appliedAmount.toString(), narration: `Person credit applied · ${subjectNumber}` },
        { accountKey: receivableAccount, side: 'CREDIT', amount: appliedAmount.toString(), narration: `Applied to open fee demands · ${subjectNumber}` },
      ];
      const posted = await this.ledger.post(tx, { tenantId, currency, eventType: 'CREDIT_APPLIED', entryDate: new Date().toISOString().slice(0, 10), lines: ledgerLines, studentId: isPerson ? null : subject.id, personId: isPerson ? subject.id : null, narration: `Credit application · ${subjectNumber}`, createdBy: actorId ?? null });
      const response = { studentId: isPerson ? null : subject.id, personId: isPerson ? subject.id : null, amount: appliedAmount.toString(), currency, allocations: auditAllocations, ledgerGroupId: posted.transactionGroupId };
      await this.idempotency.complete(tx, { id: reservation.id, responseCode: 201, responseBody: response, resourceId: subject.id, resourceType: 'CreditApplication' });
      await this.audit.record(tx, { tenantId, actorId, action: 'CREDIT_APPLIED', entityType: 'CreditApplication', entityId: subject.id, after: { amount: appliedAmount.toString(), currency, personId: isPerson ? subject.id : null, studentId: isPerson ? null : subject.id, allocations: auditAllocations, ledgerGroupId: posted.transactionGroupId } });
      await this.outbox.publish(tx, { tenantId, eventType: 'CREDIT_APPLIED', aggregateType: isPerson ? 'TenantPerson' : 'Student', aggregateId: subject.id, payload: { studentId: isPerson ? null : subject.id, personId: isPerson ? subject.id : null, amount: appliedAmount.toString(), currency, allocations: auditAllocations }, actorId, requestId: this.tenantContext.requestId });
      return response;
    });
  }

  private async openItems(tx: TransactionClient, tenantId: string, subjectId: string, isPerson: boolean): Promise<CreditDemandItem[]> {
    const demands = await tx.feeDemand.findMany({ where: { tenantId, ...(isPerson ? { personId: subjectId, studentId: null } : { studentId: subjectId }), status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] } }, orderBy: [{ dueDate: 'asc' }, { issueDate: 'asc' }] });
    if (!demands.length) return [];
    const items = await tx.feeDemandItem.findMany({ where: { tenantId, demandId: { in: demands.map((demand) => demand.id) }, status: { in: ['UNPAID', 'PARTIALLY_PAID'] } }, orderBy: [{ sequence: 'asc' }] });
    if (!items.length) return [];
    const installments = await tx.installment.findMany({ where: { tenantId, demandId: { in: demands.map((demand) => demand.id) }, status: { not: 'CANCELLED' } }, orderBy: [{ dueDate: 'asc' }, { sequence: 'asc' }] });
    const rawShares = installments.length ? await tx.installmentItem.findMany({ where: { tenantId, demandItemId: { in: items.map((item) => item.id) }, installmentId: { in: installments.map((installment) => installment.id) } } }) : [];
    const installmentById = new Map(installments.map((installment) => [installment.id, installment]));
    const shares = rawShares.flatMap((share) => {
      const installment = installmentById.get(share.installmentId);
      return installment ? [{ ...share, installment }] : [];
    });
    const responsibilities = await tx.feeDemandResponsibility.findMany({ where: { tenantId, demandItemId: { in: items.map((item) => item.id) } } });
    const responsibilityIds = responsibilities.map(({ id }) => id);
    const [activeAllocations, activeCreditAllocations] = responsibilityIds.length ? await Promise.all([
      tx.paymentAllocation.findMany({ where: { tenantId, responsibilityId: { in: responsibilityIds }, reversedAt: null } }),
      tx.creditAllocation.findMany({ where: { tenantId, responsibilityId: { in: responsibilityIds }, reversedAt: null } }),
    ]) : [[], []];
    const paymentAllocationIds = activeAllocations.map(({ id }) => id);
    const creditAllocationIds = activeCreditAllocations.map(({ id }) => id);
    const [paymentReversals, creditReversals] = await Promise.all([
      paymentAllocationIds.length ? tx.refundAllocation.groupBy({ by: ['paymentAllocationId'], where: { tenantId, paymentAllocationId: { in: paymentAllocationIds } }, _sum: { amount: true } }) : Promise.resolve([]),
      creditAllocationIds.length ? tx.refundAllocation.groupBy({ by: ['creditAllocationId'], where: { tenantId, creditAllocationId: { in: creditAllocationIds } }, _sum: { amount: true } }) : Promise.resolve([]),
    ]);
    const paymentReversalById = new Map(paymentReversals.flatMap((row) => row.paymentAllocationId ? [[row.paymentAllocationId, row._sum.amount] as const] : []));
    const creditReversalById = new Map(creditReversals.flatMap((row) => row.creditAllocationId ? [[row.creditAllocationId, row._sum.amount] as const] : []));
    const paymentAllocationsByResponsibility = new Map<string, typeof activeAllocations>();
    const creditAllocationsByResponsibility = new Map<string, typeof activeCreditAllocations>();
    for (const allocation of activeAllocations) if (allocation.responsibilityId) paymentAllocationsByResponsibility.set(allocation.responsibilityId, [...(paymentAllocationsByResponsibility.get(allocation.responsibilityId) ?? []), allocation]);
    for (const allocation of activeCreditAllocations) if (allocation.responsibilityId) creditAllocationsByResponsibility.set(allocation.responsibilityId, [...(creditAllocationsByResponsibility.get(allocation.responsibilityId) ?? []), allocation]);
    const enrichedResponsibilities = responsibilities.map((row) => ({
      ...row,
      allocations: (paymentAllocationsByResponsibility.get(row.id) ?? []).map((allocation) => ({ amount: allocation.amount, refundReversals: paymentReversalById.get(allocation.id) ? [{ amount: paymentReversalById.get(allocation.id)! }] : [] })),
      creditAllocations: (creditAllocationsByResponsibility.get(row.id) ?? []).map((allocation) => ({ amount: allocation.amount, refundReversals: creditReversalById.get(allocation.id) ? [{ amount: creditReversalById.get(allocation.id)! }] : [] })),
    }));
    const activeOrders = await tx.paymentOrder.findMany({
      where: { tenantId, ...(isPerson ? { personId: subjectId } : { studentId: subjectId }), status: { in: ['CREATED', 'INITIATED', 'PENDING'] }, expiresAt: { gt: new Date() } },
      select: { responsibilityShares: true },
    });
    const reservations = activeOrders.flatMap((order) => parseResponsibilityReservations(order.responsibilityShares));
    const demandById = new Map(demands.map((demand) => [demand.id, demand]));
    const itemById = new Map(items.map((item) => [item.id, item]));
    const sharesByItem = new Map<string, CreditScheduleShare[]>();
    for (const share of shares) {
      if (!share.demandItemId) continue;
      const item = itemById.get(share.demandItemId);
      if (!item) continue;
      if (share.installment.demandId !== item.demandId) throw AppError.conflict('INSTALLMENT_DEMAND_MISMATCH', 'A fee item is linked to an installment from another demand.');
      sharesByItem.set(item.id, [...(sharesByItem.get(item.id) ?? []), share as CreditScheduleShare]);
    }
    const responsibilitiesByItem = new Map<string, Array<{ id: string; payerType: string; amount: Prisma.Decimal; allocations: Array<{ amount: Prisma.Decimal; refundReversals: Array<{ amount: Prisma.Decimal }> }>; creditAllocations: Array<{ amount: Prisma.Decimal; refundReversals: Array<{ amount: Prisma.Decimal }> }> }>>();
    for (const row of enrichedResponsibilities) responsibilitiesByItem.set(row.demandItemId, [...(responsibilitiesByItem.get(row.demandItemId) ?? []), row]);
    return items.map((item) => {
      const demand = demandById.get(item.demandId)!;
      const currency = demand.currency;
      const rows = responsibilitiesByItem.get(item.id) ?? [];
      const balances = rows.map((row) => ({
        row,
        actualOutstanding: Money.fromString(row.amount.toString(), currency)
          .subtract(allocationUsed(row.allocations, currency))
          .subtract(allocationUsed(row.creditAllocations, currency)),
      })).map((entry) => ({ ...entry, actualOutstanding: entry.actualOutstanding.isPositive ? entry.actualOutstanding : Money.zero(currency) }));
      const payerRows = balances.filter(({ row }) => row.payerType === (isPerson ? 'MEMBER' : 'STUDENT')).sort((left, right) => left.row.id.localeCompare(right.row.id));
      const due = this.itemBalance({ ...item, demand });
      const otherPayerBalance = balances.filter(({ row }) => row.payerType !== (isPerson ? 'MEMBER' : 'STUDENT')).reduce((sum, entry) => sum.add(entry.actualOutstanding), Money.zero(currency));
      const assignedBalance = payerRows.reduce((sum, entry) => sum.add(entry.actualOutstanding), Money.zero(currency));
      let payerCapacity = due.subtract(otherPayerBalance).max(Money.zero(currency));
      const studentResponsibilityShares: CreditDemandItem['studentResponsibilityShares'] = [];
      for (const entry of payerRows) {
        if (!payerCapacity.isPositive) break;
        const reserved = reservations.filter((reservation) => reservation.demandItemId === item.id && reservation.responsibilityId === entry.row.id)
          .reduce((sum, reservation) => sum.add(Money.fromString(reservation.amount, currency)), Money.zero(currency));
        const available = entry.actualOutstanding.subtract(reserved).max(Money.zero(currency)).min(payerCapacity);
        if (available.isPositive) studentResponsibilityShares.push({ responsibilityId: entry.row.id, balance: available });
        payerCapacity = payerCapacity.subtract(available);
      }
      const unassigned = due.subtract(otherPayerBalance).subtract(assignedBalance);
      const nullReserved = reservations.filter((reservation) => reservation.demandItemId === item.id && reservation.responsibilityId === null)
        .reduce((sum, reservation) => sum.add(Money.fromString(reservation.amount, currency)), Money.zero(currency));
      const unassignedAvailable = (unassigned.isPositive ? unassigned : Money.zero(currency)).subtract(nullReserved).max(Money.zero(currency)).min(payerCapacity);
      if (unassignedAvailable.isPositive) studentResponsibilityShares.push({ responsibilityId: null, balance: unassignedAvailable });
      const studentBalance = studentResponsibilityShares.reduce((sum, share) => sum.add(share.balance), Money.zero(currency));
      return { ...item, demand, installmentShares: (sharesByItem.get(item.id) ?? []).sort((a, b) => a.installment.dueDate.getTime() - b.installment.dueDate.getTime() || a.installment.sequence - b.installment.sequence), studentResponsibilityShares, responsibilityBalance: studentBalance } as CreditDemandItem;
    })
      .filter((item) => this.itemBalance(item).isPositive && item.responsibilityBalance.isPositive)
      .sort((a, b) => this.itemDueDate(a).getTime() - this.itemDueDate(b).getTime() || a.demand.issueDate.getTime() - b.demand.issueDate.getTime() || a.sequence - b.sequence);
  }

  private planDemandItems(items: CreditDemandItem[], amount: Money): ItemAllocation[] {
    const result: ItemAllocation[] = [];
    let remaining = amount;
    for (const item of items) {
      if (!remaining.isPositive) break;
      let itemRemaining = item.responsibilityBalance.min(remaining);
      const itemTarget = itemRemaining;
      const installmentBalances = new Map(item.installmentShares.map((share) => [
        share.id,
        Money.fromString(share.amount.toString(), amount.currency.code)
          .add(Money.fromString(share.adjustmentAmount.toString(), amount.currency.code))
          .subtract(Money.fromString(share.paidAmount.toString(), amount.currency.code))
          .max(Money.zero(amount.currency.code)),
      ]));
      for (const responsibility of item.studentResponsibilityShares) {
        if (!itemRemaining.isPositive) break;
        let responsibilityRemaining = responsibility.balance.min(itemRemaining);
        const target = responsibilityRemaining;
        for (const share of item.installmentShares) {
          if (!responsibilityRemaining.isPositive) break;
          const shareBalance = installmentBalances.get(share.id) ?? Money.zero(amount.currency.code);
          if (!shareBalance.isPositive) continue;
          const allocated = shareBalance.min(responsibilityRemaining);
          result.push({ item, responsibilityId: responsibility.responsibilityId, installmentShare: share, amount: allocated });
          installmentBalances.set(share.id, shareBalance.subtract(allocated));
          responsibilityRemaining = responsibilityRemaining.subtract(allocated);
        }
        if (responsibilityRemaining.isPositive) result.push({ item, responsibilityId: responsibility.responsibilityId, amount: responsibilityRemaining });
        itemRemaining = itemRemaining.subtract(target);
      }
      remaining = remaining.subtract(itemTarget);
    }
    return result;
  }

  private assignCredits(credits: Array<{ id: string; paymentId: string | null; availableAmount: Prisma.Decimal }>, itemPlan: ItemAllocation[], requested: Money, currency: string): FinalAllocation[] {
    const result: FinalAllocation[] = [];
    let creditIndex = 0;
    let creditRemaining = credits[0] ? Money.fromString(credits[0].availableAmount.toString(), currency) : Money.zero(currency);
    let sequence = 0;
    for (const planned of itemPlan) {
      let amountRemaining = planned.amount;
      while (amountRemaining.isPositive) {
        while (!creditRemaining.isPositive && creditIndex + 1 < credits.length) {
          creditIndex += 1;
          creditRemaining = Money.fromString(credits[creditIndex]!.availableAmount.toString(), currency);
        }
        const credit = credits[creditIndex];
        if (!credit || !creditRemaining.isPositive) throw AppError.conflict('CREDIT_ALLOCATION_BALANCE_MISMATCH', 'Selected credits no longer cover the requested application amount.');
        const allocated = creditRemaining.min(amountRemaining);
        result.push({ ...planned, credit, amount: allocated, sequence: sequence++ });
        creditRemaining = creditRemaining.subtract(allocated);
        amountRemaining = amountRemaining.subtract(allocated);
      }
    }
    const total = result.reduce((sum, allocation) => sum.add(allocation.amount), Money.zero(currency));
    if (!total.equals(requested)) throw AppError.conflict('CREDIT_ALLOCATION_BALANCE_MISMATCH', 'The requested credit application was not allocated in full.');
    return result;
  }

  private itemBalance(item: { netAmount: Prisma.Decimal; adjustmentAmount: Prisma.Decimal; paidAmount: Prisma.Decimal; waivedAmount: Prisma.Decimal; demand: { currency: string } }): Money {
    return Money.fromString(item.netAmount.toString(), item.demand.currency).add(Money.fromString(item.adjustmentAmount.toString(), item.demand.currency)).subtract(Money.fromString(item.paidAmount.toString(), item.demand.currency)).subtract(Money.fromString(item.waivedAmount.toString(), item.demand.currency));
  }

  private itemDueDate(item: CreditDemandItem): Date {
    const next = item.installmentShares.find((share) => Money.fromString(share.amount.toString(), item.demand.currency).add(Money.fromString(share.adjustmentAmount.toString(), item.demand.currency)).greaterThan(Money.fromString(share.paidAmount.toString(), item.demand.currency)));
    return next?.installment.dueDate ?? item.demand.dueDate;
  }

  private assertTenant(tenantId: string): void {
    if (this.tenantContext.requireTenantId() !== tenantId) throw AppError.forbidden('The requested tenant does not match the authenticated session.');
  }
}

function allocationUsed(allocations: Array<{ amount: Prisma.Decimal; refundReversals: Array<{ amount: Prisma.Decimal }> }>, currency: string): Money {
  return allocations.reduce((sum, allocation) => {
    const refunded = allocation.refundReversals.reduce((total, reversal) => total.add(Money.fromString(reversal.amount.toString(), currency)), Money.zero(currency));
    const net = Money.fromString(allocation.amount.toString(), currency).subtract(refunded);
    return sum.add(net.isPositive ? net : Money.zero(currency));
  }, Money.zero(currency));
}

function parseResponsibilityReservations(value: Prisma.JsonValue | null): Array<{ demandItemId: string; responsibilityId: string | null; amount: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const row = entry as { demandItemId?: unknown; responsibilityId?: unknown; amount?: unknown };
    if (typeof row.demandItemId !== 'string' || (row.responsibilityId !== null && typeof row.responsibilityId !== 'string')) return [];
    if (typeof row.amount !== 'string' || !/^\d{1,14}(?:\.\d{1,4})?$/.test(row.amount)) return [];
    return [{ demandItemId: row.demandItemId, responsibilityId: row.responsibilityId as string | null, amount: row.amount }];
  });
}

@ApiTags('credits')
@RequireModules('FEES')
@Controller('credits')
export class CreditsController {
  constructor(private readonly credits: CreditsService) {}
  @Get() @RequirePermissions(PERMISSIONS.CREDIT_READ) list(@CurrentTenant() tenant: string, @Query() query: Record<string, unknown>) { return this.credits.list(tenant, query); }
  @Get(':id') @RequirePermissions(PERMISSIONS.CREDIT_READ) get(@CurrentTenant() tenant: string, @Param('id') id: string) { return this.credits.get(tenant, id); }
  @Post('apply') @RequirePermissions(PERMISSIONS.CREDIT_APPLY) @ApiOperation({ summary: 'Apply student credits to outstanding fee demands in due-date order' }) @UsePipes(new ZodValidationPipe(applyCreditSchema)) apply(@CurrentTenant() tenant: string, @Body() body: ApplyCreditInput) { return this.credits.apply(tenant, body); }
}

@Module({ imports: [PrismaModule, TenantContextModule], controllers: [CreditsController], providers: [CreditsService], exports: [CreditsService] })
export class CreditsModule {}
