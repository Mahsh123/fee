import { describe, expect, it } from 'vitest';
import { createAttendanceSessionSchema } from './attendance';

const studentA = '71ea7ed7-6bdb-45a4-a1b4-8ca5ab920001';
const studentB = '71ea7ed7-6bdb-45a4-a1b4-8ca5ab920002';

describe('attendance request validation', () => {
  it('requires a valid date, branch, group and unique student roster', () => {
    const input = {
      branchId: '71ea7ed7-6bdb-45a4-a1b4-8ca5ab920010',
      academicUnitId: '71ea7ed7-6bdb-45a4-a1b4-8ca5ab920011',
      attendanceDate: '2026-02-30',
      idempotencyKey: 'attendance-key-1',
      records: [{ studentId: studentA, status: 'PRESENT' }, { studentId: studentA, status: 'ABSENT' }],
    };
    expect(createAttendanceSessionSchema.safeParse(input).success).toBe(false);
  });

  it('defaults the session label and accepts a valid unique roster', () => {
    const result = createAttendanceSessionSchema.parse({
      branchId: '71ea7ed7-6bdb-45a4-a1b4-8ca5ab920010',
      academicUnitId: '71ea7ed7-6bdb-45a4-a1b4-8ca5ab920011',
      attendanceDate: '2026-10-12',
      idempotencyKey: 'attendance-key-1',
      records: [{ studentId: studentA, status: 'PRESENT' }, { studentId: studentB, status: 'LATE', remarks: 'Arrived after assembly' }],
    });
    expect(result.sessionLabel).toBe('FULL_DAY');
  });
});
