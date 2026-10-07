import { Body, Controller, Get, Injectable, Module, Param, Patch, Query, UsePipes } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Prisma, type AuditTransactionClient, type NumberingTransactionClient } from '@fee/database';
import { PERMISSIONS } from '@fee/types';
import {
  tenantBrandingUpdateSchema,
  tenantNumberingUpdateSchema,
  type TenantBrandingUpdateInput,
  type TenantNumberingUpdateInput,
} from '@fee/validation';
import { AppError } from '../common/errors';
import { AuditService } from '../common/financial';
import { buildSearchFilter, paginate, parseListQuery, toPrismaOrderBy, ZodValidationPipe } from '../common/http';
import { PrismaModule, PrismaService } from '../common/prisma.service';
import { CurrentTenant, RequirePermissions, TenantContextModule, TenantContextService } from '../common/tenancy';
import { resolveTenantModuleAccess } from '../common/entitlements';

@Injectable()
export class TenantConfigurationService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly context: TenantContextService) {}

  async getBranding(tenantId: string) {
    this.assertTenant(tenantId);
    return this.prisma.transactionWithRetry(async (tx) => {
      const existing = await tx.tenantBranding.findUnique({ where: { tenantId } });
      if (existing) return existing;
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
      if (!tenant) throw AppError.notFound('Tenant');
      const created = await tx.tenantBranding.create({ data: { tenantId, organizationName: tenant.name } });
      await this.audit.record(tx, { tenantId, actorId: this.context.require().userId, action: 'TENANT_BRANDING_INITIALIZED', entityType: 'TenantBranding', entityId: created.id, after: { organizationName: created.organizationName } });
      return created;
    });
  }

  async updateBranding(tenantId: string, input: TenantBrandingUpdateInput) {
    this.assertTenant(tenantId);
    return this.prisma.transactionWithRetry(async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
      if (!tenant) throw AppError.notFound('Tenant');
      const before = await tx.tenantBranding.findUnique({ where: { tenantId } });
      const data = cleanOptionalStrings(input) as Prisma.TenantBrandingUncheckedUpdateInput;
      const updated = await tx.tenantBranding.upsert({
        where: { tenantId },
        create: { tenantId, organizationName: tenant.name, ...data } as Prisma.TenantBrandingUncheckedCreateInput,
        update: data,
      });
      await this.audit.record(tx, { tenantId, actorId: this.context.require().userId, action: 'TENANT_BRANDING_UPDATED', entityType: 'TenantBranding', entityId: updated.id, before: brandingAuditView(before), after: brandingAuditView(updated) });
      return updated;
    });
  }

  async getNumbering(tenantId: string) {
    this.assertTenant(tenantId);
    const moduleAccess = await resolveTenantModuleAccess(this.prisma.db, tenantId);
    if (!moduleAccess) throw AppError.notFound('Tenant');
    const numbering = await this.prisma.db.tenantNumberingSettings.upsert({ where: { tenantId }, create: { tenantId }, update: {} });
    return projectNumberingForModules(numbering, moduleAccess.enabledModules);
  }

  async updateNumbering(tenantId: string, input: TenantNumberingUpdateInput) {
    this.assertTenant(tenantId);
    return this.prisma.transactionWithRetry(async (tx) => {
      const moduleAccess = await resolveTenantModuleAccess(tx, tenantId);
      if (!moduleAccess) throw AppError.notFound('Tenant');
      const effectiveInput = { ...input };
      if (!moduleAccess.has('PAYMENTS')) {
        delete effectiveInput.receiptPrefix;
        delete effectiveInput.invoicePrefix;
        delete effectiveInput.paymentPrefix;
        delete effectiveInput.refundPrefix;
        delete effectiveInput.creditNotePrefix;
        delete effectiveInput.adjustmentPrefix;
      }
      if (!moduleAccess.has('FEES')) delete effectiveInput.demandPrefix;
      if (!moduleAccess.has('ADMISSIONS')) {
        delete effectiveInput.applicationPrefix;
        delete effectiveInput.studentPrefix;
      }
      // Reservations and configuration changes use the same tenant lock, so an
      // allocation observes one complete version of the number format.
      await (tx as NumberingTransactionClient).lockNumberingConfiguration(tenantId);
      const before = await tx.tenantNumberingSettings.findUnique({ where: { tenantId } });
      const resetAnnually = effectiveInput.resetAnnually ?? before?.resetAnnually ?? false;
      const includeYear = effectiveInput.includeYear ?? before?.includeYear ?? true;
      if (resetAnnually && !includeYear) throw AppError.validation('Annual counter resets require the financial year to be included in the displayed number so document numbers remain unique.');
      const resetAnnuallyFrom = effectiveInput.resetAnnually === true && !before?.resetAnnually
        ? nextFinancialYearStart(new Date())
        : effectiveInput.resetAnnually === false
          ? null
          : resetAnnually && !before?.resetAnnuallyFrom
            ? nextFinancialYearStart(new Date())
            : before?.resetAnnuallyFrom;
      const resetFromChanged = (before?.resetAnnuallyFrom?.getTime() ?? null) !== (resetAnnuallyFrom?.getTime() ?? null);
      const requestedValueChanged = !before || Object.entries(effectiveInput).some(([key, value]) => (before as unknown as Record<string, unknown>)[key] !== value);
      const formatVersion = before
        ? before.formatVersion + (requestedValueChanged || resetFromChanged ? 1 : 0)
        : 2;
      if (!Number.isSafeInteger(formatVersion) || formatVersion > 2_147_483_647) {
        throw AppError.conflict('NUMBERING_VERSION_EXHAUSTED', 'The document number format has reached its version limit.');
      }
      const update = { ...effectiveInput, formatVersion, ...(effectiveInput.resetAnnually !== undefined || resetAnnually ? { resetAnnuallyFrom } : {}) } as Prisma.TenantNumberingSettingsUncheckedUpdateInput;
      const create = { tenantId, ...effectiveInput, formatVersion, ...(resetAnnually ? { resetAnnuallyFrom: resetAnnuallyFrom ?? nextFinancialYearStart(new Date()) } : {}) } as Prisma.TenantNumberingSettingsUncheckedCreateInput;
      const updated = await tx.tenantNumberingSettings.upsert({ where: { tenantId }, create, update });
      await this.audit.record(tx, { tenantId, actorId: this.context.require().userId, action: 'TENANT_NUMBERING_UPDATED', entityType: 'TenantNumberingSettings', entityId: updated.id, before: numberingAuditView(before), after: numberingAuditView(updated) });
      return projectNumberingForModules(updated, moduleAccess.enabledModules);
    });
  }

  private assertTenant(tenantId: string) {
    if (this.context.requireTenantId() !== tenantId) throw AppError.forbidden('The requested tenant does not match the authenticated session.');
  }
}

function projectNumberingForModules<T extends {
  receiptPrefix: string; invoicePrefix: string; paymentPrefix: string; demandPrefix: string; refundPrefix: string;
  creditNotePrefix: string; adjustmentPrefix: string; applicationPrefix: string; studentPrefix: string;
}>(value: T, enabledModules: string[]) {
  const enabled = new Set(enabledModules);
  return {
    ...value,
    ...(!enabled.has('PAYMENTS') ? { receiptPrefix: null, invoicePrefix: null, paymentPrefix: null, refundPrefix: null, creditNotePrefix: null, adjustmentPrefix: null } : {}),
    ...(!enabled.has('FEES') ? { demandPrefix: null } : {}),
    ...(!enabled.has('ADMISSIONS') ? { applicationPrefix: null, studentPrefix: null } : {}),
  };
}

@Injectable()
export class AuditLogReadService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly context: TenantContextService) {}

  async list(tenantId: string, raw: Record<string, unknown>) {
    this.assertTenant(tenantId);
    const query = parseListQuery(raw, { allowedSortFields: ['createdAt', 'action', 'entityType', 'severity'], defaultSort: '-createdAt' });
    const from = validDate(raw.from, 'from');
    const to = validDate(raw.to, 'to');
    if ((query.search?.length ?? 0) > 200 || query.sort.length > 4) {
      throw AppError.validation('Audit log search or sort exceeds its supported limit.');
    }
    const filters = {
      entityType: typeof raw.entityType === 'string' && raw.entityType.trim() ? raw.entityType.trim().slice(0, 120) : null,
      action: typeof raw.action === 'string' && raw.action.trim() ? raw.action.trim().slice(0, 120) : null,
      from: from?.toISOString() ?? null,
      to: to ? new Date(to.getTime() + 86_400_000).toISOString() : null,
      search: query.search ?? null,
    };
    const sort = (query.sort.length ? query.sort : [{ field: 'createdAt', direction: 'desc' as const }])
      .map((entry) => ({ field: entry.field as 'createdAt' | 'action' | 'entityType' | 'severity', direction: entry.direction }));
    return this.prisma.transaction(async (tx) => {
      const auditTx = tx as AuditTransactionClient;
      const read = await auditTx.readAuditLogs({ tenantId, filters, offset: query.skip, limit: query.take, sort });
       if (read.mode === 'v2') {
         if (!('items' in read.result)) throw new Error('The audit reader returned a record where a page was expected.');
         return paginate(read.result.items, read.result.total, query);
       }
      const where: Prisma.AuditLogWhereInput = {
        tenantId,
        ...(filters.entityType ? { entityType: filters.entityType } : {}),
        ...(filters.action ? { action: filters.action } : {}),
        ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: new Date(to.getTime() + 86_400_000) } : {}) } } : {}),
        ...buildSearchFilter(query.search, ['action', 'entityType', 'entityRef', 'actorEmail']),
      };
      const [items, total] = await Promise.all([
        tx.auditLog.findMany({ where, orderBy: toPrismaOrderBy(query.sort) as Prisma.AuditLogOrderByWithRelationInput[], skip: query.skip, take: query.take, select: { id: true, actorId: true, actorType: true, actorEmail: true, actorRoles: true, action: true, entityType: true, entityId: true, entityRef: true, reason: true, requestId: true, severity: true, prevHash: true, hash: true, createdAt: true } }),
        tx.auditLog.count({ where }),
      ]);
      return paginate(items, total, query);
    });
  }

  async get(tenantId: string, id: string) {
    this.assertTenant(tenantId);
    return this.prisma.transaction(async (tx) => {
      const read = await (tx as AuditTransactionClient).readAuditLogs({
        tenantId, id,
        filters: { entityType: null, action: null, from: null, to: null, search: null },
        offset: 0, limit: 1, sort: [{ field: 'createdAt', direction: 'desc' }],
      });
       if (read.mode === 'v2') {
         if (!('item' in read.result)) throw new Error('The audit reader returned a page where a record was expected.');
         if (!read.result.item) throw AppError.notFound('Audit log entry');
         return read.result.item;
       }
      const entry = await tx.auditLog.findFirst({ where: { tenantId, id } });
      if (!entry) throw AppError.notFound('Audit log entry');
      return entry;
    });
  }

  async verify(tenantId: string) {
    this.assertTenant(tenantId);
    return this.prisma.transactionWithRetry((tx) => this.audit.verifyChain(tx, tenantId));
  }

  private assertTenant(tenantId: string) {
    if (this.context.requireTenantId() !== tenantId) throw AppError.forbidden('The requested tenant does not match the authenticated session.');
  }
}

@ApiTags('tenant branding')
@Controller('settings/branding')
export class TenantBrandingController {
  constructor(private readonly config: TenantConfigurationService) {}
  @Get() @RequirePermissions(PERMISSIONS.TENANT_SETTINGS_READ) get(@CurrentTenant() tenant: string) { return this.config.getBranding(tenant); }
  @Patch() @RequirePermissions(PERMISSIONS.TENANT_BRANDING_UPDATE) @UsePipes(new ZodValidationPipe(tenantBrandingUpdateSchema)) @ApiOperation({ summary: 'Update tenant branding and document footer details' }) update(@CurrentTenant() tenant: string, @Body() body: TenantBrandingUpdateInput) { return this.config.updateBranding(tenant, body); }
}

@ApiTags('tenant numbering')
@Controller('settings/numbering')
export class TenantNumberingController {
  constructor(private readonly config: TenantConfigurationService) {}
  @Get() @RequirePermissions(PERMISSIONS.TENANT_SETTINGS_READ) get(@CurrentTenant() tenant: string) { return this.config.getNumbering(tenant); }
  @Patch() @RequirePermissions(PERMISSIONS.TENANT_NUMBERING_UPDATE) @UsePipes(new ZodValidationPipe(tenantNumberingUpdateSchema)) @ApiOperation({ summary: 'Update tenant-specific financial document number formats' }) update(@CurrentTenant() tenant: string, @Body() body: TenantNumberingUpdateInput) { return this.config.updateNumbering(tenant, body); }
}

@ApiTags('audit logs')
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly logs: AuditLogReadService) {}
  @Get() @RequirePermissions(PERMISSIONS.AUDIT_READ) list(@CurrentTenant() tenant: string, @Query() query: Record<string, unknown>) { return this.logs.list(tenant, query); }
  @Get('integrity') @RequirePermissions(PERMISSIONS.AUDIT_READ) @ApiOperation({ summary: 'Check the tenant audit chain links for tampering' }) verify(@CurrentTenant() tenant: string) { return this.logs.verify(tenant); }
  @Get(':id') @RequirePermissions(PERMISSIONS.AUDIT_READ) get(@CurrentTenant() tenant: string, @Param('id') id: string) { return this.logs.get(tenant, id); }
}

@Module({ imports: [PrismaModule, TenantContextModule], controllers: [TenantBrandingController, TenantNumberingController, AuditLogsController], providers: [TenantConfigurationService, AuditLogReadService] })
export class TenantOperationsModule {}

function validDate(value: unknown, name: string): Date | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw AppError.validation(`The ${name} filter must use YYYY-MM-DD.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw AppError.validation(`The ${name} filter must be a valid calendar date.`);
  return date;
}

function cleanOptionalStrings(input: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, typeof value === 'string' && value.trim() === '' ? null : value]));
}

function brandingAuditView(value: object | null) {
  if (!value) return null;
  const record = value as Record<string, unknown>;
  const { id: _id, tenantId: _tenantId, createdAt: _createdAt, updatedAt: _updatedAt, logoDocumentId, ...safe } = record;
  return { ...safe, hasLogo: Boolean(logoDocumentId) };
}

function numberingAuditView(value: object | null) {
  if (!value) return null;
  const record = value as Record<string, unknown>;
  const { id: _id, tenantId: _tenantId, createdAt: _createdAt, updatedAt: _updatedAt, ...safe } = record;
  return safe;
}

function nextFinancialYearStart(now: Date): Date {
  const year = now.getUTCFullYear();
  // Reset activation is deliberately deferred to avoid duplicate numbers in the
  // current period, even if an operator changes settings on 1 April.
  return new Date(Date.UTC(year + (now.getUTCMonth() >= 3 ? 1 : 0), 3, 1));
}
