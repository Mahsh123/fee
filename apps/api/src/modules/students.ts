import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Param,
  Patch,
  Put,
  Post,
  Query,
  UsePipes,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { Prisma, type AcademicUnitType, type AdmissionStatus, type StudentStatus, type TransactionClient } from '@fee/database';
import {
  ACADEMIC_UNIT_TYPES,
  ERROR_CODES,
  PERMISSIONS,
} from '@fee/types';
import {
  admissionDecisionSchema,
  createAcademicUnitSchema,
  createAdmissionApplicationSchema,
  createGuardianSchema,
  createStudentSchema,
  updateAcademicUnitSchema,
  updateAdmissionApplicationSchema,
  updateStudentSchema,
  studentStatusTransitionSchema,
  replaceStudentCustomAttributesSchema,
  type CreateAcademicUnitInput,
  type CreateAdmissionApplicationInput,
  type CreateGuardianInput,
  type CreateStudentInput,
  type UpdateAcademicUnitInput,
  type UpdateAdmissionApplicationInput,
  type UpdateStudentInput,
  type ReplaceStudentCustomAttributesInput,
} from '@fee/validation';
import { AppError } from '../common/errors';
import { AuditService, OutboxService, SequenceService } from '../common/financial';
import { buildSearchFilter, paginate, parseListQuery, toPrismaOrderBy, ZodValidationPipe } from '../common/http';
import { PrismaModule, PrismaService } from '../common/prisma.service';
import { CurrentTenant, RequireModules, RequirePermissions, TenantContextModule, TenantContextService } from '../common/tenancy';

const STUDENT_LIST_FIELDS = [
  'id', 'admissionNumber', 'rollNumber', 'firstName', 'middleName', 'lastName', 'dateOfBirth', 'gender',
  'category', 'phone', 'email', 'addressLine1', 'city', 'state', 'postalCode', 'country', 'status', 'branchId',
  'academicYearId', 'primaryUnitId', 'admissionType', 'scholarshipCategory', 'hostelStatus', 'transportStatus',
  'transportRouteId', 'isInternational', 'academicScore', 'familyGroupId', 'metadata', 'createdAt', 'updatedAt',
] as const;

const STUDENT_TRANSITIONS: Readonly<Record<StudentStatus, readonly StudentStatus[]>> = Object.freeze({
  PROSPECT: ['ACTIVE', 'WITHDRAWN'],
  ACTIVE: ['ON_LEAVE', 'SUSPENDED', 'WITHDRAWN', 'ALUMNI'],
  ON_LEAVE: ['ACTIVE', 'SUSPENDED', 'WITHDRAWN'],
  SUSPENDED: ['ACTIVE', 'WITHDRAWN'],
  WITHDRAWN: ['ALUMNI'],
  ALUMNI: [],
});

const ADMISSION_TRANSITIONS: Readonly<Record<AdmissionStatus, readonly AdmissionStatus[]>> = Object.freeze({
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['UNDER_REVIEW', 'REJECTED', 'CANCELLED'],
  UNDER_REVIEW: ['FEES_PENDING', 'REJECTED', 'CANCELLED'],
  FEES_PENDING: ['CONFIRMED', 'REJECTED', 'CANCELLED'],
  CONFIRMED: ['ENROLLED'],
  REJECTED: [],
  CANCELLED: [],
  ENROLLED: [],
});

@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: SequenceService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async listStudents(tenantId: string, rawQuery: Record<string, unknown>) {
    this.assertTenant(tenantId);
    const query = parseListQuery(rawQuery, { allowedSortFields: ['status', 'firstName', 'lastName', 'rollNumber'] });
    const where: Prisma.StudentWhereInput = {
      tenantId,
      deletedAt: null,
      ...(query.status?.length ? { status: { in: query.status as StudentStatus[] } } : {}),
      ...buildSearchFilter(query.search, ['admissionNumber', 'rollNumber', 'firstName', 'lastName', 'email', 'phone']),
    };
    const [items, total] = await Promise.all([
      this.prisma.db.student.findMany({
        where,
        select: Object.fromEntries(STUDENT_LIST_FIELDS.map((field) => [field, true])) as Prisma.StudentSelect,
        orderBy: toPrismaOrderBy(query.sort) as Prisma.StudentOrderByWithRelationInput[],
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.db.student.count({ where }),
    ]);
    return paginate(items, total, query);
  }

  async getStudent(tenantId: string, studentId: string) {
    this.assertTenant(tenantId);
    const student = await this.prisma.db.student.findFirst({
      where: { id: studentId, tenantId, deletedAt: null },
      select: Object.fromEntries(STUDENT_LIST_FIELDS.map((field) => [field, true])) as Prisma.StudentSelect,
    });
    if (!student) throw AppError.notFound('Student');
    return student;
  }

  async createStudent(tenantId: string, input: CreateStudentInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      await this.validateStudentReferences(tx, tenantId, input);
      const admissionNumber = await this.sequences.allocate(tx, { tenantId, kind: 'STUDENT' });
      const id = randomUUID();
      const student = await tx.student.create({
        data: {
          id,
          tenantId,
          admissionNumber,
          rollNumber: clean(input.rollNumber),
          firstName: input.firstName,
          middleName: clean(input.middleName),
          lastName: clean(input.lastName),
          dateOfBirth: dateValue(input.dateOfBirth),
          gender: clean(input.gender),
          category: clean(input.category),
          phone: clean(input.phone),
          email: emailValue(input.email),
          addressLine1: clean(input.addressLine1),
          city: clean(input.city),
          state: clean(input.state),
          postalCode: clean(input.postalCode),
          country: clean(input.country),
          branchId: clean(input.branchId),
          academicYearId: clean(input.academicYearId),
          primaryUnitId: clean(input.primaryUnitId),
          admissionType: clean(input.admissionType),
          scholarshipCategory: clean(input.scholarshipCategory),
          hostelStatus: input.hostelStatus ?? false,
          transportStatus: input.transportStatus ?? false,
          transportRouteId: clean(input.transportRouteId),
          isInternational: input.isInternational ?? false,
          academicScore: decimalValue(input.academicScore),
          metadata: jsonValue(input.metadata),
          createdBy: actorId ?? null,
          updatedBy: actorId ?? null,
        },
      });

      if (input.primaryUnitId) {
    await tx.studentUnitMembership.create({
          data: {
            tenantId,
            studentId: student.id,
            academicUnitId: input.primaryUnitId,
            academicYearId: clean(input.academicYearId),
            isPrimary: true,
            startedOn: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`),
          },
        });
      }

      await this.audit.record(tx, {
        tenantId,
        actorId,
        action: 'STUDENT_CREATED',
        entityType: 'Student',
        entityId: student.id,
        after: { id: student.id, admissionNumber: student.admissionNumber, status: student.status },
      });
      await this.outbox.publish(tx, {
        tenantId,
        eventType: 'STUDENT_CREATED',
        aggregateType: 'Student',
        aggregateId: student.id,
        payload: { studentId: student.id, admissionNumber: student.admissionNumber },
        actorId,
        requestId: this.tenantContext.requestId,
      });
      return student;
    });
  }

  async updateStudent(tenantId: string, studentId: string, input: UpdateStudentInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const current = await tx.student.findFirst({ where: { id: studentId, tenantId, deletedAt: null } });
      if (!current) throw AppError.notFound('Student');
      await this.validateStudentReferences(tx, tenantId, input);
      const data = studentUpdateData(input);
      if (!Object.keys(data).length) return current;
      const update = await tx.student.updateMany({
        where: { id: studentId, tenantId, deletedAt: null, updatedAt: current.updatedAt },
        data: { ...data, updatedBy: actorId ?? null },
      });
      if (update.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'This student changed while you were editing. Reload and try again.');
      const updated = await tx.student.findFirst({ where: { id: studentId, tenantId, deletedAt: null } });
      if (!updated) throw AppError.notFound('Student');
      await this.audit.record(tx, {
        tenantId,
        actorId,
        action: 'STUDENT_PROFILE_UPDATED',
        entityType: 'Student',
        entityId: studentId,
        before: { id: current.id, admissionNumber: current.admissionNumber, updatedAt: current.updatedAt.toISOString() },
        after: { id: updated.id, admissionNumber: updated.admissionNumber, updatedAt: updated.updatedAt.toISOString(), fields: Object.keys(data) },
      });
      await this.outbox.publish(tx, {
        tenantId,
        eventType: 'STUDENT_PROFILE_UPDATED',
        aggregateType: 'Student',
        aggregateId: studentId,
        payload: { studentId, changedFields: Object.keys(data) },
        actorId,
        requestId: this.tenantContext.requestId,
      });
      return updated;
    });
  }

  async transitionStudent(tenantId: string, studentId: string, nextStatus: StudentStatus, reason: string) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const current = await tx.student.findFirst({ where: { id: studentId, tenantId, deletedAt: null } });
      if (!current) throw AppError.notFound('Student');
      if (!STUDENT_TRANSITIONS[current.status].includes(nextStatus)) {
        throw AppError.conflict('STUDENT_INVALID_STATE', `A student cannot move from ${current.status} to ${nextStatus}.`);
      }
      const changed = await tx.student.updateMany({
        where: { id: studentId, tenantId, deletedAt: null, status: current.status, updatedAt: current.updatedAt },
        data: { status: nextStatus, updatedBy: actorId ?? null },
      });
      if (changed.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'This student changed while you were editing. Reload and try again.');
      const updated = await tx.student.findFirst({ where: { id: studentId, tenantId, deletedAt: null } });
      if (!updated) throw AppError.notFound('Student');
      await this.audit.record(tx, {
        tenantId,
        actorId,
        action: 'STUDENT_STATUS_CHANGED',
        entityType: 'Student',
        entityId: studentId,
        before: { status: current.status },
        after: { status: nextStatus },
        reason,
      });
      await this.outbox.publish(tx, {
        tenantId,
        eventType: 'STUDENT_STATUS_CHANGED',
        aggregateType: 'Student',
        aggregateId: studentId,
        payload: { studentId, from: current.status, to: nextStatus, reason },
        actorId,
        requestId: this.tenantContext.requestId,
      });
      return updated;
    });
  }

  async listCustomAttributes(tenantId: string, studentId: string) {
    this.assertTenant(tenantId);
    const student = await this.prisma.db.student.findFirst({ where: { id: studentId, tenantId, deletedAt: null }, select: { id: true } });
    if (!student) throw AppError.notFound('Student');
    return this.prisma.db.studentCustomAttribute.findMany({ where: { tenantId, studentId }, orderBy: { key: 'asc' } });
  }

  async replaceCustomAttributes(tenantId: string, studentId: string, input: ReplaceStudentCustomAttributesInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const student = await tx.student.findFirst({ where: { id: studentId, tenantId, deletedAt: null }, select: { id: true } });
      if (!student) throw AppError.notFound('Student');
      const before = await tx.studentCustomAttribute.findMany({ where: { tenantId, studentId }, orderBy: { key: 'asc' } });
      for (const attribute of input.attributes) {
        await tx.studentCustomAttribute.upsert({
          where: { studentId_key: { studentId, key: attribute.key } },
          create: { tenantId, studentId, key: attribute.key, value: attribute.value, valueType: attribute.valueType },
          update: { value: attribute.value, valueType: attribute.valueType },
        });
      }
      const after = await tx.studentCustomAttribute.findMany({ where: { tenantId, studentId }, orderBy: { key: 'asc' } });
      await this.audit.record(tx, {
        tenantId, actorId, action: 'STUDENT_CALCULATION_ATTRIBUTES_UPDATED', entityType: 'Student', entityId: studentId,
        before: before.map(({ key, value, valueType }) => ({ key, value, valueType })),
        after: after.map(({ key, value, valueType }) => ({ key, value, valueType })),
      });
      await this.outbox.publish(tx, {
        tenantId, eventType: 'STUDENT_CALCULATION_ATTRIBUTES_UPDATED', aggregateType: 'Student', aggregateId: studentId,
        payload: { studentId, changedKeys: input.attributes.map((attribute) => attribute.key) },
        actorId, requestId: this.tenantContext.requestId,
      });
      return after;
    });
  }

  async validateStudentReferences(tx: TransactionClient, tenantId: string, input: Pick<CreateStudentInput, 'academicYearId' | 'primaryUnitId' | 'transportRouteId' | 'branchId'>) {
    if (input.branchId) {
      const branch = await tx.branch.findFirst({ where: { tenantId, id: input.branchId, status: 'ACTIVE' }, select: { id: true } });
      if (!branch) throw AppError.validation('Choose an active branch from this organization.');
    }
    if (input.academicYearId) {
      const year = await tx.academicYear.findFirst({ where: { id: input.academicYearId, tenantId }, select: { id: true } });
      if (!year) throw AppError.validation('The selected academic year is not available in this institution.');
    }
    if (input.primaryUnitId) {
      const unit = await tx.academicUnit.findFirst({ where: { id: input.primaryUnitId, tenantId, active: true, deletedAt: null }, select: { id: true } });
      if (!unit) throw AppError.validation('The selected academic unit is not available in this institution.');
    }
    if (input.transportRouteId) {
      const route = await tx.academicUnit.findFirst({ where: { id: input.transportRouteId, tenantId, unitType: 'TRANSPORT_ROUTE', active: true, deletedAt: null }, select: { id: true } });
      if (!route) throw AppError.validation('The selected transport route is not available in this institution.');
    }
  }

  assertTenant(tenantId: string): void {
    if (this.tenantContext.requireTenantId() !== tenantId) throw AppError.forbidden('The requested tenant does not match the authenticated session.');
  }
}

@Injectable()
export class AcademicUnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async list(tenantId: string, rawQuery: Record<string, unknown>) {
    this.assertTenant(tenantId);
    const type = typeof rawQuery.unitType === 'string' && ACADEMIC_UNIT_TYPES.includes(rawQuery.unitType as AcademicUnitType)
      ? rawQuery.unitType as AcademicUnitType
      : undefined;
    const query = parseListQuery(rawQuery, { allowedSortFields: ['name', 'code', 'unitType'] });
    const where: Prisma.AcademicUnitWhereInput = {
      tenantId,
      deletedAt: null,
      ...(type ? { unitType: type } : {}),
      ...(rawQuery.active === 'false' ? { active: false } : rawQuery.active === 'true' ? { active: true } : {}),
      ...buildSearchFilter(query.search, ['name', 'code']),
    };
    const [items, total] = await Promise.all([
      this.prisma.db.academicUnit.findMany({ where, orderBy: toPrismaOrderBy(query.sort) as Prisma.AcademicUnitOrderByWithRelationInput[], skip: query.skip, take: query.take }),
      this.prisma.db.academicUnit.count({ where }),
    ]);
    return paginate(items, total, query);
  }

  async create(tenantId: string, input: CreateAcademicUnitInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      await this.validateParent(tx, tenantId, input.parentId);
      const id = randomUUID();
      const unit = await tx.academicUnit.create({
        data: {
          id,
          tenantId,
          unitType: input.unitType,
          name: input.name,
          code: input.code,
          parentId: clean(input.parentId),
          metadata: jsonValue(input.metadata),
        },
      });
      await this.audit.record(tx, {
        tenantId,
        actorId,
        action: 'ACADEMIC_UNIT_CREATED',
        entityType: 'AcademicUnit',
        entityId: id,
        after: { id, unitType: unit.unitType, code: unit.code, parentId: unit.parentId },
      });
      await this.outbox.publish(tx, {
        tenantId,
        eventType: 'ACADEMIC_UNIT_CREATED',
        aggregateType: 'AcademicUnit',
        aggregateId: id,
        payload: { academicUnitId: id, unitType: unit.unitType },
        actorId,
        requestId: this.tenantContext.requestId,
      });
      return unit;
    });
  }

  async update(tenantId: string, id: string, input: UpdateAcademicUnitInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const current = await tx.academicUnit.findFirst({ where: { id, tenantId, deletedAt: null } });
      if (!current) throw AppError.notFound('Academic unit');
      if (Object.hasOwn(input, 'parentId')) await this.validateParent(tx, tenantId, input.parentId, id);
      const data: Prisma.AcademicUnitUpdateManyMutationInput = {
        ...(input.unitType ? { unitType: input.unitType } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(Object.hasOwn(input, 'parentId') ? { parentId: clean(input.parentId) } : {}),
        ...(Object.hasOwn(input, 'metadata') ? { metadata: jsonValue(input.metadata) } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      };
      if (!Object.keys(input).length) return current;
      const changed = await tx.academicUnit.updateMany({ where: { id, tenantId, deletedAt: null, updatedAt: current.updatedAt }, data });
      if (changed.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'This academic unit changed while you were editing. Reload and try again.');
      const updated = await tx.academicUnit.findFirst({ where: { id, tenantId, deletedAt: null } });
      if (!updated) throw AppError.notFound('Academic unit');
      await this.audit.record(tx, {
        tenantId,
        actorId,
        action: 'ACADEMIC_UNIT_UPDATED',
        entityType: 'AcademicUnit',
        entityId: id,
        before: { unitType: current.unitType, code: current.code, active: current.active, parentId: current.parentId },
        after: { unitType: updated.unitType, code: updated.code, active: updated.active, parentId: updated.parentId },
      });
      await this.outbox.publish(tx, {
        tenantId,
        eventType: 'ACADEMIC_UNIT_UPDATED',
        aggregateType: 'AcademicUnit',
        aggregateId: id,
        payload: { academicUnitId: id, changedFields: Object.keys(input) },
        actorId,
        requestId: this.tenantContext.requestId,
      });
      return updated;
    });
  }

  private async validateParent(tx: TransactionClient, tenantId: string, parentId?: string | null, childId?: string): Promise<void> {
    if (!parentId) return;
    let cursor: string | null = parentId;
    const visited = new Set<string>();
    for (let depth = 0; cursor && depth < 128; depth += 1) {
      if (cursor === childId || visited.has(cursor)) throw AppError.validation('Academic unit parent links cannot form a cycle.');
      visited.add(cursor);
      const parent: { id: string; parentId: string | null } | null = await tx.academicUnit.findFirst({
        where: { id: cursor, tenantId, active: true, deletedAt: null },
        select: { id: true, parentId: true },
      });
      if (!parent) throw AppError.validation('The selected parent unit is not available in this institution.');
      cursor = parent.parentId;
    }
    if (cursor) throw AppError.validation('This academic unit hierarchy is too deep to verify safely.');
  }

  private assertTenant(tenantId: string): void {
    if (this.tenantContext.requireTenantId() !== tenantId) throw AppError.forbidden('The requested tenant does not match the authenticated session.');
  }
}

@Injectable()
export class GuardiansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tenantContext: TenantContextService,
    private readonly students: StudentsService,
  ) {}

  async listForStudent(tenantId: string, studentId: string) {
    this.students.assertTenant(tenantId);
    const student = await this.prisma.db.student.findFirst({ where: { id: studentId, tenantId, deletedAt: null }, select: { id: true } });
    if (!student) throw AppError.notFound('Student');
    const links = await this.prisma.db.studentGuardian.findMany({ where: { tenantId, studentId }, orderBy: { createdAt: 'asc' } });
    const guardianIds = links.map((link) => link.guardianId);
    const guardians = guardianIds.length
      ? await this.prisma.db.guardian.findMany({ where: { tenantId, id: { in: guardianIds }, deletedAt: null } })
      : [];
    const byId = new Map(guardians.map((guardian) => [guardian.id, guardian]));
    return links.flatMap((link) => {
      const guardian = byId.get(link.guardianId);
      return guardian ? [{ ...guardian, isPrimaryPayer: link.isPrimaryPayer, studentGuardianId: link.id }] : [];
    });
  }

  async createForStudent(tenantId: string, studentId: string, input: CreateGuardianInput) {
    this.students.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const student = await tx.student.findFirst({ where: { id: studentId, tenantId, deletedAt: null }, select: { id: true } });
      if (!student) throw AppError.notFound('Student');
      const id = randomUUID();
      const guardian = await tx.guardian.create({
        data: {
          id,
          tenantId,
          firstName: input.firstName,
          lastName: clean(input.lastName),
          relation: input.relation,
          phone: clean(input.phone),
          email: emailValue(input.email),
          occupation: clean(input.occupation),
          addressLine1: clean(input.addressLine1),
          city: clean(input.city),
          isPrimaryContact: input.isPrimaryContact ?? false,
        },
      });
      await tx.studentGuardian.create({
        data: {
          tenantId,
          studentId,
          guardianId: id,
          isPrimaryPayer: input.isPrimaryPayer ?? false,
        },
      });
      await this.audit.record(tx, {
        tenantId,
        actorId,
        action: 'GUARDIAN_LINKED',
        entityType: 'StudentGuardian',
        entityId: `${studentId}:${id}`,
        after: { studentId, guardianId: id, isPrimaryPayer: input.isPrimaryPayer ?? false },
      });
      return guardian;
    });
  }
}

@Injectable()
export class AdmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: SequenceService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async list(tenantId: string, rawQuery: Record<string, unknown>) {
    this.assertTenant(tenantId);
    const query = parseListQuery(rawQuery, { allowedSortFields: ['applicationNumber', 'status', 'applicantFirstName'] });
    const where: Prisma.AdmissionApplicationWhereInput = {
      tenantId,
      ...(query.status?.length ? { status: { in: query.status as AdmissionStatus[] } } : {}),
      ...buildSearchFilter(query.search, ['applicationNumber', 'applicantFirstName', 'applicantLastName', 'email', 'phone']),
    };
    const [items, total] = await Promise.all([
      this.prisma.db.admissionApplication.findMany({ where, orderBy: toPrismaOrderBy(query.sort) as Prisma.AdmissionApplicationOrderByWithRelationInput[], skip: query.skip, take: query.take }),
      this.prisma.db.admissionApplication.count({ where }),
    ]);
    return paginate(items, total, query);
  }

  async create(tenantId: string, input: CreateAdmissionApplicationInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      await this.validateReferences(tx, tenantId, input.academicYearId, input.targetUnitId);
      const applicationNumber = await this.sequences.allocate(tx, { tenantId, kind: 'APPLICATION' });
      const id = randomUUID();
      const application = await tx.admissionApplication.create({
        data: {
          id,
          tenantId,
          applicationNumber,
          applicantFirstName: input.applicantFirstName,
          applicantLastName: clean(input.applicantLastName),
          dateOfBirth: dateValue(input.dateOfBirth),
          gender: clean(input.gender),
          phone: clean(input.phone),
          email: emailValue(input.email),
          category: clean(input.category),
          academicYearId: clean(input.academicYearId),
          targetUnitId: clean(input.targetUnitId),
          admissionType: clean(input.admissionType),
          isInternational: input.isInternational ?? false,
          metadata: jsonValue(input.metadata),
          createdBy: actorId ?? null,
        },
      });
      await this.audit.record(tx, {
        tenantId,
        actorId,
        action: 'ADMISSION_APPLICATION_CREATED',
        entityType: 'AdmissionApplication',
        entityId: id,
        after: { id, applicationNumber, status: application.status },
      });
      await this.outbox.publish(tx, {
        tenantId,
        eventType: 'ADMISSION_APPLICATION_CREATED',
        aggregateType: 'AdmissionApplication',
        aggregateId: id,
        payload: { applicationId: id, applicationNumber },
        actorId,
        requestId: this.tenantContext.requestId,
      });
      return application;
    });
  }

  async updateDraft(tenantId: string, id: string, input: UpdateAdmissionApplicationInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const current = await tx.admissionApplication.findFirst({ where: { id, tenantId } });
      if (!current) throw AppError.notFound('Admission application');
      if (current.status !== 'DRAFT') throw AppError.conflict('ADMISSION_INVALID_STATE', 'Only draft applications can be edited.');
      await this.validateReferences(tx, tenantId, input.academicYearId ?? current.academicYearId, input.targetUnitId ?? current.targetUnitId);
      const data: Prisma.AdmissionApplicationUpdateManyMutationInput = {
        ...(input.applicantFirstName !== undefined ? { applicantFirstName: input.applicantFirstName } : {}),
        ...(input.applicantLastName !== undefined ? { applicantLastName: clean(input.applicantLastName) } : {}),
        ...(Object.hasOwn(input, 'dateOfBirth') ? { dateOfBirth: dateValue(input.dateOfBirth) } : {}),
        ...(Object.hasOwn(input, 'gender') ? { gender: clean(input.gender) } : {}),
        ...(Object.hasOwn(input, 'phone') ? { phone: clean(input.phone) } : {}),
        ...(Object.hasOwn(input, 'email') ? { email: emailValue(input.email) } : {}),
        ...(Object.hasOwn(input, 'category') ? { category: clean(input.category) } : {}),
        ...(Object.hasOwn(input, 'academicYearId') ? { academicYearId: clean(input.academicYearId) } : {}),
        ...(Object.hasOwn(input, 'targetUnitId') ? { targetUnitId: clean(input.targetUnitId) } : {}),
        ...(Object.hasOwn(input, 'admissionType') ? { admissionType: clean(input.admissionType) } : {}),
        ...(input.isInternational !== undefined ? { isInternational: input.isInternational } : {}),
        ...(Object.hasOwn(input, 'metadata') ? { metadata: jsonValue(input.metadata) } : {}),
      };
      if (!Object.keys(data).length) return current;
      const changed = await tx.admissionApplication.updateMany({ where: { id, tenantId, status: 'DRAFT', updatedAt: current.updatedAt }, data });
      if (changed.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'This application changed while you were editing. Reload and try again.');
      const updated = await tx.admissionApplication.findFirst({ where: { id, tenantId } });
      if (!updated) throw AppError.notFound('Admission application');
      await this.audit.record(tx, {
        tenantId,
        actorId,
        action: 'ADMISSION_APPLICATION_UPDATED',
        entityType: 'AdmissionApplication',
        entityId: id,
        before: { status: current.status, updatedAt: current.updatedAt.toISOString() },
        after: { status: updated.status, updatedAt: updated.updatedAt.toISOString(), fields: Object.keys(data) },
      });
      return updated;
    });
  }

  async transition(tenantId: string, id: string, nextStatus: AdmissionStatus, reason?: string) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const current = await tx.admissionApplication.findFirst({ where: { id, tenantId } });
      if (!current) throw AppError.notFound('Admission application');
      if (!ADMISSION_TRANSITIONS[current.status].includes(nextStatus)) {
        throw AppError.conflict('ADMISSION_INVALID_STATE', `An application cannot move from ${current.status} to ${nextStatus}.`);
      }
      if (nextStatus === 'FEES_PENDING' && !current.demandId) {
        throw AppError.conflict('ADMISSION_DEMAND_REQUIRED', 'Create the admission demand through the fee engine before marking fees pending.');
      }
      if (nextStatus === 'CONFIRMED') {
        throw AppError.conflict('ADMISSION_PAYMENT_REQUIRED', 'Admission confirmation is completed by the verified payment workflow after the admission demand is settled.');
      }
      if (nextStatus === 'ENROLLED') {
        throw AppError.conflict('ADMISSION_NOT_CONFIRMED', 'An application must be confirmed before it can be enrolled.');
      }
      const changed = await tx.admissionApplication.updateMany({
        where: { id, tenantId, status: current.status, updatedAt: current.updatedAt },
        data: {
          status: nextStatus,
          ...(nextStatus === 'SUBMITTED' ? { submittedAt: new Date() } : {}),
        },
      });
      if (changed.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'This application changed while you were reviewing it. Reload and try again.');
      const updated = await tx.admissionApplication.findFirst({ where: { id, tenantId } });
      if (!updated) throw AppError.notFound('Admission application');
      await this.audit.record(tx, {
        tenantId,
        actorId,
        action: 'ADMISSION_STATUS_CHANGED',
        entityType: 'AdmissionApplication',
        entityId: id,
        before: { status: current.status },
        after: { status: updated.status },
        reason,
      });
      await this.outbox.publish(tx, {
        tenantId,
        eventType: 'ADMISSION_STATUS_CHANGED',
        aggregateType: 'AdmissionApplication',
        aggregateId: id,
        payload: { applicationId: id, from: current.status, to: nextStatus },
        actorId,
        requestId: this.tenantContext.requestId,
      });
      return updated;
    });
  }

  private async validateReferences(tx: TransactionClient, tenantId: string, academicYearId?: string | null, targetUnitId?: string | null): Promise<void> {
    if (academicYearId) {
      const year = await tx.academicYear.findFirst({ where: { id: academicYearId, tenantId }, select: { id: true } });
      if (!year) throw AppError.validation('The selected academic year is not available in this institution.');
    }
    if (targetUnitId) {
      const unit = await tx.academicUnit.findFirst({ where: { id: targetUnitId, tenantId, active: true, deletedAt: null }, select: { id: true } });
      if (!unit) throw AppError.validation('The selected academic unit is not available in this institution.');
    }
  }

  private assertTenant(tenantId: string): void {
    if (this.tenantContext.requireTenantId() !== tenantId) throw AppError.forbidden('The requested tenant does not match the authenticated session.');
  }
}

@ApiTags('students')
@RequireModules('ADMISSIONS')
@Controller('students')
export class StudentsController {
  constructor(private readonly students: StudentsService, private readonly guardians: GuardiansService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.STUDENT_READ)
  @ApiOperation({ summary: 'Search and paginate students in the authenticated institution' })
  list(@CurrentTenant() tenantId: string, @Query() query: Record<string, unknown>) {
    return this.students.listStudents(tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.STUDENT_READ)
  get(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.students.getStudent(tenantId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.STUDENT_CREATE)
  @UsePipes(new ZodValidationPipe(createStudentSchema))
  @ApiOperation({ summary: 'Enroll a student and allocate a tenant-scoped admission number' })
  create(@CurrentTenant() tenantId: string, @Body() body: CreateStudentInput) {
    return this.students.createStudent(tenantId, body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.STUDENT_UPDATE)
  @UsePipes(new ZodValidationPipe(updateStudentSchema))
  update(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() body: UpdateStudentInput) {
    return this.students.updateStudent(tenantId, id, body);
  }

  @Get(':id/custom-attributes')
  @RequirePermissions(PERMISSIONS.STUDENT_READ)
  listCustomAttributes(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.students.listCustomAttributes(tenantId, id);
  }

  @Put(':id/custom-attributes')
  @RequirePermissions(PERMISSIONS.STUDENT_UPDATE)
  @UsePipes(new ZodValidationPipe(replaceStudentCustomAttributesSchema))
  replaceCustomAttributes(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() body: ReplaceStudentCustomAttributesInput) {
    return this.students.replaceCustomAttributes(tenantId, id, body);
  }

  @Post(':id/status')
  @RequirePermissions(PERMISSIONS.STUDENT_UPDATE)
  @UsePipes(new ZodValidationPipe(studentStatusTransitionSchema))
  transitionStatus(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() body: { reason: string; status: StudentStatus },
  ) {
    return this.students.transitionStudent(tenantId, id, body.status, body.reason);
  }

  @Get(':id/guardians')
  @RequirePermissions(PERMISSIONS.GUARDIAN_READ)
  listGuardians(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.guardians.listForStudent(tenantId, id);
  }

  @Post(':id/guardians')
  @RequirePermissions(PERMISSIONS.GUARDIAN_CREATE)
  @UsePipes(new ZodValidationPipe(createGuardianSchema))
  addGuardian(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() body: CreateGuardianInput) {
    return this.guardians.createForStudent(tenantId, id, body);
  }
}

@ApiTags('academic structure')
@RequireModules('ADMISSIONS')
@Controller('academic-units')
export class AcademicUnitsController {
  constructor(private readonly units: AcademicUnitsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.STUDENT_READ)
  list(@CurrentTenant() tenantId: string, @Query() query: Record<string, unknown>) {
    return this.units.list(tenantId, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.STUDENT_CREATE)
  @UsePipes(new ZodValidationPipe(createAcademicUnitSchema))
  create(@CurrentTenant() tenantId: string, @Body() body: CreateAcademicUnitInput) {
    return this.units.create(tenantId, body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.STUDENT_UPDATE)
  @UsePipes(new ZodValidationPipe(updateAcademicUnitSchema))
  update(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() body: UpdateAcademicUnitInput) {
    return this.units.update(tenantId, id, body);
  }
}

@ApiTags('admissions')
@RequireModules('ADMISSIONS')
@Controller('admissions')
export class AdmissionsController {
  constructor(private readonly admissions: AdmissionsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ADMISSION_READ)
  list(@CurrentTenant() tenantId: string, @Query() query: Record<string, unknown>) {
    return this.admissions.list(tenantId, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ADMISSION_CREATE)
  @UsePipes(new ZodValidationPipe(createAdmissionApplicationSchema))
  create(@CurrentTenant() tenantId: string, @Body() body: CreateAdmissionApplicationInput) {
    return this.admissions.create(tenantId, body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.ADMISSION_UPDATE)
  @UsePipes(new ZodValidationPipe(updateAdmissionApplicationSchema))
  updateDraft(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() body: UpdateAdmissionApplicationInput) {
    return this.admissions.updateDraft(tenantId, id, body);
  }

  @Post(':id/submit')
  @RequirePermissions(PERMISSIONS.ADMISSION_UPDATE)
  submit(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.admissions.transition(tenantId, id, 'SUBMITTED');
  }

  @Post(':id/review')
  @RequirePermissions(PERMISSIONS.ADMISSION_UPDATE)
  review(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.admissions.transition(tenantId, id, 'UNDER_REVIEW');
  }

  @Post(':id/reject')
  @RequirePermissions(PERMISSIONS.ADMISSION_CONFIRM)
  @UsePipes(new ZodValidationPipe(admissionDecisionSchema))
  reject(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() body: { reason: string }) {
    return this.admissions.transition(tenantId, id, 'REJECTED', body.reason);
  }
}

@Module({
  imports: [PrismaModule, TenantContextModule],
  controllers: [StudentsController, AcademicUnitsController, AdmissionsController],
  providers: [StudentsService, AcademicUnitsService, GuardiansService, AdmissionsService],
  exports: [StudentsService, AdmissionsService],
})
export class StudentsModule {}

function clean(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  const result = value.trim();
  return result === '' ? null : result;
}

function emailValue(value: string | null | undefined): string | null | undefined {
  const normalized = clean(value);
  return normalized?.toLowerCase() ?? normalized;
}

function dateValue(value: string | null | undefined): Date | null | undefined {
  const normalized = clean(value);
  if (normalized === undefined || normalized === null) return normalized;
  return normalized.length > 0 ? new Date(`${normalized}T00:00:00.000Z`) : null;
}

function decimalValue(value: string | null | undefined): string | null | undefined {
  return clean(value);
}

function jsonValue(value: Record<string, unknown> | null | undefined): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) return undefined;
  return value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue;
}

function studentUpdateData(input: UpdateStudentInput): Prisma.StudentUpdateManyMutationInput {
  return {
    ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
    ...(Object.hasOwn(input, 'middleName') ? { middleName: clean(input.middleName) } : {}),
    ...(Object.hasOwn(input, 'lastName') ? { lastName: clean(input.lastName) } : {}),
    ...(Object.hasOwn(input, 'dateOfBirth') ? { dateOfBirth: dateValue(input.dateOfBirth) } : {}),
    ...(Object.hasOwn(input, 'gender') ? { gender: clean(input.gender) } : {}),
    ...(Object.hasOwn(input, 'category') ? { category: clean(input.category) } : {}),
    ...(Object.hasOwn(input, 'phone') ? { phone: clean(input.phone) } : {}),
    ...(Object.hasOwn(input, 'email') ? { email: emailValue(input.email) } : {}),
    ...(Object.hasOwn(input, 'addressLine1') ? { addressLine1: clean(input.addressLine1) } : {}),
    ...(Object.hasOwn(input, 'city') ? { city: clean(input.city) } : {}),
    ...(Object.hasOwn(input, 'state') ? { state: clean(input.state) } : {}),
    ...(Object.hasOwn(input, 'postalCode') ? { postalCode: clean(input.postalCode) } : {}),
    ...(Object.hasOwn(input, 'country') ? { country: clean(input.country) } : {}),
    ...(Object.hasOwn(input, 'branchId') ? { branchId: clean(input.branchId) } : {}),
    ...(Object.hasOwn(input, 'rollNumber') ? { rollNumber: clean(input.rollNumber) } : {}),
    ...(Object.hasOwn(input, 'admissionType') ? { admissionType: clean(input.admissionType) } : {}),
    ...(Object.hasOwn(input, 'scholarshipCategory') ? { scholarshipCategory: clean(input.scholarshipCategory) } : {}),
    ...(input.hostelStatus !== undefined ? { hostelStatus: input.hostelStatus } : {}),
    ...(input.transportStatus !== undefined ? { transportStatus: input.transportStatus } : {}),
    ...(Object.hasOwn(input, 'transportRouteId') ? { transportRouteId: clean(input.transportRouteId) } : {}),
    ...(input.isInternational !== undefined ? { isInternational: input.isInternational } : {}),
    ...(Object.hasOwn(input, 'academicScore') ? { academicScore: decimalValue(input.academicScore) } : {}),
    ...(Object.hasOwn(input, 'metadata') ? { metadata: jsonValue(input.metadata) } : {}),
  };
}
