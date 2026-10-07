import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@fee/types';
import { AppError } from '../common/errors';
import { PrismaModule, PrismaService } from '../common/prisma.service';
import { CurrentTenant, RequireModules, RequirePermissions, TenantContextModule, TenantContextService } from '../common/tenancy';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService, private readonly tenantContext: TenantContextService) {}

  async financeSummary(tenantId: string, query: Record<string, unknown>) {
    if (this.tenantContext.requireTenantId() !== tenantId) throw AppError.forbidden('The requested tenant does not match the authenticated session.');
    const actor = this.tenantContext.require();
    const settings = await this.prisma.db.tenantSettings.findUnique({ where: { tenantId }, select: { timezone: true } });
    const timezone = settings?.timezone ?? 'UTC';
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const from = query.from === undefined ? `${today.slice(0, 7)}-01` : validDate(query.from) ? query.from : null;
    const to = query.to === undefined ? today : validDate(query.to) ? query.to : null;
    if (!from || !to) throw AppError.validation('Report dates must use the YYYY-MM-DD format.');
    if (from > to) throw AppError.validation('Report start date must be on or before the end date.');
    const spanDays = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
    if (spanDays > 366) throw AppError.validation('A report date range cannot exceed 366 days.');

    const branchIds = actor.branchScopeEnabled ? [...new Set(actor.branchIds ?? [])] : undefined;
    const data = await this.prisma.financeReportData({ tenantId, from, to, today, timezone, branchIds });
    return {
      tenantId,
      period: { from, to, timezone },
      branchScope: branchIds === undefined
        ? { mode: 'ORGANIZATION', branchCount: null }
        : { mode: 'ASSIGNED_BRANCHES', branchCount: branchIds.length },
      ...data,
    };
  }
}

@ApiTags('reports')
@RequireModules('REPORTS')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}
  @Get('finance') @RequirePermissions(PERMISSIONS.REPORT_READ) @ApiOperation({ summary: 'Read tenant-scoped collections, outstanding balances, refunds, and fee adjustments from financial facts' })
  finance(@CurrentTenant() tenant: string, @Query() query: Record<string, unknown>) { return this.reports.financeSummary(tenant, query); }
}

@Module({ imports: [PrismaModule, TenantContextModule], controllers: [ReportsController], providers: [ReportsService], exports: [ReportsService] })
export class ReportsModule {}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
