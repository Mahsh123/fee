import { Controller, Get, Injectable, Module, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Money } from '@fee/money';
import { PERMISSIONS } from '@fee/types';
import { AppError } from '../common/errors';
import { PrismaModule, PrismaService } from '../common/prisma.service';
import { CurrentTenant, RequireModules, RequirePermissions, TenantContextModule, TenantContextService } from '../common/tenancy';

@Injectable()
export class InstallmentsService {
  constructor(private readonly prisma: PrismaService, private readonly tenantContext: TenantContextService) {}

  async listForStudent(tenantId: string, studentId: string) {
    if (this.tenantContext.requireTenantId() !== tenantId) throw AppError.forbidden('The requested tenant does not match the authenticated session.');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(studentId)) throw AppError.validation('The student ID must be a valid identifier.');
    const student = await this.prisma.db.student.findFirst({ where: { tenantId, id: studentId }, select: { id: true, admissionNumber: true, firstName: true, middleName: true, lastName: true } });
    if (!student) throw AppError.notFound('Student');
    const demands = await this.prisma.db.feeDemand.findMany({
      where: { tenantId, studentId },
      select: { id: true, demandNumber: true, issueDate: true, dueDate: true, currency: true, status: true },
    });
    const demandById = new Map(demands.map((demand) => [demand.id, demand]));
    const rows = demands.length ? await this.prisma.db.installment.findMany({
      where: { tenantId, demandId: { in: demands.map(({ id }) => id) }, status: { not: 'CANCELLED' } },
      orderBy: [{ dueDate: 'asc' }, { sequence: 'asc' }],
    }) : [];
    const scheduleItems = rows.length ? await this.prisma.db.installmentItem.findMany({
      where: { tenantId, installmentId: { in: rows.map(({ id }) => id) } },
      orderBy: [{ installmentId: 'asc' }, { createdAt: 'asc' }],
    }) : [];
    const demandItemIds = [...new Set(scheduleItems.flatMap((item) => item.demandItemId ? [item.demandItemId] : []))];
    const demandItems = demandItemIds.length ? await this.prisma.db.feeDemandItem.findMany({
      where: { tenantId, id: { in: demandItemIds } },
      select: { id: true, demandId: true, feeTypeCode: true, feeTypeName: true },
    }) : [];
    const demandItemById = new Map(demandItems.map((item) => [item.id, item]));
    const itemsByInstallment = new Map<string, typeof scheduleItems>();
    for (const item of scheduleItems) itemsByInstallment.set(item.installmentId, [...(itemsByInstallment.get(item.installmentId) ?? []), item]);
    const rowsWithRelations = rows.map((row) => {
      const demand = demandById.get(row.demandId);
      if (!demand) throw AppError.conflict('INSTALLMENT_DEMAND_MISSING', 'An installment refers to a demand outside the selected student schedule.');
      const items = (itemsByInstallment.get(row.id) ?? []).map((item) => {
        const demandItem = item.demandItemId ? demandItemById.get(item.demandItemId) ?? null : null;
        if (demandItem && demandItem.demandId !== demand.id) throw AppError.conflict('INSTALLMENT_DEMAND_MISMATCH', 'An installment item refers to a fee item from another demand.');
        return { ...item, demandItem: demandItem ? { id: demandItem.id, feeTypeCode: demandItem.feeTypeCode, feeTypeName: demandItem.feeTypeName } : null };
      });
      return { ...row, demand, items };
    });
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const installments = rowsWithRelations.map((row) => {
      const currency = row.demand.currency;
      const amount = Money.fromString(row.amount.toString(), currency).add(Money.fromString(row.adjustmentAmount.toString(), currency));
      const waived = Money.fromString(row.waivedAmount.toString(), currency);
      const paid = Money.fromString(row.paidAmount.toString(), currency);
      const balance = amount.subtract(waived).subtract(paid);
      if (balance.isNegative) throw AppError.conflict('INSTALLMENT_BALANCE_INVARIANT', 'An installment paid amount exceeds its due amount.');
      const displayStatus = balance.isZero ? 'PAID' : paid.isPositive ? 'PARTIALLY_PAID' : row.dueDate < today ? 'OVERDUE' : 'PENDING';
      return { ...row, displayStatus, remainingAmount: balance.toString(), items: row.items.map((item) => ({ ...item, remainingAmount: Money.fromString(item.amount.toString(), currency).add(Money.fromString(item.adjustmentAmount.toString(), currency)).subtract(Money.fromString(item.paidAmount.toString(), currency)).max(Money.zero(currency)).toString() })) };
    });
    return { student, installments };
  }
}

@ApiTags('installments')
@RequireModules('FEES')
@Controller('installments')
export class InstallmentsController {
  constructor(private readonly installments: InstallmentsService) {}
  @Get('students/:studentId') @RequirePermissions(PERMISSIONS.FEE_DEMAND_READ) @ApiOperation({ summary: 'Read the tenant-scoped installment schedule and current settlement status for a student' })
  listForStudent(@CurrentTenant() tenant: string, @Param('studentId') studentId: string) { return this.installments.listForStudent(tenant, studentId); }
}

@Module({ imports: [PrismaModule, TenantContextModule], controllers: [InstallmentsController], providers: [InstallmentsService], exports: [InstallmentsService] })
export class InstallmentsModule {}
