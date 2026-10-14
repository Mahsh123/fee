import { Body, Controller, Get, Injectable, Module, Param, Patch, Post, Query, UsePipes } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createHash, randomUUID } from 'node:crypto';
import { isUniqueViolation } from '@fee/database';
import { PERMISSIONS } from '@fee/types';
import {
  attendanceRosterQuerySchema,
  correctAttendanceRecordsSchema,
  correctPersonAttendanceRecordsSchema,
  createAttendanceSessionSchema,
  createPersonAttendanceSessionSchema,
  personAttendanceRosterQuerySchema,
  type AttendanceRosterQuery,
  type CorrectPersonAttendanceRecordsInput,
  type CorrectAttendanceRecordsInput,
  type CreatePersonAttendanceSessionInput,
  type CreateAttendanceSessionInput,
  type PersonAttendanceRosterQuery,
} from '@fee/validation';
import { AppError } from '../common/errors';
import { AuditService, FinancialModule } from '../common/financial';
import { ZodValidationPipe } from '../common/http';
import { PrismaModule, PrismaService } from '../common/prisma.service';
import { CurrentTenant, PortalRoute, RequireModules, RequirePermissions, TenantContextModule, TenantContextService } from '../common/tenancy';

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService, private readonly context: TenantContextService, private readonly audit: AuditService) {}

  async roster(tenantId: string, academicUnitId: string, query: AttendanceRosterQuery) {
    this.assertTenant(tenantId);
    const actor = this.context.require();
    this.assertBranchAccess(actor, query.branchId);
    const [unit, branch, students, session] = await Promise.all([
      this.prisma.db.academicUnit.findFirst({ where: { tenantId, id: academicUnitId, active: true, deletedAt: null }, select: { id: true, name: true, code: true, unitType: true } }),
      this.prisma.db.branch.findFirst({ where: { tenantId, id: query.branchId, status: 'ACTIVE' }, select: { id: true, name: true, code: true } }),
      this.prisma.db.student.findMany({
        where: {
          tenantId, branchId: query.branchId, deletedAt: null, status: 'ACTIVE',
          OR: [
            { primaryUnitId: academicUnitId },
            { memberships: { some: { academicUnitId, startedOn: { lte: dateValue(query.date) }, OR: [{ endedOn: null }, { endedOn: { gte: dateValue(query.date) } }] } } },
          ],
        },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { admissionNumber: 'asc' }],
        take: 2000,
        select: { id: true, admissionNumber: true, rollNumber: true, firstName: true, middleName: true, lastName: true },
      }),
      this.prisma.db.attendanceSession.findFirst({
        where: { tenantId, branchId: query.branchId, academicUnitId, attendanceDate: dateValue(query.date), sessionLabel: query.sessionLabel },
        include: { records: { select: { studentId: true, status: true, remarks: true } } },
      }),
    ]);
    if (!unit) throw AppError.notFound('Academic unit');
    if (!branch) throw AppError.notFound('Active branch');
    const statusByStudent = new Map(session?.records.map((record) => [record.studentId, record]) ?? []);
    return {
      branch, academicUnit: unit, attendanceDate: query.date, sessionLabel: query.sessionLabel,
      sessionId: session?.id ?? null,
      students: students.map((student) => ({ ...student, attendance: statusByStudent.get(student.id) ?? null })),
    };
  }

  async mark(tenantId: string, input: CreateAttendanceSessionInput) {
    this.assertTenant(tenantId);
    const actor = this.context.require();
    if (!actor.userId) throw AppError.forbidden('A signed-in staff user is required to mark attendance.');
    this.assertBranchAccess(actor, input.branchId);
    const requestFingerprint = attendanceFingerprint(input);
    const existing = await this.prisma.db.attendanceSession.findFirst({
      where: { tenantId, idempotencyKey: input.idempotencyKey },
      include: { records: { orderBy: { studentId: 'asc' }, select: { studentId: true, status: true, remarks: true } } },
    });
    if (existing) {
      this.assertBranchAccess(actor, existing.branchId);
      if (existing.requestFingerprint !== requestFingerprint) throw AppError.conflict('ATTENDANCE_IDEMPOTENCY_REUSED', 'This idempotency key was already used for a different attendance request.');
      return existing;
    }

    await this.assertActiveBranchAndUnit(tenantId, input.branchId, input.academicUnitId);
    const personByStudent = await this.assertStudentsBelongToSession(tenantId, input.branchId, input.academicUnitId, input.attendanceDate, input.records.map(({ studentId }) => studentId));
    try {
      return await this.prisma.transactionWithRetry(async (tx) => {
        const session = await tx.attendanceSession.create({
          data: {
            id: randomUUID(), tenantId, branchId: input.branchId, academicUnitId: input.academicUnitId,
            attendanceDate: dateValue(input.attendanceDate), sessionLabel: input.sessionLabel,
            idempotencyKey: input.idempotencyKey, requestFingerprint, markedBy: actor.userId!,
            records: { createMany: { data: input.records.map((record) => ({ id: randomUUID(), tenantId, studentId: record.studentId, personId: personByStudent.get(record.studentId)!, status: record.status, remarks: record.remarks?.trim() || null, updatedBy: actor.userId! })) } },
          },
          include: { records: { orderBy: { studentId: 'asc' }, select: { studentId: true, status: true, remarks: true } } },
        });
        await this.audit.record(tx, {
          tenantId, actorId: actor.userId, action: 'attendance.session.marked', entityType: 'AttendanceSession', entityId: session.id,
          after: { branchId: input.branchId, academicUnitId: input.academicUnitId, attendanceDate: input.attendanceDate, sessionLabel: input.sessionLabel, recordCount: input.records.length },
        });
        return session;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const raced = await this.prisma.db.attendanceSession.findFirst({
          where: { tenantId, idempotencyKey: input.idempotencyKey },
          include: { records: { orderBy: { studentId: 'asc' }, select: { studentId: true, status: true, remarks: true } } },
        });
        if (raced) {
          this.assertBranchAccess(actor, raced.branchId);
          if (raced.requestFingerprint !== requestFingerprint) throw AppError.conflict('ATTENDANCE_IDEMPOTENCY_REUSED', 'This idempotency key was already used for a different attendance request.');
          return raced;
        }
        throw AppError.conflict('ATTENDANCE_SESSION_EXISTS', 'Attendance was already marked for this group, branch, date, and session. Open the existing session to make an authorised correction.');
      }
      throw error;
    }
  }

  async peopleRoster(tenantId: string, query: PersonAttendanceRosterQuery) {
    this.assertTenant(tenantId);
    const actor = this.context.require();
    this.assertBranchAccess(actor, query.branchId);
    const attendanceDate = dateValue(query.date);
    const [branch, group, people, session] = await Promise.all([
      this.prisma.db.branch.findFirst({ where: { tenantId, id: query.branchId, status: 'ACTIVE' }, select: { id: true, name: true, code: true } }),
      query.personGroupId ? this.prisma.db.tenantPersonGroup.findFirst({ where: { tenantId, id: query.personGroupId, active: true }, select: { id: true, name: true, code: true } }) : Promise.resolve(null),
      this.prisma.db.tenantPerson.findMany({
        where: {
          tenantId, branchId: query.branchId, status: 'ACTIVE', deletedAt: null,
          ...(query.personGroupId ? { groupMemberships: { some: { tenantId, groupId: query.personGroupId, startedOn: { lte: attendanceDate }, OR: [{ endedOn: null }, { endedOn: { gte: attendanceDate } }] } } } : {}),
        },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { personNumber: 'asc' }], take: 2000,
        select: { id: true, personNumber: true, typeKey: true, typeLabel: true, firstName: true, middleName: true, lastName: true },
      }),
      this.prisma.db.attendanceSession.findFirst({
        where: { tenantId, branchId: query.branchId, academicUnitId: null, personGroupId: query.personGroupId ?? null, attendanceDate, sessionLabel: query.sessionLabel },
        include: { records: { select: { personId: true, status: true, remarks: true } } },
      }),
    ]);
    if (!branch) throw AppError.notFound('Active branch');
    if (query.personGroupId && !group) throw AppError.notFound('Active people group');
    this.assertBranchAccess(actor, query.branchId);
    const statusByPerson = new Map(session?.records.map((record) => [record.personId, record]) ?? []);
    return {
      branch, personGroup: group, attendanceDate: query.date, sessionLabel: query.sessionLabel, sessionId: session?.id ?? null,
      people: people.map((person) => ({ ...person, attendance: statusByPerson.get(person.id) ?? null })),
    };
  }

  async markPeople(tenantId: string, input: CreatePersonAttendanceSessionInput) {
    this.assertTenant(tenantId);
    const actor = this.context.require();
    if (!actor.userId) throw AppError.forbidden('A signed-in staff user is required to mark attendance.');
    this.assertBranchAccess(actor, input.branchId);
    const requestFingerprint = personAttendanceFingerprint(input);
    const where = { tenantId, idempotencyKey: input.idempotencyKey };
    const existing = await this.prisma.db.attendanceSession.findFirst({ where, include: { records: { orderBy: { personId: 'asc' }, select: { personId: true, status: true, remarks: true } } } });
    if (existing) {
      this.assertBranchAccess(actor, existing.branchId);
      if (existing.academicUnitId !== null || existing.requestFingerprint !== requestFingerprint) throw AppError.conflict('ATTENDANCE_IDEMPOTENCY_REUSED', 'This idempotency key was already used for a different attendance request.');
      return existing;
    }
    const attendanceDate = dateValue(input.attendanceDate);
    const [branch, group, people] = await Promise.all([
      this.prisma.db.branch.findFirst({ where: { tenantId, id: input.branchId, status: 'ACTIVE' }, select: { id: true } }),
      input.personGroupId ? this.prisma.db.tenantPersonGroup.findFirst({ where: { tenantId, id: input.personGroupId, active: true }, select: { id: true } }) : Promise.resolve(null),
      this.prisma.db.tenantPerson.findMany({
        where: {
          tenantId, id: { in: input.records.map(({ personId }) => personId) }, branchId: input.branchId, status: 'ACTIVE', deletedAt: null,
          ...(input.personGroupId ? { groupMemberships: { some: { tenantId, groupId: input.personGroupId, startedOn: { lte: attendanceDate }, OR: [{ endedOn: null }, { endedOn: { gte: attendanceDate } }] } } } : {}),
        }, select: { id: true },
      }),
    ]);
    if (!branch) throw AppError.validation('Choose an active branch from this organization.');
    if (input.personGroupId && !group) throw AppError.validation('Choose an active people group from this organization.');
    if (people.length !== input.records.length) throw AppError.validation('Every person must be active, assigned to this branch, and included in the selected group.');
    try {
      return await this.prisma.transactionWithRetry(async (tx) => {
        const session = await tx.attendanceSession.create({
          data: {
            id: randomUUID(), tenantId, branchId: input.branchId, academicUnitId: null, personGroupId: input.personGroupId ?? null,
            attendanceDate, sessionLabel: input.sessionLabel, idempotencyKey: input.idempotencyKey, requestFingerprint, markedBy: actor.userId!,
            records: { createMany: { data: input.records.map((record) => ({ id: randomUUID(), tenantId, personId: record.personId, studentId: null, status: record.status, remarks: record.remarks?.trim() || null, updatedBy: actor.userId! })) } },
          },
          include: { records: { orderBy: { personId: 'asc' }, select: { personId: true, status: true, remarks: true } } },
        });
        await this.audit.record(tx, { tenantId, actorId: actor.userId, action: 'attendance.people_session.marked', entityType: 'AttendanceSession', entityId: session.id, after: { branchId: input.branchId, personGroupId: input.personGroupId ?? null, attendanceDate: input.attendanceDate, sessionLabel: input.sessionLabel, recordCount: input.records.length } });
        return session;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.prisma.db.attendanceSession.findFirst({ where, include: { records: { orderBy: { personId: 'asc' }, select: { personId: true, status: true, remarks: true } } } });
      if (raced) {
        this.assertBranchAccess(actor, raced.branchId);
        if (raced.academicUnitId !== null || raced.requestFingerprint !== requestFingerprint) throw AppError.conflict('ATTENDANCE_IDEMPOTENCY_REUSED', 'This idempotency key was already used for a different attendance request.');
        return raced;
      }
      throw AppError.conflict('ATTENDANCE_SESSION_EXISTS', 'Attendance was already marked for this group, branch, date, and session. Open the existing register to make an authorised correction.');
    }
  }

  async correctPeople(tenantId: string, sessionId: string, input: CorrectPersonAttendanceRecordsInput) {
    this.assertTenant(tenantId);
    const actor = this.context.require();
    if (!actor.userId) throw AppError.forbidden('A signed-in staff user is required to correct attendance.');
    const current = await this.prisma.db.attendanceSession.findFirst({ where: { tenantId, id: sessionId }, include: { records: true } });
    if (!current || current.academicUnitId !== null) throw AppError.notFound('People attendance session');
    this.assertBranchAccess(actor, current.branchId);
    const byPerson = new Map(current.records.map((record) => [record.personId, record]));
    if (input.records.some(({ personId }) => !byPerson.has(personId))) throw AppError.validation('Corrections can only change people already included in this attendance session.');
    return this.prisma.transactionWithRetry(async (tx) => {
      const before = input.records.map(({ personId }) => { const row = byPerson.get(personId)!; return { personId, status: row.status, remarks: row.remarks }; });
      for (const record of input.records) await tx.attendanceRecord.updateMany({ where: { tenantId, sessionId, personId: record.personId }, data: { status: record.status, remarks: record.remarks?.trim() || null, updatedBy: actor.userId!, updatedAt: new Date() } });
      await tx.attendanceSession.updateMany({ where: { tenantId, id: sessionId }, data: { updatedAt: new Date() } });
      const updated = await tx.attendanceSession.findFirst({ where: { tenantId, id: sessionId }, include: { records: { orderBy: { personId: 'asc' }, select: { personId: true, status: true, remarks: true } } } });
      if (!updated) throw AppError.notFound('People attendance session');
      await this.audit.record(tx, { tenantId, actorId: actor.userId, action: 'attendance.people_session.corrected', entityType: 'AttendanceSession', entityId: sessionId, before: { records: before }, after: { records: input.records } });
      return updated;
    });
  }

  async correct(tenantId: string, sessionId: string, input: CorrectAttendanceRecordsInput) {
    this.assertTenant(tenantId);
    const actor = this.context.require();
    if (!actor.userId) throw AppError.forbidden('A signed-in staff user is required to correct attendance.');
    const current = await this.prisma.db.attendanceSession.findFirst({ where: { tenantId, id: sessionId }, include: { records: true } });
    if (!current) throw AppError.notFound('Attendance session');
    this.assertBranchAccess(actor, current.branchId);
    const currentByStudent = new Map(current.records.map((record) => [record.studentId, record]));
    if (input.records.some(({ studentId }) => !currentByStudent.has(studentId))) {
      throw AppError.validation('Corrections can only change students already included in this attendance session.');
    }
    return this.prisma.transactionWithRetry(async (tx) => {
      const before = input.records.map(({ studentId }) => {
        const row = currentByStudent.get(studentId)!;
        return { studentId, status: row.status, remarks: row.remarks };
      });
      for (const record of input.records) {
        await tx.attendanceRecord.updateMany({
          where: { tenantId, sessionId, studentId: record.studentId },
          data: { status: record.status, remarks: record.remarks?.trim() || null, updatedBy: actor.userId!, updatedAt: new Date() },
        });
      }
      await tx.attendanceSession.updateMany({ where: { tenantId, id: sessionId }, data: { updatedAt: new Date() } });
      const updated = await tx.attendanceSession.findFirst({ where: { tenantId, id: sessionId }, include: { records: { orderBy: { studentId: 'asc' }, select: { studentId: true, status: true, remarks: true } } } });
      if (!updated) throw AppError.notFound('Attendance session');
      await this.audit.record(tx, {
        tenantId, actorId: actor.userId, action: 'attendance.session.corrected', entityType: 'AttendanceSession', entityId: sessionId,
        before: { records: before }, after: { records: input.records },
      });
      return updated;
    });
  }

  async portalAttendance(tenantId: string) {
    this.assertTenant(tenantId);
    const actor = this.context.require();
    if (actor.roles?.includes('WORKSPACE_PERSON') && actor.userId) {
      const user = await this.prisma.db.user.findFirst({ where: { tenantId, id: actor.userId, status: 'ACTIVE', deletedAt: null }, select: { tenantPersonId: true } });
      if (!user?.tenantPersonId) throw AppError.forbidden('This portal account is not linked to an active person profile. Contact the organization administrator.');
      return this.prisma.db.attendanceRecord.findMany({
        where: { tenantId, personId: user.tenantPersonId, session: { academicUnitId: null } },
        orderBy: [{ session: { attendanceDate: 'desc' } }, { createdAt: 'desc' }], take: 200,
        select: { personId: true, status: true, remarks: true, person: { select: { id: true, personNumber: true, typeLabel: true, firstName: true, middleName: true, lastName: true } }, session: { select: { attendanceDate: true, sessionLabel: true, personGroup: { select: { name: true, code: true } }, branch: { select: { name: true } } } } },
      });
    }
    const allowedStudentIds = await this.allowedPortalStudentIds(tenantId, actor.roles ?? [], actor.studentId, actor.guardianId);
    const records = await this.prisma.db.attendanceRecord.findMany({
      where: { tenantId, studentId: { in: allowedStudentIds } },
      orderBy: [{ session: { attendanceDate: 'desc' } }, { createdAt: 'desc' }],
      take: 200,
      select: {
        studentId: true, status: true, remarks: true,
        student: { select: { id: true, firstName: true, middleName: true, lastName: true, admissionNumber: true } },
        session: { select: { attendanceDate: true, sessionLabel: true, academicUnit: { select: { name: true, code: true } }, branch: { select: { name: true } } } },
      },
    });
    return records;
  }

  private async assertActiveBranchAndUnit(tenantId: string, branchId: string, academicUnitId: string) {
    const [branch, unit] = await Promise.all([
      this.prisma.db.branch.findFirst({ where: { tenantId, id: branchId, status: 'ACTIVE' }, select: { id: true } }),
      this.prisma.db.academicUnit.findFirst({ where: { tenantId, id: academicUnitId, active: true, deletedAt: null }, select: { id: true } }),
    ]);
    if (!branch) throw AppError.validation('Choose an active branch from this organization.');
    if (!unit) throw AppError.validation('Choose an active group from this organization.');
  }

  private async assertStudentsBelongToSession(tenantId: string, branchId: string, academicUnitId: string, attendanceDate: string, studentIds: string[]): Promise<Map<string, string>> {
    const eligible = await this.prisma.db.student.findMany({
      where: {
        tenantId, branchId, id: { in: studentIds }, deletedAt: null, status: 'ACTIVE',
        OR: [
          { primaryUnitId: academicUnitId },
          { memberships: { some: { academicUnitId, startedOn: { lte: dateValue(attendanceDate) }, OR: [{ endedOn: null }, { endedOn: { gte: dateValue(attendanceDate) } }] } } },
        ],
      },
      select: { id: true, personId: true },
    });
    if (eligible.length !== studentIds.length) throw AppError.validation('Every student must be active, assigned to this group, and belong to the selected branch.');
    if (eligible.some((student) => !student.personId)) throw AppError.conflict('PERSON_PROFILE_MISSING', 'One or more students have not been linked to the shared person profile yet. Run the tenant people migration before marking attendance.');
    return new Map(eligible.map((student) => [student.id, student.personId!]));
  }

  private async allowedPortalStudentIds(tenantId: string, roles: string[], studentId?: string | null, guardianId?: string | null): Promise<string[]> {
    const ids: string[] = [];
    if (roles.includes('STUDENT') && studentId) ids.push(studentId);
    if (roles.includes('PARENT') && guardianId) {
      const links = await this.prisma.db.studentGuardian.findMany({ where: { tenantId, guardianId }, select: { studentId: true } });
      ids.push(...links.map(({ studentId: linkedId }) => linkedId));
    }
    const uniqueIds = [...new Set(ids)];
    if (!uniqueIds.length) throw AppError.forbidden('This portal account is not linked to an active student. Contact the organization administrator.');
    return uniqueIds;
  }

  private assertBranchAccess(actor: ReturnType<TenantContextService['require']>, branchId: string) {
    if (actor.branchScopeEnabled && !(actor.branchIds ?? []).includes(branchId)) throw AppError.forbidden('This branch is outside your assigned access.');
  }

  private assertTenant(tenantId: string) {
    if (this.context.requireTenantId() !== tenantId) throw AppError.forbidden('The requested tenant does not match the authenticated session.');
  }
}

@ApiTags('attendance')
@RequireModules('ATTENDANCE')
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('units/:unitId/roster')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_READ)
  @UsePipes(new ZodValidationPipe(attendanceRosterQuerySchema, 'query'))
  @ApiOperation({ summary: 'Read a branch and group-scoped attendance roster for a date' })
  roster(@CurrentTenant() tenant: string, @Param('unitId') unitId: string, @Query() query: AttendanceRosterQuery) {
    return this.attendance.roster(tenant, unitId, query);
  }

  @Get('people/roster')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_READ)
  @UsePipes(new ZodValidationPipe(personAttendanceRosterQuerySchema, 'query'))
  @ApiOperation({ summary: 'Read an industry-neutral attendance roster for a branch and optional people group' })
  peopleRoster(@CurrentTenant() tenant: string, @Query() query: PersonAttendanceRosterQuery) { return this.attendance.peopleRoster(tenant, query); }

  @Post('sessions')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_MARK)
  @UsePipes(new ZodValidationPipe(createAttendanceSessionSchema))
  @ApiOperation({ summary: 'Mark an attendance session idempotently' })
  mark(@CurrentTenant() tenant: string, @Body() body: CreateAttendanceSessionInput) { return this.attendance.mark(tenant, body); }

  @Patch('sessions/:id/records')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_CORRECT)
  @UsePipes(new ZodValidationPipe(correctAttendanceRecordsSchema))
  @ApiOperation({ summary: 'Correct existing attendance records with the dedicated correction permission' })
  correct(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: CorrectAttendanceRecordsInput) { return this.attendance.correct(tenant, id, body); }

  @Post('people/sessions')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_MARK)
  @UsePipes(new ZodValidationPipe(createPersonAttendanceSessionSchema))
  @ApiOperation({ summary: 'Mark a branch and people-group attendance session idempotently' })
  markPeople(@CurrentTenant() tenant: string, @Body() body: CreatePersonAttendanceSessionInput) { return this.attendance.markPeople(tenant, body); }

  @Patch('people/sessions/:id/records')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_CORRECT)
  @UsePipes(new ZodValidationPipe(correctPersonAttendanceRecordsSchema))
  @ApiOperation({ summary: 'Correct generic people attendance with the dedicated correction permission' })
  correctPeople(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: CorrectPersonAttendanceRecordsInput) { return this.attendance.correctPeople(tenant, id, body); }
}

@ApiTags('student and parent portal')
@RequireModules('ATTENDANCE')
@Controller('portal/attendance')
export class PortalAttendanceController {
  constructor(private readonly attendance: AttendanceService) {}
  @Get() @PortalRoute() @RequirePermissions(PERMISSIONS.ATTENDANCE_READ)
  @ApiOperation({ summary: 'Read attendance for the signed-in student or linked guardian students' })
  list(@CurrentTenant() tenant: string) { return this.attendance.portalAttendance(tenant); }
}

@Module({ imports: [PrismaModule, TenantContextModule, FinancialModule], controllers: [AttendanceController, PortalAttendanceController], providers: [AttendanceService] })
export class AttendanceModule {}

function dateValue(value: string): Date { return new Date(`${value}T00:00:00.000Z`); }
function attendanceFingerprint(input: CreateAttendanceSessionInput): string {
  const normalized = {
    branchId: input.branchId, academicUnitId: input.academicUnitId, attendanceDate: input.attendanceDate,
    sessionLabel: input.sessionLabel,
    records: [...input.records].sort((left, right) => left.studentId.localeCompare(right.studentId)).map(({ studentId, status, remarks }) => ({ studentId, status, remarks: remarks?.trim() || null })),
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}
function personAttendanceFingerprint(input: CreatePersonAttendanceSessionInput): string {
  const normalized = {
    branchId: input.branchId, personGroupId: input.personGroupId ?? null, attendanceDate: input.attendanceDate,
    sessionLabel: input.sessionLabel,
    records: [...input.records].sort((left, right) => left.personId.localeCompare(right.personId)).map(({ personId, status, remarks }) => ({ personId, status, remarks: remarks?.trim() || null })),
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}
