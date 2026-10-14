-- Generated from prisma/schema.prisma and the explicit additive tenant-person relation registry.
-- Validate rows after indexes and the NOT VALID constraints are installed.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30min';
ALTER TABLE "adjustments" VALIDATE CONSTRAINT "adjustments_tenantId_personId_fkey";
ALTER TABLE "attendance_records" VALIDATE CONSTRAINT "attendance_records_tenantId_personId_fkey";
ALTER TABLE "attendance_sessions" VALIDATE CONSTRAINT "attendance_sessions_tenantId_personGroupId_fkey";
ALTER TABLE "credits" VALIDATE CONSTRAINT "credits_tenantId_personId_fkey";
ALTER TABLE "fee_demands" VALIDATE CONSTRAINT "fee_demands_tenantId_personId_fkey";
ALTER TABLE "invoices" VALIDATE CONSTRAINT "invoices_tenantId_personId_fkey";
ALTER TABLE "notifications" VALIDATE CONSTRAINT "notifications_tenantId_personId_fkey";
ALTER TABLE "payment_orders" VALIDATE CONSTRAINT "payment_orders_tenantId_personId_fkey";
ALTER TABLE "payments" VALIDATE CONSTRAINT "payments_tenantId_personId_fkey";
ALTER TABLE "receipts" VALIDATE CONSTRAINT "receipts_tenantId_personId_fkey";
ALTER TABLE "students" VALIDATE CONSTRAINT "students_tenantId_personId_fkey";
ALTER TABLE "tenant_people" VALIDATE CONSTRAINT "tenant_people_tenantId_branchId_fkey";
ALTER TABLE "tenant_person_group_members" VALIDATE CONSTRAINT "tenant_person_group_members_tenantId_groupId_fkey";
ALTER TABLE "tenant_person_group_members" VALIDATE CONSTRAINT "tenant_person_group_members_tenantId_personId_fkey";
ALTER TABLE "users" VALIDATE CONSTRAINT "users_tenantId_tenantPersonId_fkey";
COMMIT;
