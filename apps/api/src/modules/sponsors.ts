import { Body, Controller, Get, Injectable, Module, Param, Patch, Post, Query, UsePipes } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { PERMISSIONS } from '@fee/types';
import { isUniqueViolation, Prisma } from '@fee/database';
import { createSponsorSchema, updateSponsorSchema, type CreateSponsorInput, type UpdateSponsorInput } from '@fee/validation';
import { AppError } from '../common/errors';
import { AuditService } from '../common/financial';
import { buildSearchFilter, paginate, parseListQuery, toPrismaOrderBy, ZodValidationPipe } from '../common/http';
import { PrismaModule, PrismaService } from '../common/prisma.service';
import { CurrentTenant, RequireModules, RequirePermissions, TenantContextModule, TenantContextService } from '../common/tenancy';

@Injectable()
export class SponsorsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly tenantContext: TenantContextService) {}

  async list(tenantId: string, raw: Record<string, unknown>) {
    this.assertTenant(tenantId);
    const query = parseListQuery(raw, { allowedSortFields: ['name', 'code', 'type', 'active', 'createdAt'] });
    const where: Prisma.SponsorWhereInput = {
      tenantId,
      deletedAt: null,
      ...(query.status?.length ? { active: query.status.includes('active') } : {}),
      ...buildSearchFilter(query.search, ['name', 'code', 'type', 'contactPerson', 'email']),
    };
    const [items, total] = await Promise.all([
      this.prisma.db.sponsor.findMany({ where, orderBy: toPrismaOrderBy(query.sort) as Prisma.SponsorOrderByWithRelationInput[], skip: query.skip, take: query.take }),
      this.prisma.db.sponsor.count({ where }),
    ]);
    return paginate(items, total, query);
  }

  async create(tenantId: string, input: CreateSponsorInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    try {
      return await this.prisma.transactionWithRetry(async (tx) => {
        const sponsor = await tx.sponsor.create({
          data: {
            id: randomUUID(), tenantId, name: input.name, code: input.code.toUpperCase(), type: input.type,
            contactPerson: input.contactPerson ?? null, phone: input.phone ?? null, email: input.email ?? null,
            address: input.address ?? null, creditLimit: input.creditLimit ?? null,
          },
        });
        await this.audit.record(tx, { tenantId, actorId, action: 'SPONSOR_CREATED', entityType: 'Sponsor', entityId: sponsor.id, after: sponsorAuditView(sponsor) });
        return sponsor;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict('SPONSOR_CODE_EXISTS', 'A sponsor with this code already exists in this institution.');
      throw error;
    }
  }

  async update(tenantId: string, id: string, input: UpdateSponsorInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    try {
      return await this.prisma.transactionWithRetry(async (tx) => {
        const before = await tx.sponsor.findFirst({ where: { tenantId, id, deletedAt: null } });
        if (!before) throw AppError.notFound('Sponsor');
        const data: Prisma.SponsorUpdateManyMutationInput = {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.code !== undefined ? { code: input.code.toUpperCase() } : {}),
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(Object.hasOwn(input, 'contactPerson') ? { contactPerson: input.contactPerson ?? null } : {}),
          ...(Object.hasOwn(input, 'phone') ? { phone: input.phone ?? null } : {}),
          ...(Object.hasOwn(input, 'email') ? { email: input.email ?? null } : {}),
          ...(Object.hasOwn(input, 'address') ? { address: input.address ?? null } : {}),
          ...(Object.hasOwn(input, 'creditLimit') ? { creditLimit: input.creditLimit ?? null } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        };
        const changed = await tx.sponsor.updateMany({ where: { tenantId, id, updatedAt: before.updatedAt, deletedAt: null }, data });
        if (changed.count !== 1) throw AppError.conflict('SPONSOR_CHANGED', 'This sponsor changed while it was being edited. Reload and retry.');
        const after = await tx.sponsor.findFirst({ where: { tenantId, id, deletedAt: null } });
        if (!after) throw AppError.notFound('Sponsor');
        await this.audit.record(tx, { tenantId, actorId, action: 'SPONSOR_UPDATED', entityType: 'Sponsor', entityId: id, before: sponsorAuditView(before), after: sponsorAuditView(after) });
        return after;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict('SPONSOR_CODE_EXISTS', 'A sponsor with this code already exists in this institution.');
      throw error;
    }
  }

  private assertTenant(tenantId: string): void {
    if (this.tenantContext.requireTenantId() !== tenantId) throw AppError.forbidden('The requested tenant does not match the authenticated session.');
  }
}

@ApiTags('sponsors')
@RequireModules('FEES')
@Controller('sponsors')
export class SponsorsController {
  constructor(private readonly sponsors: SponsorsService) {}

  @Get() @RequirePermissions(PERMISSIONS.SPONSOR_READ) list(@CurrentTenant() tenant: string, @Query() query: Record<string, unknown>) { return this.sponsors.list(tenant, query); }
  @Post() @RequirePermissions(PERMISSIONS.SPONSOR_CREATE) @UsePipes(new ZodValidationPipe(createSponsorSchema)) @ApiOperation({ summary: 'Create a tenant-owned sponsor payer' }) create(@CurrentTenant() tenant: string, @Body() body: CreateSponsorInput) { return this.sponsors.create(tenant, body); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.SPONSOR_UPDATE) @UsePipes(new ZodValidationPipe(updateSponsorSchema)) update(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: UpdateSponsorInput) { return this.sponsors.update(tenant, id, body); }
}

@Module({ imports: [PrismaModule, TenantContextModule], controllers: [SponsorsController], providers: [SponsorsService] })
export class SponsorsModule {}

function sponsorAuditView(value: { name: string; code: string; type: string; contactPerson: string | null; phone: string | null; email: string | null; address: string | null; active: boolean; creditLimit: Prisma.Decimal | null }) {
  return { name: value.name, code: value.code, type: value.type, contactPerson: value.contactPerson, phone: value.phone, email: value.email, address: value.address, active: value.active, creditLimit: value.creditLimit?.toString() ?? null };
}
