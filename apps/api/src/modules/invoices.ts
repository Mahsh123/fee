import { Controller, Get, Injectable, Module, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Money } from '@fee/money';
import { Prisma, type InvoiceStatus } from '@fee/database';
import { PERMISSIONS } from '@fee/types';
import { AppError } from '../common/errors';
import { AuditService, OutboxService, SequenceService } from '../common/financial';
import { PrismaModule, PrismaService } from '../common/prisma.service';
import { CurrentTenant, RequireModules, RequirePermissions, TenantContextModule, TenantContextService } from '../common/tenancy';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async list(tenantId: string, query: Record<string, unknown>) {
    this.assertTenant(tenantId);
    const studentId = typeof query.studentId === 'string' ? query.studentId : undefined;
    const personId = typeof query.personId === 'string' ? query.personId : undefined;
    if (studentId && !isUuid(studentId)) throw AppError.validation('The student ID must be a valid identifier.');
    if (personId && !isUuid(personId)) throw AppError.validation('The person ID must be a valid identifier.');
    if (studentId && personId) throw AppError.validation('Filter invoices by one person identity at a time.');
    const take = Math.min(Math.max(Number(query.pageSize) || 50, 1), 100);
    return this.prisma.db.invoice.findMany({
      where: { tenantId, ...(studentId ? { studentId } : {}), ...(personId ? { personId } : {}) },
      orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }], take,
      select: { id: true, invoiceNumber: true, studentId: true, personId: true, demandId: true, status: true, issueDate: true, dueDate: true, totalAmount: true, adjustmentAmount: true, paidAmount: true, currency: true },
    });
  }

  async get(tenantId: string, id: string) {
    this.assertTenant(tenantId);
    if (!isUuid(id)) throw AppError.validation('The invoice ID must be a valid identifier.');
    const invoice = await this.prisma.db.invoice.findFirst({ where: { tenantId, id } });
    if (!invoice) throw AppError.notFound('Invoice');
    const [lines, demand, operationalAdjustments] = await Promise.all([
      this.prisma.db.invoiceLine.findMany({ where: { tenantId, invoiceId: invoice.id }, orderBy: { sequence: 'asc' } }),
      invoice.demandId
        ? this.prisma.db.feeDemand.findFirst({ where: { tenantId, id: invoice.demandId }, select: { id: true, demandNumber: true, studentId: true, personId: true, financialPeriod: true } })
        : Promise.resolve(null),
      invoice.demandId
        ? this.prisma.db.adjustment.findMany({ where: { tenantId, demandId: invoice.demandId, status: { in: ['APPLIED', 'REVERSED'] } }, orderBy: { createdAt: 'asc' } })
        : Promise.resolve([]),
    ]);
    return { ...invoice, lines, demand, operationalAdjustments };
  }

  async createFromDemand(tenantId: string, demandId: string) {
    this.assertTenant(tenantId);
    if (!isUuid(demandId)) throw AppError.validation('The demand ID must be a valid identifier.');
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const demand = await tx.feeDemand.findFirst({ where: { tenantId, id: demandId } });
      if (!demand) throw AppError.notFound('Fee demand');
      const [invoiceStudent, invoicePerson] = await Promise.all([
        demand.studentId ? tx.student.findFirst({ where: { tenantId, id: demand.studentId }, select: { id: true, admissionNumber: true, firstName: true, middleName: true, lastName: true, email: true, phone: true } }) : Promise.resolve(null),
        demand.personId ? tx.tenantPerson.findFirst({ where: { tenantId, id: demand.personId, deletedAt: null }, select: { id: true, personNumber: true, typeLabel: true, firstName: true, middleName: true, lastName: true, email: true, phone: true } }) : Promise.resolve(null),
      ]);
      if (!invoiceStudent && !invoicePerson) throw AppError.conflict('INVOICE_DEMAND_PERSON_MISSING', 'The fee demand has no available person identity for its invoice snapshot.');
      const existing = await tx.invoice.findFirst({ where: { tenantId, demandId } });
      if (existing) return { ...existing, lines: await tx.invoiceLine.findMany({ where: { tenantId, invoiceId: existing.id }, orderBy: { sequence: 'asc' } }), alreadyExisted: true };
      if (demand.status === 'DRAFT' || demand.status === 'CANCELLED' || demand.status === 'CREDITED') throw AppError.conflict('INVOICE_DEMAND_NOT_ISSUED', 'An invoice can be created only for an issued fee demand with a positive balance.');
      const total = Money.fromString(demand.netAmount.toString(), demand.currency).add(Money.fromString(demand.adjustmentAmount.toString(), demand.currency));
      if (!total.isPositive) throw AppError.validation('A zero or credit demand does not need a payable invoice.');
      const demandItems = await tx.feeDemandItem.findMany({ where: { tenantId, demandId }, orderBy: { sequence: 'asc' } });
      if (!demandItems.length) throw AppError.conflict('INVOICE_DEMAND_HAS_NO_ITEMS', 'The issued demand has no invoice lines.');
      const itemIds = demandItems.map((item) => item.id);
      const adjustments = await tx.feeDemandItemAdjustment.findMany({ where: { tenantId, demandItemId: { in: itemIds } }, orderBy: [{ demandItemId: 'asc' }, { sequence: 'asc' }] });
      const adjustmentsByItem = new Map<string, typeof adjustments>();
      for (const adjustment of adjustments) adjustmentsByItem.set(adjustment.demandItemId, [...(adjustmentsByItem.get(adjustment.demandItemId) ?? []), adjustment]);
      const operationalAdjustments = await tx.adjustment.findMany({ where: { tenantId, demandId, status: { in: ['APPLIED', 'REVERSED'] } }, orderBy: { createdAt: 'asc' } });
      const lines = demandItems.map((item, sequence) => ({
        description: `${item.feeTypeName}${item.dueDate ? ` · due ${item.dueDate.toISOString().slice(0, 10)}` : ''}`,
        feeTypeCode: item.feeTypeCode,
        quantity: '1.0000',
        unitAmount: Money.fromString(item.netAmount.toString(), demand.currency).add(Money.fromString(item.adjustmentAmount.toString(), demand.currency)).toString(),
        amount: Money.fromString(item.netAmount.toString(), demand.currency).add(Money.fromString(item.adjustmentAmount.toString(), demand.currency)).toString(),
        sequence,
      }));
      const invoiceNumber = await this.sequence.allocate(tx, { tenantId, kind: 'INVOICE', asOfDate: demand.issueDate.toISOString().slice(0, 10) });
      const now = new Date();
      const paid = Money.fromString(demand.paidAmount.toString(), demand.currency).min(total);
      const status = statusFor(total, paid, demand.dueDate, now);
      const branding = await tx.tenantBranding.findUnique({ where: { tenantId } });
      const tenantIdentity = branding ? null : await tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
      const snapshot = {
        invoiceNumber,
        organization: branding ?? (tenantIdentity ? { organizationName: tenantIdentity.name } : null),
        ...(invoiceStudent ? { student: { ...invoiceStudent, fullName: [invoiceStudent.firstName, invoiceStudent.middleName, invoiceStudent.lastName].filter(Boolean).join(' ') } } : {}),
        ...(invoicePerson ? { person: { ...invoicePerson, fullName: [invoicePerson.firstName, invoicePerson.middleName, invoicePerson.lastName].filter(Boolean).join(' ') } } : {}),
        dates: { issueDate: demand.issueDate.toISOString().slice(0, 10), dueDate: demand.dueDate.toISOString().slice(0, 10) },
        source: { demandId: demand.id, demandNumber: demand.demandNumber, financialPeriod: demand.financialPeriod },
        totals: { subtotal: total.toString(), discountAmount: '0.0000', taxAmount: '0.0000', totalAmount: total.toString(), currency: demand.currency },
        feeBreakdown: { baseAmount: demand.baseAmount.toString(), surchargeAmount: demand.surchargeAmount.toString(), scholarshipAmount: demand.scholarshipAmount.toString(), discountAmount: demand.discountAmount.toString(), concessionAmount: demand.concessionAmount.toString(), waiverAmount: demand.waiverAmount.toString(), overrideAmount: demand.overrideAmount.toString(), lateFeeAmount: demand.lateFeeAmount.toString(), taxAmount: demand.taxAmount.toString(), arrearsAmount: demand.arrearsAmount.toString(), operationalAdjustmentAmount: demand.adjustmentAmount.toString() },
        operationalAdjustments: operationalAdjustments.map((row) => ({ adjustmentNumber: row.adjustmentNumber, kind: row.kind, direction: row.direction, amount: row.amount.toString(), reason: row.reason, status: row.status })),
        items: demandItems.map((item) => ({ feeTypeCode: item.feeTypeCode, feeTypeName: item.feeTypeName, baseAmount: item.baseAmount.toString(), netAmount: Money.fromString(item.netAmount.toString(), demand.currency).add(Money.fromString(item.adjustmentAmount.toString(), demand.currency)).toString(), adjustments: (adjustmentsByItem.get(item.id) ?? []).map((row) => ({ direction: row.direction, stage: row.stage, label: row.label, amount: row.amount.toString(), reason: row.reason })) })),
      };
      const invoice = await tx.invoice.create({ data: {
        tenantId, branchId: demand.branchId, invoiceNumber, studentId: demand.studentId, personId: demand.personId, demandId: demand.id, status,
        issueDate: demand.issueDate, dueDate: demand.dueDate,
        subtotal: total.toString(), discountAmount: '0.0000', taxAmount: '0.0000', totalAmount: total.toString(), paidAmount: paid.toString(), currency: demand.currency,
        snapshot: snapshot as unknown as Prisma.InputJsonValue, notes: `Generated from fee demand ${demand.demandNumber}`,
        createdBy: actorId ?? null,
      } });
      await tx.invoiceLine.createMany({ data: lines.map((line) => ({ tenantId, invoiceId: invoice.id, ...line })) });
      await this.audit.record(tx, { tenantId, actorId, action: 'INVOICE_ISSUED', entityType: 'Invoice', entityId: invoice.id, after: { invoiceNumber, demandId: demand.id, demandNumber: demand.demandNumber, totalAmount: total.toString(), currency: demand.currency, status } });
      await this.outbox.publish(tx, { tenantId, eventType: 'INVOICE_ISSUED', aggregateType: 'Invoice', aggregateId: invoice.id, payload: { invoiceId: invoice.id, invoiceNumber, studentId: demand.studentId, personId: demand.personId, demandId: demand.id, totalAmount: total.toString(), currency: demand.currency }, actorId, requestId: this.tenantContext.requestId });
      return { ...invoice, lines, alreadyExisted: false };
    });
  }

  private assertTenant(tenantId: string) { if (this.tenantContext.requireTenantId() !== tenantId) throw AppError.forbidden('The requested tenant does not match the authenticated session.'); }
}

@ApiTags('invoices')
@RequireModules('FEES')
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}
  @Get() @RequirePermissions(PERMISSIONS.INVOICE_READ) list(@CurrentTenant() tenant: string, @Query() query: Record<string, unknown>) { return this.invoices.list(tenant, query); }
  @Get(':id') @RequirePermissions(PERMISSIONS.INVOICE_READ) get(@CurrentTenant() tenant: string, @Param('id') id: string) { return this.invoices.get(tenant, id); }
  @Post('from-demand/:demandId') @RequirePermissions(PERMISSIONS.INVOICE_CREATE) @ApiOperation({ summary: 'Issue a snapshot invoice from one tenant-scoped fee demand' }) createFromDemand(@CurrentTenant() tenant: string, @Param('demandId') demandId: string) { return this.invoices.createFromDemand(tenant, demandId); }
}

@Module({ imports: [PrismaModule, TenantContextModule], controllers: [InvoicesController], providers: [InvoicesService], exports: [InvoicesService] })
export class InvoicesModule {}

function statusFor(total: Money, paid: Money, dueDate: Date, now: Date): InvoiceStatus {
  if (paid.greaterThanOrEqual(total)) return 'PAID';
  if (paid.isPositive) return 'PARTIALLY_PAID';
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return dueDate < today ? 'OVERDUE' : 'ISSUED';
}
function isUuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
