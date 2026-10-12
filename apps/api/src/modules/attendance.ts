import { Body, Controller, Get, Injectable, Module, Param, Patch, Post, Query, UsePipes } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createHash, randomUUID } from 'node:crypto';
import { isUniqueViolation } from '@fee/database';
import { PERMISSIONS } from '@fee/types';
import {
  attendanceRosterQuerySchema,
  correctAttendanceRecordsSchema,
  createAttendanceSessionSchema,
  type AttendanceRosterQuery,
  type CorrectAttendanceRecordsInput,
  type CreateAttendanceSessionInput,
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
            { memberships: { some: { academicUnitId, OR: [{ endedOn: null }, { endedOn: { gte: new Date(`${query.date}T00:00:00.000Z`) } }] } } },
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
    await this.assertStudentsBelongToSession(tenantId, input.branchId, input.academicUnitId, input.records.map(({ studentId }) => studentId));
    try {
      return await this.prisma.transactionWithRetry(async (tx) => {
        const session = await tx.attendanceSession.create({
          data: {
            id: randomUUID(), tenantId, branchId: input.branchId, academicUnitId: input.academicUnitId,
            attendanceDate: dateValue(input.attendanceDate), sessionLabel: input.sessionLabel,
            idempotencyKey: input.idempotencyKey, requestFingerprint, markedBy: actor.userId!,
            records: { createMany: { data: input.records.map((record) => ({ id: randomUUID(), tenantId, studentId: record.studentId, status: record.status, remarks: record.remarks?.trim() || null, updatedBy: actor.userId! })) } },
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
      if (isUniqueViolation(error)) throw AppError.conflict('ATTENDANCE_SESSION_EXISTS', 'Attendance was already marked for this group, branch, date, and session. Open the existing session to make an authorised correction.');
      throw error;
    }
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

  private async assertStudentsBelongToSession(tenantId: string, branchId: string, academicUnitId: string, studentIds: string[]) {
    const eligible = await this.prisma.db.student.findMany({
      where: {
        tenantId, branchId, id: { in: studentIds }, deletedAt: null, status: 'ACTIVE',
        OR: [
          { primaryUnitId: academicUnitId },
          { memberships: { some: { academicUnitId } } },
        ],
      },
      select: { id: true },
    });
    if (eligible.length !== studentIds.length) throw AppError.validation('Every student must be active, assigned to this group, and belong to the selected branch.');
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
  @UsePipes(new ZodValidationPipe(attendanceRosterQuerySchema))
  @ApiOperation({ summary: 'Read a branch and group-scoped attendance roster for a date' })
  roster(@CurrentTenant() tenant: string, @Param('unitId') unitId: string, @Query() query: AttendanceRosterQuery) {
    return this.attendance.roster(tenant, unitId, query);
  }

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
