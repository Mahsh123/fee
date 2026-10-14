import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { TenantContextService } from '../common/tenancy';
import { AttendanceService } from './attendance';

function createAttendanceService(options: {
  studentIds?: string[];
  records?: unknown[];
  attendanceSessionFindFirst?: ReturnType<typeof vi.fn>;
  transactionWithRetry?: ReturnType<typeof vi.fn>;
} = {}) {
  const context = new TenantContextService();
  const guardianFindMany = vi.fn(async () => (options.studentIds ?? []).map((studentId) => ({ studentId })));
  const attendanceFindMany = vi.fn(async () => options.records ?? []);
  const studentFindMany = vi.fn(async () => (options.studentIds ?? []).map((id) => ({ id, personId: `person-${id}` })));
  const attendanceSessionFindFirst = options.attendanceSessionFindFirst ?? vi.fn(async () => null);
  const database = {
    studentGuardian: { findMany: guardianFindMany },
    attendanceRecord: { findMany: attendanceFindMany },
    academicUnit: { findFirst: vi.fn(async () => ({ id: 'unit-a', name: 'Unit A', code: 'A', unitType: 'GROUP' })) },
    branch: { findFirst: vi.fn(async () => ({ id: 'branch-a', name: 'Branch A', code: 'A' })) },
    student: { findMany: studentFindMany },
    attendanceSession: { findFirst: attendanceSessionFindFirst },
  };
  const prisma = { db: database, transactionWithRetry: options.transactionWithRetry ?? vi.fn() };
  const service = new AttendanceService(prisma as never, context, { record: vi.fn() } as never);
  const withIdentity = <T>(identity: Record<string, unknown>, work: () => T, tenantId = 'tenant-a') => context.run({
    tenantId, userId: 'portal-user', isPlatformAdmin: false, ...identity,
  } as never, work);
  return { service, database, guardianFindMany, attendanceFindMany, studentFindMany, attendanceSessionFindFirst, prisma, withIdentity };
}

describe('attendance access scope', () => {
  it('rejects a staff mark request for a branch outside the actor branch assignment before reading data', async () => {
    const { service, database, withIdentity } = createAttendanceService();
    const input = {
      branchId: 'branch-b', academicUnitId: 'unit-a', attendanceDate: '2026-10-12',
      sessionLabel: 'FULL_DAY', idempotencyKey: 'attendance-key-0001', records: [],
    };

    await expect(withIdentity({ roles: ['ADMISSION_STAFF'], branchScopeEnabled: true, branchIds: ['branch-a'] }, () => service.mark('tenant-a', input as never)))
      .rejects.toMatchObject({ status: 403 });
    expect(database.studentGuardian.findMany).not.toHaveBeenCalled();
    expect(database.attendanceRecord.findMany).not.toHaveBeenCalled();
  });

  it('limits a student portal feed to the authenticated student ID and tenant', async () => {
    const { service, attendanceFindMany, guardianFindMany, withIdentity } = createAttendanceService();

    await withIdentity({ roles: ['STUDENT'], studentId: 'student-own' }, () => service.portalAttendance('tenant-a'));

    expect(guardianFindMany).not.toHaveBeenCalled();
    expect(attendanceFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant-a', studentId: { in: ['student-own'] } } }));
  });

  it('resolves parent feed student IDs from tenant-scoped guardian links only', async () => {
    const { service, guardianFindMany, attendanceFindMany, withIdentity } = createAttendanceService({ studentIds: ['student-a', 'student-b'] });

    await withIdentity({ roles: ['PARENT'], guardianId: 'guardian-a' }, () => service.portalAttendance('tenant-a'));

    expect(guardianFindMany).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a', guardianId: 'guardian-a' }, select: { studentId: true } });
    expect(attendanceFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant-a', studentId: { in: ['student-a', 'student-b'] } } }));
  });

  it('rejects a tenant mismatch before database access', async () => {
    const { service, attendanceFindMany, withIdentity } = createAttendanceService();

    await expect(withIdentity({ roles: ['STUDENT'], studentId: 'student-own' }, () => service.portalAttendance('tenant-b')))
      .rejects.toMatchObject({ status: 403 });
    expect(attendanceFindMany).not.toHaveBeenCalled();
  });

  it('includes only students whose group membership was active on the roster date', async () => {
    const { service, studentFindMany, withIdentity } = createAttendanceService();

    await withIdentity({ roles: ['REPORT_VIEWER'] }, () => service.roster('tenant-a', 'unit-a', {
      branchId: 'branch-a', date: '2026-10-12', sessionLabel: 'FULL_DAY',
    }));

    expect(studentFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([{
          memberships: { some: {
            academicUnitId: 'unit-a',
            startedOn: { lte: new Date('2026-10-12T00:00:00.000Z') },
            OR: [{ endedOn: null }, { endedOn: { gte: new Date('2026-10-12T00:00:00.000Z') } }],
          } },
        }]),
      }),
    }));
  });

  it('returns the created matching session when a concurrent retry wins with the same key', async () => {
    const input = {
      branchId: 'branch-a', academicUnitId: 'unit-a', attendanceDate: '2026-10-12',
      sessionLabel: 'FULL_DAY', idempotencyKey: 'attendance-key-0001',
      records: [{ studentId: 'student-a', status: 'PRESENT' }],
    };
    const fingerprint = createHash('sha256').update(JSON.stringify({
      branchId: input.branchId, academicUnitId: input.academicUnitId, attendanceDate: input.attendanceDate,
      sessionLabel: input.sessionLabel,
      records: [{ studentId: 'student-a', status: 'PRESENT', remarks: null }],
    })).digest('hex');
    const created = { id: 'session-a', branchId: 'branch-a', requestFingerprint: fingerprint, records: [{ studentId: 'student-a', status: 'PRESENT', remarks: null }] };
    const attendanceSessionFindFirst = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(created);
    const transactionWithRetry = vi.fn(async () => { throw { code: 'P2002' }; });
    const { service, studentFindMany, withIdentity } = createAttendanceService({ studentIds: ['student-a'], attendanceSessionFindFirst, transactionWithRetry });

    const result = await withIdentity({ roles: ['ADMISSION_STAFF'] }, () => service.mark('tenant-a', input as never));

    expect(result).toEqual(created);
    expect(attendanceSessionFindFirst).toHaveBeenCalledTimes(2);
    expect(studentFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      OR: expect.arrayContaining([expect.objectContaining({
        memberships: { some: expect.objectContaining({
          academicUnitId: 'unit-a',
          startedOn: { lte: new Date('2026-10-12T00:00:00.000Z') },
        }) },
      })]),
    }) }));
  });

  it('marks attendance for generic tenant people scoped to the selected tenant and branch', async () => {
    const personId = 'person-own';
    const peopleFindMany = vi.fn(async () => [{ id: personId }]);
    const createdSession = { id: 'people-session-a', academicUnitId: null, records: [{ personId, studentId: null, status: 'PRESENT', remarks: null }] };
    const attendanceSession = { findFirst: vi.fn(async () => null), create: vi.fn(async () => createdSession) };
    const branch = { findFirst: vi.fn(async () => ({ id: 'branch-a' })) };
    const tenantPersonGroup = { findFirst: vi.fn(async () => null) };
    const audit = { record: vi.fn(async () => undefined) };
    const context = new TenantContextService();
    const tx = { attendanceSession, attendanceRecord: { updateMany: vi.fn() } };
    const prisma = {
      db: { attendanceSession, branch, tenantPersonGroup, tenantPerson: { findMany: peopleFindMany } },
      transactionWithRetry: vi.fn(async (work: (transaction: typeof tx) => unknown) => work(tx)),
    };
    const service = new AttendanceService(prisma as never, context, audit as never);
    const input = {
      branchId: 'branch-a', attendanceDate: '2026-10-12', sessionLabel: 'FULL_DAY',
      idempotencyKey: 'generic-attendance-key-01', records: [{ personId, status: 'PRESENT' }],
    };

    const result = await context.run({ tenantId: 'tenant-a', userId: 'staff-a', requestId: 'generic-attendance-mark-test', roles: ['ATTENDANCE_STAFF'], branchScopeEnabled: false }, () => service.markPeople('tenant-a', input as never));

    expect(result).toBe(createdSession);
    expect(peopleFindMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a', id: { in: [personId] }, branchId: 'branch-a', status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    expect(attendanceSession.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      tenantId: 'tenant-a', branchId: 'branch-a', academicUnitId: null,
      records: { createMany: { data: [expect.objectContaining({ personId, studentId: null, status: 'PRESENT' })] } },
    }) }));
    expect(audit.record).toHaveBeenCalledOnce();
  });

  it('limits generic member attendance feed to the signed-in profile and tenant', async () => {
    const personId = 'person-own';
    const userFindFirst = vi.fn(async () => ({ tenantPersonId: personId }));
    const attendanceFindMany = vi.fn(async () => []);
    const context = new TenantContextService();
    const service = new AttendanceService({ db: { user: { findFirst: userFindFirst }, attendanceRecord: { findMany: attendanceFindMany } } } as never, context, {} as never);

    await context.run({ tenantId: 'tenant-a', userId: 'user-a', requestId: 'generic-attendance-portal-test', roles: ['WORKSPACE_PERSON'] }, () => service.portalAttendance('tenant-a'));

    expect(userFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant-a', id: 'user-a', status: 'ACTIVE', deletedAt: null } }));
    expect(attendanceFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant-a', personId, session: { academicUnitId: null } } }));
  });
});
