import { z } from 'zod';

const uuid = z.string().uuid();
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}, 'Enter a valid calendar date.');

const attendanceRecordSchema = z.object({
  studentId: uuid,
  status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']),
  remarks: z.string().trim().max(500).nullable().optional(),
});

export const createAttendanceSessionSchema = z.object({
  branchId: uuid,
  academicUnitId: uuid,
  attendanceDate: calendarDate,
  sessionLabel: z.string().trim().min(1).max(40).default('FULL_DAY'),
  idempotencyKey: z.string().trim().min(8).max(200),
  records: z.array(attendanceRecordSchema).min(1).max(2000)
    .refine((records) => new Set(records.map(({ studentId }) => studentId)).size === records.length, 'Each student can be included only once.'),
});

export const correctAttendanceRecordsSchema = z.object({
  records: z.array(attendanceRecordSchema).min(1).max(2000)
    .refine((records) => new Set(records.map(({ studentId }) => studentId)).size === records.length, 'Each student can be included only once.'),
});

export const attendanceRosterQuerySchema = z.object({
  branchId: uuid,
  date: calendarDate,
  sessionLabel: z.string().trim().min(1).max(40).default('FULL_DAY'),
});

const personAttendanceRecordSchema = z.object({
  personId: uuid,
  status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']),
  remarks: z.string().trim().max(500).nullable().optional(),
});

export const personAttendanceRosterQuerySchema = z.object({
  branchId: uuid,
  date: calendarDate,
  sessionLabel: z.string().trim().min(1).max(40).default('FULL_DAY'),
  personGroupId: uuid.optional(),
});

export const createPersonAttendanceSessionSchema = z.object({
  branchId: uuid,
  personGroupId: uuid.nullable().optional(),
  attendanceDate: calendarDate,
  sessionLabel: z.string().trim().min(1).max(40).default('FULL_DAY'),
  idempotencyKey: z.string().trim().min(8).max(200),
  records: z.array(personAttendanceRecordSchema).min(1).max(2000)
    .refine((records) => new Set(records.map(({ personId }) => personId)).size === records.length, 'Each person can be included only once.'),
});

export const correctPersonAttendanceRecordsSchema = z.object({
  records: z.array(personAttendanceRecordSchema).min(1).max(2000)
    .refine((records) => new Set(records.map(({ personId }) => personId)).size === records.length, 'Each person can be included only once.'),
});

export type CreateAttendanceSessionInput = z.infer<typeof createAttendanceSessionSchema>;
export type CorrectAttendanceRecordsInput = z.infer<typeof correctAttendanceRecordsSchema>;
export type AttendanceRosterQuery = z.infer<typeof attendanceRosterQuerySchema>;
export type PersonAttendanceRosterQuery = z.infer<typeof personAttendanceRosterQuerySchema>;
export type CreatePersonAttendanceSessionInput = z.infer<typeof createPersonAttendanceSessionSchema>;
export type CorrectPersonAttendanceRecordsInput = z.infer<typeof correctPersonAttendanceRecordsSchema>;
