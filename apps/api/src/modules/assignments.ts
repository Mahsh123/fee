import { Body, Controller, Get, Injectable, Module, Param, Patch, Post, Query, UsePipes } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { calculateBaseAmount, calculateFees, CALCULATION_VERSION, evaluateConditions, FeeBaseCalculationError } from '@fee/fee-engine';
import { Money, Rate } from '@fee/money';
import { ERROR_CODES, PERMISSIONS, type ConditionNode, type FeeCalculationItemInput, type FeeContext, type SystemLedgerAccountKey } from '@fee/types';
import { Prisma, type DemandStatus, type FeeOptionality, type FeeFrequency, type TransactionClient, type VersionStatus } from '@fee/database';
import { createFeeAssignmentSchema, groupMembershipRuleSchema, installmentRuleSchema, updateFeeAssignmentSchema, type CreateFeeAssignmentInput, type InstallmentRuleInput, type UpdateFeeAssignmentInput } from '@fee/validation';
import { AppError } from '../common/errors';
import { AuditService, LedgerService, OutboxService, SequenceService, requireTenantCurrency } from '../common/financial';
import { buildSearchFilter, paginate, parseListQuery, toPrismaOrderBy, ZodValidationPipe } from '../common/http';
import { PrismaModule, PrismaService } from '../common/prisma.service';
import { CurrentTenant, RequireModules, RequirePermissions, TenantContextModule, TenantContextService } from '../common/tenancy';
import { FeePoliciesModule, FeePoliciesService } from './fee-policies';
import { BenefitsModule, BenefitsService } from './benefits';
import { calculatePayerResponsibilities } from './payer-responsibility-engine';

interface DemandCandidate {
  student: {
    id: string; branchId: string | null; admissionNumber: string; firstName: string; middleName: string | null; lastName: string | null;
    dateOfBirth: Date | null; gender: string | null; category: string | null; phone: string | null; email: string | null;
    status: string; primaryUnitId: string | null; academicYearId: string | null; admissionType: string | null;
    scholarshipCategory: string | null; hostelStatus: boolean; transportStatus: boolean; transportRouteId: string | null;
    isInternational: boolean; academicScore: Prisma.Decimal | null; familyGroupId: string | null; metadata: Prisma.JsonValue | null;
  };
  context: FeeContext;
}

@Injectable()
export class FeeAssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policies: FeePoliciesService,
    private readonly sequences: SequenceService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly tenantContext: TenantContextService,
    private readonly benefits: BenefitsService,
  ) {}

  async list(tenantId: string, raw: Record<string, unknown>) {
    this.assertTenant(tenantId);
    const query = parseListQuery(raw, { allowedSortFields: ['status', 'targetType', 'generatedAt'] });
    const where: Prisma.FeeAssignmentWhereInput = {
      tenantId,
      ...(query.status?.length ? { status: { in: query.status as VersionStatus[] } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.db.feeAssignment.findMany({ where, orderBy: toPrismaOrderBy(query.sort) as Prisma.FeeAssignmentOrderByWithRelationInput[], skip: query.skip, take: query.take }),
      this.prisma.db.feeAssignment.count({ where }),
    ]);
    return paginate(items, total, query);
  }

  async create(tenantId: string, input: CreateFeeAssignmentInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const [structure, version, settings] = await Promise.all([
        tx.feeStructure.findFirst({ where: { tenantId, id: input.feeStructureId, active: true, deletedAt: null } }),
        tx.feeStructureVersion.findFirst({ where: { tenantId, id: input.feeStructureVersionId, feeStructureId: input.feeStructureId, status: 'ACTIVE' } }),
        tx.tenantSettings.findUnique({ where: { tenantId } }),
      ]);
      const currency = requireTenantCurrency(settings);
      if (!structure || !version) throw AppError.validation('Select an active fee structure and one of its published versions.');
      if (input.branchId) {
        const branch = await tx.branch.findFirst({ where: { tenantId, id: input.branchId, status: 'ACTIVE' }, select: { id: true } });
        if (!branch) throw AppError.validation('Choose an active branch from this organization.');
      }
      if (input.academicYearId) {
        const year = await tx.academicYear.findFirst({ where: { tenantId, id: input.academicYearId }, select: { id: true } });
        if (!year) throw AppError.validation('The selected academic year is not available in this institution.');
      }
      await this.validateTarget(tx, tenantId, input);
      const assignment = await tx.feeAssignment.create({
        data: {
          tenantId, branchId: input.branchId, feeStructureId: structure.id, feeStructureVersionId: version.id,
          targetType: input.targetType, targetId: input.targetId ?? null,
          targetStudentIds: input.targetStudentIds ?? [], academicYearId: input.academicYearId ?? structure.academicYearId,
          dueDateOverride: input.dueDateOverride ? dateValue(input.dueDateOverride) : null,
          installmentRule: jsonValue(input.installmentRule), status: 'DRAFT', createdBy: actorId ?? null,
        },
      });
      await this.audit.record(tx, { tenantId, actorId, action: 'FEE_ASSIGNMENT_CREATED', entityType: 'FeeAssignment', entityId: assignment.id, after: { structureId: structure.id, versionId: version.id, targetType: input.targetType, targetId: input.targetId ?? null } });
      return assignment;
    });
  }

  async update(tenantId: string, id: string, input: UpdateFeeAssignmentInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const current = await tx.feeAssignment.findFirst({ where: { tenantId, id } });
      if (!current) throw AppError.notFound('Fee assignment');
      if (current.status !== 'DRAFT') throw AppError.conflict('FEE_ASSIGNMENT_IMMUTABLE', 'Only a draft assignment can be edited.');
      if (input.branchId && input.branchId !== current.branchId) {
        const branch = await tx.branch.findFirst({ where: { tenantId, id: input.branchId, status: 'ACTIVE' }, select: { id: true } });
        if (!branch) throw AppError.validation('Choose an active branch from this organization.');
      }
      const changed = await tx.feeAssignment.updateMany({ where: { tenantId, id, status: 'DRAFT', updatedAt: current.updatedAt }, data: { dueDateOverride: input.dueDateOverride ? dateValue(input.dueDateOverride) : null, ...(input.branchId ? { branchId: input.branchId } : {}), updatedBy: actorId } });
      if (changed.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'This assignment changed while you were editing it. Reload and try again.');
      const updated = await tx.feeAssignment.findFirst({ where: { tenantId, id } });
      if (!updated) throw AppError.notFound('Fee assignment');
      await this.audit.record(tx, { tenantId, actorId, action: 'FEE_ASSIGNMENT_UPDATED', entityType: 'FeeAssignment', entityId: id, before: { dueDateOverride: current.dueDateOverride?.toISOString().slice(0, 10) ?? null }, after: { dueDateOverride: updated.dueDateOverride?.toISOString().slice(0, 10) ?? null } });
      return updated;
    });
  }

  async generate(tenantId: string, assignmentId: string) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    const assignment = await this.prisma.db.feeAssignment.findFirst({ where: { tenantId, id: assignmentId } });
    if (!assignment) throw AppError.notFound('Fee assignment');
    if (assignment.status === 'ACTIVE' && assignment.generatedAt) return { assignmentId, ...asJsonObject(assignment.generationSummary), alreadyGenerated: true };
    if (assignment.status !== 'DRAFT') throw AppError.conflict('FEE_ASSIGNMENT_BUSY', 'This assignment is already being generated or requires administrative recovery.');

    const claimed = await this.prisma.db.feeAssignment.updateMany({ where: { tenantId, id: assignmentId, status: 'DRAFT' }, data: { status: 'PENDING_APPROVAL', needsAttention: false } });
    if (claimed.count !== 1) throw AppError.conflict('FEE_ASSIGNMENT_BUSY', 'This assignment is already being generated. Refresh to see its status.');

    const summary = { matchedStudents: 0, demandsCreated: 0, demandsSkipped: 0, studentsNeedingAttention: 0, failures: [] as Array<{ studentId: string; message: string }> };
    try {
      const [structure, version, structureItems, settings] = await Promise.all([
        this.prisma.db.feeStructure.findFirst({ where: { tenantId, id: assignment.feeStructureId, active: true, deletedAt: null } }),
        this.prisma.db.feeStructureVersion.findFirst({ where: { tenantId, id: assignment.feeStructureVersionId, feeStructureId: assignment.feeStructureId, status: 'ACTIVE' } }),
        this.prisma.db.feeStructureItem.findMany({ where: { tenantId, feeStructureVersionId: assignment.feeStructureVersionId, active: true }, orderBy: { sortOrder: 'asc' } }),
        this.prisma.db.tenantSettings.findUnique({ where: { tenantId } }),
      ]);
      const currency = requireTenantCurrency(settings);
      if (!structure || !version) throw AppError.conflict('FEE_STRUCTURE_NOT_ACTIVE', 'The assigned structure version is not currently available.');
      const today = new Date().toISOString().slice(0, 10);
      if (version.effectiveFrom.toISOString().slice(0, 10) > today || (version.effectiveTo && version.effectiveTo.toISOString().slice(0, 10) < today)) {
        throw AppError.conflict('FEE_STRUCTURE_NOT_EFFECTIVE', 'The assigned fee structure version is not effective today.');
      }
      if (structureItems.length === 0) throw AppError.validation('The published structure has no active fee items.');
      const candidateStudents = await this.resolveStudents(tenantId, assignment);
      summary.matchedStudents = candidateStudents.length;
      if (candidateStudents.length > 5000) throw AppError.validation('This synchronous generation batch is too large. Narrow the assignment scope before retrying.');
      const feeTypeIds = [...new Set(structureItems.map((item) => item.feeTypeId))];
      const feeTypes = await this.prisma.db.feeType.findMany({ where: { tenantId, id: { in: feeTypeIds }, active: true, deletedAt: null } });
      const categoryIds = [...new Set(feeTypes.map((type) => type.categoryId))];
      const categories = categoryIds.length ? await this.prisma.db.feeCategory.findMany({ where: { tenantId, id: { in: categoryIds }, active: true } }) : [];
      const categoryCodeById = new Map(categories.map((category) => [category.id, category.code]));
      const feeTypeById = new Map(feeTypes.map((type) => [type.id, type]));
      const versionIds = [...new Set(structureItems.map((item) => item.feeTypeVersionId).filter((id): id is string => Boolean(id)))];
      const feeTypeVersions = versionIds.length ? await this.prisma.db.feeTypeVersion.findMany({ where: { tenantId, id: { in: versionIds }, status: 'ACTIVE' } }) : [];
      const feeVersionById = new Map(feeTypeVersions.map((row) => [row.id, row]));
      const academicYearId = assignment.academicYearId ?? structure.academicYearId;
      const academicYear = academicYearId ? await this.prisma.db.academicYear.findFirst({ where: { tenantId, id: academicYearId } }) : null;
      if (academicYearId && !academicYear) throw AppError.validation('The assignment academic year is not available in this institution.');
      const rules = await this.policies.loadActiveRules(this.prisma.db as unknown as TransactionClient, tenantId, today);
      const benefitRulesByStudent = await this.benefits.loadRulesForCandidates(
        this.prisma.db as unknown as TransactionClient,
        tenantId,
        candidateStudents.map((candidate) => ({ studentId: candidate.student.id, groupIds: candidate.context.studentGroupIds ?? [] })),
        academicYearId ?? null,
        today,
      );
      const rawPayerResponsibilityRules = await this.prisma.db.payerResponsibilityRule.findMany({
        where: {
          tenantId, active: true, deletedAt: null, effectiveFrom: { lte: dateValue(today) },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: dateValue(today) } }],
        },
        orderBy: [{ priority: 'asc' }, { id: 'asc' }],
      });
      const payerSponsorIds = [...new Set(rawPayerResponsibilityRules.map((rule) => rule.payerSponsorId).filter((id): id is string => Boolean(id)))];
      const payerGuardianIds = [...new Set(rawPayerResponsibilityRules.map((rule) => rule.payerGuardianId).filter((id): id is string => Boolean(id)))];
      const candidateStudentIds = candidateStudents.map((candidate) => candidate.student.id);
      const [payerSponsors, activePayerGuardians, candidateGuardianLinks] = await Promise.all([
        payerSponsorIds.length ? this.prisma.db.sponsor.findMany({ where: { tenantId, id: { in: payerSponsorIds } }, select: { id: true, name: true, active: true, deletedAt: true } }) : Promise.resolve([]),
        payerGuardianIds.length ? this.prisma.db.guardian.findMany({ where: { tenantId, id: { in: payerGuardianIds }, deletedAt: null }, select: { id: true, firstName: true, lastName: true } }) : Promise.resolve([]),
        candidateStudentIds.length ? this.prisma.db.studentGuardian.findMany({ where: { tenantId, studentId: { in: candidateStudentIds } }, select: { studentId: true, guardianId: true } }) : Promise.resolve([]),
      ]);
      const sponsorById = new Map(payerSponsors.map((sponsor) => [sponsor.id, sponsor]));
      const activeGuardianIdSet = new Set(activePayerGuardians.map((guardian) => guardian.id));
      const guardianNameById = new Map(activePayerGuardians.map((guardian) => [guardian.id, `${guardian.firstName} ${guardian.lastName ?? ''}`.trim()]));
      const guardianIdsByStudent = new Map<string, string[]>();
      for (const link of candidateGuardianLinks) {
        if (activeGuardianIdSet.has(link.guardianId)) guardianIdsByStudent.set(link.studentId, [...(guardianIdsByStudent.get(link.studentId) ?? []), link.guardianId]);
      }
      const payerResponsibilityRules = rawPayerResponsibilityRules.map((rule) => ({
        ...rule,
        payerName: rule.payerGuardianId ? guardianNameById.get(rule.payerGuardianId) ?? rule.payerName : rule.payerName,
        sponsor: rule.payerSponsorId ? sponsorById.get(rule.payerSponsorId) ?? null : null,
      }));
      const dueOverride = assignment.dueDateOverride?.toISOString().slice(0, 10);
      const runStats = { rulesApplied: 0, totalNetAmount: '0.0000' };
      for (const candidate of candidateStudents) {
        const existing = await this.prisma.db.feeDemand.findFirst({ where: { tenantId, feeAssignmentId: assignment.id, studentId: candidate.student.id, financialPeriod: academicYear?.name ?? today } });
        if (existing) { summary.demandsSkipped += 1; continue; }
        try {
          const calculationItems: FeeCalculationItemInput[] = structureItems.map((item, index) => {
            const feeType = feeTypeById.get(item.feeTypeId);
            const feeVersion = item.feeTypeVersionId ? feeVersionById.get(item.feeTypeVersionId) : undefined;
            if (!feeType || !feeVersion) throw AppError.validation(`Fee item ${item.id} does not have an active fee type version.`);
            const baseCalculation = calculateBaseAmount({
              method: feeVersion.calculationMethod,
              amount: item.amount.toString(),
              quantity: item.quantity?.toString() ?? null,
              percentBase: item.percentBase?.toString() ?? null,
              config: feeVersion.calculationConfig,
              context: {
                ...candidate.context,
                fee: {
                  ...candidate.context.fee,
                  type: feeType.code,
                  category: categoryCodeById.get(feeType.categoryId),
                  frequency: item.frequency as FeeFrequency,
                  optionality: item.optionality as FeeOptionality,
                  amount: item.amount.toString(),
                  quantity: item.quantity?.toString() ?? undefined,
                  percentBase: item.percentBase?.toString() ?? undefined,
                },
              },
              currency,
            });
            return {
              key: item.id,
              feeTypeId: item.feeTypeId,
              feeTypeCode: feeType.code,
              feeTypeName: feeType.name,
              feeCategoryCode: categoryCodeById.get(feeType.categoryId),
              feeTypeVersionId: feeVersion.id,
              sequence: index,
              frequency: item.frequency as FeeFrequency,
              optionality: item.optionality as FeeOptionality,
              baseAmount: baseCalculation.amount,
              baseCalculation,
              quantity: item.quantity?.toString() ?? undefined,
              rate: feeVersion.calculationMethod === 'PERCENTAGE' ? item.amount.toString() : undefined,
              taxable: item.taxable,
              taxPercent: (item.taxPercent ?? feeVersion.taxPercent)?.toString(),
              dueDate: dueOverride ?? item.dueDate?.toISOString().slice(0, 10),
            };
          });
          const result = calculateFees({
            currency,
            roundingMode: settings?.roundingMode ?? 'HALF_UP',
            asOfDate: today,
            context: { ...candidate.context, academicYear: academicYear ? { id: academicYear.id, name: academicYear.name, startDate: academicYear.startDate.toISOString().slice(0, 10), endDate: academicYear.endDate.toISOString().slice(0, 10) } : undefined },
            items: calculationItems,
            rules: [...rules, ...(benefitRulesByStudent.get(candidate.student.id) ?? [])],
            allowNegativeTotal: settings?.allowNegativeDemand ?? false,
          });
          if (result.status === 'FAILED') throw AppError.unprocessable('FEE_CALCULATION_FAILED', `Fee calculation failed for ${candidate.student.admissionNumber}.`);
          const dueDates = result.items.map((item) => item.dueDate).filter((value): value is string => Boolean(value));
          if (dueDates.length !== result.items.length) throw AppError.validation(`A due date is required for every fee item before generating a demand for ${candidate.student.admissionNumber}.`);
          const dueDate = dueDates.sort()[0]!;
          const demandId = await this.prisma.transactionWithRetry(async (tx) => {
            const duplicate = await tx.feeDemand.findFirst({ where: { tenantId, feeAssignmentId: assignment.id, studentId: candidate.student.id, financialPeriod: academicYear?.name ?? today }, select: { id: true } });
            if (duplicate) return null;
            const demandNumber = await this.sequences.allocate(tx, { tenantId, kind: 'DEMAND', asOfDate: today });
            const id = randomUUID();
            const totals = result.totals;
            await tx.feeDemand.create({
              data: {
                id, tenantId, branchId: candidate.student.branchId, studentId: candidate.student.id, demandNumber, feeAssignmentId: assignment.id,
                academicYearId: academicYearId ?? null, financialPeriod: academicYear?.name ?? today,
                currency, issueDate: dateValue(today), dueDate: dateValue(dueDate),
                baseAmount: totals.baseAmount, surchargeAmount: totals.surchargeAmount, scholarshipAmount: totals.scholarshipAmount,
                discountAmount: totals.discountAmount, concessionAmount: totals.concessionAmount, waiverAmount: totals.waiverAmount,
                overrideAmount: totals.overrideAmount, lateFeeAmount: totals.lateFeeAmount, taxAmount: totals.taxAmount,
                netAmount: totals.netAmount, status: 'DRAFT', calculation: result as unknown as Prisma.InputJsonValue,
                calculationVersion: result.calculationVersion, createdBy: actorId ?? null,
              },
            });
            const demandItemsForInstallments: Array<{ id: string; feeTypeId: string; netAmount: string }> = [];
            for (const [index, itemResult] of result.items.entries()) {
              const source = structureItems.find((item) => item.id === itemResult.key);
              const feeType = source ? feeTypeById.get(source.feeTypeId) : undefined;
              if (!source || !feeType) throw AppError.validation('The fee structure changed while the demand was being generated.');
              const demandItemId = randomUUID();
              await tx.feeDemandItem.create({
                data: {
                  id: demandItemId, tenantId, demandId: id, feeTypeId: source.feeTypeId, feeTypeCode: itemResult.feeTypeCode,
                  feeTypeName: itemResult.feeTypeName, feeCategoryCode: itemResult.feeCategoryCode ?? null, feeTypeVersionId: itemResult.feeTypeVersionId ?? null,
                  sequence: index, frequency: itemResult.frequency, optionality: itemResult.optionality,
                  baseAmount: itemResult.baseAmount, quantity: itemResult.quantity ?? null, rate: itemResult.rate ?? null,
                  surchargeAmount: itemResult.surchargeAmount, scholarshipAmount: itemResult.scholarshipAmount, discountAmount: itemResult.discountAmount,
                  concessionAmount: itemResult.concessionAmount, waiverAmount: itemResult.waiverAmount, overrideAmount: itemResult.overrideAmount,
                  lateFeeAmount: itemResult.lateFeeAmount, taxAmount: itemResult.taxAmount, netAmount: itemResult.netAmount,
                  dueDate: itemResult.dueDate ? dateValue(itemResult.dueDate) : null, calculation: itemResult as unknown as Prisma.InputJsonValue,
                },
              });
              const responsibilities = calculatePayerResponsibilities({
                itemAmount: itemResult.netAmount,
                currency,
                studentId: candidate.student.id,
                studentName: `${candidate.student.firstName} ${candidate.student.lastName ?? ''}`.trim(),
                studentGroupIds: candidate.context.studentGroupIds ?? [],
                studentGuardianIds: guardianIdsByStudent.get(candidate.student.id) ?? [],
                academicYearId: academicYearId ?? null,
                feeTypeId: source.feeTypeId,
                rules: payerResponsibilityRules,
              });
              for (const responsibility of responsibilities) {
                await tx.feeDemandResponsibility.create({ data: {
                  id: randomUUID(), tenantId, demandId: id, demandItemId, payerType: responsibility.payerType,
                  payerName: responsibility.payerName, payerSponsorId: responsibility.payerSponsorId,
                  payerGuardianId: responsibility.payerGuardianId,
                  sourceRuleId: responsibility.sourceRuleId, priority: responsibility.priority, amount: responsibility.amount,
                } });
              }
              demandItemsForInstallments.push({ id: demandItemId, feeTypeId: source.feeTypeId, netAmount: itemResult.netAmount });
              for (const line of itemResult.lines) {
                await tx.feeDemandItemAdjustment.create({
                  data: {
                    tenantId, demandItemId, direction: line.direction, code: line.code, label: line.label, stage: line.stage, sequence: line.sequence,
                    amount: line.amount, percent: line.percent ?? null, basisAmount: line.basisAmount ?? null, runningTotalAfter: line.runningTotalAfter ?? null,
                    policyId: line.policyId ?? null, policyVersionId: line.policyVersionId ?? null, policyName: line.policyName ?? null,
                    policyType: line.policyType ?? null, stackingMode: line.stackingMode ?? null, instrumentType: line.instrumentType ?? null,
                    instrumentId: line.instrumentId ?? null, reason: line.reason ?? null, approvedBy: line.approvedBy ?? null,
                    approvedAt: line.approvedAt ? new Date(line.approvedAt) : null,
                    effectiveFrom: line.effectiveFrom ? dateValue(line.effectiveFrom) : null, effectiveTo: line.effectiveTo ? dateValue(line.effectiveTo) : null,
                    cappedBy: line.cappedBy ?? null, notes: line.notes ?? null,
                  },
                });
              }
            }
            await this.createInstallments(tx, { tenantId, demandId: id, rule: assignment.installmentRule, demandAmount: totals.netAmount, currency, items: demandItemsForInstallments });
            await this.audit.record(tx, { tenantId, actorId, action: 'FEE_DEMAND_GENERATED', entityType: 'FeeDemand', entityId: id, after: { demandNumber, studentId: candidate.student.id, netAmount: totals.netAmount, calculationVersion: result.calculationVersion, needsAttention: result.status === 'NEEDS_ATTENTION' } });
            await this.outbox.publish(tx, { tenantId, eventType: 'FEE_DEMAND_GENERATED', aggregateType: 'FeeDemand', aggregateId: id, payload: { demandId: id, studentId: candidate.student.id, demandNumber, needsAttention: result.status === 'NEEDS_ATTENTION' }, actorId, requestId: this.tenantContext.requestId });
            return id;
          });
          if (demandId) {
            summary.demandsCreated += 1;
            if (result.status === 'NEEDS_ATTENTION') summary.studentsNeedingAttention += 1;
            runStats.rulesApplied += result.appliedRuleIds.length;
            runStats.totalNetAmount = Money.fromString(runStats.totalNetAmount).add(Money.fromString(result.totals.netAmount)).toString();
          } else summary.demandsSkipped += 1;
        } catch (error) {
          summary.studentsNeedingAttention += 1;
          summary.failures.push({
            studentId: candidate.student.id,
            message: error instanceof AppError || error instanceof FeeBaseCalculationError
              ? error.message
              : 'Demand calculation failed for this student.',
          });
        }
      }
      const finalSummary = { ...summary, rulesApplied: runStats.rulesApplied, totalNetAmount: runStats.totalNetAmount, calculationVersion: CALCULATION_VERSION };
      await this.prisma.transactionWithRetry(async (tx) => {
        const failed = summary.failures.length > 0;
        const changed = await tx.feeAssignment.updateMany({ where: { tenantId, id: assignmentId, status: 'PENDING_APPROVAL' }, data: { status: failed ? 'DRAFT' : 'ACTIVE', generatedAt: failed ? null : new Date(), generationSummary: finalSummary as Prisma.InputJsonValue, needsAttention: failed || summary.studentsNeedingAttention > 0, ...(failed ? {} : { approvedBy: actorId ?? null, approvedAt: new Date() }) } });
        if (changed.count !== 1) throw AppError.conflict('FEE_ASSIGNMENT_BUSY', 'The generation state changed before completion.');
        await this.audit.record(tx, { tenantId, actorId, action: 'FEE_ASSIGNMENT_GENERATION_COMPLETED', entityType: 'FeeAssignment', entityId: assignmentId, after: finalSummary });
      });
      return { assignmentId, ...finalSummary };
    } catch (error) {
      await this.prisma.db.feeAssignment.updateMany({ where: { tenantId, id: assignmentId, status: 'PENDING_APPROVAL' }, data: { status: 'DRAFT', needsAttention: true, generationSummary: summary as Prisma.InputJsonValue } });
      throw error;
    }
  }

  private async createInstallments(
    tx: TransactionClient,
    input: { tenantId: string; demandId: string; rule: Prisma.JsonValue | null; demandAmount: string; currency: string; items: Array<{ id: string; feeTypeId: string; netAmount: string }> },
  ): Promise<void> {
    if (!input.rule) return;
    const parsed = installmentRuleSchema.safeParse(input.rule);
    if (!parsed.success) throw AppError.validation('The saved installment schedule is invalid. Update the assignment before generating demands.');
    const rule: InstallmentRuleInput = parsed.data;
    const demandAmount = Money.fromString(input.demandAmount, input.currency);
    if (!demandAmount.isPositive || input.items.length === 0) throw AppError.validation('Installment schedules require a positive demand with at least one fee item.');
    const itemAmounts = input.items.map((item) => Money.fromString(item.netAmount, input.currency));
    if (itemAmounts.some((amount) => amount.isNegative)) throw AppError.validation('Installment schedules cannot split a negative fee item.');
    if (!Money.sum(itemAmounts, input.currency).equals(demandAmount)) throw AppError.validation('The fee item snapshots do not add up to the demand total.');
    const splits = rule.installments.map(() => input.items.map(() => Money.zero(input.currency)));

    if (rule.basis === 'FIXED_AMOUNT') {
      const installmentAmounts = rule.installments.map((row) => Money.fromString(row.amount, input.currency));
      const configuredTotal = installmentAmounts.reduce((sum, amount) => sum.add(amount), Money.zero(input.currency));
      if (!configuredTotal.equals(demandAmount)) throw AppError.validation(`Fixed installment amounts must total ${demandAmount.toString()}.`);
      for (const [index, installmentAmount] of installmentAmounts.entries()) {
        const itemShares = allocateByWeights(installmentAmount, itemAmounts);
        itemShares.forEach((amount, itemIndex) => { splits[index]![itemIndex] = amount; });
      }
    } else {
      const ratios = rule.installments.map((row) => Rate.fromPercent(row.percentage));
      itemAmounts.forEach((itemAmount, itemIndex) => {
        const installmentShares = itemAmount.allocate(ratios);
        installmentShares.forEach((amount, installmentIndex) => { splits[installmentIndex]![itemIndex] = amount; });
      });
    }

    for (const [index, row] of rule.installments.entries()) {
      const itemAmountsForInstallment = splits[index]!;
      const amount = itemAmountsForInstallment.reduce((sum, value) => sum.add(value), Money.zero(input.currency));
      const installment = await tx.installment.create({
        data: { tenantId: input.tenantId, demandId: input.demandId, label: row.label, basis: rule.basis, sequence: index + 1, dueDate: dateValue(row.dueDate), amount: amount.toString(), status: 'PENDING' },
      });
      const rows = input.items.flatMap((item, itemIndex) => {
        const itemAmount = itemAmountsForInstallment[itemIndex]!;
        return itemAmount.isPositive ? [{ tenantId: input.tenantId, installmentId: installment.id, feeTypeId: item.feeTypeId, demandItemId: item.id, amount: itemAmount.toString(), paidAmount: '0.0000' }] : [];
      });
      if (rows.length) await tx.installmentItem.createMany({ data: rows });
    }
  }

  private async resolveStudents(tenantId: string, assignment: { targetType: string; targetId: string | null; targetStudentIds: string[]; academicYearId: string | null; branchId: string | null }): Promise<DemandCandidate[]> {
    const branchFilter: Prisma.StudentWhereInput = assignment.branchId ? { branchId: assignment.branchId } : {};
    let ids: string[] = [];
    let dynamicGroupId: string | undefined;
    let dynamicGroupCondition: ConditionNode | undefined;
    if (assignment.targetType === 'STUDENT') ids = assignment.targetStudentIds;
    else if (assignment.targetType === 'CUSTOM_GROUP') {
      const group = await this.prisma.db.studentGroup.findFirst({ where: { tenantId, id: assignment.targetId!, active: true, deletedAt: null } });
      if (!group) throw AppError.validation('The selected student group is not available.');
      if (group.isDynamic) {
        const parsed = groupMembershipRuleSchema.safeParse(group.membershipRule);
        if (!parsed.success) throw AppError.conflict('STUDENT_GROUP_RULE_INVALID', 'The selected dynamic group has invalid membership criteria. Update its rules before generating demands.');
        dynamicGroupId = group.id;
        dynamicGroupCondition = {
          kind: 'group',
          op: parsed.data.op,
          children: parsed.data.conditions.map((condition) => ({
            kind: 'condition', field: condition.field, operator: condition.operator,
            ...(condition.value !== undefined ? { value: condition.value } : {}),
            ...(condition.valueType ? { valueType: condition.valueType } : {}),
            ...(condition.negate !== undefined ? { negate: condition.negate } : {}),
          })),
        };
        const students = await this.prisma.db.student.findMany({ where: { tenantId, status: 'ACTIVE', deletedAt: null, ...branchFilter }, select: { id: true } });
        ids = students.map((student) => student.id);
      } else {
        const links = await this.prisma.db.studentGroupMember.findMany({ where: { tenantId, groupId: group.id }, select: { studentId: true } });
        ids = links.map((row) => row.studentId);
      }
    } else if (assignment.targetType === 'TRANSPORT_ROUTE') {
      const students = await this.prisma.db.student.findMany({ where: { tenantId, status: 'ACTIVE', deletedAt: null, ...branchFilter, ...(assignment.targetId ? { transportRouteId: assignment.targetId } : { transportStatus: true }) }, select: { id: true } });
      ids = students.map((row) => row.id);
    } else if (assignment.targetType === 'HOSTEL' && !assignment.targetId) {
      const students = await this.prisma.db.student.findMany({ where: { tenantId, status: 'ACTIVE', deletedAt: null, ...branchFilter, hostelStatus: true }, select: { id: true } });
      ids = students.map((row) => row.id);
    } else {
      const unitIds = assignment.targetId ? await this.unitDescendants(tenantId, assignment.targetId) : [];
      if (assignment.targetId && unitIds.length === 0) throw AppError.validation('The target academic unit is not available.');
      const membershipWhere: Prisma.StudentUnitMembershipWhereInput = { tenantId, ...(assignment.academicYearId ? { academicYearId: assignment.academicYearId } : {}), ...(unitIds.length ? { academicUnitId: { in: unitIds } } : {}) };
      const memberships = await this.prisma.db.studentUnitMembership.findMany({ where: membershipWhere, select: { studentId: true } });
      const unitFilter = unitIds.length ? { OR: [{ primaryUnitId: { in: unitIds } }, { id: { in: memberships.map((row) => row.studentId) } }] } : {};
      const students = await this.prisma.db.student.findMany({ where: { tenantId, status: 'ACTIVE', deletedAt: null, ...branchFilter, ...unitFilter }, select: { id: true } });
      ids = students.map((row) => row.id);
    }
    ids = [...new Set(ids)];
    if (!ids.length) return [];
    const yearMemberships = assignment.academicYearId
      ? await this.prisma.db.studentUnitMembership.findMany({ where: { tenantId, studentId: { in: ids }, academicYearId: assignment.academicYearId }, select: { studentId: true } })
      : [];
    const yearMemberIds = [...new Set(yearMemberships.map((row) => row.studentId))];
    const yearStudentFilter: Prisma.StudentWhereInput = assignment.academicYearId ? { OR: [{ academicYearId: assignment.academicYearId }, { id: { in: yearMemberIds } }] } : {};
    const students = await this.prisma.db.student.findMany({ where: { tenantId, id: { in: ids }, status: 'ACTIVE', deletedAt: null, ...branchFilter, ...yearStudentFilter } });
    const studentIds = students.map((student) => student.id);
    const [memberships, groupLinks, attributes, units] = await Promise.all([
      this.prisma.db.studentUnitMembership.findMany({ where: { tenantId, studentId: { in: studentIds }, ...(assignment.academicYearId ? { academicYearId: assignment.academicYearId } : {}) } }),
      this.prisma.db.studentGroupMember.findMany({ where: { tenantId, studentId: { in: studentIds } } }),
      this.prisma.db.studentCustomAttribute.findMany({ where: { tenantId, studentId: { in: studentIds } } }),
      this.prisma.db.academicUnit.findMany({ where: { tenantId, deletedAt: null }, select: { id: true, parentId: true, unitType: true, name: true, code: true } }),
    ]);
    const unitById = new Map(units.map((unit) => [unit.id, unit]));
    const unitsByStudent = groupBy(memberships, (row) => row.studentId);
    const groupsByStudent = groupBy(groupLinks, (row) => row.studentId);
    const customByStudent = groupBy(attributes, (row) => row.studentId);
    const candidates = students.map((student) => {
      const memberUnits = unitsByStudent.get(student.id) ?? [];
      const primary = memberUnits.find((row) => row.isPrimary)?.academicUnitId ?? student.primaryUnitId;
      const unitPath: string[] = [];
      const unitChain: Array<{ id: string; parentId: string | null; unitType: string; name: string; code: string }> = [];
      let cursor = primary ? unitById.get(primary) : undefined;
      const seen = new Set<string>();
      while (cursor && !seen.has(cursor.id) && unitPath.length < 128) {
        seen.add(cursor.id); unitPath.push(cursor.id); unitChain.push(cursor); cursor = cursor.parentId ? unitById.get(cursor.parentId) : undefined;
      }
      const factUnit = (unitType: string) => unitChain.find((unit) => unit.unitType === unitType);
      const customAttributes: Record<string, string | number | boolean | null> = {};
      for (const attribute of customByStudent.get(student.id) ?? []) customAttributes[attribute.key] = attribute.value;
      return {
        student,
        context: {
          student: {
            id: student.id, admissionNumber: student.admissionNumber,
            class: factUnit('CLASS')?.code,
            section: factUnit('SECTION')?.code,
            batch: factUnit('BATCH')?.code,
            course: factUnit('COURSE')?.code ?? factUnit('PROGRAM')?.code,
            department: factUnit('DEPARTMENT')?.code,
            category: student.category ?? undefined, gender: student.gender ?? undefined,
            hostelStatus: student.hostelStatus, transportStatus: student.transportStatus,
            transportRoute: student.transportRouteId ?? undefined, scholarshipCategory: student.scholarshipCategory ?? undefined,
            admissionType: student.admissionType ?? undefined, academicScore: student.academicScore?.toString(), familyGroup: student.familyGroupId ?? undefined,
            isInternational: student.isInternational, status: student.status, customAttributes,
          },
          evaluationDate: new Date().toISOString().slice(0, 10), scopeUnits: unitPath,
          studentGroupIds: (groupsByStudent.get(student.id) ?? []).map((row) => row.groupId),
        },
      };
    });
    if (!dynamicGroupCondition || !dynamicGroupId) return candidates;
    return candidates.filter((candidate) => evaluateConditions(dynamicGroupCondition, candidate.context).matched).map((candidate) => ({
      ...candidate,
      context: { ...candidate.context, studentGroupIds: [...new Set([...(candidate.context.studentGroupIds ?? []), dynamicGroupId])] },
    }));
  }

  private async unitDescendants(tenantId: string, rootId: string): Promise<string[]> {
    const units = await this.prisma.db.academicUnit.findMany({ where: { tenantId, active: true, deletedAt: null }, select: { id: true, parentId: true } });
    const children = new Map<string, string[]>();
    for (const unit of units) if (unit.parentId) children.set(unit.parentId, [...(children.get(unit.parentId) ?? []), unit.id]);
    if (!units.some((unit) => unit.id === rootId)) return [];
    const found: string[] = [];
    const pending = [rootId];
    while (pending.length && found.length < 5000) {
      const next = pending.pop()!;
      if (found.includes(next)) continue;
      found.push(next); pending.push(...(children.get(next) ?? []));
    }
    return found;
  }

  private async validateTarget(tx: TransactionClient, tenantId: string, input: CreateFeeAssignmentInput): Promise<void> {
    if (input.targetType === 'STUDENT') {
      const found = await tx.student.findMany({ where: { tenantId, branchId: input.branchId, id: { in: input.targetStudentIds ?? [] }, status: 'ACTIVE', deletedAt: null }, select: { id: true } });
      const targetStudentIds = input.targetStudentIds ?? [];
      if (found.length !== new Set(targetStudentIds).size) throw AppError.validation('Every selected student must be active and belong to this institution.');
    } else if (input.targetType === 'CUSTOM_GROUP') {
      const group = await tx.studentGroup.findFirst({ where: { tenantId, id: input.targetId!, active: true, deletedAt: null }, select: { id: true, isDynamic: true, membershipRule: true } });
      if (!group) throw AppError.validation('The selected student group is not available.');
      if (group.isDynamic && !groupMembershipRuleSchema.safeParse(group.membershipRule).success) throw AppError.validation('The selected dynamic group needs valid membership criteria.');
    } else if (input.targetId && ['HOSTEL', 'TRANSPORT_ROUTE'].includes(input.targetType)) {
      const unit = await tx.academicUnit.findFirst({ where: { tenantId, id: input.targetId, active: true, deletedAt: null }, select: { id: true, unitType: true } });
      if (!unit || unit.unitType !== input.targetType) throw AppError.validation('Select a matching academic unit for this assignment target.');
    } else if (input.targetId) {
      const unit = await tx.academicUnit.findFirst({ where: { tenantId, id: input.targetId, active: true, deletedAt: null }, select: { id: true, unitType: true } });
      if (!unit || unit.unitType !== input.targetType) throw AppError.validation('Select an academic unit matching this assignment target.');
    }
  }

  private assertTenant(tenantId: string): void {
    if (this.tenantContext.requireTenantId() !== tenantId) throw AppError.forbidden('The requested tenant does not match the authenticated session.');
  }
}

@Injectable()
export class FeeDemandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async list(tenantId: string, raw: Record<string, unknown>) {
    this.assertTenant(tenantId);
    const studentId = typeof raw.studentId === 'string' && raw.studentId.trim() ? raw.studentId.trim() : undefined;
    if (studentId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(studentId)) throw AppError.validation('The student ID must be a valid identifier.');
    const query = parseListQuery(raw, { allowedSortFields: ['demandNumber', 'status', 'dueDate', 'issueDate', 'netAmount', 'paidAmount'] });
    const where: Prisma.FeeDemandWhereInput = {
      tenantId,
      ...(studentId ? { studentId } : {}),
      ...(query.status?.length ? { status: { in: query.status as DemandStatus[] } } : {}),
      ...(query.from || query.to ? { dueDate: { ...(query.from ? { gte: dateValue(query.from) } : {}), ...(query.to ? { lte: dateValue(query.to) } : {}) } } : {}),
      ...buildSearchFilter(query.search, ['demandNumber', 'financialPeriod']),
    };
    const [items, total] = await Promise.all([
      this.prisma.db.feeDemand.findMany({ where, orderBy: toPrismaOrderBy(query.sort) as Prisma.FeeDemandOrderByWithRelationInput[], skip: query.skip, take: query.take }),
      this.prisma.db.feeDemand.count({ where }),
    ]);
    return paginate(items, total, query);
  }

  async get(tenantId: string, id: string) {
    this.assertTenant(tenantId);
    const demand = await this.prisma.db.feeDemand.findFirst({ where: { tenantId, id } });
    if (!demand) throw AppError.notFound('Fee demand');
    const items = await this.prisma.db.feeDemandItem.findMany({ where: { tenantId, demandId: id }, orderBy: { sequence: 'asc' } });
    const itemIds = items.map((item) => item.id);
    const adjustments = itemIds.length ? await this.prisma.db.feeDemandItemAdjustment.findMany({ where: { tenantId, demandItemId: { in: itemIds } }, orderBy: { sequence: 'asc' } }) : [];
    const byItem = groupBy(adjustments, (row) => row.demandItemId);
    const responsibilities = itemIds.length ? await this.prisma.db.feeDemandResponsibility.findMany({ where: { tenantId, demandItemId: { in: itemIds } }, orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] }) : [];
    const sponsorIds = [...new Set(responsibilities.map((row) => row.payerSponsorId).filter((value): value is string => Boolean(value)))];
    const sponsors = sponsorIds.length ? await this.prisma.db.sponsor.findMany({ where: { tenantId, id: { in: sponsorIds } }, select: { id: true, name: true, code: true } }) : [];
    const sponsorById = new Map(sponsors.map((sponsor) => [sponsor.id, sponsor]));
    const responsibilitiesByItem = groupBy(responsibilities.map((row) => ({ ...row, sponsor: row.payerSponsorId ? sponsorById.get(row.payerSponsorId) ?? null : null })), (row) => row.demandItemId);
    const operationalAdjustments = await this.prisma.db.adjustment.findMany({ where: { tenantId, demandId: id, status: { in: ['APPLIED', 'REVERSED'] } }, orderBy: { createdAt: 'asc' } });
    return { ...demand, items: items.map((item) => ({ ...item, adjustments: byItem.get(item.id) ?? [], responsibilities: responsibilitiesByItem.get(item.id) ?? [] })), operationalAdjustments };
  }

  async issue(tenantId: string, id: string) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const demand = await tx.feeDemand.findFirst({ where: { tenantId, id } });
      if (!demand) throw AppError.notFound('Fee demand');
      if (demand.status !== 'DRAFT') throw AppError.conflict('DEMAND_ALREADY_ISSUED', 'Only a draft demand can be issued.');
      const items = await tx.feeDemandItem.findMany({ where: { tenantId, demandId: id }, orderBy: { sequence: 'asc' } });
      if (!items.length) throw AppError.validation('A demand needs at least one item before it can be issued.');
      const net = Money.fromString(demand.netAmount.toString(), demand.currency);
      const lines: Array<{ accountKey: SystemLedgerAccountKey; side: 'DEBIT' | 'CREDIT'; amount: string; narration: string }> = [];
      const addLine = (accountKey: SystemLedgerAccountKey, side: 'DEBIT' | 'CREDIT', amount: string, narration: string) => {
        const value = Money.fromString(amount, demand.currency);
        if (value.isPositive) lines.push({ accountKey, side, amount: value.toString(), narration });
      };
      if (net.isPositive) addLine('STUDENT_RECEIVABLE', 'DEBIT', net.toString(), `Demand ${demand.demandNumber}`);
      addLine('FEE_INCOME', 'CREDIT', demand.baseAmount.toString(), `Fee base · ${demand.demandNumber}`);
      // The immutable adjustment snapshot is the source for every non-base
      // journal line. Do not also post aggregate demand tax/surcharge buckets:
      // those totals are already represented here and would be double-counted.
      const itemIds = items.map((item) => item.id);
      const adjustments = await tx.feeDemandItemAdjustment.findMany({
        where: { tenantId, demandItemId: { in: itemIds } },
        orderBy: [{ demandItemId: 'asc' }, { sequence: 'asc' }],
      });
      for (const adjustment of adjustments) {
        if (adjustment.direction === 'DEBIT') {
          const account: SystemLedgerAccountKey = adjustment.code === 'TAX'
            ? 'TAX_PAYABLE'
            : adjustment.stage === 'SURCHARGE'
              ? 'SURCHARGE_INCOME'
              : adjustment.stage === 'LATE_FEE' || adjustment.policyType === 'LATE_FEE'
                ? 'LATE_FEE_INCOME'
                : 'FEE_INCOME';
          addLine(account, 'CREDIT', adjustment.amount.toString(), adjustment.label);
        } else {
          const account: SystemLedgerAccountKey = adjustment.policyType === 'SCHOLARSHIP'
            ? 'SCHOLARSHIP_CONTRA'
            : adjustment.policyType === 'WAIVER' || adjustment.policyType === 'EXEMPTION'
              ? 'WAIVER_CONTRA'
              : 'DISCOUNT_CONTRA';
          addLine(account, 'DEBIT', adjustment.amount.toString(), adjustment.label);
        }
      }
      let resultingCreditId: string | null = null;
      if (net.isNegative) {
        resultingCreditId = randomUUID();
        const creditAmount = net.abs().toString();
        await tx.credit.create({ data: { id: resultingCreditId, tenantId, branchId: demand.branchId, studentId: demand.studentId, source: 'ADJUSTMENT', status: 'AVAILABLE', currency: demand.currency, originalAmount: creditAmount, allocatedAmount: '0.0000', availableAmount: creditAmount, sourceDemandId: demand.id, reason: `Net credit from demand ${demand.demandNumber}`, createdBy: actorId ?? null } });
        addLine('STUDENT_CREDIT', 'CREDIT', creditAmount, `Demand credit · ${demand.demandNumber}`);
      }
      const posted = await this.ledger.post(tx, {
        tenantId, currency: demand.currency, eventType: 'FEE_DEMAND_ISSUED', entryDate: demand.issueDate.toISOString().slice(0, 10), lines,
        studentId: demand.studentId, demandId: demand.id, creditId: resultingCreditId,
        narration: `Issue fee demand ${demand.demandNumber}`, createdBy: actorId ?? null,
      });
      const nextStatus = net.isNegative ? 'CREDITED' : 'ISSUED';
      const changed = await tx.feeDemand.updateMany({ where: { tenantId, id, status: 'DRAFT', updatedAt: demand.updatedAt }, data: { status: nextStatus, issuedAt: new Date(), creditedAmount: net.isNegative ? net.abs().toString() : demand.creditedAmount, updatedBy: actorId ?? null } });
      if (changed.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'This demand changed while it was being issued. Reload and try again.');
      const updated = await tx.feeDemand.findFirst({ where: { tenantId, id } });
      if (!updated) throw AppError.notFound('Fee demand');
      await this.audit.record(tx, { tenantId, actorId, action: 'FEE_DEMAND_ISSUED', entityType: 'FeeDemand', entityId: id, before: { status: demand.status }, after: { status: nextStatus, netAmount: demand.netAmount.toString(), ledgerGroupId: posted.transactionGroupId, creditId: resultingCreditId } });
      await this.outbox.publish(tx, { tenantId, eventType: 'FEE_DEMAND_ISSUED', aggregateType: 'FeeDemand', aggregateId: id, payload: { demandId: id, demandNumber: demand.demandNumber, status: nextStatus }, actorId, requestId: this.tenantContext.requestId });
      return updated;
    });
  }

  private assertTenant(tenantId: string): void {
    if (this.tenantContext.requireTenantId() !== tenantId) throw AppError.forbidden('The requested tenant does not match the authenticated session.');
  }
}

@ApiTags('fee assignments')
@RequireModules('FEES')
@Controller('fee-assignments')
export class FeeAssignmentsController {
  constructor(private readonly assignments: FeeAssignmentsService) {}
  @Get() @RequirePermissions(PERMISSIONS.FEE_ASSIGNMENT_READ) list(@CurrentTenant() tenant: string, @Query() query: Record<string, unknown>) { return this.assignments.list(tenant, query); }
  @Post() @RequirePermissions(PERMISSIONS.FEE_ASSIGNMENT_CREATE) @UsePipes(new ZodValidationPipe(createFeeAssignmentSchema)) create(@CurrentTenant() tenant: string, @Body() body: CreateFeeAssignmentInput) { return this.assignments.create(tenant, body); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.FEE_ASSIGNMENT_CREATE) @UsePipes(new ZodValidationPipe(updateFeeAssignmentSchema)) update(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: UpdateFeeAssignmentInput) { return this.assignments.update(tenant, id, body); }
  @Post(':id/generate') @RequirePermissions(PERMISSIONS.FEE_ASSIGNMENT_GENERATE) @ApiOperation({ summary: 'Calculate and snapshot a draft demand for each matching student' }) generate(@CurrentTenant() tenant: string, @Param('id') id: string) { return this.assignments.generate(tenant, id); }
}

@ApiTags('fee demands')
@RequireModules('FEES')
@Controller('fee-demands')
export class FeeDemandsController {
  constructor(private readonly demands: FeeDemandsService) {}
  @Get() @RequirePermissions(PERMISSIONS.FEE_DEMAND_READ) list(@CurrentTenant() tenant: string, @Query() query: Record<string, unknown>) { return this.demands.list(tenant, query); }
  @Get(':id') @RequirePermissions(PERMISSIONS.FEE_DEMAND_READ) get(@CurrentTenant() tenant: string, @Param('id') id: string) { return this.demands.get(tenant, id); }
  @Post(':id/issue') @RequirePermissions(PERMISSIONS.FEE_DEMAND_APPROVE) @ApiOperation({ summary: 'Issue a draft demand and post its balanced ledger entry' }) issue(@CurrentTenant() tenant: string, @Param('id') id: string) { return this.demands.issue(tenant, id); }
}

@Module({
  imports: [PrismaModule, TenantContextModule, FeePoliciesModule, BenefitsModule],
  controllers: [FeeAssignmentsController, FeeDemandsController],
  providers: [FeeAssignmentsService, FeeDemandsService],
  exports: [FeeAssignmentsService, FeeDemandsService],
})
export class AssignmentsModule {}

function dateValue(value: string): Date { return new Date(`${value}T00:00:00.000Z`); }
function allocateByWeights(total: Money, weights: Money[]): Money[] {
  if (weights.length === 0) return [];
  const totalWeight = weights.reduce((sum, weight) => sum + weight.units, 0n);
  if (totalWeight <= 0n) throw AppError.validation('A fixed installment needs positive fee item weights.');
  const shares = weights.map((weight) => ({ units: (total.units * weight.units) / totalWeight, remainder: (total.units * weight.units) % totalWeight }));
  const allocated = shares.reduce((sum, share) => sum + share.units, 0n);
  let leftover = total.units - allocated;
  const order = shares.map((share, index) => ({ index, remainder: share.remainder })).sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  for (let cursor = 0; leftover > 0n; cursor += 1) {
    const selected = order[cursor % order.length]!;
    shares[selected.index]!.units += 1n;
    leftover -= 1n;
  }
  return shares.map((share) => Money.fromUnits(share.units, total.currency));
}
function jsonValue(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) return undefined;
  return value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue;
}
function groupBy<T, K extends string>(items: T[], keyOf: (item: T) => K): Map<K, T[]> {
  const result = new Map<K, T[]>();
  for (const item of items) { const key = keyOf(item); result.set(key, [...(result.get(key) ?? []), item]); }
  return result;
}
function asJsonObject(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
