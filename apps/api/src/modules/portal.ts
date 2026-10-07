import { Controller, Get, Injectable, Module, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@fee/types';
import { Money } from '@fee/money';
import { AppError } from '../common/errors';
import { PrismaModule, PrismaService } from '../common/prisma.service';
import { CurrentTenant, PortalRoute, RequireModules, RequirePermissions, TenantContextModule, TenantContextService } from '../common/tenancy';
import { PaymentsModule, PaymentsService } from './payments';

@Injectable()
export class PortalService {
  constructor(private readonly prisma: PrismaService, private readonly tenantContext: TenantContextService, private readonly payments: PaymentsService) {}

  async dashboard(tenantId: string) {
    this.assertTenant(tenantId);
    const context = this.tenantContext.require();
    const roles = context.roles ?? [];
    const studentIds: string[] = [];
    if (roles.includes('STUDENT') && context.studentId) studentIds.push(context.studentId);
    if (roles.includes('PARENT') && context.guardianId) {
      const links = await this.prisma.db.studentGuardian.findMany({ where: { tenantId, guardianId: context.guardianId }, select: { studentId: true } });
      studentIds.push(...links.map((link) => link.studentId));
    }
    const allowedStudentIds = [...new Set(studentIds)];
    if (!allowedStudentIds.length) throw AppError.forbidden('This portal account is not linked to an active student. Contact the institution administrator.');

    const [students, demands, payments, credits, paymentMethods] = await Promise.all([
      this.prisma.db.student.findMany({ where: { tenantId, id: { in: allowedStudentIds }, deletedAt: null }, orderBy: [{ firstName: 'asc' }, { admissionNumber: 'asc' }], select: { id: true, admissionNumber: true, firstName: true, middleName: true, lastName: true, status: true } }),
      this.prisma.db.feeDemand.findMany({ where: { tenantId, studentId: { in: allowedStudentIds }, status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] } }, orderBy: [{ dueDate: 'asc' }, { issueDate: 'desc' }], take: 250, select: { id: true, studentId: true, demandNumber: true, currency: true, dueDate: true, issueDate: true, status: true, netAmount: true, adjustmentAmount: true, paidAmount: true, waivedAmount: true } }),
      this.prisma.db.payment.findMany({ where: { tenantId, studentId: { in: allowedStudentIds }, status: { in: ['SUCCESS', 'PARTIALLY_REFUNDED', 'REFUNDED'] } }, orderBy: { paidAt: 'desc' }, take: 100, select: { id: true, studentId: true, paymentNumber: true, receiptNumber: true, methodKind: true, amount: true, refundedAmount: true, currency: true, status: true, paidAt: true, receipts: { orderBy: { issueDate: 'desc' }, select: { id: true, receiptNumber: true, issueDate: true, status: true } } } }),
      this.prisma.db.credit.findMany({ where: { tenantId, studentId: { in: allowedStudentIds }, status: { in: ['AVAILABLE', 'PARTIALLY_ALLOCATED'] }, availableAmount: { gt: 0 } }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, studentId: true, source: true, currency: true, availableAmount: true, createdAt: true, reason: true } }),
      this.prisma.db.paymentMethod.findMany({ where: { tenantId, active: true, enabledForOnline: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, name: true, kind: true } }),
    ]);
    if (!students.length) throw AppError.forbidden('This portal account is not linked to an active student. Contact the institution administrator.');

    const demandIds = demands.map((demand) => demand.id);
    const installments = demandIds.length ? await this.prisma.db.installment.findMany({ where: { tenantId, demandId: { in: demandIds }, status: { not: 'CANCELLED' } }, orderBy: [{ dueDate: 'asc' }, { sequence: 'asc' }], take: 250, select: { id: true, demandId: true, label: true, sequence: true, dueDate: true, amount: true, adjustmentAmount: true, paidAmount: true, waivedAmount: true, status: true } }) : [];
    const portalPayer = roles.includes('PARENT') && context.guardianId
      ? { type: 'PARENT' as const, payerGuardianId: context.guardianId }
      : { type: 'STUDENT' as const };
    const openItemsByStudent = await Promise.all(allowedStudentIds.map((studentId) => this.payments.openItemsForStudent(tenantId, studentId, portalPayer)));
    const studentShareByDemand = new Map<string, Money>();
    const payerOutstandingByInstallment = new Map<string, Money>();
    for (const item of openItemsByStudent.flat()) {
      const prior = studentShareByDemand.get(item.demand.id) ?? Money.zero(item.demand.currency);
      studentShareByDemand.set(item.demand.id, prior.add(Money.fromString(item.outstandingAmount, item.demand.currency)));
      let remaining = Money.fromString(item.outstandingAmount, item.demand.currency);
      const schedule = [...(item.installmentShares ?? [])].sort((left, right) => left.installment.dueDate.getTime() - right.installment.dueDate.getTime() || left.installment.sequence - right.installment.sequence);
      for (const share of schedule) {
        if (!remaining.isPositive) break;
        const scheduleBalance = Money.fromString(share.amount.toString(), item.demand.currency).add(Money.fromString(share.adjustmentAmount.toString(), item.demand.currency)).subtract(Money.fromString(share.paidAmount.toString(), item.demand.currency));
        if (!scheduleBalance.isPositive) continue;
        const allocated = remaining.min(scheduleBalance);
        const installmentId = share.installment.id;
        payerOutstandingByInstallment.set(installmentId, (payerOutstandingByInstallment.get(installmentId) ?? Money.zero(item.demand.currency)).add(allocated));
        remaining = remaining.subtract(allocated);
      }
    }

    const adjustmentRows = demands.length ? await this.prisma.db.adjustment.findMany({
      where: { tenantId, demandId: { in: demands.map((row) => row.id) }, status: { in: ['APPLIED', 'REVERSED'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, demandId: true, adjustmentNumber: true, kind: true, direction: true, amount: true, currency: true, reason: true, status: true, createdAt: true },
    }) : [];
    const adjustmentsByDemand = new Map<string, typeof adjustmentRows>();
    for (const row of adjustmentRows) if (row.demandId) adjustmentsByDemand.set(row.demandId, [...(adjustmentsByDemand.get(row.demandId) ?? []), row]);
    const demandById = new Map(demands.map((demand) => [demand.id, demand]));
    const outstanding = demands.map((demand) => ({
      ...demand,
      overallOutstandingAmount: Money.fromString(demand.netAmount.toString(), demand.currency).add(Money.fromString(demand.adjustmentAmount.toString(), demand.currency)).subtract(Money.fromString(demand.paidAmount.toString(), demand.currency)).subtract(Money.fromString(demand.waivedAmount.toString(), demand.currency)).toString(),
      outstandingAmount: (studentShareByDemand.get(demand.id) ?? Money.zero(demand.currency)).toString(),
      adjustments: adjustmentsByDemand.get(demand.id) ?? [],
    })).filter((demand) => Money.fromString(demand.outstandingAmount, demand.currency).isPositive);
    return {
      students,
      demands: outstanding,
      payments,
      installments: installments.map((row) => {
        const demand = demandById.get(row.demandId);
        if (!demand) return null;
        return {
        ...row,
        demand: { studentId: demand.studentId, demandNumber: demand.demandNumber, currency: demand.currency },
        outstandingAmount: (payerOutstandingByInstallment.get(row.id) ?? Money.zero(demand.currency)).toString(),
      };
      }).filter((row): row is NonNullable<typeof row> => row !== null && Money.fromString(row.outstandingAmount, row.demand.currency).isPositive),
      credits,
      paymentMethods,
    };
  }

  async getReceipt(tenantId: string, receiptId: string) {
    this.assertTenant(tenantId);
    const context = this.tenantContext.require();
    const roles = context.roles ?? [];
    const allowedStudentIds: string[] = [];
    if (roles.includes('STUDENT') && context.studentId) allowedStudentIds.push(context.studentId);
    if (roles.includes('PARENT') && context.guardianId) {
      const links = await this.prisma.db.studentGuardian.findMany({ where: { tenantId, guardianId: context.guardianId }, select: { studentId: true } });
      allowedStudentIds.push(...links.map((link) => link.studentId));
    }
    if (!allowedStudentIds.length) throw AppError.forbidden('This portal account is not linked to an active student. Contact the institution administrator.');
    const receipt = await this.prisma.db.receipt.findFirst({ where: { tenantId, id: receiptId, studentId: { in: [...new Set(allowedStudentIds)] } } });
    if (!receipt) throw AppError.notFound('Receipt');
    const lines = await this.prisma.db.receiptLine.findMany({ where: { tenantId, receiptId: receipt.id }, orderBy: { sequence: 'asc' } });
    return { ...receipt, lines };
  }

  private assertTenant(tenantId: string) {
    if (this.tenantContext.requireTenantId() !== tenantId) throw AppError.forbidden('The requested tenant does not match the authenticated session.');
  }
}

@ApiTags('student and parent portal')
@RequireModules('PORTAL')
@Controller('portal')
export class PortalController {
  constructor(private readonly portal: PortalService) {}
  @Get('dashboard') @PortalRoute() @RequirePermissions(PERMISSIONS.DASHBOARD_READ) @ApiOperation({ summary: 'Read fee and payment information for the signed-in student or linked guardian' }) dashboard(@CurrentTenant() tenant: string) { return this.portal.dashboard(tenant); }
  @Get('receipts/:id') @PortalRoute() @RequirePermissions(PERMISSIONS.DASHBOARD_READ) @ApiOperation({ summary: 'Read a receipt for the signed-in student or a linked student' }) receipt(@CurrentTenant() tenant: string, @Param('id') id: string) { return this.portal.getReceipt(tenant, id); }
}

@Module({ imports: [PrismaModule, TenantContextModule, PaymentsModule], controllers: [PortalController], providers: [PortalService] })
export class PortalModule {}
