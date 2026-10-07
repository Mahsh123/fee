import { Body, Controller, Get, Injectable, Module, Param, Patch, Post, Put, Query, UsePipes } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { Prisma, isUniqueViolation } from '@fee/database';
import { PERMISSIONS } from '@fee/types';
import {
  createAcademicYearSchema,
  createStudentGroupSchema,
  replaceStudentGroupMembersSchema,
  updateAcademicYearSchema,
  updateStudentGroupSchema,
  type CreateAcademicYearInput,
  type CreateStudentGroupInput,
  type ReplaceStudentGroupMembersInput,
  type UpdateAcademicYearInput,
  type UpdateStudentGroupInput,
} from '@fee/validation';
import { AppError } from '../common/errors';
import { AuditService, OutboxService } from '../common/financial';
import { buildSearchFilter, paginate, parseListQuery, toPrismaOrderBy, ZodValidationPipe } from '../common/http';
import { PrismaModule, PrismaService } from '../common/prisma.service';
import { CurrentTenant, RequireModules, RequirePermissions, TenantContextModule, TenantContextService } from '../common/tenancy';

@Injectable()
export class AcademicOperationsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly tenantContext: TenantContextService) {}

  async listYears(tenantId: string, raw: Record<string, unknown>) {
    this.assertTenant(tenantId);
    const query = parseListQuery(raw, { allowedSortFields: ['name', 'startDate', 'endDate', 'isCurrent'] });
    const where: Prisma.AcademicYearWhereInput = { tenantId, ...buildSearchFilter(query.search, ['name']) };
    const [items, total] = await Promise.all([
      this.prisma.db.academicYear.findMany({ where, orderBy: toPrismaOrderBy(query.sort) as Prisma.AcademicYearOrderByWithRelationInput[], skip: query.skip, take: query.take }),
      this.prisma.db.academicYear.count({ where }),
    ]);
    return paginate(items, total, query);
  }

  async createYear(tenantId: string, input: CreateAcademicYearInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    try {
      return await this.prisma.transactionWithRetry(async (tx) => {
        if (input.isCurrent) await tx.academicYear.updateMany({ where: { tenantId, isCurrent: true }, data: { isCurrent: false } });
        const year = await tx.academicYear.create({ data: { id: randomUUID(), tenantId, name: input.name, startDate: dateValue(input.startDate), endDate: dateValue(input.endDate), isCurrent: input.isCurrent ?? false } });
        await this.audit.record(tx, { tenantId, actorId, action: 'ACADEMIC_YEAR_CREATED', entityType: 'AcademicYear', entityId: year.id, after: { name: year.name, startDate: input.startDate, endDate: input.endDate, isCurrent: year.isCurrent } });
        return year;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict('ACADEMIC_YEAR_NAME_EXISTS', 'An academic year with this name already exists in this institution.');
      throw error;
    }
  }

  async updateYear(tenantId: string, id: string, input: UpdateAcademicYearInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    try {
      return await this.prisma.transactionWithRetry(async (tx) => {
        const current = await tx.academicYear.findFirst({ where: { tenantId, id } });
        if (!current) throw AppError.notFound('Academic year');
        if (current.isClosed) throw AppError.conflict('ACADEMIC_YEAR_CLOSED', 'A closed academic year cannot be changed.');
        if (input.isCurrent) await tx.academicYear.updateMany({ where: { tenantId, isCurrent: true, id: { not: id } }, data: { isCurrent: false } });
        const changed = await tx.academicYear.updateMany({
          where: { tenantId, id, updatedAt: current.updatedAt, isClosed: false },
          data: { name: input.name, startDate: dateValue(input.startDate), endDate: dateValue(input.endDate), isCurrent: input.isCurrent ?? current.isCurrent },
        });
        if (changed.count !== 1) throw AppError.conflict('ACADEMIC_YEAR_CHANGED', 'This academic year changed while you were editing it. Reload and retry.');
        const updated = await tx.academicYear.findFirst({ where: { tenantId, id } });
        if (!updated) throw AppError.notFound('Academic year');
        await this.audit.record(tx, { tenantId, actorId, action: 'ACADEMIC_YEAR_UPDATED', entityType: 'AcademicYear', entityId: id, before: { name: current.name, isCurrent: current.isCurrent }, after: { name: updated.name, isCurrent: updated.isCurrent, startDate: input.startDate, endDate: input.endDate } });
        return updated;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict('ACADEMIC_YEAR_NAME_EXISTS', 'An academic year with this name already exists in this institution.');
      throw error;
    }
  }

  async closeYear(tenantId: string, id: string) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const current = await tx.academicYear.findFirst({ where: { tenantId, id } });
      if (!current) throw AppError.notFound('Academic year');
      if (current.isClosed) return current;
      const changed = await tx.academicYear.updateMany({ where: { tenantId, id, isClosed: false, updatedAt: current.updatedAt }, data: { isClosed: true, isCurrent: false, closedAt: new Date() } });
      if (changed.count !== 1) throw AppError.conflict('ACADEMIC_YEAR_CHANGED', 'This academic year changed while it was being closed. Reload and retry.');
      const closed = await tx.academicYear.findFirst({ where: { tenantId, id } });
      if (!closed) throw AppError.notFound('Academic year');
      await this.audit.record(tx, { tenantId, actorId, action: 'ACADEMIC_YEAR_CLOSED', entityType: 'AcademicYear', entityId: id, before: { isCurrent: current.isCurrent }, after: { isClosed: true, isCurrent: false } });
      return closed;
    });
  }

  async listGroups(tenantId: string, raw: Record<string, unknown>) {
    this.assertTenant(tenantId);
    const query = parseListQuery(raw, { allowedSortFields: ['name', 'code', 'active', 'isDynamic'] });
    const where: Prisma.StudentGroupWhereInput = { tenantId, deletedAt: null, ...(query.status?.length ? { active: query.status.includes('active') } : {}), ...buildSearchFilter(query.search, ['name', 'code', 'description']) };
    const [groups, total] = await Promise.all([
      this.prisma.db.studentGroup.findMany({ where, orderBy: toPrismaOrderBy(query.sort) as Prisma.StudentGroupOrderByWithRelationInput[], skip: query.skip, take: query.take }),
      this.prisma.db.studentGroup.count({ where }),
    ]);
    const groupIds = groups.map(({ id }) => id);
    const memberCounts = groupIds.length ? await this.prisma.db.studentGroupMember.groupBy({ by: ['groupId'], where: { tenantId, groupId: { in: groupIds } }, _count: { _all: true } }) : [];
    const countByGroup = new Map(memberCounts.map((row) => [row.groupId, row._count._all]));
    const items = groups.map((group) => ({ ...group, _count: { members: countByGroup.get(group.id) ?? 0 } }));
    return paginate(items, total, query);
  }

  async getGroup(tenantId: string, id: string) {
    this.assertTenant(tenantId);
    const group = await this.prisma.db.studentGroup.findFirst({ where: { tenantId, id, deletedAt: null } });
    if (!group) throw AppError.notFound('Student group');
    const members = await this.prisma.db.studentGroupMember.findMany({ where: { tenantId, groupId: id }, orderBy: { addedAt: 'desc' }, take: 5000 });
    const studentIds = [...new Set(members.map(({ studentId }) => studentId))];
    const students = studentIds.length ? await this.prisma.db.student.findMany({ where: { tenantId, id: { in: studentIds } }, select: { id: true, admissionNumber: true, firstName: true, lastName: true, status: true } }) : [];
    const studentById = new Map(students.map((student) => [student.id, student]));
    return { ...group, members: members.flatMap((member) => {
      const student = studentById.get(member.studentId);
      return student ? [{ ...member, student }] : [];
    }) };
  }

  async createGroup(tenantId: string, input: CreateStudentGroupInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    try {
      return await this.prisma.transactionWithRetry(async (tx) => {
        const group = await tx.studentGroup.create({
          data: {
            id: randomUUID(), tenantId, name: input.name, code: input.code.toUpperCase(), description: clean(input.description),
            isDynamic: input.mode === 'DYNAMIC', membershipRule: input.mode === 'DYNAMIC' ? input.membershipRule as Prisma.InputJsonValue : Prisma.JsonNull,
          },
        });
        await this.audit.record(tx, { tenantId, actorId, action: 'STUDENT_GROUP_CREATED', entityType: 'StudentGroup', entityId: group.id, after: { code: group.code, isDynamic: group.isDynamic, membershipRule: group.membershipRule } });
        return group;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict('STUDENT_GROUP_CODE_EXISTS', 'A student group with this code already exists in this institution.');
      throw error;
    }
  }

  async updateGroup(tenantId: string, id: string, input: UpdateStudentGroupInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    try {
      return await this.prisma.transactionWithRetry(async (tx) => {
        const current = await tx.studentGroup.findFirst({ where: { tenantId, id, deletedAt: null } });
        if (!current) throw AppError.notFound('Student group');
        const updated = await tx.studentGroup.updateMany({
          where: { tenantId, id, updatedAt: current.updatedAt, deletedAt: null },
          data: {
            name: input.name, code: input.code.toUpperCase(), description: clean(input.description),
            isDynamic: input.mode === 'DYNAMIC', membershipRule: input.mode === 'DYNAMIC' ? input.membershipRule as Prisma.InputJsonValue : Prisma.JsonNull,
          },
        });
        if (updated.count !== 1) throw AppError.conflict('STUDENT_GROUP_CHANGED', 'This group changed while it was being edited. Reload and retry.');
        if (input.mode === 'DYNAMIC') await tx.studentGroupMember.deleteMany({ where: { tenantId, groupId: id } });
        const result = await tx.studentGroup.findFirst({ where: { tenantId, id, deletedAt: null } });
        if (!result) throw AppError.notFound('Student group');
        await this.audit.record(tx, { tenantId, actorId, action: 'STUDENT_GROUP_UPDATED', entityType: 'StudentGroup', entityId: id, before: { isDynamic: current.isDynamic, code: current.code }, after: { isDynamic: result.isDynamic, code: result.code, membershipRule: result.membershipRule } });
        return result;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict('STUDENT_GROUP_CODE_EXISTS', 'A student group with this code already exists in this institution.');
      throw error;
    }
  }

  async replaceGroupMembers(tenantId: string, id: string, input: ReplaceStudentGroupMembersInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const group = await tx.studentGroup.findFirst({ where: { tenantId, id, active: true, deletedAt: null } });
      if (!group) throw AppError.notFound('Student group');
      if (group.isDynamic) throw AppError.conflict('DYNAMIC_GROUP_MEMBERSHIP_RULE', 'Dynamic group membership is calculated from its rule and cannot be edited student by student.');
      const studentIds = [...new Set(input.studentIds)];
      const students = studentIds.length ? await tx.student.findMany({ where: { tenantId, id: { in: studentIds }, status: 'ACTIVE', deletedAt: null }, select: { id: true } }) : [];
      if (students.length !== studentIds.length) throw AppError.validation('Every selected student must be active and belong to this institution.');
      const before = await tx.studentGroupMember.findMany({ where: { tenantId, groupId: id }, select: { studentId: true } });
      await tx.studentGroupMember.deleteMany({ where: { tenantId, groupId: id } });
      if (studentIds.length) await tx.studentGroupMember.createMany({ data: studentIds.map((studentId) => ({ tenantId, groupId: id, studentId, addedBy: actorId ?? null })) });
      await this.audit.record(tx, { tenantId, actorId, action: 'STUDENT_GROUP_MEMBERS_REPLACED', entityType: 'StudentGroup', entityId: id, before: { studentIds: before.map((row) => row.studentId) }, after: { studentIds } });
      return { groupId: id, memberCount: studentIds.length };
    });
  }

  private assertTenant(tenantId: string): void {
    if (this.tenantContext.requireTenantId() !== tenantId) throw AppError.forbidden('The requested tenant does not match the authenticated session.');
  }
}

@ApiTags('academic years')
@RequireModules('ADMISSIONS')
@Controller('academic-years')
export class AcademicYearsController {
  constructor(private readonly academics: AcademicOperationsService) {}
  @Get() @RequirePermissions(PERMISSIONS.TENANT_SETTINGS_READ) list(@CurrentTenant() tenant: string, @Query() query: Record<string, unknown>) { return this.academics.listYears(tenant, query); }
  @Post() @RequirePermissions(PERMISSIONS.TENANT_SETTINGS_UPDATE) @UsePipes(new ZodValidationPipe(createAcademicYearSchema)) @ApiOperation({ summary: 'Create a tenant academic year' }) create(@CurrentTenant() tenant: string, @Body() body: CreateAcademicYearInput) { return this.academics.createYear(tenant, body); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.TENANT_SETTINGS_UPDATE) @UsePipes(new ZodValidationPipe(updateAcademicYearSchema)) update(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: UpdateAcademicYearInput) { return this.academics.updateYear(tenant, id, body); }
  @Post(':id/close') @RequirePermissions(PERMISSIONS.TENANT_SETTINGS_UPDATE) close(@CurrentTenant() tenant: string, @Param('id') id: string) { return this.academics.closeYear(tenant, id); }
}

@ApiTags('student groups')
@RequireModules('ADMISSIONS')
@Controller('student-groups')
export class StudentGroupsController {
  constructor(private readonly academics: AcademicOperationsService) {}
  @Get() @RequirePermissions(PERMISSIONS.STUDENT_READ) list(@CurrentTenant() tenant: string, @Query() query: Record<string, unknown>) { return this.academics.listGroups(tenant, query); }
  @Get(':id') @RequirePermissions(PERMISSIONS.STUDENT_READ) get(@CurrentTenant() tenant: string, @Param('id') id: string) { return this.academics.getGroup(tenant, id); }
  @Post() @RequirePermissions(PERMISSIONS.STUDENT_CREATE) @UsePipes(new ZodValidationPipe(createStudentGroupSchema)) create(@CurrentTenant() tenant: string, @Body() body: CreateStudentGroupInput) { return this.academics.createGroup(tenant, body); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.STUDENT_UPDATE) @UsePipes(new ZodValidationPipe(updateStudentGroupSchema)) update(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: UpdateStudentGroupInput) { return this.academics.updateGroup(tenant, id, body); }
  @Put(':id/members') @RequirePermissions(PERMISSIONS.STUDENT_UPDATE) @UsePipes(new ZodValidationPipe(replaceStudentGroupMembersSchema)) setMembers(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: ReplaceStudentGroupMembersInput) { return this.academics.replaceGroupMembers(tenant, id, body); }
}

@Module({ imports: [PrismaModule, TenantContextModule], controllers: [AcademicYearsController, StudentGroupsController], providers: [AcademicOperationsService] })
export class AcademicOperationsModule {}

function dateValue(value: string): Date { return new Date(`${value}T00:00:00.000Z`); }
function clean(value: string | null | undefined): string | null { return value?.trim() || null; }
