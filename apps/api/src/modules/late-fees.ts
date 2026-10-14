import { Body, Controller, Get, Injectable, Module, Post, UsePipes } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { computeLateFee } from '@fee/fee-engine';
import { Money, Rate } from '@fee/money';
import { PERMISSIONS, type LateFeeConfig } from '@fee/types';
import { Prisma, isUniqueViolation, type TransactionClient } from '@fee/database';
import { accrueLateFeesSchema, type AccrueLateFeesInput } from '@fee/validation';
import { AppError } from '../common/errors';
import { AuditService, OutboxService, SequenceService } from '../common/financial';
import { ZodValidationPipe } from '../common/http';
import { PrismaModule, PrismaService } from '../common/prisma.service';
import { CurrentTenant, RequireModules, RequirePermissions, TenantContextModule, TenantContextService } from '../common/tenancy';

const ACCRUAL_PAGE_SIZE = 200;
type LateFeeCandidate = {
  id: string; demandId: string; netAmount: Prisma.Decimal; adjustmentAmount: Prisma.Decimal; paidAmount: Prisma.Decimal;
  waivedAmount: Prisma.Decimal; dueDate: Date | null;
  demand: { id: string; branchId: string | null; studentId: string | null; personId: string | null; demandNumber: string; academicYearId: string | null; financialPeriod: string | null; currency: string; issueDate: Date };
};

@Injectable()
export class LateFeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: SequenceService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async list(tenantId: string) {
    this.assertTenant(tenantId);
    const rows = await this.prisma.db.lateFeeAccrual.findMany({
      where: { tenantId },
      orderBy: [{ calculatedFor: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
    const demandIds = [...new Set(rows.map(({ demandId }) => demandId))];
    const demandItemIds = [...new Set(rows.flatMap(({ demandItemId }) => demandItemId ? [demandItemId] : []))];
    const resultDemandIds = [...new Set(rows.map(({ resultDemandId }) => resultDemandId).filter((id): id is string => Boolean(id)))];
    const [demands, demandItems, resultDemands] = await Promise.all([
      demandIds.length ? this.prisma.db.feeDemand.findMany({ where: { tenantId, id: { in: demandIds } }, select: { id: true, studentId: true, personId: true, demandNumber: true, currency: true, status: true } }) : Promise.resolve([]),
      demandItemIds.length ? this.prisma.db.feeDemandItem.findMany({ where: { tenantId, id: { in: demandItemIds } }, select: { id: true, feeTypeName: true, dueDate: true, netAmount: true, adjustmentAmount: true, paidAmount: true, waivedAmount: true } }) : Promise.resolve([]),
      resultDemandIds.length ? this.prisma.db.feeDemand.findMany({ where: { tenantId, id: { in: resultDemandIds } }, select: { id: true, demandNumber: true, status: true, netAmount: true, currency: true } }) : Promise.resolve([]),
    ]);
    const studentIds = [...new Set(demands.map(({ studentId }) => studentId).filter((id): id is string => Boolean(id)))];
    const personIds = [...new Set(demands.map(({ personId }) => personId).filter((id): id is string => Boolean(id)))];
    const [students, people] = await Promise.all([
      studentIds.length ? this.prisma.db.student.findMany({ where: { tenantId, id: { in: studentIds } }, select: { id: true, admissionNumber: true, firstName: true, lastName: true } }) : Promise.resolve([]),
      personIds.length ? this.prisma.db.tenantPerson.findMany({ where: { tenantId, id: { in: personIds } }, select: { id: true, personNumber: true, typeLabel: true, firstName: true, lastName: true } }) : Promise.resolve([]),
    ]);
    const studentsById = new Map(students.map((student) => [student.id, student]));
    const peopleById = new Map(people.map((person) => [person.id, person]));
    const demandById = new Map(demands.map((demand) => [demand.id, { ...demand, student: demand.studentId ? studentsById.get(demand.studentId) ?? null : null, person: demand.personId ? peopleById.get(demand.personId) ?? null : null }]));
    const itemById = new Map(demandItems.map((item) => [item.id, item]));
    const resultDemandById = new Map(resultDemands.map((demand) => [demand.id, demand]));
    return rows.map((row) => ({ ...row, demand: demandById.get(row.demandId) ?? null, demandItem: row.demandItemId ? itemById.get(row.demandItemId) ?? null : null, resultDemand: row.resultDemandId ? resultDemandById.get(row.resultDemandId) ?? null : null }));
  }

  async accrue(tenantId: string, input: AccrueLateFeesInput) {
    this.assertTenant(tenantId);
    const settings = await this.prisma.db.tenantSettings.findUnique({ where: { tenantId } });
    if (!settings) throw AppError.conflict('TENANT_SETTINGS_REQUIRED', 'Configure tenant financial settings before accruing late fees.');
    if (settings.lateFeeMode === 'NONE') throw AppError.validation('Late fees are disabled for this institution.');
    if (!settings.lateFeeFeeTypeId) throw AppError.conflict('LATE_FEE_TYPE_REQUIRED', 'Choose an active fee type for late-fee charges in tenant settings.');

    const asOf = dateValue(input.asOfDate);
    if (input.asOfDate > dateInTimezone(new Date(), settings.timezone)) {
      throw AppError.validation('The accrual date cannot be in the future for this institution.');
    }
    const { batch, hasMore } = await this.loadCandidates(tenantId, asOf, input.cursor);
    const actorId = this.tenantContext.require().userId;
    const created: Array<{ accrualId: string; sourceDemandNumber: string; demandId: string; demandNumber: string; amount: string; taxAmount: string; currency: string }> = [];
    let skipped = 0;

    for (const candidate of batch) {
      try {
        const result = await this.prisma.transactionWithRetry(async (tx) => {
          const currentSettings = await tx.tenantSettings.findUnique({ where: { tenantId } });
          if (!currentSettings || currentSettings.updatedAt.getTime() !== settings.updatedAt.getTime()) {
            throw AppError.conflict('LATE_FEE_CONFIGURATION_CHANGED', 'Late-fee settings changed during this accrual run. Reload settings and start a new run.');
          }
          if (currentSettings.lateFeeMode === 'NONE' || !currentSettings.lateFeeFeeTypeId) return null;

          const itemRow = await tx.feeDemandItem.findFirst({ where: { tenantId, id: candidate.id, status: { in: ['UNPAID', 'PARTIALLY_PAID'] }, dueDate: { lt: asOf } } });
          if (!itemRow) return null;
          const demand = await tx.feeDemand.findFirst({ where: { tenantId, id: itemRow.demandId, status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] } }, select: { id: true, branchId: true, studentId: true, personId: true, demandNumber: true, academicYearId: true, financialPeriod: true, currency: true, issueDate: true } });
          if (!demand) return null;
          const item: LateFeeCandidate = { ...itemRow, demand };

          const alreadyForDate = await tx.lateFeeAccrual.findFirst({
            where: { tenantId, demandItemId: item.id, calculatedFor: asOf },
            select: { id: true },
          });
          if (alreadyForDate) return null;

          const feeType = await tx.feeType.findFirst({ where: { tenantId, id: currentSettings.lateFeeFeeTypeId, active: true, deletedAt: null } });
          const [feeTypeVersion, feeCategory] = feeType ? await Promise.all([
            tx.feeTypeVersion.findFirst({ where: { tenantId, feeTypeId: feeType.id, status: 'ACTIVE', effectiveFrom: { lte: asOf }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }] }, orderBy: { version: 'desc' } }),
            tx.feeCategory.findFirst({ where: { tenantId, id: feeType.categoryId }, select: { code: true } }),
          ]) : [null, null];
          if (!feeType || !feeTypeVersion || !feeCategory) throw AppError.conflict('LATE_FEE_TYPE_NOT_ACTIVE', 'The configured late-fee type no longer has a published version effective for this accrual date.');

          const currency = item.demand.currency;
          const net = Money.fromString(item.netAmount.toString(), currency).add(Money.fromString(item.adjustmentAmount.toString(), currency));
          const paid = Money.fromString(item.paidAmount.toString(), currency);
          const waived = Money.fromString(item.waivedAmount.toString(), currency);
          const outstanding = net.subtract(paid).subtract(waived).max(Money.zero(currency));
          const dueDate = item.dueDate?.toISOString().slice(0, 10);
          const config: LateFeeConfig = {
            mode: currentSettings.lateFeeMode,
            graceDays: currentSettings.lateFeeGraceDays,
            flatAmount: currentSettings.lateFeeFlatAmount.toString(),
            perDayAmount: currentSettings.lateFeePerDay.toString(),
            percent: currentSettings.lateFeePercent.toString(),
            maxAmount: currentSettings.lateFeeMaxAmount?.toString() ?? null,
            dueDate,
            asOfDate: input.asOfDate,
            separateLine: true,
          };
          const outcome = computeLateFee({ config, dueDate, asOfDate: input.asOfDate, outstanding, currency });
          if (!outcome.amount.isPositive) return null;

          const priorAccruals = await tx.lateFeeAccrual.findMany({
            where: { tenantId, demandItemId: item.id, calculatedFor: { lt: asOf } },
            select: { amount: true },
          });
          const previouslyAssessed = priorAccruals.reduce((total, row) => total.add(Money.fromString(row.amount.toString(), currency)), Money.zero(currency));
          const incrementalFee = outcome.amount.subtract(previouslyAssessed).max(Money.zero(currency));
          if (!incrementalFee.isPositive) return null;

          const taxPercent = feeTypeVersion.taxable ? feeTypeVersion.taxPercent?.toString() : undefined;
          const taxAmount = taxPercent ? incrementalFee.percent(Rate.fromPercent(taxPercent)) : Money.zero(currency);
          const netAmount = incrementalFee.add(taxAmount);
          if (!netAmount.isPositive) return null;

          const chargeDueDate = new Date(asOf);
          chargeDueDate.setUTCDate(chargeDueDate.getUTCDate() + currentSettings.lateFeePaymentTermDays);

          const demandId = randomUUID();
          const demandNumber = await this.sequences.allocate(tx, { tenantId, kind: 'DEMAND', asOfDate: input.asOfDate });
          const demandItemId = randomUUID();
          await tx.feeDemand.create({
            data: {
              id: demandId,
              tenantId,
              branchId: item.demand.branchId,
              studentId: item.demand.studentId,
              personId: item.demand.personId,
              demandNumber,
              academicYearId: item.demand.academicYearId,
              financialPeriod: item.demand.financialPeriod,
              currency,
              issueDate: asOf,
              dueDate: chargeDueDate,
              lateFeeAmount: incrementalFee.toString(),
              taxAmount: taxAmount.toString(),
              netAmount: netAmount.toString(),
              status: 'DRAFT',
              calculation: {
                kind: 'LATE_FEE_ACCRUAL',
                sourceDemandId: item.demandId,
                sourceDemandItemId: item.id,
                sourceDemandNumber: item.demand.demandNumber,
                asOfDate: input.asOfDate,
                daysLate: outcome.daysLate,
                graceDays: outcome.graceDays,
                mode: outcome.mode,
                description: outcome.description,
                previouslyAssessed: previouslyAssessed.toString(),
                configuredTotal: outcome.amount.toString(),
                incrementalFee: incrementalFee.toString(),
                taxPercent: taxPercent ?? null,
                taxAmount: taxAmount.toString(),
                cappedBy: outcome.cappedBy ?? null,
                feeTypeId: feeType.id,
                feeTypeVersionId: feeTypeVersion.id,
              } as Prisma.InputJsonValue,
              calculationVersion: 'late-fee-v1',
              createdBy: actorId ?? null,
            },
          });
          await tx.feeDemandItem.create({
            data: {
              id: demandItemId,
              tenantId,
              demandId,
              feeTypeId: feeType.id,
              feeTypeCode: feeType.code,
              feeTypeName: feeType.name,
              feeCategoryCode: feeCategory.code,
              feeTypeVersionId: feeTypeVersion.id,
              sequence: 0,
              frequency: 'ONE_TIME',
              optionality: 'MANDATORY',
              baseAmount: '0',
              lateFeeAmount: incrementalFee.toString(),
              taxAmount: taxAmount.toString(),
              netAmount: netAmount.toString(),
              dueDate: chargeDueDate,
              calculation: {
                sourceDemandId: item.demandId,
                sourceDemandItemId: item.id,
                description: outcome.description,
                daysLate: outcome.daysLate,
                graceDays: outcome.graceDays,
                mode: outcome.mode,
                incrementalFee: incrementalFee.toString(),
                taxPercent: taxPercent ?? null,
                taxAmount: taxAmount.toString(),
              } as Prisma.InputJsonValue,
            },
          });
          await tx.feeDemandItemAdjustment.create({
            data: {
              tenantId,
              demandItemId,
              direction: 'DEBIT',
              code: 'LATE_FEE',
              label: feeType.name,
              stage: 'LATE_FEE',
              sequence: 0,
              amount: incrementalFee.toString(),
              policyType: 'LATE_FEE',
              reason: outcome.description,
              effectiveFrom: asOf,
              cappedBy: outcome.cappedBy ?? null,
            },
          });
          if (taxAmount.isPositive) {
            await tx.feeDemandItemAdjustment.create({
              data: {
                tenantId,
                demandItemId,
                direction: 'DEBIT',
                code: 'TAX',
                label: `Tax · ${feeType.name}`,
                stage: 'TAX',
                sequence: 1,
                amount: taxAmount.toString(),
                percent: taxPercent ?? null,
                basisAmount: incrementalFee.toString(),
                effectiveFrom: asOf,
              },
            });
          }

          const accrual = await tx.lateFeeAccrual.create({
            data: {
              tenantId,
              branchId: item.demand.branchId,
              demandId: item.demandId,
              demandItemId: item.id,
              resultDemandId: demandId,
              mode: currentSettings.lateFeeMode,
              daysLate: outcome.daysLate,
              graceDays: outcome.graceDays,
              rateApplied: rateApplied(currentSettings.lateFeeMode, currentSettings.lateFeeFlatAmount.toString(), currentSettings.lateFeePerDay.toString(), currentSettings.lateFeePercent.toString()),
              baseAmount: outstanding.toString(),
              amount: incrementalFee.toString(),
              cappedBy: outcome.cappedBy ?? null,
              calculatedFor: asOf,
              createdBy: actorId ?? null,
            },
          });
          await this.audit.record(tx, {
            tenantId,
            actorId,
            action: 'LATE_FEE_ACCRUED',
            entityType: 'LateFeeAccrual',
            entityId: accrual.id,
            after: { sourceDemandId: item.demandId, sourceDemandItemId: item.id, resultDemandId: demandId, amount: incrementalFee.toString(), taxAmount: taxAmount.toString(), calculatedFor: input.asOfDate },
          });
          await this.outbox.publish(tx, {
            tenantId,
            eventType: 'lateFee.accrued',
            aggregateType: 'FeeDemand',
            aggregateId: demandId,
            payload: { demandId, demandNumber, sourceDemandId: item.demandId, sourceDemandNumber: item.demand.demandNumber, studentId: item.demand.studentId, personId: item.demand.personId, amount: incrementalFee.toString(), taxAmount: taxAmount.toString(), currency },
            actorId,
            requestId: this.tenantContext.requestId,
          });
          return { accrualId: accrual.id, sourceDemandNumber: item.demand.demandNumber, demandId, demandNumber, amount: incrementalFee.toString(), taxAmount: taxAmount.toString(), currency };
        });
        if (result) created.push(result);
        else skipped += 1;
      } catch (error) {
        if (isUniqueViolation(error)) {
          skipped += 1;
          continue;
        }
        throw error;
      }
    }

    return {
      asOfDate: input.asOfDate,
      processed: batch.length,
      createdCount: created.length,
      skippedCount: skipped,
      created,
      hasMore,
      nextCursor: hasMore && batch.length ? batch[batch.length - 1]!.id : null,
    };
  }

  private async loadCandidates(tenantId: string, asOf: Date, cursor?: string): Promise<{ batch: LateFeeCandidate[]; hasMore: boolean }> {
    const candidates: LateFeeCandidate[] = [];
    let scanCursor = cursor;
    let exhausted = false;
    while (candidates.length <= ACCRUAL_PAGE_SIZE && !exhausted) {
      const page = await this.prisma.db.feeDemandItem.findMany({
        where: { tenantId, status: { in: ['UNPAID', 'PARTIALLY_PAID'] }, dueDate: { lt: asOf }, ...(scanCursor ? { id: { gt: scanCursor } } : {}) },
        orderBy: { id: 'asc' },
        take: 500,
      });
      if (!page.length) break;
      scanCursor = page[page.length - 1]!.id;
      exhausted = page.length < 500;
      const demandIds = [...new Set(page.map(({ demandId }) => demandId))];
      const demands = await this.prisma.db.feeDemand.findMany({ where: { tenantId, id: { in: demandIds }, status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] } }, select: { id: true, branchId: true, studentId: true, personId: true, demandNumber: true, academicYearId: true, financialPeriod: true, currency: true, issueDate: true } });
      const demandById = new Map(demands.map((demand) => [demand.id, demand]));
      for (const item of page) {
        const demand = demandById.get(item.demandId);
        if (demand) candidates.push({ ...item, demand });
        if (candidates.length > ACCRUAL_PAGE_SIZE) break;
      }
    }
    return { batch: candidates.slice(0, ACCRUAL_PAGE_SIZE), hasMore: candidates.length > ACCRUAL_PAGE_SIZE };
  }

  private assertTenant(tenantId: string): void {
    if (this.tenantContext.requireTenantId() !== tenantId) throw AppError.forbidden('The requested tenant does not match the authenticated session.');
  }
}

@ApiTags('late fees')
@RequireModules('FEES')
@Controller('late-fees')
export class LateFeesController {
  constructor(private readonly lateFees: LateFeesService) {}

  @Get('accruals')
  @RequirePermissions(PERMISSIONS.FEE_DEMAND_READ)
  list(@CurrentTenant() tenant: string) { return this.lateFees.list(tenant); }

  @Post('accrue')
  @RequirePermissions(PERMISSIONS.FEE_DEMAND_CREATE)
  @UsePipes(new ZodValidationPipe(accrueLateFeesSchema))
  @ApiOperation({ summary: 'Accrue configured late fees as separate, traceable fee demands' })
  accrue(@CurrentTenant() tenant: string, @Body() body: AccrueLateFeesInput) { return this.lateFees.accrue(tenant, body); }
}

@Module({
  imports: [PrismaModule, TenantContextModule],
  controllers: [LateFeesController],
  providers: [LateFeesService],
})
export class LateFeesModule {}

function dateValue(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateInTimezone(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

function rateApplied(mode: string, flat: string, perDay: string, percent: string): string | null {
  if (mode === 'FLAT') return flat;
  if (mode === 'PER_DAY') return perDay;
  if (mode === 'PERCENTAGE') return percent;
  return null;
}
