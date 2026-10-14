CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED');

CREATE TABLE "attendance_sessions" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "academicUnitId" UUID NOT NULL,
  "attendanceDate" DATE NOT NULL,
  "sessionLabel" VARCHAR(40) NOT NULL DEFAULT 'FULL_DAY',
  "idempotencyKey" VARCHAR(200) NOT NULL,
  "requestFingerprint" CHAR(64) NOT NULL,
  "markedBy" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "attendance_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "attendance_sessions_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "branches"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "attendance_sessions_tenantId_academicUnitId_fkey" FOREIGN KEY ("tenantId", "academicUnitId") REFERENCES "academic_units"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "attendance_sessions_tenantId_markedBy_fkey" FOREIGN KEY ("tenantId", "markedBy") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "attendance_sessions_tenantId_id_key" ON "attendance_sessions"("tenantId", "id");
CREATE UNIQUE INDEX "attendance_sessions_tenantId_idempotencyKey_key" ON "attendance_sessions"("tenantId", "idempotencyKey");
CREATE UNIQUE INDEX "attendance_sessions_tenantId_branchId_academicUnitId_attendanceDate_sessionLabel_key" ON "attendance_sessions"("tenantId", "branchId", "academicUnitId", "attendanceDate", "sessionLabel");
CREATE INDEX "attendance_sessions_tenantId_academicUnitId_attendanceDate_idx" ON "attendance_sessions"("tenantId", "academicUnitId", "attendanceDate");
CREATE INDEX "attendance_sessions_tenantId_branchId_attendanceDate_idx" ON "attendance_sessions"("tenantId", "branchId", "attendanceDate");
CREATE INDEX "attendance_sessions_tenantId_markedBy_idx" ON "attendance_sessions"("tenantId", "markedBy");

CREATE TABLE "attendance_records" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "sessionId" UUID NOT NULL,
  "studentId" UUID NOT NULL,
  "status" "AttendanceStatus" NOT NULL,
  "remarks" VARCHAR(500),
  "updatedBy" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "attendance_records_tenantId_sessionId_fkey" FOREIGN KEY ("tenantId", "sessionId") REFERENCES "attendance_sessions"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "attendance_records_tenantId_studentId_fkey" FOREIGN KEY ("tenantId", "studentId") REFERENCES "students"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "attendance_records_tenantId_updatedBy_fkey" FOREIGN KEY ("tenantId", "updatedBy") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "attendance_records_tenantId_id_key" ON "attendance_records"("tenantId", "id");
CREATE UNIQUE INDEX "attendance_records_tenantId_sessionId_studentId_key" ON "attendance_records"("tenantId", "sessionId", "studentId");
CREATE INDEX "attendance_records_tenantId_sessionId_idx" ON "attendance_records"("tenantId", "sessionId");
CREATE INDEX "attendance_records_tenantId_studentId_createdAt_idx" ON "attendance_records"("tenantId", "studentId", "createdAt");
CREATE INDEX "attendance_records_tenantId_updatedBy_idx" ON "attendance_records"("tenantId", "updatedBy");

INSERT INTO "permissions" ("id", "key", "resource", "action", "description", "sensitive") VALUES
  (gen_random_uuid(), 'attendance.read', 'attendance', 'read', 'Read branch-scoped attendance and linked portal records.', false),
  (gen_random_uuid(), 'attendance.mark', 'attendance', 'mark', 'Mark attendance for an authorized branch and group.', false),
  (gen_random_uuid(), 'attendance.correct', 'attendance', 'correct', 'Correct existing attendance records; changes are audited.', true)
ON CONFLICT ("key") DO NOTHING;

ALTER TABLE "notifications" ADD COLUMN "readAt" TIMESTAMP(3);
CREATE INDEX "notifications_tenantId_recipientType_recipientId_createdAt_idx"
  ON "notifications"("tenantId", "recipientType", "recipientId", "createdAt");
