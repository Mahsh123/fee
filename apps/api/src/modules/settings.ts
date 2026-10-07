import { Body, Controller, Get, Injectable, Module, Patch, UsePipes } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@fee/types';
import { Prisma, type TransactionClient } from '@fee/database';
import { tenantSettingsUpdateSchema, type TenantSettingsUpdateInput } from '@fee/validation';
import { AppError } from '../common/errors';
import { AuditService } from '../common/financial';
import { ZodValidationPipe } from '../common/http';
import { PrismaModule, PrismaService } from '../common/prisma.service';
import { CurrentTenant, RequirePermissions, TenantContextModule, TenantContextService } from '../common/tenancy';
import { resolveTenantModuleAccess } from '../common/entitlements';

@Injectable()
export class TenantSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async get(tenantId: string) {
    this.assertTenant(tenantId);
    const asOf = new Date();
    const actorId = this.tenantContext.require().userId;
    const moduleAccess = await resolveTenantModuleAccess(this.prisma.db, tenantId);
    if (!moduleAccess) throw AppError.notFound('Tenant');
    const hasFees = moduleAccess.has('FEES');
    const hasAdmissions = moduleAccess.has('ADMISSIONS');
    const hasPayments = moduleAccess.has('PAYMENTS');
    const [settings, candidateFeeTypes, academicYears] = await Promise.all([
      this.prisma.transactionWithRetry(async (tx) => {
        const current = await tx.tenantSettings.findUnique({ where: { tenantId } });
        if (current) return current;
        const initialized = await tx.tenantSettings.create({ data: { tenantId } });
        await this.audit.record(tx, { tenantId, actorId, action: 'TENANT_SETTINGS_INITIALIZED', entityType: 'TenantSettings', entityId: initialized.id, after: { source: 'schema_defaults' } });
        return initialized;
      }),
      hasFees ? this.prisma.db.feeType.findMany({
        where: { tenantId, active: true, deletedAt: null },
        select: { id: true, categoryId: true, code: true, name: true },
        orderBy: [{ name: 'asc' }, { code: 'asc' }],
      }) : Promise.resolve([]),
      hasAdmissions ? this.prisma.db.academicYear.findMany({ where: { tenantId }, select: { id: true, name: true, startDate: true, endDate: true }, orderBy: { startDate: 'desc' } }) : Promise.resolve([]),
    ]);
    const candidateIds = candidateFeeTypes.map(({ id }) => id);
    const activeVersions = candidateIds.length ? await this.prisma.db.feeTypeVersion.findMany({ where: { tenantId, feeTypeId: { in: candidateIds }, status: 'ACTIVE', effectiveFrom: { lte: asOf }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }] }, select: { feeTypeId: true } }) : [];
    const activeIds = new Set(activeVersions.map(({ feeTypeId }) => feeTypeId));
    const feeTypesToReturn = candidateFeeTypes.filter(({ id }) => activeIds.has(id));
    const categoryIds = [...new Set(feeTypesToReturn.map(({ categoryId }) => categoryId))];
    const categories = categoryIds.length ? await this.prisma.db.feeCategory.findMany({ where: { tenantId, id: { in: categoryIds } }, select: { id: true, code: true, name: true } }) : [];
    const categoryById = new Map(categories.map((category) => [category.id, category]));
    const feeTypes = feeTypesToReturn.map(({ categoryId, ...feeType }) => ({ ...feeType, category: categoryById.get(categoryId) ?? null }));
    return { settings, feeTypes, academicYears, enabledModules: moduleAccess.enabledModules };
  }

  async update(tenantId: string, input: TenantSettingsUpdateInput) {
    this.assertTenant(tenantId);
    this.validateLocaleAndTimezone(input.locale, input.timezone);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const moduleAccess = await resolveTenantModuleAccess(tx, tenantId);
      if (!moduleAccess) throw AppError.notFound('Tenant');
      const hasAdmissions = moduleAccess.has('ADMISSIONS');
      const hasFees = moduleAccess.has('FEES');
      const hasPayments = moduleAccess.has('PAYMENTS');
      if (hasAdmissions && input.defaultAcademicYearId) {
        const year = await tx.academicYear.findFirst({ where: { tenantId, id: input.defaultAcademicYearId }, select: { id: true } });
        if (!year) throw AppError.validation('The default academic year is not available in this organization.');
      }
      if (hasFees && input.lateFeeMode !== 'NONE' && !input.lateFeeFeeTypeId) {
        throw AppError.validation('Choose an active fee type for late-fee charges before enabling late fees.');
      }
      if (hasFees && input.lateFeeFeeTypeId) await this.assertLateFeeType(tx, tenantId, input.lateFeeFeeTypeId);

      const before = await tx.tenantSettings.findUnique({ where: { tenantId } });
      const data: Prisma.TenantSettingsUncheckedCreateInput = {
        tenantId,
        currency: input.currency,
        currencySymbol: input.currencySymbol,
        currencyMinorUnits: input.currencyMinorUnits,
        roundingMode: input.roundingMode,
        timezone: input.timezone,
        locale: input.locale,
        dateFormat: input.dateFormat,
        ...(hasAdmissions && input.defaultAcademicYearId !== undefined ? { defaultAcademicYearId: input.defaultAcademicYearId } : {}),
        ...(hasFees ? {
          lateFeeMode: input.lateFeeMode,
          lateFeeGraceDays: input.lateFeeGraceDays,
          lateFeeFlatAmount: input.lateFeeFlatAmount,
          lateFeePerDay: input.lateFeePerDay,
          lateFeePercent: input.lateFeePercent,
          lateFeeMaxAmount: input.lateFeeMaxAmount,
          lateFeePaymentTermDays: input.lateFeePaymentTermDays,
          lateFeeFeeTypeId: input.lateFeeFeeTypeId,
          waiverApprovalThreshold: input.waiverApprovalThreshold,
          adjustmentApprovalThreshold: input.adjustmentApprovalThreshold,
          allowNegativeDemand: input.allowNegativeDemand,
        } : {}),
        ...(hasPayments ? {
          partialPaymentPolicy: input.partialPaymentPolicy,
          overpaymentPolicy: input.overpaymentPolicy,
          allowAdvancePayment: input.allowAdvancePayment,
          minimumPartialAmount: input.minimumPartialAmount,
          refundApprovalThreshold: input.refundApprovalThreshold,
          reminderScheduleDays: input.reminderScheduleDays,
        } : {}),
        ...(input.allowPublicRegistration !== undefined ? { allowPublicRegistration: input.allowPublicRegistration } : {}),
        updatedBy: actorId ?? null,
      };
      const { tenantId: _tenantId, ...updateData } = data;
      const updated = await tx.tenantSettings.upsert({
        where: { tenantId },
        create: data,
        update: updateData,
      });
      await this.audit.record(tx, {
        tenantId,
        actorId,
        action: 'TENANT_SETTINGS_UPDATED',
        entityType: 'TenantSettings',
        entityId: updated.id,
        before: settingsAuditView(before),
        after: settingsAuditView(updated),
      });
      return updated;
    });
  }

  private async assertLateFeeType(tx: TransactionClient, tenantId: string, id: string): Promise<void> {
    const type = await tx.feeType.findFirst({ where: { tenantId, id, active: true, deletedAt: null }, select: { id: true } });
    const asOf = new Date();
    const version = type ? await tx.feeTypeVersion.findFirst({ where: { tenantId, feeTypeId: id, status: 'ACTIVE', effectiveFrom: { lte: asOf }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }] }, select: { id: true } }) : null;
    if (!type || !version) throw AppError.validation('Select an active fee type with a currently published version for late fees.');
  }

  private validateLocaleAndTimezone(locale: string, timezone: string): void {
    try {
      new Intl.DateTimeFormat(locale).format(new Date());
      new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    } catch {
      throw AppError.validation('Enter a locale and timezone supported by this runtime.');
    }
  }

  private assertTenant(tenantId: string): void {
    if (this.tenantContext.requireTenantId() !== tenantId) throw AppError.forbidden('The requested tenant does not match the authenticated session.');
  }
}

@ApiTags('tenant settings')
@Controller('settings/tenant')
export class TenantSettingsController {
  constructor(private readonly settings: TenantSettingsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.TENANT_SETTINGS_READ)
  @ApiOperation({ summary: 'Read workspace settings and configuration for enabled modules' })
  get(@CurrentTenant() tenant: string) { return this.settings.get(tenant); }

  @Patch()
  @RequirePermissions(PERMISSIONS.TENANT_SETTINGS_UPDATE)
  @UsePipes(new ZodValidationPipe(tenantSettingsUpdateSchema))
  @ApiOperation({ summary: 'Update workspace settings and configuration for enabled modules' })
  update(@CurrentTenant() tenant: string, @Body() body: TenantSettingsUpdateInput) { return this.settings.update(tenant, body); }
}

@Module({ imports: [PrismaModule, TenantContextModule], controllers: [TenantSettingsController], providers: [TenantSettingsService] })
export class TenantSettingsModule {}

function settingsAuditView(value: {
  currency: string; currencySymbol: string; currencyMinorUnits: number; timezone: string; locale: string; dateFormat: string; roundingMode: string;
  defaultAcademicYearId: string | null; lateFeeMode: string; lateFeeGraceDays: number;
  lateFeeFlatAmount: Prisma.Decimal; lateFeePerDay: Prisma.Decimal; lateFeePercent: Prisma.Decimal; lateFeeMaxAmount: Prisma.Decimal | null;
  lateFeePaymentTermDays: number; lateFeeFeeTypeId: string | null; partialPaymentPolicy: string; overpaymentPolicy: string; allowAdvancePayment: boolean;
  minimumPartialAmount: Prisma.Decimal | null; refundApprovalThreshold: Prisma.Decimal | null; waiverApprovalThreshold: Prisma.Decimal | null;
  adjustmentApprovalThreshold: Prisma.Decimal | null; reminderScheduleDays: number[]; allowNegativeDemand: boolean; allowPublicRegistration: boolean;
} | null) {
  if (!value) return null;
  return {
    currency: value.currency,
    currencySymbol: value.currencySymbol,
    currencyMinorUnits: value.currencyMinorUnits,
    timezone: value.timezone,
    locale: value.locale,
    dateFormat: value.dateFormat,
    roundingMode: value.roundingMode,
    defaultAcademicYearId: value.defaultAcademicYearId,
    lateFee: {
      mode: value.lateFeeMode,
      graceDays: value.lateFeeGraceDays,
      flatAmount: value.lateFeeFlatAmount.toString(),
      perDayAmount: value.lateFeePerDay.toString(),
      percent: value.lateFeePercent.toString(),
      maxAmount: value.lateFeeMaxAmount?.toString() ?? null,
      paymentTermDays: value.lateFeePaymentTermDays,
      feeTypeId: value.lateFeeFeeTypeId,
    },
    payment: {
      partialPaymentPolicy: value.partialPaymentPolicy,
      overpaymentPolicy: value.overpaymentPolicy,
      allowAdvancePayment: value.allowAdvancePayment,
      minimumPartialAmount: value.minimumPartialAmount?.toString() ?? null,
    },
    approvals: {
      refund: value.refundApprovalThreshold?.toString() ?? null,
      waiver: value.waiverApprovalThreshold?.toString() ?? null,
      adjustment: value.adjustmentApprovalThreshold?.toString() ?? null,
    },
    reminders: value.reminderScheduleDays,
    allowNegativeDemand: value.allowNegativeDemand,
    allowPublicRegistration: value.allowPublicRegistration,
  };
}
