import { Body, Controller, Get, Injectable, Module, Param, Patch, Post, Query, UsePipes } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { Prisma, type ActionKind, type PolicyType, type StackingMode, type TransactionClient } from '@fee/database';
import { PERMISSIONS, type RuleDefinition } from '@fee/types';
import {
  benefitAssignmentDecisionSchema,
  createBenefitAssignmentSchema,
  createBenefitInstrumentSchema,
  createFeeOverrideSchema,
  feeOverrideDecisionSchema,
  updateBenefitInstrumentSchema,
  type BenefitAssignmentDecisionInput,
  type CreateBenefitAssignmentInput,
  type CreateBenefitInstrumentInput,
  type CreateFeeOverrideInput,
  type FeeOverrideDecisionInput,
  type UpdateBenefitInstrumentInput,
} from '@fee/validation';
import { AppError } from '../common/errors';
import { AuditService, OutboxService } from '../common/financial';
import { buildSearchFilter, paginate, parseListQuery, ZodValidationPipe } from '../common/http';
import { PrismaModule, PrismaService } from '../common/prisma.service';
import { CurrentTenant, RequireModules, RequirePermissions, TenantContextModule, TenantContextService } from '../common/tenancy';

type BenefitKind = 'SCHOLARSHIP' | 'DISCOUNT' | 'CONCESSION' | 'WAIVER' | 'SURCHARGE';
type AssignableBenefitKind = Exclude<BenefitKind, 'SURCHARGE'>;
type BenefitAssignmentInstruments = {
  scholarship: Prisma.ScholarshipGetPayload<{}> | null;
  discount: Prisma.DiscountGetPayload<{}> | null;
  concession: Prisma.ConcessionGetPayload<{}> | null;
  waiver: Prisma.WaiverGetPayload<{}> | null;
};

@Injectable()
export class BenefitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async listInstruments(tenantId: string, raw: Record<string, unknown>) {
    this.assertTenant(tenantId);
    const query = parseListQuery(raw, { allowedSortFields: ['name', 'code', 'active', 'createdAt'] });
    const active = query.status?.length ? query.status.includes('active') : undefined;
    const where = { tenantId, deletedAt: null, ...(active === undefined ? {} : { active }) };
    const [scholarships, discounts, concessions, waivers, surcharges] = await Promise.all([
      this.prisma.db.scholarship.findMany({ where, orderBy: { name: 'asc' }, take: 500 }),
      this.prisma.db.discount.findMany({ where, orderBy: { name: 'asc' }, take: 500 }),
      this.prisma.db.concession.findMany({ where, orderBy: { name: 'asc' }, take: 500 }),
      this.prisma.db.waiver.findMany({ where, orderBy: { name: 'asc' }, take: 500 }),
      this.prisma.db.surcharge.findMany({ where, orderBy: { name: 'asc' }, take: 500 }),
    ]);
    const type = typeof raw.instrumentType === 'string' ? raw.instrumentType.toUpperCase() : undefined;
    if (type && !['SCHOLARSHIP', 'DISCOUNT', 'CONCESSION', 'WAIVER', 'SURCHARGE'].includes(type)) throw AppError.validation('Choose a supported benefit instrument type.');
    const items = [
      ...scholarships.map((item) => ({ ...item, instrumentType: 'SCHOLARSHIP' as const })),
      ...discounts.map((item) => ({ ...item, instrumentType: 'DISCOUNT' as const })),
      ...concessions.map((item) => ({ ...item, instrumentType: 'CONCESSION' as const })),
      ...waivers.map((item) => ({ ...item, instrumentType: 'WAIVER' as const })),
      ...surcharges.map((item) => ({ ...item, instrumentType: 'SURCHARGE' as const })),
    ].filter((item) => (!type || item.instrumentType === type) && matchesSearch(item, query.search));
    items.sort((a, b) => a.name.localeCompare(b.name));
    return paginate(items.slice(query.skip, query.skip + query.take), items.length, query);
  }

  async createInstrument(tenantId: string, input: CreateBenefitInstrumentInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    try {
      return await this.prisma.transactionWithRetry(async (tx) => {
        await this.validateInstrumentReferences(tx, tenantId, input);
        const id = randomUUID();
        const common = {
          id, tenantId, name: input.name, code: input.code.toUpperCase(),
          percentage: input.percentage ?? null, fixedAmount: input.fixedAmount ?? null,
          maxAmount: input.maxAmount ?? null, feeTypeIds: input.feeTypeIds ?? [],
          effectiveFrom: dateValue(input.effectiveFrom), effectiveTo: input.effectiveTo ? dateValue(input.effectiveTo) : null,
          active: input.active ?? true, createdBy: actorId ?? null,
        };
        let record: object | null = null;
        switch (input.instrumentType) {
          case 'SCHOLARSHIP':
            record = await tx.scholarship.create({ data: { ...common, kind: input.kind as never, funder: clean(input.funder) ?? null, policyId: input.policyId ?? null, academicYearId: input.academicYearId ?? null, requiresApproval: input.requiresApproval ?? true, notes: clean(input.notes) ?? null } });
            break;
          case 'DISCOUNT':
            record = await tx.discount.create({ data: { ...common, reason: input.reason!, policyId: input.policyId ?? null, stackingMode: (input.stackingMode ?? 'STACKABLE') as StackingMode, priority: input.priority ?? 100, requiresApproval: input.requiresApproval ?? false } });
            break;
          case 'CONCESSION':
            record = await tx.concession.create({ data: { ...common, reason: input.reason!, policyId: input.policyId ?? null, requiresApproval: input.requiresApproval ?? true } });
            break;
          case 'WAIVER':
            record = await tx.waiver.create({ data: { ...common, reason: input.reason!, policyId: input.policyId ?? null, fullWaiver: input.fullWaiver ?? false, requiresApproval: input.requiresApproval ?? true } });
            break;
          case 'SURCHARGE':
            record = await tx.surcharge.create({ data: { ...common, reason: input.reason!, policyId: input.policyId ?? null, taxable: input.taxable ?? false, taxPercent: input.taxPercent ?? null, mandatory: input.mandatory ?? false, stackingMode: (input.stackingMode ?? 'STACKABLE') as StackingMode, priority: input.priority ?? 100 } });
            break;
        }
        await this.audit.record(tx, { tenantId, actorId, action: 'BENEFIT_INSTRUMENT_CREATED', entityType: input.instrumentType, entityId: id, after: auditView(input) });
        await this.outbox.publish(tx, { tenantId, eventType: 'BENEFIT_INSTRUMENT_CREATED', aggregateType: input.instrumentType, aggregateId: id, payload: { instrumentType: input.instrumentType, code: input.code.toUpperCase(), active: input.active ?? true }, actorId, requestId: this.tenantContext.requestId });
        return { ...record!, instrumentType: input.instrumentType };
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict('BENEFIT_CODE_EXISTS', 'An instrument with this code already exists in this institution.');
      throw error;
    }
  }

  async updateInstrument(tenantId: string, id: string, rawType: string, input: UpdateBenefitInstrumentInput) {
    this.assertTenant(tenantId);
    const type = normalizeInstrumentType(rawType);
    const actorId = this.tenantContext.require().userId;
    try {
      return await this.prisma.transactionWithRetry(async (tx) => {
        const before = await this.findInstrument(tx, tenantId, id, type);
        if (!before) throw AppError.notFound('Benefit instrument');
        validateMergedInstrument(type, before, input);
        await this.validateInstrumentReferences(tx, tenantId, { ...input, instrumentType: type } as CreateBenefitInstrumentInput, true);
        const data = instrumentUpdateData(input, type);
        const delegate = instrumentDelegate(tx, type) as unknown as {
          updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
        };
        const changed = await delegate.updateMany({ where: { tenantId, id, updatedAt: before.updatedAt, deletedAt: null }, data });
        if (changed.count !== 1) throw AppError.conflict('BENEFIT_CHANGED', 'This instrument changed while it was being edited. Reload and retry.');
        const after = await this.findInstrument(tx, tenantId, id, type);
        if (!after) throw AppError.notFound('Benefit instrument');
        await this.audit.record(tx, { tenantId, actorId, action: 'BENEFIT_INSTRUMENT_UPDATED', entityType: type, entityId: id, before: auditView(before), after: auditView(after) });
        await this.outbox.publish(tx, { tenantId, eventType: 'BENEFIT_INSTRUMENT_UPDATED', aggregateType: type, aggregateId: id, payload: { instrumentType: type, active: (after as { active?: boolean }).active }, actorId, requestId: this.tenantContext.requestId });
        return { ...after, instrumentType: type };
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict('BENEFIT_CODE_EXISTS', 'An instrument with this code already exists in this institution.');
      throw error;
    }
  }

  async listAssignments(tenantId: string, raw: Record<string, unknown>) {
    this.assertTenant(tenantId);
    const query = parseListQuery(raw, { allowedSortFields: ['effectiveFrom', 'status', 'createdAt', 'priority'] });
    const status = query.status?.filter((value) => ['DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'RETIRED', 'ARCHIVED'].includes(value));
    const studentId = typeof raw.studentId === 'string' ? raw.studentId : undefined;
    const rows = await this.prisma.db.benefitAssignment.findMany({
      where: { tenantId, deletedAt: null, ...(status?.length ? { status: { in: status as never[] } } : {}), ...(studentId ? { studentId } : {}) },
      orderBy: [{ status: 'asc' }, { effectiveFrom: 'desc' }], skip: query.skip, take: query.take,
    });
    const total = await this.prisma.db.benefitAssignment.count({ where: { tenantId, deletedAt: null, ...(status?.length ? { status: { in: status as never[] } } : {}), ...(studentId ? { studentId } : {}) } });
    const withInstruments = await this.attachAssignmentInstruments(this.prisma.db, tenantId, rows);
    const studentIds = [...new Set(withInstruments.flatMap((assignment) => assignment.studentId ? [assignment.studentId] : []))];
    const students = studentIds.length ? await this.prisma.db.student.findMany({
      where: { tenantId, id: { in: studentIds } },
      select: { id: true, firstName: true, lastName: true, admissionNumber: true },
    }) : [];
    const studentById = new Map(students.map((student) => [student.id, student]));
    return paginate(withInstruments.map((assignment) => ({
      ...assignment,
      student: assignment.studentId ? studentById.get(assignment.studentId) ?? null : null,
    })), total, query);
  }

  async createAssignment(tenantId: string, input: CreateBenefitAssignmentInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const instrument = await this.findAssignableInstrument(tx, tenantId, input.instrumentType, input.instrumentId);
      if (!instrument || !instrument.active) throw AppError.validation('Choose an active instrument from this institution.');
      if (!windowsOverlap(dateValue(input.effectiveFrom), input.effectiveTo ? dateValue(input.effectiveTo) : null, instrument.effectiveFrom, instrument.effectiveTo)) {
        throw AppError.validation('The assignment dates must overlap the instrument effective period.');
      }
      if (input.studentId) {
        const student = await tx.student.findFirst({ where: { tenantId, id: input.studentId, deletedAt: null }, select: { id: true } });
        if (!student) throw AppError.validation('Choose a student from this institution.');
      }
      if (input.groupId) {
        const group = await tx.studentGroup.findFirst({ where: { tenantId, id: input.groupId, active: true, deletedAt: null }, select: { id: true } });
        if (!group) throw AppError.validation('Choose an active student group from this institution.');
      }
      const academicYearId = input.academicYearId ?? ('academicYearId' in instrument ? instrument.academicYearId : null);
      if (academicYearId && !(await tx.academicYear.findFirst({ where: { tenantId, id: academicYearId }, select: { id: true } }))) throw AppError.validation('The selected academic year is not available in this institution.');
      if (input.instrumentType === 'SCHOLARSHIP' && 'academicYearId' in instrument && instrument.academicYearId && academicYearId !== instrument.academicYearId) throw AppError.validation('The scholarship is restricted to a different academic year.');
      const start = maxDate(dateValue(input.effectiveFrom), instrument.effectiveFrom);
      const end = minDate(input.effectiveTo ? dateValue(input.effectiveTo) : null, instrument.effectiveTo);
      const status = instrument.requiresApproval ? 'PENDING_APPROVAL' : 'ACTIVE';
      const stackingMode = input.stackingMode ?? ('stackingMode' in instrument ? instrument.stackingMode : 'STACKABLE');
      const instrumentPriority = 'priority' in instrument && typeof instrument.priority === 'number' ? instrument.priority : 100;
      const priority = input.priority ?? instrumentPriority;
      const id = randomUUID();
      const assignment = await tx.benefitAssignment.create({ data: {
        id, tenantId, studentId: input.studentId ?? null, groupId: input.groupId ?? null,
        scholarshipId: input.instrumentType === 'SCHOLARSHIP' ? input.instrumentId : null,
        discountId: input.instrumentType === 'DISCOUNT' ? input.instrumentId : null,
        concessionId: input.instrumentType === 'CONCESSION' ? input.instrumentId : null,
        waiverId: input.instrumentType === 'WAIVER' ? input.instrumentId : null,
        academicYearId, effectiveFrom: start, effectiveTo: end, status, reason: input.reason,
        overridePercentage: input.overridePercentage ?? null, overrideFixedAmount: input.overrideFixedAmount ?? null,
        overrideMaxAmount: input.overrideMaxAmount ?? null, stackingMode: stackingMode as StackingMode, priority,
        createdBy: actorId ?? null, updatedBy: actorId ?? null,
      } });
      await this.audit.record(tx, { tenantId, actorId, action: 'BENEFIT_ASSIGNMENT_CREATED', entityType: 'BenefitAssignment', entityId: id, after: { instrumentType: input.instrumentType, instrumentId: input.instrumentId, studentId: input.studentId ?? null, groupId: input.groupId ?? null, status, effectiveFrom: dateOnly(start), effectiveTo: end ? dateOnly(end) : null, reason: input.reason } });
      await this.outbox.publish(tx, { tenantId, eventType: status === 'ACTIVE' ? 'BENEFIT_ASSIGNMENT_ACTIVATED' : 'BENEFIT_ASSIGNMENT_APPROVAL_REQUESTED', aggregateType: 'BenefitAssignment', aggregateId: id, payload: { assignmentId: id, instrumentType: input.instrumentType, studentId: input.studentId ?? null, groupId: input.groupId ?? null, status }, actorId, requestId: this.tenantContext.requestId });
      return assignment;
    });
  }

  async decideAssignment(tenantId: string, id: string, input: BenefitAssignmentDecisionInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const before = await tx.benefitAssignment.findFirst({ where: { tenantId, id, deletedAt: null } });
      if (!before) throw AppError.notFound('Benefit assignment');
      if (input.decision === 'APPROVE' || input.decision === 'REJECT') {
        if (before.status !== 'PENDING_APPROVAL') throw AppError.conflict('BENEFIT_ASSIGNMENT_IMMUTABLE', 'Only a pending assignment can be approved or rejected.');
      } else if (before.status !== 'ACTIVE' && before.status !== 'PENDING_APPROVAL') {
        throw AppError.conflict('BENEFIT_ASSIGNMENT_IMMUTABLE', 'Only an active or pending assignment can be archived.');
      }
      const status = input.decision === 'APPROVE' ? 'ACTIVE' : 'ARCHIVED';
      const changed = await tx.benefitAssignment.updateMany({ where: { tenantId, id, status: before.status, updatedAt: before.updatedAt, deletedAt: null }, data: { status, approvedBy: input.decision === 'APPROVE' ? actorId ?? null : before.approvedBy, approvedAt: input.decision === 'APPROVE' ? new Date() : before.approvedAt, updatedBy: actorId ?? null } });
      if (changed.count !== 1) throw AppError.conflict('BENEFIT_ASSIGNMENT_CHANGED', 'The assignment changed while this decision was being recorded. Reload and retry.');
      const after = await tx.benefitAssignment.findFirst({ where: { tenantId, id } });
      if (!after) throw AppError.notFound('Benefit assignment');
      await this.audit.record(tx, { tenantId, actorId, action: `BENEFIT_ASSIGNMENT_${input.decision}`, entityType: 'BenefitAssignment', entityId: id, before: { status: before.status }, after: { status, reason: input.reason, approvedBy: after.approvedBy, approvedAt: after.approvedAt } });
      await this.outbox.publish(tx, { tenantId, eventType: `BENEFIT_ASSIGNMENT_${input.decision}`, aggregateType: 'BenefitAssignment', aggregateId: id, payload: { assignmentId: id, status, reason: input.reason }, actorId, requestId: this.tenantContext.requestId });
      return after;
    });
  }

  async listOverrides(tenantId: string, raw: Record<string, unknown>) {
    this.assertTenant(tenantId);
    const query = parseListQuery(raw, { allowedSortFields: ['effectiveFrom', 'status', 'createdAt', 'overrideAmount'] });
    const status = query.status?.filter((value) => ['DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'RETIRED', 'ARCHIVED'].includes(value));
    const where: Prisma.FeeOverrideWhereInput = { tenantId, ...(status?.length ? { status: { in: status as never[] } } : {}), ...(typeof raw.studentId === 'string' ? { studentId: raw.studentId } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.db.feeOverride.findMany({ where, orderBy: [{ status: 'asc' }, { effectiveFrom: 'desc' }], skip: query.skip, take: query.take }),
      this.prisma.db.feeOverride.count({ where }),
    ]);
    const studentIds = [...new Set(items.map(({ studentId }) => studentId))];
    const students = studentIds.length ? await this.prisma.db.student.findMany({
      where: { tenantId, id: { in: studentIds } },
      select: { id: true, firstName: true, lastName: true, admissionNumber: true },
    }) : [];
    const studentById = new Map(students.map((student) => [student.id, student]));
    return paginate(items.map((item) => ({ ...item, student: studentById.get(item.studentId) ?? null })), total, query);
  }

  async createOverride(tenantId: string, input: CreateFeeOverrideInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const [student, feeType, academicYear] = await Promise.all([
        tx.student.findFirst({ where: { tenantId, id: input.studentId, deletedAt: null }, select: { id: true } }),
        tx.feeType.findFirst({ where: { tenantId, id: input.feeTypeId, deletedAt: null }, select: { id: true } }),
        input.academicYearId ? tx.academicYear.findFirst({ where: { tenantId, id: input.academicYearId }, select: { id: true } }) : Promise.resolve(true),
      ]);
      if (!student) throw AppError.validation('Choose a student from this institution.');
      if (!feeType) throw AppError.validation('Choose a fee type from this institution.');
      if (!academicYear) throw AppError.validation('Choose an academic year from this institution.');
      const effectiveFrom = dateValue(input.effectiveFrom);
      const effectiveTo = input.effectiveTo ? dateValue(input.effectiveTo) : null;
      const overlaps = await tx.feeOverride.findFirst({ where: {
        tenantId, studentId: input.studentId, feeTypeId: input.feeTypeId, status: { in: ['ACTIVE', 'PENDING_APPROVAL'] },
        effectiveFrom: { lte: effectiveTo ?? new Date('9999-12-31T00:00:00.000Z') },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }],
      }, select: { id: true } });
      if (overlaps) throw AppError.conflict('FEE_OVERRIDE_OVERLAP', 'An active or pending override already covers this student, fee type and academic period. Close its date range before adding another.');
      const id = randomUUID();
      const status = input.requiresApproval ? 'PENDING_APPROVAL' : 'ACTIVE';
      const override = await tx.feeOverride.create({ data: {
        id, tenantId, studentId: input.studentId, feeTypeId: input.feeTypeId,
        originalAmount: input.originalAmount, overrideAmount: input.overrideAmount, reason: input.reason,
        academicYearId: input.academicYearId ?? null, effectiveFrom, effectiveTo, status,
        requiresApproval: input.requiresApproval, createdBy: actorId ?? null, updatedBy: actorId ?? null,
      } });
      await this.audit.record(tx, { tenantId, actorId, action: 'FEE_OVERRIDE_CREATED', entityType: 'FeeOverride', entityId: id, after: { studentId: input.studentId, feeTypeId: input.feeTypeId, originalAmount: input.originalAmount, overrideAmount: input.overrideAmount, reason: input.reason, status, academicYearId: input.academicYearId ?? null, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo ?? null } });
      await this.outbox.publish(tx, { tenantId, eventType: status === 'ACTIVE' ? 'FEE_OVERRIDE_ACTIVATED' : 'FEE_OVERRIDE_APPROVAL_REQUESTED', aggregateType: 'FeeOverride', aggregateId: id, payload: { overrideId: id, studentId: input.studentId, feeTypeId: input.feeTypeId, status }, actorId, requestId: this.tenantContext.requestId });
      return override;
    });
  }

  async decideOverride(tenantId: string, id: string, input: FeeOverrideDecisionInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const before = await tx.feeOverride.findFirst({ where: { tenantId, id } });
      if (!before) throw AppError.notFound('Fee override');
      if ((input.decision === 'APPROVE' || input.decision === 'REJECT') && before.status !== 'PENDING_APPROVAL') throw AppError.conflict('FEE_OVERRIDE_IMMUTABLE', 'Only a pending override can be approved or rejected.');
      if (input.decision === 'ARCHIVE' && before.status !== 'ACTIVE' && before.status !== 'PENDING_APPROVAL') throw AppError.conflict('FEE_OVERRIDE_IMMUTABLE', 'Only an active or pending override can be archived.');
      const status = input.decision === 'APPROVE' ? 'ACTIVE' : 'ARCHIVED';
      const changed = await tx.feeOverride.updateMany({ where: { tenantId, id, status: before.status, updatedAt: before.updatedAt }, data: { status, approvedBy: input.decision === 'APPROVE' ? actorId ?? null : before.approvedBy, approvedAt: input.decision === 'APPROVE' ? new Date() : before.approvedAt, updatedBy: actorId ?? null } });
      if (changed.count !== 1) throw AppError.conflict('FEE_OVERRIDE_CHANGED', 'The override changed while its decision was being recorded. Reload and retry.');
      const after = await tx.feeOverride.findFirst({ where: { tenantId, id } });
      if (!after) throw AppError.notFound('Fee override');
      await this.audit.record(tx, { tenantId, actorId, action: `FEE_OVERRIDE_${input.decision}`, entityType: 'FeeOverride', entityId: id, before: { status: before.status }, after: { status, reason: input.reason, approvedBy: after.approvedBy, approvedAt: after.approvedAt } });
      await this.outbox.publish(tx, { tenantId, eventType: `FEE_OVERRIDE_${input.decision}`, aggregateType: 'FeeOverride', aggregateId: id, payload: { overrideId: id, status, reason: input.reason }, actorId, requestId: this.tenantContext.requestId });
      return after;
    });
  }

  async loadRulesForCandidates(tx: TransactionClient, tenantId: string, candidates: Array<{ studentId: string; groupIds: string[] }>, academicYearId: string | null, asOfDate: string): Promise<Map<string, RuleDefinition[]>> {
    const date = dateValue(asOfDate);
    const studentIds = [...new Set(candidates.map((candidate) => candidate.studentId))];
    const groupIds = [...new Set(candidates.flatMap((candidate) => candidate.groupIds))];
    const studentAssignments = studentIds.length ? await tx.benefitAssignment.findMany({
      where: {
        tenantId, status: 'ACTIVE', deletedAt: null, studentId: { in: studentIds }, effectiveFrom: { lte: date },
        AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] }, ...(academicYearId ? [{ OR: [{ academicYearId: null }, { academicYearId }] }] : [{ academicYearId: null }])],
      },
    }) : [];
    const overrides = studentIds.length ? await tx.feeOverride.findMany({ where: {
      tenantId, studentId: { in: studentIds }, status: 'ACTIVE', effectiveFrom: { lte: date },
      AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] }, ...(academicYearId ? [{ OR: [{ academicYearId: null }, { academicYearId }] }] : [{ academicYearId: null }])],
    } }) : [];
    const groupAssignments = groupIds.length ? await tx.benefitAssignment.findMany({
      where: {
        tenantId, status: 'ACTIVE', deletedAt: null, groupId: { in: groupIds }, effectiveFrom: { lte: date },
        AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] }, ...(academicYearId ? [{ OR: [{ academicYearId: null }, { academicYearId }] }] : [{ academicYearId: null }])],
      },
    }) : [];
    const assignments = await this.attachAssignmentInstruments(tx, tenantId, [...studentAssignments, ...groupAssignments]);
    const surcharges = await tx.surcharge.findMany({ where: { tenantId, active: true, deletedAt: null, effectiveFrom: { lte: date }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] } });
    const feeTypeIds = [...new Set(assignments.flatMap((assignment) => [
      ...(assignment.scholarship?.feeTypeIds ?? []), ...(assignment.discount?.feeTypeIds ?? []), ...(assignment.concession?.feeTypeIds ?? []), ...(assignment.waiver?.feeTypeIds ?? []),
    ]).concat(surcharges.flatMap((surcharge) => surcharge.feeTypeIds), overrides.map((override) => override.feeTypeId)))];
    const feeTypes = feeTypeIds.length ? await tx.feeType.findMany({ where: { tenantId, id: { in: feeTypeIds } }, select: { id: true, code: true } }) : [];
    const feeCodeById = new Map(feeTypes.map((feeType) => [feeType.id, feeType.code]));
    const surchargeRules = surcharges.filter((surcharge) => surcharge.feeTypeIds.every((id) => feeCodeById.has(id))).map((surcharge) => instrumentRule({
      id: surcharge.id, code: surcharge.code, name: surcharge.name, type: 'SURCHARGE', priority: surcharge.priority,
      stackingMode: surcharge.stackingMode, effectiveFrom: surcharge.effectiveFrom, effectiveTo: surcharge.effectiveTo,
      feeTypeCodes: surcharge.feeTypeIds.map((id) => feeCodeById.get(id)!), percentage: surcharge.percentage, fixedAmount: surcharge.fixedAmount,
      maxAmount: surcharge.maxAmount, reason: surcharge.reason, policyId: surcharge.policyId, taxable: surcharge.taxable, taxPercent: surcharge.taxPercent,
    }));
    const result = new Map<string, RuleDefinition[]>();
    for (const candidate of candidates) {
      const byId = new Map<string, typeof assignments[number]>();
      for (const assignment of assignments) {
        if (assignment.studentId === candidate.studentId || (assignment.groupId && candidate.groupIds.includes(assignment.groupId))) byId.set(assignment.id, assignment);
      }
      const assignedRules: RuleDefinition[] = [];
      for (const assignment of byId.values()) {
        const instrumentType = assignment.scholarship ? 'SCHOLARSHIP' : assignment.discount ? 'DISCOUNT' : assignment.concession ? 'CONCESSION' : assignment.waiver ? 'WAIVER' : null;
        const instrument = assignment.scholarship ?? assignment.discount ?? assignment.concession ?? assignment.waiver;
        if (!instrument || !instrument.active || ('academicYearId' in instrument && instrument.academicYearId && instrument.academicYearId !== academicYearId)) continue;
        if (instrument.effectiveFrom > date || (instrument.effectiveTo && instrument.effectiveTo < date)) continue;
        const feeCodes = instrument.feeTypeIds.map((id) => feeCodeById.get(id)).filter((code): code is string => Boolean(code));
        if (feeCodes.length !== instrument.feeTypeIds.length) continue;
        const full = instrumentType === 'WAIVER' && assignment.waiver?.fullWaiver || instrumentType === 'SCHOLARSHIP' && assignment.scholarship?.kind === 'FULL';
        const percentage = assignment.overridePercentage ?? instrument.percentage;
        const fixedAmount = assignment.overrideFixedAmount ?? instrument.fixedAmount;
        assignedRules.push(instrumentRule({
          id: assignment.id, code: `${instrumentType}_${instrument.code}_${assignment.id.slice(0, 8)}`, name: instrument.name,
          type: instrumentType!, priority: assignment.priority, stackingMode: assignment.stackingMode,
          effectiveFrom: maxDate(assignment.effectiveFrom, instrument.effectiveFrom), effectiveTo: minDate(assignment.effectiveTo, instrument.effectiveTo),
          feeTypeCodes: feeCodes, percentage, fixedAmount, maxAmount: assignment.overrideMaxAmount ?? instrument.maxAmount,
          full, reason: assignment.reason, policyId: 'policyId' in instrument ? instrument.policyId : null,
          approvedBy: assignment.approvedBy, approvedAt: assignment.approvedAt,
          scopes: assignment.studentId ? [{ targetType: 'STUDENT', targetId: candidate.studentId, includeChildren: false }] : [{ targetType: 'CUSTOM_GROUP', targetId: assignment.groupId, includeChildren: false }],
        }));
      }
      const overrideRules = overrides.filter((override) => override.studentId === candidate.studentId && feeCodeById.has(override.feeTypeId)).map((override) => feeOverrideRule(override, candidate.studentId, feeCodeById.get(override.feeTypeId)!));
      result.set(candidate.studentId, [...surchargeRules, ...assignedRules, ...overrideRules]);
    }
    return result;
  }

  private async attachAssignmentInstruments<T extends {
    scholarshipId: string | null;
    discountId: string | null;
    concessionId: string | null;
    waiverId: string | null;
  }>(tx: TransactionClient | PrismaService['db'], tenantId: string, rows: T[]): Promise<Array<T & BenefitAssignmentInstruments>> {
    const ids = {
      scholarship: [...new Set(rows.flatMap((row) => row.scholarshipId ? [row.scholarshipId] : []))],
      discount: [...new Set(rows.flatMap((row) => row.discountId ? [row.discountId] : []))],
      concession: [...new Set(rows.flatMap((row) => row.concessionId ? [row.concessionId] : []))],
      waiver: [...new Set(rows.flatMap((row) => row.waiverId ? [row.waiverId] : []))],
    };
    const [scholarships, discounts, concessions, waivers] = await Promise.all([
      ids.scholarship.length ? tx.scholarship.findMany({ where: { tenantId, id: { in: ids.scholarship } } }) : Promise.resolve([]),
      ids.discount.length ? tx.discount.findMany({ where: { tenantId, id: { in: ids.discount } } }) : Promise.resolve([]),
      ids.concession.length ? tx.concession.findMany({ where: { tenantId, id: { in: ids.concession } } }) : Promise.resolve([]),
      ids.waiver.length ? tx.waiver.findMany({ where: { tenantId, id: { in: ids.waiver } } }) : Promise.resolve([]),
    ]);
    const scholarshipById = new Map(scholarships.map((row) => [row.id, row]));
    const discountById = new Map(discounts.map((row) => [row.id, row]));
    const concessionById = new Map(concessions.map((row) => [row.id, row]));
    const waiverById = new Map(waivers.map((row) => [row.id, row]));
    return rows.map((row) => ({
      ...row,
      scholarship: row.scholarshipId ? scholarshipById.get(row.scholarshipId) ?? null : null,
      discount: row.discountId ? discountById.get(row.discountId) ?? null : null,
      concession: row.concessionId ? concessionById.get(row.concessionId) ?? null : null,
      waiver: row.waiverId ? waiverById.get(row.waiverId) ?? null : null,
    })) as Array<T & BenefitAssignmentInstruments>;
  }

  private async validateInstrumentReferences(tx: TransactionClient, tenantId: string, input: CreateBenefitInstrumentInput, partial = false) {
    const feeTypeIds = input.feeTypeIds ?? [];
    if (feeTypeIds.length) {
      const found = await tx.feeType.findMany({ where: { tenantId, id: { in: feeTypeIds }, deletedAt: null }, select: { id: true } });
      if (found.length !== new Set(feeTypeIds).size) throw AppError.validation('Every fee type must belong to this institution and be active.');
    }
    if (input.academicYearId && !(await tx.academicYear.findFirst({ where: { tenantId, id: input.academicYearId }, select: { id: true } }))) throw AppError.validation('The academic year is not available in this institution.');
    if (input.policyId && !(await tx.feePolicy.findFirst({ where: { tenantId, id: input.policyId, deletedAt: null }, select: { id: true } }))) throw AppError.validation('The linked policy is not available in this institution.');
    void partial;
  }

  private async findInstrument(tx: TransactionClient, tenantId: string, id: string, type: BenefitKind): Promise<Record<string, unknown> | null> {
    const delegate = instrumentDelegate(tx, type) as unknown as {
      findFirst(args: { where: Record<string, unknown> }): Promise<unknown>;
    };
    return await delegate.findFirst({ where: { tenantId, id, deletedAt: null } }) as Record<string, unknown> | null;
  }

  private async findAssignableInstrument(tx: TransactionClient, tenantId: string, type: AssignableBenefitKind, id: string) {
    if (type === 'SCHOLARSHIP') return tx.scholarship.findFirst({ where: { tenantId, id, deletedAt: null } });
    if (type === 'DISCOUNT') return tx.discount.findFirst({ where: { tenantId, id, deletedAt: null } });
    if (type === 'CONCESSION') return tx.concession.findFirst({ where: { tenantId, id, deletedAt: null } });
    return tx.waiver.findFirst({ where: { tenantId, id, deletedAt: null } });
  }

  private assertTenant(tenantId: string): void {
    if (this.tenantContext.requireTenantId() !== tenantId) throw AppError.forbidden('The requested tenant does not match the authenticated session.');
  }
}

@ApiTags('benefits')
@RequireModules('FEES')
@Controller('benefits')
export class BenefitsController {
  constructor(private readonly benefits: BenefitsService) {}

  @Get('instruments') @RequirePermissions(PERMISSIONS.BENEFIT_READ) listInstruments(@CurrentTenant() tenant: string, @Query() query: Record<string, unknown>) { return this.benefits.listInstruments(tenant, query); }
  @Post('instruments') @RequirePermissions(PERMISSIONS.BENEFIT_CONFIGURE) @UsePipes(new ZodValidationPipe(createBenefitInstrumentSchema)) @ApiOperation({ summary: 'Create a tenant-configured benefit or surcharge instrument' }) createInstrument(@CurrentTenant() tenant: string, @Body() body: CreateBenefitInstrumentInput) { return this.benefits.createInstrument(tenant, body); }
  @Patch('instruments/:type/:id') @RequirePermissions(PERMISSIONS.BENEFIT_CONFIGURE) @UsePipes(new ZodValidationPipe(updateBenefitInstrumentSchema)) updateInstrument(@CurrentTenant() tenant: string, @Param('type') type: string, @Param('id') id: string, @Body() body: UpdateBenefitInstrumentInput) { return this.benefits.updateInstrument(tenant, id, type, body); }
  @Get('assignments') @RequirePermissions(PERMISSIONS.BENEFIT_READ) listAssignments(@CurrentTenant() tenant: string, @Query() query: Record<string, unknown>) { return this.benefits.listAssignments(tenant, query); }
  @Post('assignments') @RequirePermissions(PERMISSIONS.BENEFIT_ASSIGN) @UsePipes(new ZodValidationPipe(createBenefitAssignmentSchema)) createAssignment(@CurrentTenant() tenant: string, @Body() body: CreateBenefitAssignmentInput) { return this.benefits.createAssignment(tenant, body); }
  @Post('assignments/:id/decision') @RequirePermissions(PERMISSIONS.BENEFIT_APPROVE) @UsePipes(new ZodValidationPipe(benefitAssignmentDecisionSchema)) decideAssignment(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: BenefitAssignmentDecisionInput) { return this.benefits.decideAssignment(tenant, id, body); }
  @Get('overrides') @RequirePermissions(PERMISSIONS.OVERRIDE_READ) listOverrides(@CurrentTenant() tenant: string, @Query() query: Record<string, unknown>) { return this.benefits.listOverrides(tenant, query); }
  @Post('overrides') @RequirePermissions(PERMISSIONS.OVERRIDE_CREATE) @UsePipes(new ZodValidationPipe(createFeeOverrideSchema)) @ApiOperation({ summary: 'Create a dated, approval-aware per-student fee override' }) createOverride(@CurrentTenant() tenant: string, @Body() body: CreateFeeOverrideInput) { return this.benefits.createOverride(tenant, body); }
  @Post('overrides/:id/decision') @RequirePermissions(PERMISSIONS.OVERRIDE_APPROVE) @UsePipes(new ZodValidationPipe(feeOverrideDecisionSchema)) decideOverride(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: FeeOverrideDecisionInput) { return this.benefits.decideOverride(tenant, id, body); }
}

@Module({ imports: [PrismaModule, TenantContextModule], controllers: [BenefitsController], providers: [BenefitsService], exports: [BenefitsService] })
export class BenefitsModule {}

function instrumentRule(input: {
  id: string; code: string; name: string; type: BenefitKind; priority: number; stackingMode: StackingMode;
  effectiveFrom: Date; effectiveTo: Date | null; feeTypeCodes: string[]; percentage?: Prisma.Decimal | null; fixedAmount?: Prisma.Decimal | null;
  maxAmount?: Prisma.Decimal | null; full?: boolean; reason: string; policyId?: string | null; approvedBy?: string | null; approvedAt?: Date | null;
  taxable?: boolean; taxPercent?: Prisma.Decimal | null; scopes?: RuleDefinition['scopes'];
}): RuleDefinition {
  const policyType = input.type as PolicyType;
  const actionKind: ActionKind = input.type === 'SURCHARGE' ? input.percentage ? 'ADD_PERCENTAGE' : 'ADD_FIXED_AMOUNT'
    : input.full ? 'WAIVE_FULL'
      : input.type === 'WAIVER' ? input.percentage ? 'WAIVE_PARTIAL' : 'WAIVE_PARTIAL'
        : input.percentage ? 'DISCOUNT_PERCENTAGE' : 'DISCOUNT_FIXED';
  const amount = input.fixedAmount?.toString() ?? null;
  const percentage = input.percentage?.toString() ?? null;
  return {
    id: input.id, code: input.code, name: input.name, policyType, stage: input.type,
    priority: input.priority, stackingMode: input.stackingMode, actions: [{
      id: `${input.id}:benefit`, kind: actionKind, amountBasis: 'RUNNING_TOTAL', amount, percentage,
      feeTypeCodes: input.feeTypeCodes, capAmount: input.maxAmount?.toString() ?? null, sortOrder: 0,
      parameters: input.taxable ? { taxable: true, taxPercent: input.taxPercent?.toString() } : null,
    }],
    scopes: input.scopes, effectiveFrom: dateOnly(input.effectiveFrom), effectiveTo: input.effectiveTo ? dateOnly(input.effectiveTo) : null, status: 'ACTIVE',
    requiresApproval: false, instrument: { type: input.type, id: input.id, name: input.name, reason: input.reason, approvedBy: input.approvedBy, approvedAt: input.approvedAt?.toISOString() ?? null, taxable: input.taxable ?? false, taxPercent: input.taxPercent?.toString() ?? null },
    explainTemplate: input.reason,
  };
}

function feeOverrideRule(override: {
  id: string; feeTypeId: string; originalAmount: Prisma.Decimal; overrideAmount: Prisma.Decimal; reason: string;
  effectiveFrom: Date; effectiveTo: Date | null; approvedBy: string | null; approvedAt: Date | null;
}, studentId: string, feeTypeCode: string): RuleDefinition {
  return {
    id: override.id, code: `OVERRIDE_${feeTypeCode}_${override.id.slice(0, 8)}`, name: `${feeTypeCode} fee override`,
    policyType: 'OVERRIDE', stage: 'OVERRIDE', priority: 100, stackingMode: 'PRIORITY_ONLY',
    actions: [{ id: `${override.id}:override`, kind: 'OVERRIDE_AMOUNT', amountBasis: 'RUNNING_TOTAL', amount: override.overrideAmount.toString(), feeTypeCodes: [feeTypeCode], sortOrder: 0 }],
    scopes: [{ targetType: 'STUDENT', targetId: studentId, includeChildren: false }],
    effectiveFrom: dateOnly(override.effectiveFrom), effectiveTo: override.effectiveTo ? dateOnly(override.effectiveTo) : null, status: 'ACTIVE',
    instrument: { type: 'OVERRIDE', id: override.id, name: `${feeTypeCode} fee override`, reason: override.reason, approvedBy: override.approvedBy, approvedAt: override.approvedAt?.toISOString() ?? null },
    override: { originalAmount: override.originalAmount.toString(), overrideAmount: override.overrideAmount.toString(), reason: override.reason },
    explainTemplate: override.reason,
  };
}

function instrumentDelegate(tx: TransactionClient | PrismaService['db'], type: BenefitKind) {
  if (type === 'SCHOLARSHIP') return tx.scholarship;
  if (type === 'DISCOUNT') return tx.discount;
  if (type === 'CONCESSION') return tx.concession;
  if (type === 'WAIVER') return tx.waiver;
  return tx.surcharge;
}

function instrumentUpdateData(input: UpdateBenefitInstrumentInput, type: BenefitKind): Record<string, unknown> {
  const common: Record<string, unknown> = {};
  for (const key of ['name', 'code', 'percentage', 'fixedAmount', 'maxAmount', 'feeTypeIds', 'effectiveFrom', 'effectiveTo', 'active'] as const) {
    if (input[key] !== undefined) common[key] = key === 'code' ? input[key]?.toUpperCase() : key === 'effectiveFrom' || key === 'effectiveTo' ? input[key] ? dateValue(input[key] as string) : null : input[key];
  }
  if (input.policyId !== undefined) common.policyId = input.policyId;
  if (input.requiresApproval !== undefined && type !== 'SURCHARGE') common.requiresApproval = input.requiresApproval;
  if (type === 'SCHOLARSHIP') {
    if (input.kind !== undefined) common.kind = input.kind;
    if (input.funder !== undefined) common.funder = input.funder;
    if (input.academicYearId !== undefined) common.academicYearId = input.academicYearId;
    if (input.notes !== undefined) common.notes = input.notes;
  } else {
    if (input.reason !== undefined) common.reason = input.reason;
  }
  if (type === 'DISCOUNT') {
    if (input.stackingMode !== undefined) common.stackingMode = input.stackingMode;
    if (input.priority !== undefined) common.priority = input.priority;
  }
  if (type === 'WAIVER' && input.fullWaiver !== undefined) common.fullWaiver = input.fullWaiver;
  if (type === 'SURCHARGE') {
    if (input.taxable !== undefined) common.taxable = input.taxable;
    if (input.taxPercent !== undefined) common.taxPercent = input.taxPercent;
    if (input.mandatory !== undefined) common.mandatory = input.mandatory;
    if (input.stackingMode !== undefined) common.stackingMode = input.stackingMode;
    if (input.priority !== undefined) common.priority = input.priority;
  }
  return common;
}

function normalizeInstrumentType(type: string): BenefitKind {
  const normalized = type.toUpperCase();
  if (['SCHOLARSHIP', 'DISCOUNT', 'CONCESSION', 'WAIVER', 'SURCHARGE'].includes(normalized)) return normalized as BenefitKind;
  throw AppError.validation('Choose a supported benefit instrument type.');
}

function validateMergedInstrument(type: BenefitKind, before: Record<string, unknown>, input: UpdateBenefitInstrumentInput): void {
  const merged = { ...before, ...input };
  const hasPercentage = Boolean(merged.percentage);
  const hasFixedAmount = Boolean(merged.fixedAmount);
  if (hasPercentage && hasFixedAmount) throw AppError.validation('Choose a fixed amount or a percentage, not both.');
  if (type === 'SCHOLARSHIP') {
    const kind = merged.kind;
    if (kind === 'FULL' && (hasPercentage || hasFixedAmount)) throw AppError.validation('A full scholarship does not need an amount.');
    if (kind === 'PERCENTAGE' && !hasPercentage) throw AppError.validation('Enter the scholarship percentage.');
    if (kind === 'FIXED_AMOUNT' && !hasFixedAmount) throw AppError.validation('Enter the scholarship amount.');
    if (kind !== 'FULL' && !hasPercentage && !hasFixedAmount) throw AppError.validation('Enter a fixed amount or percentage.');
  } else if (type === 'WAIVER') {
    if (merged.fullWaiver && (hasPercentage || hasFixedAmount)) throw AppError.validation('A full waiver does not need an amount.');
    if (!merged.fullWaiver && !hasPercentage && !hasFixedAmount) throw AppError.validation('Choose a full waiver or provide an amount/percentage.');
  } else if (!hasPercentage && !hasFixedAmount) {
    throw AppError.validation('Enter a fixed amount or percentage.');
  }
  const start = input.effectiveFrom ? dateValue(input.effectiveFrom) : before.effectiveFrom as Date;
  const end = input.effectiveTo === null ? null : input.effectiveTo ? dateValue(input.effectiveTo) : before.effectiveTo as Date | null;
  if (end && end < start) throw AppError.validation('The end date must be on or after the start date.');
}

function matchesSearch(value: { name: string; code: string }, search?: string) {
  return !search || `${value.name} ${value.code}`.toLowerCase().includes(search.toLowerCase());
}

function auditView(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const out = { ...(value as Record<string, unknown>) };
  for (const key of ['percentage', 'fixedAmount', 'maxAmount', 'taxPercent', 'overridePercentage', 'overrideFixedAmount', 'overrideMaxAmount']) {
    const amount = out[key];
    if (amount && typeof amount === 'object' && 'toString' in amount) out[key] = amount.toString();
  }
  return out;
}

function dateValue(value: string): Date { return new Date(`${value}T00:00:00.000Z`); }
function dateOnly(value: Date): string { return value.toISOString().slice(0, 10); }
function clean(value: string | null | undefined): string | null | undefined { if (value === undefined || value === null) return value; return value.trim() || null; }
function maxDate(a: Date, b: Date): Date { return a.getTime() >= b.getTime() ? a : b; }
function minDate(a: Date | null, b: Date | null): Date | null { if (!a) return b; if (!b) return a; return a.getTime() <= b.getTime() ? a : b; }
function windowsOverlap(aFrom: Date, aTo: Date | null, bFrom: Date, bTo: Date | null): boolean { return aFrom.getTime() <= (bTo?.getTime() ?? Number.POSITIVE_INFINITY) && bFrom.getTime() <= (aTo?.getTime() ?? Number.POSITIVE_INFINITY); }
function isUniqueViolation(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002'; }
