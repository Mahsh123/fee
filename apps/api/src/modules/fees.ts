import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Param,
  Patch,
  Post,
  Query,
  UsePipes,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import {
  Prisma,
  type FeeCalculationMethod,
  type FeeCategoryKind,
  type FeeFrequency,
  type FeeOptionality,
  type TransactionClient,
  type VersionStatus,
} from '@fee/database';
import { ERROR_CODES, PERMISSIONS } from '@fee/types';
import { FeeBaseCalculationError, validateFeeCalculationConfig } from '@fee/fee-engine';
import {
  createFeeCategorySchema,
  createFeeStructureSchema,
  createFeeStructureVersionSchema,
  createFeeTypeSchema,
  createFeeTypeVersionSchema,
  closeFeeStructureVersionSchema,
  closeFeeTypeVersionSchema,
  updateFeeCategorySchema,
  updateFeeStructureSchema,
  updateFeeTypeSchema,
  type CreateFeeCategoryInput,
  type CreateFeeStructureInput,
  type CreateFeeStructureVersionInput,
  type CreateFeeTypeInput,
  type CreateFeeTypeVersionInput,
  type CloseFeeStructureVersionInput,
  type CloseFeeTypeVersionInput,
  type FeeStructureItemInput,
  type UpdateFeeCategoryInput,
  type UpdateFeeStructureInput,
  type UpdateFeeTypeInput,
} from '@fee/validation';
import { AppError } from '../common/errors';
import { AuditService, OutboxService } from '../common/financial';
import { buildSearchFilter, paginate, parseListQuery, toPrismaOrderBy, ZodValidationPipe } from '../common/http';
import { PrismaModule, PrismaService } from '../common/prisma.service';
import { CurrentTenant, RequireModules, RequirePermissions, TenantContextModule, TenantContextService } from '../common/tenancy';

@Injectable()
export class FeeCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async listCategories(tenantId: string, raw: Record<string, unknown>) {
    this.assertTenant(tenantId);
    const query = parseListQuery(raw, { allowedSortFields: ['kind', 'sortOrder', 'active'] });
    const where: Prisma.FeeCategoryWhereInput = {
      tenantId,
      deletedAt: null,
      ...(query.status?.length ? { active: query.status.includes('active') } : {}),
      ...buildSearchFilter(query.search, ['name', 'code', 'description']),
    };
    const [items, total] = await Promise.all([
      this.prisma.db.feeCategory.findMany({ where, orderBy: toPrismaOrderBy(query.sort) as Prisma.FeeCategoryOrderByWithRelationInput[], skip: query.skip, take: query.take }),
      this.prisma.db.feeCategory.count({ where }),
    ]);
    return paginate(items, total, query);
  }

  async createCategory(tenantId: string, input: CreateFeeCategoryInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const id = randomUUID();
      const category = await tx.feeCategory.create({
        data: { id, tenantId, name: input.name, code: input.code.toUpperCase(), kind: input.kind as FeeCategoryKind, description: clean(input.description), sortOrder: input.sortOrder ?? 0, createdAt: new Date() },
      });
      await this.audit.record(tx, { tenantId, actorId, action: 'FEE_CATEGORY_CREATED', entityType: 'FeeCategory', entityId: id, after: { code: category.code, kind: category.kind } });
      return category;
    });
  }

  async updateCategory(tenantId: string, id: string, input: UpdateFeeCategoryInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const current = await tx.feeCategory.findFirst({ where: { tenantId, id, deletedAt: null } });
      if (!current) throw AppError.notFound('Fee category');
      const data: Prisma.FeeCategoryUpdateManyMutationInput = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.code !== undefined ? { code: input.code.toUpperCase() } : {}),
        ...(input.kind !== undefined ? { kind: input.kind as FeeCategoryKind } : {}),
        ...(Object.hasOwn(input, 'description') ? { description: clean(input.description) } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      };
      const changed = await tx.feeCategory.updateMany({ where: { tenantId, id, updatedAt: current.updatedAt }, data });
      if (changed.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'This category changed while you were editing it. Reload and try again.');
      const updated = await tx.feeCategory.findFirst({ where: { tenantId, id } });
      if (!updated) throw AppError.notFound('Fee category');
      await this.audit.record(tx, { tenantId, actorId, action: 'FEE_CATEGORY_UPDATED', entityType: 'FeeCategory', entityId: id, before: { active: current.active }, after: { active: updated.active, fields: Object.keys(data) } });
      return updated;
    });
  }

  async listTypes(tenantId: string, raw: Record<string, unknown>) {
    this.assertTenant(tenantId);
    const query = parseListQuery(raw, { allowedSortFields: ['priority', 'active', 'name'] });
    const where: Prisma.FeeTypeWhereInput = {
      tenantId,
      deletedAt: null,
      ...(query.status?.length ? { active: query.status.includes('active') } : {}),
      ...buildSearchFilter(query.search, ['name', 'code', 'description']),
    };
    const [items, total] = await Promise.all([
      this.prisma.db.feeType.findMany({ where, orderBy: toPrismaOrderBy(query.sort) as Prisma.FeeTypeOrderByWithRelationInput[], skip: query.skip, take: query.take }),
      this.prisma.db.feeType.count({ where }),
    ]);
    return paginate(items, total, query);
  }

  async createType(tenantId: string, input: CreateFeeTypeInput) {
    this.assertTenant(tenantId);
    const calculationConfig = validateCalculationConfig(input.calculationMethod as FeeCalculationMethod, input.calculationConfig);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      await this.assertActiveCategory(tx, tenantId, input.categoryId);
      const id = randomUUID();
      const feeType = await tx.feeType.create({
        data: {
          id, tenantId, categoryId: input.categoryId, name: input.name, code: input.code.toUpperCase(), description: clean(input.description),
          calculationMethod: input.calculationMethod as FeeCalculationMethod,
          defaultFrequency: input.defaultFrequency as FeeFrequency,
          optionality: input.optionality as FeeOptionality,
          taxable: input.taxable ?? false,
          taxPercent: input.taxPercent ?? null,
          applicabilityRule: jsonValue(input.applicabilityRule),
          priority: input.priority ?? 100,
          createdBy: actorId ?? null,
        },
      });
      const initialVersion = await tx.feeTypeVersion.create({
        data: {
          tenantId, feeTypeId: id, version: 1, status: 'DRAFT', effectiveFrom: dateOnly(new Date()), effectiveTo: null,
          calculationMethod: input.calculationMethod as FeeCalculationMethod,
          defaultFrequency: input.defaultFrequency as FeeFrequency,
          optionality: input.optionality as FeeOptionality,
          taxable: input.taxable ?? false,
          taxPercent: input.taxPercent ?? null,
          applicabilityRule: jsonValue(input.applicabilityRule),
          calculationConfig: calculationConfig ? calculationConfig as Prisma.InputJsonValue : Prisma.JsonNull,
          createdBy: actorId ?? null,
        },
      });
      await this.audit.record(tx, { tenantId, actorId, action: 'FEE_TYPE_CREATED', entityType: 'FeeType', entityId: id, after: { code: feeType.code, categoryId: feeType.categoryId, initialVersion: 1, calculationMethod: input.calculationMethod, calculationConfig } });
      return { ...feeType, draftVersionId: initialVersion.id };
    });
  }

  async updateType(tenantId: string, id: string, input: UpdateFeeTypeInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const current = await tx.feeType.findFirst({ where: { tenantId, id, deletedAt: null } });
      if (!current) throw AppError.notFound('Fee type');
      if (input.categoryId) await this.assertActiveCategory(tx, tenantId, input.categoryId);
      const data: Prisma.FeeTypeUpdateManyMutationInput = {
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(Object.hasOwn(input, 'description') ? { description: clean(input.description) } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        updatedBy: actorId ?? null,
      };
      const changed = await tx.feeType.updateMany({ where: { tenantId, id, updatedAt: current.updatedAt }, data });
      if (changed.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'This fee type changed while you were editing it. Reload and try again.');
      const updated = await tx.feeType.findFirst({ where: { tenantId, id } });
      if (!updated) throw AppError.notFound('Fee type');
      await this.audit.record(tx, { tenantId, actorId, action: 'FEE_TYPE_UPDATED', entityType: 'FeeType', entityId: id, before: { active: current.active }, after: { active: updated.active, fields: Object.keys(data) } });
      return updated;
    });
  }

  async createTypeVersion(tenantId: string, feeTypeId: string, input: CreateFeeTypeVersionInput) {
    this.assertTenant(tenantId);
    assertDateRange(input.effectiveFrom, input.effectiveTo);
    const calculationConfig = validateCalculationConfig(input.calculationMethod as FeeCalculationMethod, input.calculationConfig);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const feeType = await tx.feeType.findFirst({ where: { tenantId, id: feeTypeId, deletedAt: null } });
      if (!feeType) throw AppError.notFound('Fee type');
      const latest = await tx.feeTypeVersion.findFirst({ where: { tenantId, feeTypeId }, orderBy: { version: 'desc' } });
      const version = await tx.feeTypeVersion.create({
        data: {
          tenantId, feeTypeId, version: (latest?.version ?? 0) + 1, status: 'DRAFT',
          effectiveFrom: new Date(`${input.effectiveFrom}T00:00:00.000Z`), effectiveTo: input.effectiveTo ? new Date(`${input.effectiveTo}T00:00:00.000Z`) : null,
          calculationMethod: input.calculationMethod as FeeCalculationMethod,
          defaultFrequency: input.defaultFrequency as FeeFrequency,
          optionality: input.optionality as FeeOptionality,
          taxable: input.taxable ?? false, taxPercent: input.taxPercent ?? null,
          applicabilityRule: jsonValue(input.applicabilityRule), createdBy: actorId ?? null,
          calculationConfig: calculationConfig ? calculationConfig as Prisma.InputJsonValue : Prisma.JsonNull,
        },
      });
      await this.audit.record(tx, { tenantId, actorId, action: 'FEE_TYPE_VERSION_CREATED', entityType: 'FeeTypeVersion', entityId: version.id, after: { feeTypeId, version: version.version, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo ?? null, calculationMethod: input.calculationMethod, calculationConfig } });
      return version;
    });
  }

  async listTypeVersions(tenantId: string, feeTypeId: string) {
    this.assertTenant(tenantId);
    const feeType = await this.prisma.db.feeType.findFirst({ where: { tenantId, id: feeTypeId, deletedAt: null }, select: { id: true } });
    if (!feeType) throw AppError.notFound('Fee type');
    return this.prisma.db.feeTypeVersion.findMany({ where: { tenantId, feeTypeId }, orderBy: { version: 'desc' } });
  }

  async closeTypeVersion(tenantId: string, feeTypeId: string, versionId: string, input: CloseFeeTypeVersionInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    const effectiveTo = dateOnly(new Date(`${input.effectiveTo}T00:00:00.000Z`));
    const today = dateOnly(new Date());
    if (effectiveTo < today) throw AppError.validation('A published fee type window can only be closed today or on a future date.');
    return this.prisma.transactionWithRetry(async (tx) => {
      const current = await tx.feeTypeVersion.findFirst({ where: { tenantId, feeTypeId, id: versionId } });
      if (!current) throw AppError.notFound('Fee type version');
      if (current.status !== 'ACTIVE') throw AppError.conflict('FEE_VERSION_NOT_ACTIVE', 'Only an active fee type version can have its future window closed.');
      if (current.effectiveTo) throw AppError.conflict('FEE_VERSION_WINDOW_CLOSED', 'This fee type version already has an end date.');
      if (effectiveTo < current.effectiveFrom) throw AppError.validation('The end date must be on or after this version’s start date.');
      await this.assertNoOverlap(tx, tenantId, feeTypeId, current.effectiveFrom, effectiveTo, current.id);
      const changed = await tx.feeTypeVersion.updateMany({
        where: { tenantId, feeTypeId, id: versionId, status: 'ACTIVE', effectiveTo: null },
        data: { effectiveTo },
      });
      if (changed.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'This fee type version changed while you were closing its effective window. Reload and try again.');
      await this.audit.record(tx, {
        tenantId, actorId, action: 'FEE_TYPE_VERSION_WINDOW_CLOSED', entityType: 'FeeTypeVersion', entityId: versionId,
        before: { effectiveFrom: current.effectiveFrom.toISOString().slice(0, 10), effectiveTo: null, calculationMethod: current.calculationMethod },
        after: { effectiveFrom: current.effectiveFrom.toISOString().slice(0, 10), effectiveTo: input.effectiveTo, reason: input.reason },
        reason: input.reason,
      });
      await this.outbox.publish(tx, {
        tenantId, eventType: 'FEE_TYPE_VERSION_WINDOW_CLOSED', aggregateType: 'FeeType', aggregateId: feeTypeId,
        payload: { versionId, effectiveTo: input.effectiveTo }, actorId, requestId: this.tenantContext.requestId,
      });
      return { ...current, effectiveTo };
    });
  }

  async publishTypeVersion(tenantId: string, feeTypeId: string, versionId: string) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const version = await tx.feeTypeVersion.findFirst({ where: { tenantId, feeTypeId, id: versionId } });
      if (!version) throw AppError.notFound('Fee type version');
      if (version.status !== 'DRAFT' && version.status !== 'PENDING_APPROVAL') throw AppError.conflict('FEE_VERSION_IMMUTABLE', 'Only an unpublished fee type version can be published.');
      validateCalculationConfig(version.calculationMethod, version.calculationConfig);
      await this.assertNoOverlap(tx, tenantId, feeTypeId, version.effectiveFrom, version.effectiveTo, version.id);
      const activated = await tx.feeTypeVersion.updateMany({ where: { tenantId, feeTypeId, id: versionId, status: version.status }, data: { status: 'ACTIVE', approvedBy: actorId ?? null, approvedAt: new Date() } });
      if (activated.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'This fee type version changed while it was being published. Reload and try again.');
      const updatedType = await tx.feeType.updateMany({ where: { tenantId, id: feeTypeId }, data: { calculationMethod: version.calculationMethod, defaultFrequency: version.defaultFrequency, optionality: version.optionality, taxable: version.taxable, taxPercent: version.taxPercent, applicabilityRule: version.applicabilityRule ?? Prisma.JsonNull, updatedBy: actorId ?? null } });
      if (updatedType.count !== 1) throw AppError.notFound('Fee type');
      await this.audit.record(tx, { tenantId, actorId, action: 'FEE_TYPE_VERSION_PUBLISHED', entityType: 'FeeTypeVersion', entityId: versionId, after: { feeTypeId, version: version.version, status: 'ACTIVE' } });
      await this.outbox.publish(tx, { tenantId, eventType: 'FEE_TYPE_VERSION_PUBLISHED', aggregateType: 'FeeType', aggregateId: feeTypeId, payload: { versionId, version: version.version }, actorId, requestId: this.tenantContext.requestId });
      return { ...version, status: 'ACTIVE' as VersionStatus };
    });
  }

  private async assertActiveCategory(tx: TransactionClient, tenantId: string, id: string): Promise<void> {
    const category = await tx.feeCategory.findFirst({ where: { tenantId, id, active: true, deletedAt: null }, select: { id: true } });
    if (!category) throw AppError.validation('Select an active fee category from this institution.');
  }

  private async assertNoOverlap(tx: TransactionClient, tenantId: string, feeTypeId: string, from: Date, to: Date | null, exceptId: string): Promise<void> {
    const active = await tx.feeTypeVersion.findMany({ where: { tenantId, feeTypeId, status: 'ACTIVE', id: { not: exceptId } } });
    const overlaps = active.some((current) => rangesOverlap(from, to, current.effectiveFrom, current.effectiveTo));
    if (overlaps) throw AppError.conflict('FEE_VERSION_DATE_OVERLAP', 'This effective date overlaps a published fee type version. Close that version’s date range first.');
  }

  private assertTenant(tenantId: string): void {
    if (this.tenantContext.requireTenantId() !== tenantId) throw AppError.forbidden('The requested tenant does not match the authenticated session.');
  }
}

@Injectable()
export class FeeStructuresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async list(tenantId: string, raw: Record<string, unknown>) {
    this.assertTenant(tenantId);
    const query = parseListQuery(raw, { allowedSortFields: ['priority', 'active', 'name', 'code'] });
    const where: Prisma.FeeStructureWhereInput = {
      tenantId, deletedAt: null,
      ...(query.status?.length ? { active: query.status.includes('active') } : {}),
      ...buildSearchFilter(query.search, ['name', 'code', 'description']),
    };
    const [items, total] = await Promise.all([
      this.prisma.db.feeStructure.findMany({ where, orderBy: toPrismaOrderBy(query.sort) as Prisma.FeeStructureOrderByWithRelationInput[], skip: query.skip, take: query.take }),
      this.prisma.db.feeStructure.count({ where }),
    ]);
    return paginate(items, total, query);
  }

  async get(tenantId: string, id: string) {
    this.assertTenant(tenantId);
    const structure = await this.prisma.db.feeStructure.findFirst({ where: { tenantId, id, deletedAt: null } });
    if (!structure) throw AppError.notFound('Fee structure');
    const versions = await this.prisma.db.feeStructureVersion.findMany({ where: { tenantId, feeStructureId: id }, orderBy: { version: 'desc' } });
    const itemsByVersion = await Promise.all(versions.map((version) => this.prisma.db.feeStructureItem.findMany({ where: { tenantId, feeStructureVersionId: version.id, active: true }, orderBy: { sortOrder: 'asc' } })));
    return { ...structure, versions: versions.map((version, index) => ({ ...version, items: itemsByVersion[index] ?? [] })) };
  }

  async create(tenantId: string, input: CreateFeeStructureInput) {
    this.assertTenant(tenantId);
    assertDateRange(input.effectiveFrom, input.effectiveTo);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      await this.validateScope(tx, tenantId, input.academicYearId, input.targetUnitId);
      const id = randomUUID();
      const structure = await tx.feeStructure.create({
        data: {
          id, tenantId, name: input.name, code: input.code.toUpperCase(), description: clean(input.description),
          academicYearId: input.academicYearId ?? null,
          targetType: input.targetType ?? 'CLASS', targetUnitId: input.targetUnitId ?? null,
          priority: input.priority ?? 100, createdBy: actorId ?? null,
        },
      });
      const version = await tx.feeStructureVersion.create({
        data: {
          tenantId, feeStructureId: id, version: 1, status: 'DRAFT',
          effectiveFrom: new Date(`${input.effectiveFrom}T00:00:00.000Z`), effectiveTo: input.effectiveTo ? new Date(`${input.effectiveTo}T00:00:00.000Z`) : null,
          notes: clean(input.notes), createdBy: actorId ?? null,
        },
      });
      await this.replaceDraftItems(tx, tenantId, version.id, version.effectiveFrom, input.items);
      await this.audit.record(tx, { tenantId, actorId, action: 'FEE_STRUCTURE_CREATED', entityType: 'FeeStructure', entityId: id, after: { code: structure.code, version: 1, itemCount: input.items.length } });
      return { ...structure, draftVersionId: version.id };
    });
  }

  async update(tenantId: string, id: string, input: UpdateFeeStructureInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const current = await tx.feeStructure.findFirst({ where: { tenantId, id, deletedAt: null } });
      if (!current) throw AppError.notFound('Fee structure');
      const data: Prisma.FeeStructureUpdateManyMutationInput = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(Object.hasOwn(input, 'description') ? { description: clean(input.description) } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        updatedBy: actorId ?? null,
      };
      const changed = await tx.feeStructure.updateMany({ where: { tenantId, id, updatedAt: current.updatedAt }, data });
      if (changed.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'This fee structure changed while you were editing it. Reload and try again.');
      const updated = await tx.feeStructure.findFirst({ where: { tenantId, id } });
      if (!updated) throw AppError.notFound('Fee structure');
      await this.audit.record(tx, { tenantId, actorId, action: 'FEE_STRUCTURE_UPDATED', entityType: 'FeeStructure', entityId: id, before: { active: current.active }, after: { active: updated.active, fields: Object.keys(data) } });
      return updated;
    });
  }

  async createVersion(tenantId: string, id: string, input: CreateFeeStructureVersionInput) {
    this.assertTenant(tenantId);
    assertDateRange(input.effectiveFrom, input.effectiveTo);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const structure = await tx.feeStructure.findFirst({ where: { tenantId, id, deletedAt: null } });
      if (!structure) throw AppError.notFound('Fee structure');
      const latest = await tx.feeStructureVersion.findFirst({ where: { tenantId, feeStructureId: id }, orderBy: { version: 'desc' } });
      const version = await tx.feeStructureVersion.create({
        data: {
          tenantId, feeStructureId: id, version: (latest?.version ?? 0) + 1, status: 'DRAFT',
          effectiveFrom: new Date(`${input.effectiveFrom}T00:00:00.000Z`), effectiveTo: input.effectiveTo ? new Date(`${input.effectiveTo}T00:00:00.000Z`) : null,
          notes: clean(input.notes), supersedesVersionId: latest?.id ?? null, createdBy: actorId ?? null,
        },
      });
      await this.replaceDraftItems(tx, tenantId, version.id, version.effectiveFrom, input.items);
      await this.audit.record(tx, { tenantId, actorId, action: 'FEE_STRUCTURE_VERSION_CREATED', entityType: 'FeeStructureVersion', entityId: version.id, after: { feeStructureId: id, version: version.version, itemCount: input.items.length } });
      return version;
    });
  }

  async closeVersion(tenantId: string, id: string, versionId: string, input: CloseFeeStructureVersionInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    const effectiveTo = dateOnly(new Date(`${input.effectiveTo}T00:00:00.000Z`));
    const today = dateOnly(new Date());
    if (effectiveTo < today) throw AppError.validation('A published fee structure window can only be closed today or on a future date.');
    return this.prisma.transactionWithRetry(async (tx) => {
      const current = await tx.feeStructureVersion.findFirst({ where: { tenantId, feeStructureId: id, id: versionId } });
      if (!current) throw AppError.notFound('Fee structure version');
      if (current.status !== 'ACTIVE') throw AppError.conflict('FEE_VERSION_NOT_ACTIVE', 'Only an active fee structure version can have its future window closed.');
      if (current.effectiveTo) throw AppError.conflict('FEE_VERSION_WINDOW_CLOSED', 'This fee structure version already has an end date.');
      if (effectiveTo < current.effectiveFrom) throw AppError.validation('The end date must be on or after this version’s start date.');
      await this.assertNoOverlap(tx, tenantId, id, current.effectiveFrom, effectiveTo, current.id);
      const changed = await tx.feeStructureVersion.updateMany({
        where: { tenantId, feeStructureId: id, id: versionId, status: 'ACTIVE', effectiveTo: null },
        data: { effectiveTo },
      });
      if (changed.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'This fee structure version changed while you were closing its effective window. Reload and try again.');
      await this.audit.record(tx, {
        tenantId, actorId, action: 'FEE_STRUCTURE_VERSION_WINDOW_CLOSED', entityType: 'FeeStructureVersion', entityId: versionId,
        before: { feeStructureId: id, effectiveFrom: current.effectiveFrom.toISOString().slice(0, 10), effectiveTo: null },
        after: { feeStructureId: id, effectiveFrom: current.effectiveFrom.toISOString().slice(0, 10), effectiveTo: input.effectiveTo, reason: input.reason },
        reason: input.reason,
      });
      await this.outbox.publish(tx, {
        tenantId, eventType: 'FEE_STRUCTURE_VERSION_WINDOW_CLOSED', aggregateType: 'FeeStructure', aggregateId: id,
        payload: { versionId, effectiveTo: input.effectiveTo }, actorId, requestId: this.tenantContext.requestId,
      });
      return { ...current, effectiveTo };
    });
  }

  async publishVersion(tenantId: string, id: string, versionId: string) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const version = await tx.feeStructureVersion.findFirst({ where: { tenantId, feeStructureId: id, id: versionId } });
      if (!version) throw AppError.notFound('Fee structure version');
      if (version.status !== 'DRAFT' && version.status !== 'PENDING_APPROVAL') throw AppError.conflict('FEE_VERSION_IMMUTABLE', 'Only a draft fee structure version can be published.');
      const items = await tx.feeStructureItem.findMany({ where: { tenantId, feeStructureVersionId: versionId, active: true }, orderBy: { sortOrder: 'asc' } });
      if (items.length === 0) throw AppError.validation('A fee structure must contain at least one active fee item before it can be published.');
      await this.assertNoOverlap(tx, tenantId, id, version.effectiveFrom, version.effectiveTo, version.id);
      const typeIds = [...new Set(items.map((item) => item.feeTypeId))];
      const activeTypes = await tx.feeTypeVersion.findMany({
        where: { tenantId, feeTypeId: { in: typeIds }, status: 'ACTIVE', effectiveFrom: { lte: version.effectiveFrom }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: version.effectiveFrom } }] },
      });
      const activeVersionsPerType = new Map<string, number>();
      for (const activeType of activeTypes) activeVersionsPerType.set(activeType.feeTypeId, (activeVersionsPerType.get(activeType.feeTypeId) ?? 0) + 1);
      const typeById = new Map(activeTypes.map((row) => [row.feeTypeId, row]));
      if (typeIds.some((typeId) => !typeById.has(typeId))) throw AppError.validation('Every fee item must refer to a fee type version active on the structure’s effective date.');
      if (typeIds.some((typeId) => activeVersionsPerType.get(typeId) !== 1)) throw AppError.conflict('FEE_TYPE_VERSION_AMBIGUOUS', 'A fee type has more than one published version active on this date. Resolve the version dates first.');
      let total: Prisma.Decimal | null = new Prisma.Decimal(0);
      for (const item of items) {
        const feeVersion = typeById.get(item.feeTypeId)!;
        if (!item.feeTypeVersionId || item.feeTypeVersionId !== feeVersion.id) {
          throw AppError.conflict('FEE_TYPE_VERSION_CHANGED', `Fee item ${item.id} is pinned to a different fee type version. Create a new fee structure version with the intended rate.`);
        }
        validateCalculationConfig(feeVersion.calculationMethod, feeVersion.calculationConfig);
        if (feeVersion.calculationMethod === 'QUANTITY' && !item.quantity) {
          throw AppError.validation(`Add a quantity to fee item ${item.id} before publishing this structure.`);
        }
        if (feeVersion.calculationMethod === 'PERCENTAGE' && !item.percentBase) {
          throw AppError.validation(`Add a percentage base to fee item ${item.id} before publishing this structure.`);
        }
        const base = amountForItem(item, feeVersion.calculationMethod);
        if (base === null) { total = null; continue; }
        const tax = item.taxable ? base.mul(item.taxPercent ?? feeVersion.taxPercent ?? '0').div(100) : new Prisma.Decimal(0);
        if (total) total = total.add(base).add(tax).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
      }
      const activated = await tx.feeStructureVersion.updateMany({ where: { tenantId, feeStructureId: id, id: versionId, status: version.status }, data: { status: 'ACTIVE', totalAmount: total, approvedBy: actorId ?? null, approvedAt: new Date() } });
      if (activated.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'This fee structure version changed while it was being published. Reload and try again.');
      await this.audit.record(tx, { tenantId, actorId, action: 'FEE_STRUCTURE_VERSION_PUBLISHED', entityType: 'FeeStructureVersion', entityId: versionId, after: { feeStructureId: id, version: version.version, itemCount: items.length, totalAmount: total?.toFixed(4) ?? null } });
      await this.outbox.publish(tx, { tenantId, eventType: 'FEE_STRUCTURE_VERSION_PUBLISHED', aggregateType: 'FeeStructure', aggregateId: id, payload: { versionId, version: version.version }, actorId, requestId: this.tenantContext.requestId });
      return { ...version, status: 'ACTIVE' as VersionStatus, totalAmount: total?.toFixed(4) ?? null };
    });
  }

  private async replaceDraftItems(tx: TransactionClient, tenantId: string, versionId: string, effectiveFrom: Date, items: FeeStructureItemInput[]): Promise<void> {
    const ids = items.map((item) => item.feeTypeId);
    if (new Set(ids).size !== ids.length) throw AppError.validation('A fee type can appear only once in a structure version.');
    const types = await tx.feeType.findMany({ where: { tenantId, id: { in: ids }, active: true, deletedAt: null }, select: { id: true } });
    const found = new Set(types.map((type) => type.id));
    if (ids.some((id) => !found.has(id))) throw AppError.validation('Every fee item must refer to an active fee type from this institution.');
    const feeVersions = ids.length ? await tx.feeTypeVersion.findMany({
      where: { tenantId, feeTypeId: { in: ids }, status: 'ACTIVE', effectiveFrom: { lte: effectiveFrom }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }] },
    }) : [];
    const versionCountByType = new Map<string, number>();
    const versionByType = new Map<string, typeof feeVersions[number]>();
    for (const version of feeVersions) {
      versionCountByType.set(version.feeTypeId, (versionCountByType.get(version.feeTypeId) ?? 0) + 1);
      versionByType.set(version.feeTypeId, version);
    }
    if (ids.some((id) => versionCountByType.get(id) !== 1)) {
      throw AppError.validation('Every fee type must have exactly one published configuration active on the fee structure start date.');
    }
    for (const [index, item] of items.entries()) {
      const feeVersion = versionByType.get(item.feeTypeId)!;
      validateCalculationConfig(feeVersion.calculationMethod, feeVersion.calculationConfig);
      if (feeVersion.calculationMethod === 'QUANTITY' && !item.quantity) throw AppError.validation('Add a quantity for every quantity-based fee item.');
      if (feeVersion.calculationMethod === 'PERCENTAGE' && !item.percentBase) throw AppError.validation('Add a percentage base for every percentage-based fee item.');
      await tx.feeStructureItem.create({
        data: {
          tenantId, feeStructureVersionId: versionId, feeTypeId: item.feeTypeId, feeTypeVersionId: feeVersion.id,
          amount: item.amount, quantity: item.quantity ?? null, percentBase: item.percentBase ?? null,
          frequency: item.frequency as FeeFrequency, optionality: (item.optionality ?? 'MANDATORY') as FeeOptionality,
          taxable: item.taxable ?? false, taxPercent: item.taxPercent ?? null,
          dueDate: item.dueDate ? new Date(`${item.dueDate}T00:00:00.000Z`) : null,
          sortOrder: item.sortOrder ?? index,
        },
      });
    }
  }

  private async validateScope(tx: TransactionClient, tenantId: string, academicYearId?: string | null, targetUnitId?: string | null): Promise<void> {
    if (academicYearId) {
      const year = await tx.academicYear.findFirst({ where: { tenantId, id: academicYearId }, select: { id: true } });
      if (!year) throw AppError.validation('The academic year is not available in this institution.');
    }
    if (targetUnitId) {
      const unit = await tx.academicUnit.findFirst({ where: { tenantId, id: targetUnitId, active: true, deletedAt: null }, select: { id: true } });
      if (!unit) throw AppError.validation('The academic unit is not available in this institution.');
    }
  }

  private async assertNoOverlap(tx: TransactionClient, tenantId: string, id: string, from: Date, to: Date | null, exceptId: string): Promise<void> {
    const active = await tx.feeStructureVersion.findMany({ where: { tenantId, feeStructureId: id, status: 'ACTIVE', id: { not: exceptId } } });
    if (active.some((current) => rangesOverlap(from, to, current.effectiveFrom, current.effectiveTo))) {
      throw AppError.conflict('FEE_VERSION_DATE_OVERLAP', 'This effective date overlaps a published fee structure version. Close that version’s date range first.');
    }
  }

  private assertTenant(tenantId: string): void {
    if (this.tenantContext.requireTenantId() !== tenantId) throw AppError.forbidden('The requested tenant does not match the authenticated session.');
  }
}

@ApiTags('fee catalog')
@RequireModules('FEES')
@Controller('fee-categories')
export class FeeCategoriesController {
  constructor(private readonly fees: FeeCatalogService) {}
  @Get() @RequirePermissions(PERMISSIONS.FEE_CATALOG_READ) list(@CurrentTenant() tenant: string, @Query() query: Record<string, unknown>) { return this.fees.listCategories(tenant, query); }
  @Post() @RequirePermissions(PERMISSIONS.FEE_CATALOG_CREATE) @UsePipes(new ZodValidationPipe(createFeeCategorySchema)) create(@CurrentTenant() tenant: string, @Body() body: CreateFeeCategoryInput) { return this.fees.createCategory(tenant, body); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.FEE_CATALOG_UPDATE) @UsePipes(new ZodValidationPipe(updateFeeCategorySchema)) update(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: UpdateFeeCategoryInput) { return this.fees.updateCategory(tenant, id, body); }
}

@ApiTags('fee catalog')
@RequireModules('FEES')
@Controller('fee-types')
export class FeeTypesController {
  constructor(private readonly fees: FeeCatalogService) {}
  @Get() @RequirePermissions(PERMISSIONS.FEE_CATALOG_READ) list(@CurrentTenant() tenant: string, @Query() query: Record<string, unknown>) { return this.fees.listTypes(tenant, query); }
  @Post() @RequirePermissions(PERMISSIONS.FEE_CATALOG_CREATE) @UsePipes(new ZodValidationPipe(createFeeTypeSchema)) create(@CurrentTenant() tenant: string, @Body() body: CreateFeeTypeInput) { return this.fees.createType(tenant, body); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.FEE_CATALOG_UPDATE) @UsePipes(new ZodValidationPipe(updateFeeTypeSchema)) update(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: UpdateFeeTypeInput) { return this.fees.updateType(tenant, id, body); }
  @Get(':id/versions') @RequirePermissions(PERMISSIONS.FEE_CATALOG_READ) versions(@CurrentTenant() tenant: string, @Param('id') id: string) { return this.fees.listTypeVersions(tenant, id); }
  @Post(':id/versions') @RequirePermissions(PERMISSIONS.FEE_CATALOG_UPDATE) @UsePipes(new ZodValidationPipe(createFeeTypeVersionSchema)) version(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: CreateFeeTypeVersionInput) { return this.fees.createTypeVersion(tenant, id, body); }
  @Post(':id/versions/:versionId/close') @RequirePermissions(PERMISSIONS.FEE_CATALOG_UPDATE) @UsePipes(new ZodValidationPipe(closeFeeTypeVersionSchema)) closeVersion(@CurrentTenant() tenant: string, @Param('id') id: string, @Param('versionId') versionId: string, @Body() body: CloseFeeTypeVersionInput) { return this.fees.closeTypeVersion(tenant, id, versionId, body); }
  @Post(':id/versions/:versionId/publish') @RequirePermissions(PERMISSIONS.FEE_STRUCTURE_PUBLISH) @ApiOperation({ summary: 'Publish a dated fee type configuration version' }) publish(@CurrentTenant() tenant: string, @Param('id') id: string, @Param('versionId') versionId: string) { return this.fees.publishTypeVersion(tenant, id, versionId); }
}

@ApiTags('fee structures')
@RequireModules('FEES')
@Controller('fee-structures')
export class FeeStructuresController {
  constructor(private readonly structures: FeeStructuresService) {}
  @Get() @RequirePermissions(PERMISSIONS.FEE_STRUCTURE_READ) list(@CurrentTenant() tenant: string, @Query() query: Record<string, unknown>) { return this.structures.list(tenant, query); }
  @Get(':id') @RequirePermissions(PERMISSIONS.FEE_STRUCTURE_READ) get(@CurrentTenant() tenant: string, @Param('id') id: string) { return this.structures.get(tenant, id); }
  @Post() @RequirePermissions(PERMISSIONS.FEE_STRUCTURE_CREATE) @UsePipes(new ZodValidationPipe(createFeeStructureSchema)) create(@CurrentTenant() tenant: string, @Body() body: CreateFeeStructureInput) { return this.structures.create(tenant, body); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.FEE_STRUCTURE_UPDATE) @UsePipes(new ZodValidationPipe(updateFeeStructureSchema)) update(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: UpdateFeeStructureInput) { return this.structures.update(tenant, id, body); }
  @Post(':id/versions') @RequirePermissions(PERMISSIONS.FEE_STRUCTURE_UPDATE) @UsePipes(new ZodValidationPipe(createFeeStructureVersionSchema)) version(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: CreateFeeStructureVersionInput) { return this.structures.createVersion(tenant, id, body); }
  @Post(':id/versions/:versionId/close') @RequirePermissions(PERMISSIONS.FEE_STRUCTURE_UPDATE) @UsePipes(new ZodValidationPipe(closeFeeStructureVersionSchema)) closeVersion(@CurrentTenant() tenant: string, @Param('id') id: string, @Param('versionId') versionId: string, @Body() body: CloseFeeStructureVersionInput) { return this.structures.closeVersion(tenant, id, versionId, body); }
  @Post(':id/versions/:versionId/publish') @RequirePermissions(PERMISSIONS.FEE_STRUCTURE_PUBLISH) @ApiOperation({ summary: 'Publish a dated fee schedule version' }) publish(@CurrentTenant() tenant: string, @Param('id') id: string, @Param('versionId') versionId: string) { return this.structures.publishVersion(tenant, id, versionId); }
}

@Module({
  imports: [PrismaModule, TenantContextModule],
  controllers: [FeeCategoriesController, FeeTypesController, FeeStructuresController],
  providers: [FeeCatalogService, FeeStructuresService],
  exports: [FeeCatalogService, FeeStructuresService],
})
export class FeesModule {}

function clean(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

function jsonValue(value: Record<string, unknown> | null | undefined): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) return undefined;
  return value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue;
}

function validateCalculationConfig(method: FeeCalculationMethod, value: unknown) {
  try {
    return validateFeeCalculationConfig(method, value);
  } catch (error) {
    if (error instanceof FeeBaseCalculationError) throw AppError.validation(error.message);
    throw error;
  }
}

function dateOnly(date: Date): Date {
  return new Date(`${date.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

function assertDateRange(from: string, to: string | null | undefined): void {
  if (to && to < from) throw AppError.validation('The effective end date must be on or after the start date.');
}

function rangesOverlap(aFrom: Date, aTo: Date | null, bFrom: Date, bTo: Date | null): boolean {
  const aEnd = aTo?.getTime() ?? Number.POSITIVE_INFINITY;
  const bEnd = bTo?.getTime() ?? Number.POSITIVE_INFINITY;
  return aFrom.getTime() <= bEnd && bFrom.getTime() <= aEnd;
}

function amountForItem(item: { amount: Prisma.Decimal; quantity: Prisma.Decimal | null; percentBase: Prisma.Decimal | null; taxable: boolean; taxPercent: Prisma.Decimal | null }, method: FeeCalculationMethod): Prisma.Decimal | null {
  const amount = new Prisma.Decimal(item.amount);
  let base: Prisma.Decimal;
  switch (method) {
    case 'FIXED': base = amount; break;
    case 'QUANTITY':
      if (!item.quantity) return null;
      base = amount.mul(item.quantity);
      break;
    case 'PERCENTAGE':
      if (!item.percentBase) return null;
      base = item.percentBase.mul(amount).div(100);
      break;
    case 'USAGE':
    case 'FORMULA':
    case 'CUSTOM': return null;
  }
  return base.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
}
