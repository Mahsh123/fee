import { Body, Controller, Get, Injectable, Module, Param, Patch, Post, Query, UsePipes } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { calculateFees, hasBlockingIssues, validateRuleSet } from '@fee/fee-engine';
import {
  CALCULATION_STAGES,
  ERROR_CODES,
  PERMISSIONS,
  type ConditionNode,
  type FeeCalculationRequest,
  type RuleDefinition,
} from '@fee/types';
import {
  Prisma,
  type ActionAmountBasis,
  type ActionKind,
  type AssignmentTargetType,
  type FeePolicyAction,
  type FeePolicyScope,
  type PolicyType,
  type StackingMode,
  type TransactionClient,
  type VersionStatus,
} from '@fee/database';
import {
  createFeePolicySchema,
  createFeePolicyVersionSchema,
  feePolicyPreviewSchema,
  updateFeePolicySchema,
  type CreateFeePolicyInput,
  type CreateFeePolicyVersionInput,
  type FeePolicyPreviewInput,
  type UpdateFeePolicyInput,
} from '@fee/validation';
import { AppError } from '../common/errors';
import { AuditService, OutboxService, requireTenantCurrency } from '../common/financial';
import { buildSearchFilter, paginate, parseListQuery, toPrismaOrderBy, ZodValidationPipe } from '../common/http';
import { PrismaModule, PrismaService } from '../common/prisma.service';
import { CurrentTenant, RequireModules, RequirePermissions, TenantContextModule, TenantContextService } from '../common/tenancy';

const POLICY_STAGE_BY_TYPE: Record<PolicyType, (typeof CALCULATION_STAGES)[number]> = {
  ELIGIBILITY: 'BASE',
  SCHOLARSHIP: 'SCHOLARSHIP',
  DISCOUNT: 'DISCOUNT',
  CONCESSION: 'CONCESSION',
  WAIVER: 'WAIVER',
  EXEMPTION: 'WAIVER',
  SURCHARGE: 'SURCHARGE',
  OVERRIDE: 'OVERRIDE',
  LATE_FEE: 'LATE_FEE',
  EARLY_PAYMENT_DISCOUNT: 'DISCOUNT',
  INSTALLMENT_RULE: 'BASE',
};

@Injectable()
export class FeePoliciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async list(tenantId: string, raw: Record<string, unknown>) {
    this.assertTenant(tenantId);
    const query = parseListQuery(raw, { allowedSortFields: ['name', 'code', 'priority', 'active', 'stage'] });
    const where: Prisma.FeePolicyWhereInput = {
      tenantId, deletedAt: null,
      ...(query.status?.length ? { active: query.status.includes('active') } : {}),
      ...buildSearchFilter(query.search, ['name', 'code', 'description']),
    };
    const [items, total] = await Promise.all([
      this.prisma.db.feePolicy.findMany({ where, orderBy: toPrismaOrderBy(query.sort) as Prisma.FeePolicyOrderByWithRelationInput[], skip: query.skip, take: query.take }),
      this.prisma.db.feePolicy.count({ where }),
    ]);
    return paginate(items, total, query);
  }

  async get(tenantId: string, id: string) {
    this.assertTenant(tenantId);
    const policy = await this.prisma.db.feePolicy.findFirst({ where: { tenantId, id, deletedAt: null } });
    if (!policy) throw AppError.notFound('Fee policy');
    const versions = await this.prisma.db.feePolicyVersion.findMany({ where: { tenantId, policyId: id }, orderBy: { version: 'desc' } });
    const details = await Promise.all(versions.map(async (version) => {
      const [actions, scopes] = await Promise.all([
        this.prisma.db.feePolicyAction.findMany({ where: { tenantId, policyVersionId: version.id }, orderBy: { sortOrder: 'asc' } }),
        this.prisma.db.feePolicyScope.findMany({ where: { tenantId, policyVersionId: version.id } }),
      ]);
      return { ...version, actions, scopes };
    }));
    return { ...policy, versions: details };
  }

  async create(tenantId: string, input: CreateFeePolicyInput) {
    this.assertTenant(tenantId);
    assertDateRange(input.version.effectiveFrom, input.version.effectiveTo);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      await this.validateVersionReferences(tx, tenantId, input.version);
      const id = randomUUID();
      const policy = await tx.feePolicy.create({
        data: {
          id, tenantId, name: input.name, code: input.code.toUpperCase(), description: clean(input.description),
          policyType: input.policyType as PolicyType, stackingMode: input.stackingMode as StackingMode,
          priority: input.priority ?? 100, stage: CALCULATION_STAGES.indexOf(input.stage) * 10,
          arbitrationGroup: clean(input.arbitrationGroup), requiresApproval: input.requiresApproval ?? false,
          approvalThreshold: input.approvalThreshold ?? null, explainTemplate: clean(input.explainTemplate), createdBy: actorId ?? null,
        },
      });
      const version = await this.createVersionRows(tx, tenantId, id, 1, input.version, actorId);
      await this.audit.record(tx, { tenantId, actorId, action: 'FEE_POLICY_CREATED', entityType: 'FeePolicy', entityId: id, after: { code: policy.code, policyType: policy.policyType, draftVersionId: version.id } });
      return { ...policy, draftVersionId: version.id };
    });
  }

  async update(tenantId: string, id: string, input: UpdateFeePolicyInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const current = await tx.feePolicy.findFirst({ where: { tenantId, id, deletedAt: null } });
      if (!current) throw AppError.notFound('Fee policy');
      const data: Prisma.FeePolicyUpdateManyMutationInput = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(Object.hasOwn(input, 'description') ? { description: clean(input.description) } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.stage !== undefined ? { stage: CALCULATION_STAGES.indexOf(input.stage) * 10 } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(Object.hasOwn(input, 'explainTemplate') ? { explainTemplate: clean(input.explainTemplate) } : {}),
        updatedBy: actorId ?? null,
      };
      const changed = await tx.feePolicy.updateMany({ where: { tenantId, id, updatedAt: current.updatedAt }, data });
      if (changed.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'This policy changed while you were editing it. Reload and try again.');
      const updated = await tx.feePolicy.findFirst({ where: { tenantId, id } });
      if (!updated) throw AppError.notFound('Fee policy');
      await this.audit.record(tx, { tenantId, actorId, action: 'FEE_POLICY_UPDATED', entityType: 'FeePolicy', entityId: id, before: { active: current.active }, after: { active: updated.active, fields: Object.keys(data) } });
      return updated;
    });
  }

  async createVersion(tenantId: string, policyId: string, input: CreateFeePolicyVersionInput) {
    this.assertTenant(tenantId);
    assertDateRange(input.effectiveFrom, input.effectiveTo);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const policy = await tx.feePolicy.findFirst({ where: { tenantId, id: policyId, deletedAt: null } });
      if (!policy) throw AppError.notFound('Fee policy');
      await this.validateVersionReferences(tx, tenantId, input);
      const latest = await tx.feePolicyVersion.findFirst({ where: { tenantId, policyId }, orderBy: { version: 'desc' } });
      const version = await this.createVersionRows(tx, tenantId, policyId, (latest?.version ?? 0) + 1, input, actorId);
      await this.audit.record(tx, { tenantId, actorId, action: 'FEE_POLICY_VERSION_CREATED', entityType: 'FeePolicyVersion', entityId: version.id, after: { policyId, version: version.version } });
      return version;
    });
  }

  async publishVersion(tenantId: string, policyId: string, versionId: string) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const policy = await tx.feePolicy.findFirst({ where: { tenantId, id: policyId, deletedAt: null } });
      const version = await tx.feePolicyVersion.findFirst({ where: { tenantId, policyId, id: versionId } });
      if (!policy || !version) throw AppError.notFound('Fee policy version');
      if (!policy.active) throw AppError.conflict('FEE_POLICY_INACTIVE', 'Activate this policy before publishing a version.');
      if (version.status !== 'DRAFT' && version.status !== 'PENDING_APPROVAL') throw AppError.conflict('FEE_VERSION_IMMUTABLE', 'Only a draft policy version can be published.');
      const current = await tx.feePolicyVersion.findMany({ where: { tenantId, policyId, status: 'ACTIVE', id: { not: version.id } } });
      if (current.some((active) => rangesOverlap(version.effectiveFrom, version.effectiveTo, active.effectiveFrom, active.effectiveTo))) {
        throw AppError.conflict('FEE_VERSION_DATE_OVERLAP', 'This policy version overlaps a published version. Close the earlier date range first.');
      }
      const rule = await this.toRule(tx, tenantId, policy, version, 'ACTIVE');
      const knownTypes = await tx.feeType.findMany({ where: { tenantId, active: true, deletedAt: null }, select: { code: true } });
      const issues = validateRuleSet([rule], { knownFeeTypeCodes: knownTypes.map((type) => type.code) });
      if (hasBlockingIssues(issues)) throw AppError.validation('This policy version has configuration errors.', issues.filter((issue) => issue.severity === 'ERROR').map((issue) => ({ path: issue.code, message: issue.message, code: issue.code })));
      const activated = await tx.feePolicyVersion.updateMany({ where: { tenantId, policyId, id: version.id, status: version.status }, data: { status: 'ACTIVE', approvedBy: actorId ?? null, approvedAt: new Date() } });
      if (activated.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'This policy version changed while it was being published. Reload and try again.');
      await this.audit.record(tx, { tenantId, actorId, action: 'FEE_POLICY_VERSION_PUBLISHED', entityType: 'FeePolicyVersion', entityId: versionId, after: { policyId, version: version.version, warnings: issues.filter((issue) => issue.severity === 'WARNING').map((issue) => issue.code) } });
      await this.outbox.publish(tx, { tenantId, eventType: 'FEE_POLICY_VERSION_PUBLISHED', aggregateType: 'FeePolicy', aggregateId: policyId, payload: { versionId, version: version.version }, actorId, requestId: this.tenantContext.requestId });
      return { ...version, status: 'ACTIVE' as VersionStatus, validationWarnings: issues.filter((issue) => issue.severity === 'WARNING') };
    });
  }

  async preview(tenantId: string, policyId: string, body: FeePolicyPreviewInput) {
    this.assertTenant(tenantId);
    const policy = await this.prisma.db.feePolicy.findFirst({ where: { tenantId, id: policyId, deletedAt: null } });
    if (!policy) throw AppError.notFound('Fee policy');
    const version = body.versionId
      ? await this.prisma.db.feePolicyVersion.findFirst({ where: { tenantId, policyId, id: body.versionId } })
      : await this.prisma.db.feePolicyVersion.findFirst({ where: { tenantId, policyId, status: 'ACTIVE' }, orderBy: { version: 'desc' } });
    if (!version) throw AppError.notFound('Published policy version');
    const settings = await this.prisma.db.tenantSettings.findUnique({ where: { tenantId }, select: { currency: true, roundingMode: true } });
    const currency = requireTenantCurrency(settings);
    const rule = await this.toRule(this.prisma.db as unknown as TransactionClient, tenantId, policy, version, 'ACTIVE');
    const request = body.request as unknown as Omit<FeeCalculationRequest, 'rules' | 'currency' | 'roundingMode'>;
    const result = calculateFees({ ...request, rules: [rule], currency, roundingMode: settings?.roundingMode ?? 'HALF_UP' });
    return { result, warnings: result.diagnostics.filter((entry) => entry.severity === 'WARNING') };
  }

  async loadActiveRules(tx: TransactionClient, tenantId: string, asOfDate: string): Promise<RuleDefinition[]> {
    const policies = await tx.feePolicy.findMany({ where: { tenantId, active: true, deletedAt: null } });
    if (policies.length === 0) return [];
    const policyById = new Map(policies.map((policy) => [policy.id, policy]));
    const versions = await tx.feePolicyVersion.findMany({
      where: {
        tenantId, policyId: { in: policies.map((policy) => policy.id) }, status: 'ACTIVE',
        effectiveFrom: { lte: dateValue(asOfDate) },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: dateValue(asOfDate) } }],
      },
    });
    const rules: RuleDefinition[] = [];
    for (const version of versions) {
      const policy = policyById.get(version.policyId);
      if (policy) rules.push(await this.toRule(tx, tenantId, policy, version, 'ACTIVE'));
    }
    return rules;
  }

  private async createVersionRows(tx: TransactionClient, tenantId: string, policyId: string, versionNumber: number, input: CreateFeePolicyVersionInput, actorId?: string) {
    const version = await tx.feePolicyVersion.create({
      data: {
        tenantId, policyId, version: versionNumber, status: 'DRAFT',
        effectiveFrom: dateValue(input.effectiveFrom), effectiveTo: input.effectiveTo ? dateValue(input.effectiveTo) : null,
        conditionTree: jsonValue(input.conditionTree), limits: jsonValue(input.limits), createdBy: actorId ?? null,
      },
    });
    for (const [index, action] of input.actions.entries()) {
      await tx.feePolicyAction.create({
        data: {
          tenantId, policyVersionId: version.id, kind: action.kind as ActionKind, amountBasis: (action.amountBasis ?? 'RUNNING_TOTAL') as ActionAmountBasis,
          amount: action.amount ?? null, percentage: action.percentage ?? null, feeTypeIds: action.feeTypeIds ?? [],
          capAmount: action.capAmount ?? null, floorAmount: action.floorAmount ?? null,
          dueDate: action.dueDate ? dateValue(action.dueDate) : null, sortOrder: action.sortOrder ?? index,
          parameters: jsonValue(action.parameters),
        },
      });
    }
    for (const scope of input.scopes ?? []) {
      await tx.feePolicyScope.create({
        data: {
          tenantId, policyVersionId: version.id, targetType: scope.targetType as AssignmentTargetType,
          targetId: scope.targetId ?? null, academicYearId: scope.academicYearId ?? null, includeChildren: scope.includeChildren ?? true,
        },
      });
    }
    return version;
  }

  private async validateVersionReferences(tx: TransactionClient, tenantId: string, input: CreateFeePolicyVersionInput): Promise<void> {
    const feeTypeIds = [...new Set((input.actions ?? []).flatMap((action) => action.feeTypeIds ?? []))];
    if (feeTypeIds.length) {
      const found = await tx.feeType.findMany({ where: { tenantId, id: { in: feeTypeIds }, deletedAt: null }, select: { id: true } });
      const foundIds = new Set(found.map((row) => row.id));
      if (feeTypeIds.some((id) => !foundIds.has(id))) throw AppError.validation('An action references a fee type that is not part of this institution.');
    }
    for (const scope of input.scopes ?? []) {
      if (scope.academicYearId) {
        const year = await tx.academicYear.findFirst({ where: { tenantId, id: scope.academicYearId }, select: { id: true } });
        if (!year) throw AppError.validation('A policy scope references an academic year outside this institution.');
      }
      if (scope.targetId) {
        if (scope.targetType === 'STUDENT') {
          const student = await tx.student.findFirst({ where: { tenantId, id: scope.targetId, deletedAt: null }, select: { id: true } });
          if (!student) throw AppError.validation('A policy scope references a student outside this institution.');
        } else if (scope.targetType === 'CUSTOM_GROUP') {
          const group = await tx.studentGroup.findFirst({ where: { tenantId, id: scope.targetId, active: true }, select: { id: true } });
          if (!group) throw AppError.validation('A policy scope references a student group outside this institution.');
        } else {
          const unit = await tx.academicUnit.findFirst({ where: { tenantId, id: scope.targetId, active: true, deletedAt: null }, select: { id: true } });
          if (!unit) throw AppError.validation('A policy scope references an academic unit outside this institution.');
        }
      }
    }
  }

  private async toRule(tx: TransactionClient, tenantId: string, policy: { id: string; name: string; code: string; policyType: PolicyType; stackingMode: StackingMode; priority: number; stage: number; arbitrationGroup: string | null; requiresApproval: boolean; approvalThreshold: Prisma.Decimal | null; explainTemplate: string | null }, version: { id: string; status: VersionStatus; effectiveFrom: Date; effectiveTo: Date | null; conditionTree: Prisma.JsonValue | null; limits: Prisma.JsonValue | null; version: number }, statusOverride?: VersionStatus): Promise<RuleDefinition> {
    const [storedActions, scopes] = await Promise.all([
      tx.feePolicyAction.findMany({ where: { tenantId, policyVersionId: version.id }, orderBy: { sortOrder: 'asc' } }),
      tx.feePolicyScope.findMany({ where: { tenantId, policyVersionId: version.id } }),
    ]);
    const feeTypeIds = [...new Set(storedActions.flatMap((action) => action.feeTypeIds))];
    const feeTypes = feeTypeIds.length ? await tx.feeType.findMany({ where: { tenantId, id: { in: feeTypeIds } }, select: { id: true, code: true } }) : [];
    const codeById = new Map(feeTypes.map((feeType) => [feeType.id, feeType.code]));
    const stage = stageFor(policy);
    return {
      id: policy.id, versionId: version.id, code: policy.code, name: policy.name,
      policyType: policy.policyType,
      stage,
      priority: policy.priority,
      stackingMode: policy.stackingMode,
      arbitrationGroup: policy.arbitrationGroup,
      conditions: version.conditionTree ? version.conditionTree as unknown as ConditionNode : undefined,
      actions: storedActions.map((action: FeePolicyAction) => ({
        id: action.id, kind: action.kind, amountBasis: action.amountBasis,
        amount: action.amount?.toString() ?? null, percentage: action.percentage?.toString() ?? null,
        feeTypeCodes: action.feeTypeIds.map((id) => codeById.get(id)).filter((code): code is string => Boolean(code)),
        capAmount: action.capAmount?.toString() ?? null, floorAmount: action.floorAmount?.toString() ?? null,
        dueDate: action.dueDate?.toISOString().slice(0, 10) ?? null, sortOrder: action.sortOrder,
        parameters: action.parameters as Record<string, unknown> | null,
      })),
      scopes: scopes.map((scope: FeePolicyScope) => ({ targetType: scope.targetType, targetId: scope.targetId, academicYearId: scope.academicYearId, includeChildren: scope.includeChildren })),
      effectiveFrom: version.effectiveFrom.toISOString().slice(0, 10),
      effectiveTo: version.effectiveTo?.toISOString().slice(0, 10) ?? null,
      status: statusOverride ?? version.status,
      requiresApproval: policy.requiresApproval,
      approvalThreshold: policy.approvalThreshold?.toString() ?? null,
      limits: version.limits as RuleDefinition['limits'],
      explainTemplate: policy.explainTemplate,
    };
  }

  private assertTenant(tenantId: string): void {
    if (this.tenantContext.requireTenantId() !== tenantId) throw AppError.forbidden('The requested tenant does not match the authenticated session.');
  }
}

@ApiTags('fee policies')
@RequireModules('FEES')
@Controller('fee-policies')
export class FeePoliciesController {
  constructor(private readonly policies: FeePoliciesService) {}
  @Get() @RequirePermissions(PERMISSIONS.FEE_POLICY_READ) list(@CurrentTenant() tenant: string, @Query() query: Record<string, unknown>) { return this.policies.list(tenant, query); }
  @Get(':id') @RequirePermissions(PERMISSIONS.FEE_POLICY_READ) get(@CurrentTenant() tenant: string, @Param('id') id: string) { return this.policies.get(tenant, id); }
  @Post() @RequirePermissions(PERMISSIONS.FEE_POLICY_CREATE) @UsePipes(new ZodValidationPipe(createFeePolicySchema)) create(@CurrentTenant() tenant: string, @Body() body: CreateFeePolicyInput) { return this.policies.create(tenant, body); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.FEE_POLICY_UPDATE) @UsePipes(new ZodValidationPipe(updateFeePolicySchema)) update(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: UpdateFeePolicyInput) { return this.policies.update(tenant, id, body); }
  @Post(':id/versions') @RequirePermissions(PERMISSIONS.FEE_POLICY_UPDATE) @UsePipes(new ZodValidationPipe(createFeePolicyVersionSchema)) version(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: CreateFeePolicyVersionInput) { return this.policies.createVersion(tenant, id, body); }
  @Post(':id/versions/:versionId/publish') @RequirePermissions(PERMISSIONS.FEE_POLICY_PUBLISH) @ApiOperation({ summary: 'Validate and publish a dated fee policy version' }) publish(@CurrentTenant() tenant: string, @Param('id') id: string, @Param('versionId') versionId: string) { return this.policies.publishVersion(tenant, id, versionId); }
  @Post(':id/preview') @RequirePermissions(PERMISSIONS.FEE_POLICY_PREVIEW) @UsePipes(new ZodValidationPipe(feePolicyPreviewSchema)) preview(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: FeePolicyPreviewInput) { return this.policies.preview(tenant, id, body); }
}

@Module({ imports: [PrismaModule, TenantContextModule], controllers: [FeePoliciesController], providers: [FeePoliciesService], exports: [FeePoliciesService] })
export class FeePoliciesModule {}

function clean(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  const trimmed = value.trim();
  return trimmed || null;
}

function jsonValue(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) return undefined;
  return value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue;
}

function dateValue(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function assertDateRange(from: string, to?: string | null): void {
  if (to && to < from) throw AppError.validation('The effective end date must be on or after the start date.');
}

function rangesOverlap(aFrom: Date, aTo: Date | null, bFrom: Date, bTo: Date | null): boolean {
  return aFrom.getTime() <= (bTo?.getTime() ?? Number.POSITIVE_INFINITY) && bFrom.getTime() <= (aTo?.getTime() ?? Number.POSITIVE_INFINITY);
}

function stageFor(policy: { policyType: PolicyType; stage: number }): RuleDefinition['stage'] {
  const index = policy.stage / 10;
  const stage = Number.isInteger(index) ? CALCULATION_STAGES[index] : undefined;
  if (!stage || POLICY_STAGE_BY_TYPE[policy.policyType] !== stage) {
    throw AppError.validation(`Policy type ${policy.policyType} must use the ${POLICY_STAGE_BY_TYPE[policy.policyType]} calculation stage.`);
  }
  return stage;
}
