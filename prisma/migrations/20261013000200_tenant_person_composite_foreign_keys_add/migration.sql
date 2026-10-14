-- Generated from prisma/schema.prisma and the explicit additive tenant-person relation registry.
-- These relations were introduced with the shared tenant person identity.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '1min';
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_tenantId_personId_fkey" FOREIGN KEY ("tenantId", "personId") REFERENCES "tenant_people" ("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_tenantId_personId_fkey" FOREIGN KEY ("tenantId", "personId") REFERENCES "tenant_people" ("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_tenantId_personGroupId_fkey" FOREIGN KEY ("tenantId", "personGroupId") REFERENCES "tenant_person_groups" ("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "credits" ADD CONSTRAINT "credits_tenantId_personId_fkey" FOREIGN KEY ("tenantId", "personId") REFERENCES "tenant_people" ("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "fee_demands" ADD CONSTRAINT "fee_demands_tenantId_personId_fkey" FOREIGN KEY ("tenantId", "personId") REFERENCES "tenant_people" ("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenantId_personId_fkey" FOREIGN KEY ("tenantId", "personId") REFERENCES "tenant_people" ("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenantId_personId_fkey" FOREIGN KEY ("tenantId", "personId") REFERENCES "tenant_people" ("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_tenantId_personId_fkey" FOREIGN KEY ("tenantId", "personId") REFERENCES "tenant_people" ("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenantId_personId_fkey" FOREIGN KEY ("tenantId", "personId") REFERENCES "tenant_people" ("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenantId_personId_fkey" FOREIGN KEY ("tenantId", "personId") REFERENCES "tenant_people" ("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "students" ADD CONSTRAINT "students_tenantId_personId_fkey" FOREIGN KEY ("tenantId", "personId") REFERENCES "tenant_people" ("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "tenant_people" ADD CONSTRAINT "tenant_people_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "branches" ("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE NOT VALID;
ALTER TABLE "tenant_person_group_members" ADD CONSTRAINT "tenant_person_group_members_tenantId_groupId_fkey" FOREIGN KEY ("tenantId", "groupId") REFERENCES "tenant_person_groups" ("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "tenant_person_group_members" ADD CONSTRAINT "tenant_person_group_members_tenantId_personId_fkey" FOREIGN KEY ("tenantId", "personId") REFERENCES "tenant_people" ("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_tenantPersonId_fkey" FOREIGN KEY ("tenantId", "tenantPersonId") REFERENCES "tenant_people" ("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
COMMIT;
